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
    void notify("Preparing local clone", `${repo} — first agent run sets up a working copy`);
    await git(["clone", "--filter=blob:none", "--no-checkout", gh.authedCloneUrl(repo), clonePath]);
  } else {
    // keep the remote URL fresh in case the token rotated
    await git(["remote", "set-url", "origin", gh.authedCloneUrl(repo)], clonePath);
  }
  return clonePath;
}

const branchWorktreePath = (dataDir: string, repo: string, branch: string) =>
  `${dataDir}/worktrees/${sanitize(repo)}/${sanitize(branch)}`;

/**
 * Get a worktree on the PR's head branch. One PERSISTENT worktree per branch,
 * reused across runs: code is hard-synced to the remote tip (`reset --hard` +
 * `clean -fd`), while git-ignored artifacts — node_modules, target/, venvs —
 * survive, so any dependency install is paid at most once per PR, not per
 * run. If the persistent worktree is busy with another agent, a throwaway one
 * is created instead. The agent pushes with `git push origin HEAD:<branch>`.
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
  await git(["fetch", "origin", pr.headRef, pr.baseRef], clonePath);
  const dataDir = await native.appDataDir();
  const stablePath = branchWorktreePath(dataDir, repo, pr.headRef);
  const localBranch = `pr-copilot/${sanitize(pr.headRef)}`;

  const busy = activeAgentCwds().some((c) => c.startsWith(stablePath));
  if (!busy) {
    if (await isGitRepo(stablePath)) {
      // reuse: sync code to the remote tip; ignored files (deps) survive
      await git(["reset", "--hard", `origin/${pr.headRef}`], stablePath);
      await git(["clean", "-fd"], stablePath);
      return { path: stablePath, localBranch, prBranch: pr.headRef, clonePath, persistent: true };
    }
    await git(["worktree", "add", "-B", localBranch, stablePath, `origin/${pr.headRef}`], clonePath);
    return { path: stablePath, localBranch, prBranch: pr.headRef, clonePath, persistent: true };
  }

  // persistent worktree is occupied — fall back to a throwaway
  const tmpBranch = `pr-copilot/tmp-${uid()}`;
  const tmpPath = `${stablePath}-tmp-${uid()}`;
  await git(["worktree", "add", "-b", tmpBranch, tmpPath, `origin/${pr.headRef}`], clonePath);
  return { path: tmpPath, localBranch: tmpBranch, prBranch: pr.headRef, clonePath, persistent: false };
}

/** Post-run cleanup: persistent worktrees stay for reuse; temp ones go. */
export async function releaseWorktree(wt: Worktree): Promise<void> {
  if (wt.persistent) return;
  try {
    await git(["worktree", "remove", "--force", wt.path], wt.clonePath);
  } catch (e) {
    console.warn("worktree cleanup failed", e);
  }
  try {
    await git(["branch", "-D", wt.localBranch], wt.clonePath);
  } catch {
    /* branch may not exist */
  }
}

/**
 * Reclaim the persistent worktree for a branch whose PR closed/merged.
 * No-op while an agent is still using it.
 */
export async function pruneBranchWorktree(repo: string, branch: string): Promise<void> {
  try {
    const dataDir = await native.appDataDir();
    const path = branchWorktreePath(dataDir, repo, branch);
    if (activeAgentCwds().some((c) => c.startsWith(path))) return;
    if (!(await isGitRepo(path))) return;
    // find the owning clone before deleting, so we can prune its registry
    const common = (await git(["rev-parse", "--git-common-dir"], path)).trim();
    const mainRepo = common.endsWith("/.git") ? common.slice(0, -5) : common;
    await native.runExec("rm", ["-rf", path]);
    await git(["worktree", "prune"], mainRepo).catch(() => undefined);
    await git(["branch", "-D", `pr-copilot/${sanitize(branch)}`], mainRepo).catch(() => undefined);
  } catch (e) {
    console.warn("worktree prune failed", e);
  }
}

/** True when the worktree produced commits not yet on the PR branch tip. */
export async function worktreeHasNewCommits(wt: Worktree, baseSha: string): Promise<boolean> {
  try {
    const head = (await git(["rev-parse", "HEAD"], wt.path)).trim();
    return head !== baseSha;
  } catch {
    return false;
  }
}
