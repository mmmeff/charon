import { native } from "./tauri";
import { notify } from "./notify";
import { uid } from "./template";
import type { GitHubClient } from "./github";
import type { PrSummary } from "../types";

export interface Worktree {
  path: string;
  localBranch: string;
  prBranch: string;
  clonePath: string;
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

/**
 * Create a worktree checked out on the PR's head branch (unique local branch
 * name so multiple agents can work the same PR without collisions). The agent
 * pushes with `git push origin HEAD:<pr-branch>`.
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
  const localBranch = `pr-copilot/${sanitize(pr.headRef)}-${uid()}`;
  const path = `${dataDir}/worktrees/${sanitize(repo)}/${sanitize(pr.headRef)}-${uid()}`;
  await git(
    ["worktree", "add", "-b", localBranch, path, `origin/${pr.headRef}`],
    clonePath
  );
  return { path, localBranch, prBranch: pr.headRef, clonePath };
}

export async function removeWorktree(wt: Worktree): Promise<void> {
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

/** True when the worktree produced commits not yet on the PR branch tip. */
export async function worktreeHasNewCommits(wt: Worktree, baseSha: string): Promise<boolean> {
  try {
    const head = (await git(["rev-parse", "HEAD"], wt.path)).trim();
    return head !== baseSha;
  } catch {
    return false;
  }
}
