/** Fixture data for the design preview. Preview-only. */
import { defaultGlobalConfig, defaultRepoConfig } from "../../src/lib/defaults";
import type { AgentRun, AgentToolCall, CheckInfo, CommentInfo, PrSummary } from "../../src/types";

export const REPO = "acme/charon";
const KEY = "acme__charon";
const NOW = Date.now();

const basePr: PrSummary = {
  number: 4821,
  title: "Reject unreachable worktree paths before the fix flow commits",
  body:
    "The fix flow assumed `localClonePath` still resolved. When a clone is moved or\n" +
    "deleted the worktree lease succeeds against a stale path and the agent commits\n" +
    "into nothing, so `validateAndPush` reports success with an empty tree.\n\n" +
    "## What changed\n\n" +
    "- Probe the clone path on lease and fail loudly when it is gone.\n" +
    "- Send rejected commits to `pr-copilot/rejected/<runId>` instead of dropping them.\n" +
    "- Cover the moved-clone case in the worktree integration test.\n\n" +
    "Closes #4790.",
  author: "mfrey",
  authorIsBot: false,
  draft: false,
  state: "open",
  merged: false,
  headRef: "mfrey/reject-unreachable-worktrees",
  headSha: "9f2c41a8e77b3d5064ab19cc8d2e5510aa73bc61",
  headRepoFullName: REPO,
  baseRef: "main",
  baseSha: "1c0de9b4a2f8",
  labels: ["native", "worktree"],
  url: "https://github.com/acme/charon/pull/4821",
  mergeableState: "unstable",
  autoMerge: true,
  requestedReviewers: ["dsato"],
  requestedTeams: ["platform"],
  reviewers: ["kwatanabe"],
  requestedFromMe: false,
  reviewDecision: "CHANGES_REQUESTED",
  updatedAt: new Date(NOW - 1000 * 60 * 47).toISOString(),
  additions: 142,
  deletions: 38,
  changedFiles: 7,
};

export const prs: PrSummary[] = [
  basePr,
  {
    ...basePr,
    number: 4822,
    title: "Bump rustls to 0.23.14 to pick up the CVE-2025-1122 fix",
    author: "dependabot[bot]",
    authorIsBot: true,
    labels: ["dependencies"],
    mergeableState: "clean",
    autoMerge: false,
    reviewDecision: "APPROVED",
    additions: 4,
    deletions: 4,
    changedFiles: 2,
    headRef: "dependabot/cargo/rustls-0.23.14",
    updatedAt: new Date(NOW - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    ...basePr,
    number: 4818,
    title: "Draft: split the ACP stall diagnostic out of agents.ts",
    draft: true,
    mergeableState: "dirty",
    autoMerge: false,
    reviewDecision: null,
    additions: 613,
    deletions: 402,
    changedFiles: 31,
    headRef: "mfrey/acp-stall-diagnostic",
    updatedAt: new Date(NOW - 1000 * 60 * 60 * 26).toISOString(),
  },
  {
    ...basePr,
    number: 4805,
    title: "Fix the rail tooltip clipping under the top strip",
    author: "kwatanabe",
    requestedFromMe: true,
    mergeableState: "clean",
    autoMerge: false,
    reviewDecision: "REVIEW_REQUIRED",
    additions: 11,
    deletions: 3,
    changedFiles: 1,
    headRef: "kwatanabe/tooltip-clip",
    updatedAt: new Date(NOW - 1000 * 60 * 60 * 3).toISOString(),
  },
];

export const deepStackPrs: PrSummary[] = Array.from({ length: 7 }, (_, index) => {
  const number = 4900 + index;
  const headRef = `mfrey/stack-layer-${index + 1}-with-a-deliberately-long-branch-name`;
  const baseRef = index === 0 ? "main" : `mfrey/stack-layer-${index}-with-a-deliberately-long-branch-name`;
  return {
    ...basePr,
    number,
    title: `[STACK-${index + 1}] Carry the review context through a deeply nested pull request`,
    draft: true,
    headRef,
    baseRef,
    url: `https://github.com/acme/charon/pull/${number}`,
    mergeableState: index % 2 === 0 ? "dirty" : "clean",
    additions: 180 * (index + 1),
    deletions: 37 * (index + 1),
    changedFiles: index + 2,
    updatedAt: new Date(NOW - 1000 * 60 * 60 * (index + 1)).toISOString(),
  };
});

export const greenPr: PrSummary = {
  ...prs[0],
  number: 4830,
  title: "Cache the clone-root probe for the poll window",
  headRef: "mfrey/cache-clone-probe",
  mergeableState: "clean",
  autoMerge: false,
  reviewDecision: "APPROVED",
  requestedReviewers: [],
  reviewers: ["dsato", "kwatanabe"],
  labels: ["worktree"],
  additions: 26,
  deletions: 9,
  changedFiles: 2,
};

export const greenChecks: CheckInfo[] = [
  { name: "typecheck", status: "completed", conclusion: "success", url: "#", id: 11 },
  { name: "lint", status: "completed", conclusion: "success", url: "#", id: 12 },
  { name: "cargo check (aarch64-apple-darwin)", status: "completed", conclusion: "success", url: "#", id: 13 },
  { name: "e2e (chromium)", status: "completed", conclusion: "success", url: "#", id: 14 },
  { name: "e2e (webkit)", status: "completed", conclusion: "success", url: "#", id: 15 },
  { name: "bundle size", status: "completed", conclusion: "success", url: "#", id: 16 },
];

export const checks: CheckInfo[] = [
  { name: "typecheck", status: "completed", conclusion: "success", url: "#", id: 1,
    startedAt: new Date(NOW - 1000 * 60 * 22).toISOString(), completedAt: new Date(NOW - 1000 * 60 * 20).toISOString() },
  { name: "lint", status: "completed", conclusion: "success", url: "#", id: 2 },
  { name: "cargo check (aarch64-apple-darwin)", status: "completed", conclusion: "failure", url: "#", id: 3,
    outputTitle: "1 error",
    outputSummary: "error[E0308]: mismatched types\n  --> src/lib.rs:412:19\n     expected `&Path`, found `PathBuf`" },
  { name: "e2e (chromium)", status: "completed", conclusion: "failure", url: "#", id: 4,
    outputTitle: "2 failing specs", outputSummary: "worktree.e2e.ts: lease rejects a moved clone — timed out after 30000ms" },
  { name: "e2e (webkit)", status: "in_progress", conclusion: null, url: "#", id: 5 },
  { name: "bundle size", status: "queued", conclusion: null, url: "#", id: 6 },
  { name: "codeql", status: "completed", conclusion: "skipped", url: "#", id: 7 },
];

export const comments: CommentInfo[] = [
  { id: 9001, kind: "issue", author: "kwatanabe", authorIsBot: false,
    body: "Does the rescue branch get pruned anywhere, or do these accumulate per failed run?",
    createdAt: new Date(NOW - 1000 * 60 * 90).toISOString(), url: "#" },
  { id: 9002, kind: "review_comment", author: "dsato", authorIsBot: false,
    body: "This probe runs on every lease. Worth caching per clone path for the poll window.",
    createdAt: new Date(NOW - 1000 * 60 * 55).toISOString(), url: "#",
    path: "src/lib/worktree.ts", line: 84, side: "RIGHT" },
];

const toolset: Record<string, AgentToolCall> = {
  t1: {
    toolCallId: "t1",
    title: "src/lib/worktree.ts",
    kind: "read",
    status: "completed",
    locations: ["src/lib/worktree.ts:78"],
    input: "src/lib/worktree.ts",
  },
  t2: {
    toolCallId: "t2",
    title: "grep localClonePath",
    kind: "search",
    status: "completed",
    locations: [],
    input: "localClonePath",
    output: "src/lib/worktree.ts:78\nsrc/lib/flows.ts:39\nsrc/types.ts:201",
  },
  t3: {
    toolCallId: "t3",
    title: "src/lib/worktree.ts",
    kind: "edit",
    status: "completed",
    locations: ["src/lib/worktree.ts:84"],
    output: "@@ -78,12 +78,21 @@\n-  const dir = resolve(root);\n+  if (!(await pathExists(root))) {\n+    throw new Error(`clone root is unreachable: ${root}`);\n+  }",
  },
  t4: {
    toolCallId: "t4",
    title: "npm run typecheck",
    kind: "execute",
    status: "in_progress",
    locations: [],
    input: "npm run typecheck",
  },
};

const baseRun: AgentRun = {
  id: "run-1",
  kind: "ci_fix",
  relation: "CI fix",
  repo: REPO,
  prNumber: 4821,
  prTitle: basePr.title,
  prompt: "cargo check is red on aarch64. Read the error and fix the type mismatch.",
  model: "claude-opus-4",
  cwd: "/preview/worktrees/charon-4821",
  status: "running",
  startedAt: NOW - 1000 * 190,
  endedAt: null,
  exitCode: null,
  entries: [
    { type: "thought", at: NOW - 1000 * 188, text: "The failure is at src/lib.rs:412. resolve() takes &Path but the caller hands it a PathBuf." },
    { type: "tool", at: NOW - 1000 * 180, toolCallId: "t1" },
    { type: "message", at: NOW - 1000 * 170, text: "`resolve` borrows, so the call site needs `&path` rather than moving the `PathBuf`.\n\nI will also probe the clone root first so a moved clone fails before any commit lands." },
    { type: "tool", at: NOW - 1000 * 150, toolCallId: "t2" },
    { type: "tool", at: NOW - 1000 * 120, toolCallId: "t3" },
    { type: "tool", at: NOW - 1000 * 40, toolCallId: "t4" },
  ],
  tools: toolset,
  plan: [
    { content: "Reproduce the type error locally", status: "completed" },
    { content: "Borrow the path at the call site", status: "completed" },
    { content: "Probe the clone root on lease", status: "in_progress" },
    { content: "Run the validation command", status: "pending" },
  ],
  steerable: true,
  resultText: "",
  proposalIds: [],
};

export const runs: AgentRun[] = [
  baseRun,
  {
    ...baseRun,
    id: "run-2",
    kind: "review",
    relation: "review",
    status: "done",
    steerable: false,
    startedAt: NOW - 1000 * 60 * 22,
    endedAt: NOW - 1000 * 60 * 19,
    exitCode: 0,
    plan: [],
    entries: [
      { type: "message", at: NOW - 1000 * 60 * 19, text: "Two findings.\n\n1. `validateAndPush` still reports success on an empty tree — check `git diff --quiet` before pushing.\n2. The rescue branch name collides when a run is retried with the same id." },
    ],
    resultText: "Two findings.",
  },
  {
    ...baseRun,
    id: "run-3",
    kind: "ci_fix",
    relation: "CI fix",
    status: "error",
    steerable: false,
    startedAt: NOW - 1000 * 60 * 61,
    endedAt: NOW - 1000 * 60 * 60,
    exitCode: 1,
    plan: [],
    entries: [{ type: "thought", at: NOW - 1000 * 60 * 61, text: "Opening the worktree." }],
    error: "opencode: provider returned 429 (rate limit)",
    errorDetail: "code: -32000\ndata: { provider: 'anthropic', status: 429 }\nstderr: stream error: rate_limit_exceeded — retry after 41s",
    resultText: "",
  },
  {
    ...baseRun,
    id: "run-4",
    kind: "feedback_fix",
    relation: "comment fix",
    status: "killed",
    steerable: false,
    startedAt: NOW - 1000 * 60 * 140,
    endedAt: NOW - 1000 * 60 * 138,
    exitCode: null,
    plan: [],
    entries: [{ type: "message", at: NOW - 1000 * 60 * 139, text: "Stopped before the first edit." }],
    resultText: "",
  },
];

/** A draft_create run with no PR yet: drives the pending-draft hero. */
export const pendingDraftRun: AgentRun = {
  ...runs[0],
  id: "run-draft-1",
  kind: "draft_create",
  relation: "new draft",
  prNumber: null,
  prTitle: "",
  prompt: "Add a rescue branch for commits the validation command refuses.",
  status: "running",
  plan: [
    { content: "Read validateAndPush", status: "completed" },
    { content: "Add rescueBranch helper", status: "in_progress" },
  ],
  draftCreate: {
    baseBranch: "main",
    branch: "mfrey/rescue-branch",
    worktreePath: "/preview/worktrees/charon-draft-1",
  },
};

export const diffText = `diff --git a/src/lib/worktree.ts b/src/lib/worktree.ts
index 3a1f9c2..7b4e881 100644
--- a/src/lib/worktree.ts
+++ b/src/lib/worktree.ts
@@ -78,12 +78,21 @@ export async function leaseFixWorktree(
   const root = cloneRoot(clonePath);
-  const dir = resolve(root);
-  await gitIn(dir, ["worktree", "add", "--detach", target, sha]);
+  // A moved or deleted clone used to lease successfully against a stale path,
+  // so the agent committed into nothing and validateAndPush reported success.
+  if (!(await pathExists(root))) {
+    throw new Error(\`clone root is unreachable: \${root}\`);
+  }
+  const dir = resolve(&root);
+  await gitIn(dir, ["worktree", "add", "--detach", target, sha]);
+  if (!(await pathExists(target))) {
+    throw new Error(\`worktree did not materialise at \${target}\`);
+  }
   return { path: target, sha, leasedAt: Date.now() };
 }
 
+/** Rescue branch for a commit the validation command refused. */
+export function rescueBranch(runId: string): string {
+  return \`pr-copilot/rejected/\${runId}\`;
+}
+
 export async function pruneWorktrees(clonePath: string): Promise<void> {
   const root = cloneRoot(clonePath);
   await gitIn(root, ["worktree", "prune"]);
diff --git a/src/lib/flows.ts b/src/lib/flows.ts
index 91cc4de..a2f0117 100644
--- a/src/lib/flows.ts
+++ b/src/lib/flows.ts
@@ -244,8 +244,14 @@ export async function validateAndPush(
   const head = (await gitIn(wt, ["rev-parse", "HEAD"])).trim();
   try {
     const dirty = (await gitIn(wt, ["status", "--porcelain"])).trim();
-    if (!dirty) return null;
+    if (!dirty) {
+      log.warn("validateAndPush: nothing staged", { runId, head });
+      return null;
+    }
     await runValidation(ctx, wt);
   } catch (e) {
+    await gitIn(wt, ["branch", rescueBranch(runId)]);
     throw e;
   }
   return head;
 }
`;

export const blobs: Record<string, string> = {
  "global.json": JSON.stringify({
    ...defaultGlobalConfig(),
    githubUrl: "https://github.com",
    token: "preview-token",
    login: "mfrey",
    lastRepo: REPO,
  }),
  [`repos/${KEY}/config.json`]: JSON.stringify({
    ...defaultRepoConfig(),
    localClonePath: "/preview/clones/charon",
    validationCommand: "npm run typecheck && npm run lint",
  }),
  [`repos/${KEY}/snapshots.json`]: JSON.stringify({}),
  [`repos/${KEY}/proposals.json`]: JSON.stringify([]),
  [`repos/${KEY}/events.json`]: JSON.stringify([]),
  [`repos/${KEY}/findings.json`]: JSON.stringify({ findings: [], summaries: {} }),
  [`repos/${KEY}/dismissed-ask.json`]: JSON.stringify([]),
};
