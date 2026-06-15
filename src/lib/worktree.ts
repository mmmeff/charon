import { native } from "./tauri";
import { notify } from "./notify";
import { uid } from "./template";
import { useAgentStore } from "./store";
import type { GitHubClient } from "./github";
import type { PrSummary } from "../types";

export interface Worktree {
  path: string;
  localBranch: string;
  prBranch: string;
  clonePath: string;
  /** persistent worktrees are reused across runs (deps survive); temp ones are removed */
  persistent: boolean;
  /** HEAD sha the worktree started from — compare against the post-run HEAD to
   *  tell whether the agent actually produced a commit (and which one). */
  baseSha: string;
}

/** cwd of every agent currently executing — used to avoid touching busy worktrees */
function activeAgentCwds(): string[] {
  return Object.values(useAgentStore.getState().runs)
    .filter((r) => r.status === "running" || r.status === "starting")
    .map((r) => r.cwd ?? "")
    .filter(Boolean);
}

async function git(args: string[], cwd?: string): Promise<string> {
  const res = await native.runGit(args, cwd);
  if (res.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${res.code}):\n${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_.-]/g, "-");

/**
 * Ensure a local clone exists for the repo. Uses the user-configured path if
 * set (must already be a clone); otherwise maintains an app-managed bare-ish
 * clone under appData/clones.
 */
/**
 * Is `path` a git repository? Tolerates the directory not existing at all —
 * spawning git with a missing cwd fails at the OS level (ENOENT), which must
 * read as "no repo here yet", not as an error.
 */
async function isGitRepo(path: string): Promise<boolean> {
  try {
    const r = await native.runGit(["rev-parse", "--git-dir"], path);
    return r.code === 0;
  } catch {
    return false;
  }
}

export async function ensureClone(
  gh: GitHubClient,
  repo: string,
  configuredPath: string
): Promise<string> {
  if (configuredPath.trim()) {
    const p = configuredPath.trim();
    if (!(await isGitRepo(p))) {
      throw new Error(
        `Configured clone path is not a git repository: ${p} — fix it in Settings, or clear it to let the app manage its own clone.`
      );
    }
    return p;
  }
  const dataDir = await native.appDataDir();
  const clonePath = `${dataDir}/clones/${sanitize(repo)}`;
  if (!(await isGitRepo(clonePath))) {
    // first use: create the managed clone. Blobless partial clone keeps this
    // fast even on huge repos — worktree checkouts fetch blobs on demand.
    void notify("clone_setup", "Preparing local clone", `${repo} — first agent run sets up a working copy`);
    await git(["clone", "--filter=blob:none", "--no-checkout", gh.authedCloneUrl(repo), clonePath]);
  } else {
    // keep the remote URL fresh in case the token rotated
    await git(["remote", "set-url", "origin", gh.authedCloneUrl(repo)], clonePath);
  }
  return clonePath;
}

const branchWorktreePath = (dataDir: string, repo: string, branch: string) =>
  `${dataDir}/worktrees/${sanitize(repo)}/${sanitize(branch)}`;

/** How many persistent (dep-caching) worktrees a single branch may have. */
const MAX_BRANCH_SLOTS = 3;

/** Slot 0 keeps the historical single-worktree path so existing caches survive. */
function slotInfo(dataDir: string, repo: string, branch: string, slot: number) {
  const base = branchWorktreePath(dataDir, repo, branch);
  const suffix = slot === 0 ? "" : `--${slot + 1}`;
  return {
    path: `${base}${suffix}`,
    localBranch: `pr-copilot/${sanitize(branch)}${suffix}`,
  };
}

/**
 * Worktrees handed out but not yet released. Agent cwds only become visible in
 * the agent store after spawn, so this set closes the allocation→spawn gap —
 * without it, two simultaneous applies could be handed the same slot.
 */
const leases = new Set<string>();

function isBusy(path: string): boolean {
  if (leases.has(path)) return true;
  return activeAgentCwds().some((c) => c === path || c.startsWith(`${path}/`));
}

/**
 * Per-clone async mutex. Concurrent `fetch` / `worktree add` against the same
 * clone can trip over git's lock files, so all clone-mutating setup runs
 * serialized; agents then work in their own worktrees fully in parallel.
 */
const cloneLocks = new Map<string, Promise<unknown>>();
async function withCloneLock<T>(clonePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = cloneLocks.get(clonePath) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  cloneLocks.set(clonePath, next);
  try {
    return await next;
  } finally {
    if (cloneLocks.get(clonePath) === next) cloneLocks.delete(clonePath);
  }
}

/**
 * Get a worktree on the PR's head branch. Each branch has a small pool of
 * PERSISTENT worktree slots reused across runs: code is hard-synced to the
 * remote tip (`reset --hard` + `clean -fd`), while git-ignored artifacts —
 * node_modules, target/, venvs — survive, so any dependency install is paid
 * at most once per slot, not per run. Concurrent runs on the same branch each
 * get their own slot (lowest free slot first, so the warmest caches are
 * preferred); past the pool cap, a throwaway worktree is created. The agent
 * pushes with `git push origin HEAD:<branch>`.
 */
export async function createWorktree(
  gh: GitHubClient,
  repo: string,
  configuredClonePath: string,
  pr: PrSummary
): Promise<Worktree> {
  if (pr.headRepoFullName && pr.headRepoFullName !== repo) {
    throw new Error(
      `PR #${pr.number} comes from a fork (${pr.headRepoFullName}); automated pushes are limited to same-repo branches.`
    );
  }
  const clonePath = await ensureClone(gh, repo, configuredClonePath);
  const dataDir = await native.appDataDir();

  return withCloneLock(clonePath, async () => {
    await git(["fetch", "origin", pr.headRef, pr.baseRef], clonePath);

    for (let slot = 0; slot < MAX_BRANCH_SLOTS; slot++) {
      const { path, localBranch } = slotInfo(dataDir, repo, pr.headRef, slot);
      if (isBusy(path)) continue;
      if (await isGitRepo(path)) {
        // reuse: sync code to the remote tip; ignored files (deps) survive
        await git(["reset", "--hard", `origin/${pr.headRef}`], path);
        await git(["clean", "-fd"], path);
      } else {
        await git(["worktree", "add", "-B", localBranch, path, `origin/${pr.headRef}`], clonePath);
      }
      leases.add(path);
      const baseSha = (await git(["rev-parse", "HEAD"], path)).trim();
      return { path, localBranch, prBranch: pr.headRef, clonePath, persistent: true, baseSha };
    }

    // every persistent slot is occupied — fall back to a throwaway
    const tmpBranch = `pr-copilot/tmp-${uid()}`;
    const tmpPath = `${branchWorktreePath(dataDir, repo, pr.headRef)}-tmp-${uid()}`;
    await git(["worktree", "add", "-b", tmpBranch, tmpPath, `origin/${pr.headRef}`], clonePath);
    leases.add(tmpPath);
    const baseSha = (await git(["rev-parse", "HEAD"], tmpPath)).trim();
    return { path: tmpPath, localBranch: tmpBranch, prBranch: pr.headRef, clonePath, persistent: false, baseSha };
  });
}

/**
 * Read-only worktree at the PR head, for review agents that need the full
 * project to investigate — not just the diff. Same-repo PRs reuse the
 * standard branch slots (dep caches and all); fork PRs check out GitHub's
 * `pull/<n>/head` ref detached in a throwaway worktree, since their branch
 * doesn't exist in this repo.
 */
export async function createReviewWorktree(
  gh: GitHubClient,
  repo: string,
  configuredClonePath: string,
  pr: PrSummary
): Promise<Worktree> {
  if (!pr.headRepoFullName || pr.headRepoFullName === repo) {
    return createWorktree(gh, repo, configuredClonePath, pr);
  }
  const clonePath = await ensureClone(gh, repo, configuredClonePath);
  const dataDir = await native.appDataDir();
  return withCloneLock(clonePath, async () => {
    await git(["fetch", "origin", `pull/${pr.number}/head`], clonePath);
    const tmpPath = `${dataDir}/worktrees/${sanitize(repo)}/pr-${pr.number}-${uid()}`;
    await git(["worktree", "add", "--detach", tmpPath, pr.headSha], clonePath);
    leases.add(tmpPath);
    return { path: tmpPath, localBranch: "", prBranch: pr.headRef, clonePath, persistent: false, baseSha: pr.headSha };
  });
}

/** Post-run cleanup: persistent worktrees stay for reuse; temp ones go. */
export async function releaseWorktree(wt: Worktree): Promise<void> {
  leases.delete(wt.path);
  if (wt.persistent) return;
  await withCloneLock(wt.clonePath, async () => {
    try {
      await git(["worktree", "remove", "--force", wt.path], wt.clonePath);
    } catch (e) {
      console.warn("worktree cleanup failed", e);
    }
    if (wt.localBranch) {
      try {
        await git(["branch", "-D", wt.localBranch], wt.clonePath);
      } catch {
        /* branch may not exist */
      }
    }
  });
}

/**
 * Reclaim the persistent worktree slots for a branch whose PR closed/merged.
 * Slots still in use by an agent are skipped.
 */
export async function pruneBranchWorktree(repo: string, branch: string): Promise<void> {
  const dataDir = await native.appDataDir();
  for (let slot = 0; slot < MAX_BRANCH_SLOTS; slot++) {
    try {
      const { path, localBranch } = slotInfo(dataDir, repo, branch, slot);
      if (isBusy(path)) continue;
      if (!(await isGitRepo(path))) continue;
      // find the owning clone before deleting, so we can prune its registry
      const common = (await git(["rev-parse", "--git-common-dir"], path)).trim();
      const mainRepo = common.endsWith("/.git") ? common.slice(0, -5) : common;
      await native.runExec("rm", ["-rf", path]);
      await git(["worktree", "prune"], mainRepo).catch(() => undefined);
      await git(["branch", "-D", localBranch], mainRepo).catch(() => undefined);
    } catch (e) {
      console.warn("worktree prune failed", e);
    }
  }
}

/** The worktree's current HEAD sha, or null if it can't be read. Compare to
 *  `wt.baseSha` to tell whether the agent committed anything this run. */
export async function worktreeHead(wt: Worktree): Promise<string | null> {
  try {
    return (await git(["rev-parse", "HEAD"], wt.path)).trim();
  } catch {
    return null;
  }
}
