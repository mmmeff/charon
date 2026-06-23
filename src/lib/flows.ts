import type {
  CommentInfo,
  AgentRun,
  GlobalConfig,
  LineSelection,
  Proposal,
  ProposedInlineComment,
  PrStackIndex,
  PrSummary,
  RepoConfig,
  ReviewFinding,
  Severity,
  Skill,
} from "../types";
import { cleanResultText, extractProposalJson, startAgent } from "./agents";
import { lineInDiff, lineTextAt, nearestDiffLine, parseUnifiedDiff } from "./diff";
import type { GitHubClient } from "./github";
import { applySkills } from "./skills";
import { native } from "./tauri";
import { interpolate, prVars, truncate, uid } from "./template";
import { useAgentStore, useRepoStore } from "./store";
import {
  createDraftCreationWorktree,
  createReviewWorktree,
  createWorktree,
  removeWorktree,
  preserveWorktree,
  releaseWorktree,
  worktreeHead,
  type Worktree,
} from "./worktree";

/**
 * Best-effort full-project checkout for review agents. Reviews must not fail
 * just because no clone can be provisioned — they degrade to diff-only.
 */
async function tryReviewWorktree(ctx: FlowContext, pr: PrSummary): Promise<Worktree | null> {
  try {
    return await createReviewWorktree(ctx.gh, ctx.repo, ctx.config.localClonePath, pr);
  } catch (e) {
    console.warn("review worktree unavailable — falling back to diff-only review", e);
    return null;
  }
}

const reviewWorkspaceBlock = (wt: Worktree | null, pr: PrSummary) =>
  wt
    ? `
Your working directory is a checkout of the FULL repository at this PR's head commit (${pr.headSha}).
Investigate freely before judging the diff: read the surrounding code, trace callers and implementations,
check how similar things are done elsewhere in the project. You are running read-only — never modify files.
`
    : `
(No local checkout is available — review from the diff and PR context alone.)
`;

export interface FlowContext {
  gh: GitHubClient;
  repo: string;
  config: RepoConfig;
  global: GlobalConfig;
  skills: Skill[];
  prStacks: PrStackIndex;
}

const MAX_DIFF_CHARS = 90_000;

/**
 * Model resolution, most specific wins:
 * explicit pick at launch > per-flow override > global default.
 * Configured ids the CLI doesn't list are skipped (install defaults may
 * reference models a given Cursor setup doesn't have).
 *
 * For Swarms the contender's per-slot `{model, reasoning?}` pick is the most
 * specific tier (ADR-0001: one harness per swarm, contenders vary by model).
 * It is threaded through the same `explicit` arg so callers do not branch.
 */
export function resolveModel(ctx: FlowContext, explicit?: string, kind?: string): string {
  const known = (m?: string) =>
    m && (ctx.global.models.length === 0 || ctx.global.models.includes(m)) ? m : "";
  return (
    explicit ||
    known(kind ? ctx.global.modelOverrides?.[kind] : "") ||
    known(ctx.global.defaultModel) ||
    "auto"
  );
}

// ---------------------------------------------------------------------------
// Shared prompt contracts
// ---------------------------------------------------------------------------

const HITL_CONTRACT = `
HARD CONSTRAINTS (non-negotiable):
- You must NEVER post comments, replies, or reviews to GitHub, and never use \`gh\`, the GitHub API, or any
  other channel to write to GitHub. The ONLY permitted remote effect is \`git push\` to the PR's own branch
  when these instructions explicitly allow it.
- Anything you want to say on the PR goes into the proposal block below; a human will edit and approve it
  before it is sent.`;

const PROPOSAL_CONTRACT = `
When you are completely done, end your final message with EXACTLY ONE proposal block:
<proposal>{"type": "comment" | "reply" | "none", "body": "<markdown comment for the PR>", "in_reply_to": <comment id, only for type reply>}</proposal>
- Use "reply" with in_reply_to when responding to a specific inline review comment id you were given.
- Use "comment" for a general PR comment (e.g. summarizing a pushed fix).
- Use "none" when no PR response is warranted.
The block must be valid JSON on its own.`;

const REVIEW_CONTRACT = `
Output your review as EXACTLY ONE proposal block at the very end:
<proposal>{
  "type": "review",
  "verdict": "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
  "summary": "<overall review summary, markdown>",
  "comments": [
    {"path": "<file path from the diff>", "line": <new-file line number the comment anchors to>,
     "side": "RIGHT", "start_line": <optional first line of a multi-line range>,
     "body": "<the comment, markdown>",
     "severity": "blocker" | "major" | "minor" | "nit",
     "confidence": <integer 0-100>,
     "suggestion": "<optional: concrete replacement code for the commented lines, when you can write it>"}
  ]
}</proposal>
- "line"/"start_line" MUST be line numbers that appear in the provided diff (use LEFT side + old line numbers
  only for deleted lines).
- Include "suggestion" only when you are confident in the exact replacement code; omit it for directional feedback.
- An empty "comments" array with a short summary is a valid review of a clean diff.
The block must be valid JSON on its own.`;

function fixFlowWrapper(
  ctx: FlowContext,
  pr: PrSummary,
  wt: Worktree,
  task: string,
  propose = true
): string {
  return `You are Charon's autonomous code fix agent working on repository ${ctx.repo}, PR #${pr.number} ("${pr.title}").

Your working directory is a dedicated git worktree at ${wt.path}, checked out from origin/${pr.headRef}
on local branch ${wt.localBranch}. The PR's base branch is ${pr.baseRef}.

TASK:
${task}

WORKFLOW:
1. Investigate and implement the fix in this worktree.
2. Commit with a clear message and push to the PR branch with:
   git push origin HEAD:${pr.headRef}
   (Pushing to this branch is explicitly authorized — ${
     pr.author === ctx.gh.login
       ? "it is the user's own PR branch"
       : `the user explicitly launched this fix on ${pr.author}'s branch from the app`
   }.)
   Other agents may be pushing fixes to this branch concurrently. If the push is rejected because
   the remote moved, run \`git pull --rebase origin ${pr.headRef}\`, resolve any conflicts in favor of
   keeping both fixes intact, and push again. NEVER force-push.
3. If you determine no code change is needed, do not commit or push; explain why in your ${
    propose ? "proposal" : "final message"
  }.

DEPENDENCY & VALIDATION POLICY:
${ctx.config.fixPolicy}
${HITL_CONTRACT}
${
  propose
    ? PROPOSAL_CONTRACT
    : `
No PR comment is wanted for this run. Do NOT emit a proposal block; end with a short summary
of what you did for the activity log.`
}`;
}

/**
 * Record the commit an agent pushed onto a run, so the UI can link straight to
 * its diff. The worktree HEAD advances only when the agent actually committed;
 * if it didn't (no change needed) HEAD still equals the tip it started from and
 * we record nothing. Best-effort — a failure here must never sink the run.
 *
 * Exported for the Swarm layer: a mutable contender's "commit but do NOT push"
 * onDone is just this call (ADR-0002). The Winner's single-push happens later,
 * in the swarm module's promote-step, once the user picks.
 */
export async function recordPushedCommit(runId: string, wt: Worktree): Promise<void> {
  try {
    const head = await worktreeHead(wt);
    if (head && head !== wt.baseSha) {
      useAgentStore.getState().update(runId, { commitSha: head });
    }
  } catch (e) {
    console.warn("could not record pushed commit", e);
  }
}

interface DraftPrMetadata {
  changed: boolean;
  title: string;
  body: string;
  summary?: string;
}

export function extractDraftPrJson(text: string): DraftPrMetadata | null {
  const m = /<draft-pr>\s*([\s\S]*?)\s*<\/draft-pr>/i.exec(text);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]) as Record<string, unknown>;
    return {
      changed: obj.changed !== false,
      title: String(obj.title ?? "").trim(),
      body: String(obj.body ?? "").trim(),
      summary: obj.summary == null ? undefined : String(obj.summary).trim(),
    };
  } catch {
    return null;
  }
}

const BRANCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function branchSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

function draftSlug(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((w) => w.length > 1 && !BRANCH_STOP_WORDS.has(w))
    .slice(0, 6);
  return branchSegment(words?.join("-") || "draft-pr") || "draft-pr";
}

async function uniqueDraftBranch(ctx: FlowContext, prompt: string): Promise<string> {
  const user = branchSegment(ctx.gh.login || ctx.global.login || "user") || "user";
  const base = `${user}/${draftSlug(prompt)}`;
  let existing = new Set<string>();
  try {
    existing = new Set(await ctx.gh.listBranches(ctx.repo));
  } catch {
    return `${base}-${uid().split("-").pop()}`;
  }
  if (!existing.has(base)) return base;
  for (let i = 2; i <= 20; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${uid().split("-").pop()}`;
}

function ghRepoArg(ctx: FlowContext): string {
  try {
    const host = new URL(ctx.gh.webBase).host;
    return host === "github.com" || host === "www.github.com" ? ctx.repo : `${host}/${ctx.repo}`;
  } catch {
    return ctx.repo;
  }
}

/** Exported for the Swarm layer: a draft_create Swarm's Winner is the one
 *  contender the user promoted, and `gh pr create` runs exactly once on its
 *  local commit (ADR-0002). */
export async function createDraftPrWithGh(
  ctx: FlowContext,
  wt: Worktree,
  baseBranch: string,
  title: string,
  body: string
): Promise<{ number: number; url: string }> {
  const res = await native.runExec(
    "gh",
    [
      "pr",
      "create",
      "--draft",
      "--repo",
      ghRepoArg(ctx),
      "--base",
      baseBranch,
      "--head",
      wt.prBranch,
      "--title",
      title,
      "--body",
      body || "Draft PR created by Charon.",
    ],
    wt.path
  );
  if (res.code !== 0) {
    const out = res.stderr || res.stdout;
    const hint = /not found|No such file|failed to run gh/i.test(out)
      ? "\n\nInstall and authenticate the GitHub CLI (`gh auth login`) before creating draft PRs."
      : /authentication|not logged|login|HTTP 401|HTTP 403/i.test(out)
        ? "\n\nAuthenticate the GitHub CLI for this GitHub host with `gh auth login`."
        : "";
    throw new Error(`gh pr create failed (${res.code}):\n${out}${hint}`);
  }
  const out = `${res.stdout}\n${res.stderr}`.trim();
  const url = out.match(/https?:\/\/\S+\/pull\/\d+/)?.[0] ?? "";
  const number = Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? NaN);
  if (!url || !Number.isFinite(number)) {
    throw new Error(`gh pr create succeeded but no PR URL was found:\n${out}`);
  }
  return { number, url };
}

export async function deleteDraftCreateArtifacts(run: AgentRun): Promise<void> {
  const d = run.draftCreate;
  if (!d) throw new Error("this run has no draft creation recovery metadata");
  if (run.status === "running" || run.status === "starting") {
    throw new Error("stop the draft creation run before deleting its worktree");
  }

  const errors: string[] = [];
  if (d.branch && run.prNumber == null) {
    try {
      const res = await native.runGit(["push", "origin", "--delete", d.branch], d.clonePath);
      if (res.code !== 0 && !/remote ref does not exist|unable to delete/i.test(res.stderr || res.stdout)) {
        errors.push(res.stderr || res.stdout);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  try {
    const path = d.worktreePath || run.cwd || "";
    if (!path) throw new Error("no preserved worktree path was recorded for this run");
    await removeWorktree({
      path,
      clonePath: d.clonePath,
      localBranch: d.localBranch,
    });
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  if (errors.length) {
    useAgentStore.getState().update(run.id, {
      draftCreate: { ...d, cleanupStatus: "error", cleanupError: errors.join("\n\n") },
    });
    throw new Error(errors.join("\n\n"));
  }

  useAgentStore.getState().remove(run.id);
}

// ---------------------------------------------------------------------------
// Proposal creation from agent output
// ---------------------------------------------------------------------------

async function createProposalFromFixOutput(
  ctx: FlowContext,
  pr: PrSummary,
  runId: string,
  resultText: string,
  context: string,
  /** pin the proposal to this inline review comment id, whatever the agent emitted */
  forceReplyTo?: number
): Promise<void> {
  const store = useRepoStore.getState();
  const obj = extractProposalJson(resultText);
  const fallbackBody = cleanResultText(resultText);

  if (obj?.type === "none") return;

  const replyTo = forceReplyTo ?? (obj?.type === "reply" && obj.in_reply_to ? Number(obj.in_reply_to) : null);
  if (replyTo) {
    await store.upsertProposal({
      id: uid("prop-"),
      type: "comment_reply",
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      body: String(obj?.body ?? fallbackBody),
      inReplyToCommentId: replyTo,
      context,
      createdAt: Date.now(),
      status: "pending",
      agentRunId: runId,
    });
    return;
  }

  const body = String(obj?.body ?? fallbackBody).trim();
  if (!body) return;
  await store.upsertProposal({
    id: uid("prop-"),
    type: "issue_comment",
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    body,
    context,
    createdAt: Date.now(),
    status: "pending",
    agentRunId: runId,
  });
}

const SEVERITIES: Severity[] = ["blocker", "major", "minor", "nit"];

interface ParsedReviewComment {
  path: string;
  line: number;
  startLine?: number;
  side: "LEFT" | "RIGHT";
  body: string;
  severity: Severity;
  confidence: number;
  suggestion?: string;
}

/** Parse + diff-validate a review agent's output (shared by teammate review proposals and own-PR self-reviews). */
function parseReviewOutput(
  resultText: string,
  diffText: string
): { summary: string; verdict: string; comments: ParsedReviewComment[]; dropped: string[] } {
  const obj = extractProposalJson(resultText);
  const files = parseUnifiedDiff(diffText);
  const rawComments: any[] = Array.isArray(obj?.comments) ? obj.comments : [];
  const comments: ParsedReviewComment[] = [];
  const dropped: string[] = [];
  for (const c of rawComments) {
    if (!c?.path || !c?.body) continue;
    let line = Number(c.line) || 0;
    let side: "LEFT" | "RIGHT" = c.side === "LEFT" ? "LEFT" : "RIGHT";
    if (!lineInDiff(files, c.path, line, side)) {
      const fixed = nearestDiffLine(files, c.path, line);
      if (fixed) {
        line = fixed.line;
        side = fixed.side;
      } else {
        dropped.push(`${c.path}:${c.line}`);
        continue;
      }
    }
    comments.push({
      path: String(c.path),
      line,
      startLine: c.start_line ? Number(c.start_line) : undefined,
      side,
      body: String(c.body),
      severity: SEVERITIES.includes(c.severity) ? c.severity : "minor",
      confidence: Math.max(0, Math.min(100, Number(c.confidence) || 50)),
      suggestion: typeof c.suggestion === "string" && c.suggestion.trim() ? c.suggestion : undefined,
    });
  }
  const summary =
    String(obj?.summary ?? obj?.body ?? "").trim() || cleanResultText(resultText) || "Automated review.";
  const verdict =
    obj?.verdict === "APPROVE" || obj?.verdict === "REQUEST_CHANGES" ? obj.verdict : "COMMENT";
  return { summary, verdict, comments, dropped };
}

/** Suggestions fold into the comment body for GitHub submission. */
const toProposedComments = (parsed: ParsedReviewComment[]): ProposedInlineComment[] =>
  parsed.map((c) => ({
    key: uid("ic-"),
    path: c.path,
    line: c.line,
    startLine: c.startLine,
    side: c.side,
    body: c.suggestion ? `${c.body}\n\n**Suggested change:**\n\`\`\`\n${c.suggestion}\n\`\`\`` : c.body,
    severity: c.severity,
    confidence: c.confidence,
    included: true,
  }));

async function createReviewProposal(
  ctx: FlowContext,
  pr: PrSummary,
  runId: string,
  resultText: string,
  diffText: string,
  context: string
): Promise<void> {
  const store = useRepoStore.getState();
  const parsed = parseReviewOutput(resultText, diffText);
  const comments = toProposedComments(parsed.comments);

  const summary = parsed.summary;
  const dropped = parsed.dropped;
  const note = dropped.length
    ? `\n\n_(${dropped.length} proposed comment(s) could not be anchored to the diff and were dropped: ${dropped.join(", ")})_`
    : "";

  // a fresh review supersedes any stale pending review proposal for this PR
  for (const p of store.proposals) {
    if (p.type === "review" && p.prNumber === pr.number && p.status === "pending") {
      await store.removeProposal(p.id);
    }
  }

  await store.upsertProposal({
    id: uid("prop-"),
    type: "review",
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    body: summary + note,
    verdict: parsed.verdict as "COMMENT" | "APPROVE" | "REQUEST_CHANGES",
    comments,
    context,
    createdAt: Date.now(),
    status: "pending",
    agentRunId: runId,
  });
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

/**
 * Fix flow: worktree → agent implements/commits/pushes (automated) → PR-facing
 * response becomes a pending proposal (gated on approval). Conflict/branch
 * maintenance runs (kind "conflict_fix") skip the proposal entirely — merging
 * main isn't worth a PR comment. opts.replyToCommentId pins the proposal to
 * an inline review comment as a threaded reply.
 */
export async function runFixFlow(
  ctx: FlowContext,
  pr: PrSummary,
  task: string,
  relation: string,
  kind: "ci_fix" | "conflict_fix" | "feedback_fix" | "event",
  model?: string,
  opts?: { replyToCommentId?: number }
): Promise<string> {
  const propose = kind !== "conflict_fix";
  const wt = await createWorktree(ctx.gh, ctx.repo, ctx.config.localClonePath, pr);
  const prompt = applySkills(
    fixFlowWrapper(ctx, pr, wt, task, propose),
    ctx.skills,
    ctx.config.skills.fix
  );
  try {
    return await startAgent({
      kind,
      relation,
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prompt,
      model: resolveModel(ctx, model, kind),
      binary: ctx.global.cursorBinary,
      cwd: wt.path,
      onDone: async (run) => {
        try {
          await recordPushedCommit(run.id, wt);
          if (propose) {
            await createProposalFromFixOutput(
              ctx,
              pr,
              run.id,
              run.resultText,
              relation,
              opts?.replyToCommentId
            );
          }
        } finally {
          await releaseWorktree(wt);
        }
      },
    });
  } catch (e) {
    await releaseWorktree(wt); // spawn failure: free the slot lease
    throw e;
  }
}

/**
 * Append a line-scoped review's findings to the pending review proposal (or
 * start one) instead of replacing it — used when the user selects a range on
 * a teammate PR and asks for review feedback on just those lines.
 */
async function mergeIntoReviewProposal(
  ctx: FlowContext,
  pr: PrSummary,
  runId: string,
  resultText: string,
  diffText: string
): Promise<void> {
  const store = useRepoStore.getState();
  const parsed = parseReviewOutput(resultText, diffText);
  const comments = toProposedComments(parsed.comments);
  const existing = store.proposals.find(
    (p) => p.type === "review" && p.prNumber === pr.number && p.status === "pending"
  );
  if (existing && existing.type === "review") {
    await store.upsertProposal({ ...existing, comments: [...existing.comments, ...comments] });
    return;
  }
  await store.upsertProposal({
    id: uid("prop-"),
    type: "review",
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    body: parsed.summary,
    verdict: "COMMENT",
    comments,
    context: "line-scoped review",
    createdAt: Date.now(),
    status: "pending",
    agentRunId: runId,
  });
}

/** Review flow: diff + skills → agent → review proposal with inline comments. */
export async function runReviewFlow(
  ctx: FlowContext,
  pr: PrSummary,
  task: string,
  model?: string,
  selection?: LineSelection | null
): Promise<string> {
  const diffText = await ctx.gh.getPullDiff(ctx.repo, pr.number);
  const diff = truncate(diffText, MAX_DIFF_CHARS, "\n…[diff truncated — review what is shown]");
  const scopeBlock = selection
    ? `\nSCOPE: review ONLY this selected region — ${selection.path} lines ${selection.startLine}–${selection.endLine} (${
        selection.side === "RIGHT" ? "new" : "old"
      } side):
\`\`\`
${selection.snippet}
\`\`\`
Every comment must be about code in (or directly broken by) this region; anchor comments to lines within it.\n`
    : "";
  const wt = await tryReviewWorktree(ctx, pr);
  const base = `You are Charon's code's review agent. Review PR #${pr.number} ("${pr.title}") by ${pr.author} in ${ctx.repo}.
${reviewWorkspaceBlock(wt, pr)}
TASK:
${task}
${scopeBlock}

PR description:
${truncate(pr.body || "(none)", 4000)}

THE DIFF TO REVIEW (unified format, new-file line numbers derive from @@ hunk headers):
\`\`\`diff
${diff}
\`\`\`
${HITL_CONTRACT}
${REVIEW_CONTRACT}`;

  const prompt = applySkills(base, ctx.skills, ctx.config.skills.review);
  try {
    return await startAgent({
      kind: "review",
      relation: selection
        ? `review (${selection.path}:${selection.startLine}–${selection.endLine})`
        : "review",
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prompt,
      model: resolveModel(ctx, model, "review"),
      binary: ctx.global.cursorBinary,
      cwd: wt?.path,
      mode: "ask", // read-only: a review must never touch code or GitHub
      onDone: async (run) => {
        try {
          if (selection) await mergeIntoReviewProposal(ctx, pr, run.id, run.resultText, diffText);
          else await createReviewProposal(ctx, pr, run.id, run.resultText, diffText, "automated self-review");
        } finally {
          if (wt) await releaseWorktree(wt);
        }
      },
    });
  } catch (e) {
    if (wt) await releaseWorktree(wt); // spawn failure: free the slot lease
    throw e;
  }
}

/**
 * Self-review flow (own PRs): same review agent and contract as the teammate
 * flow, but the output becomes LOCAL findings — inline feedback that never
 * syncs to GitHub. Each finding can then be applied via a fix agent.
 */
export async function runSelfReviewFlow(
  ctx: FlowContext,
  pr: PrSummary,
  model?: string,
  task?: string,
  selection?: LineSelection | null
): Promise<string> {
  const diffText = await ctx.gh.getPullDiff(ctx.repo, pr.number);
  const diff = truncate(diffText, MAX_DIFF_CHARS, "\n…[diff truncated — review what is shown]");
  const scopeBlock = selection
    ? `\nSCOPE: review ONLY this selected region — ${selection.path} lines ${selection.startLine}–${selection.endLine} (${
        selection.side === "RIGHT" ? "new" : "old"
      } side):
\`\`\`
${selection.snippet}
\`\`\`
Every finding must be about code in (or directly broken by) this region; anchor findings to lines within it.\n`
    : "";
  const wt = await tryReviewWorktree(ctx, pr);
  const base = `You are Charon's code's review agent. The user wants a critical self-review of THEIR OWN PR #${pr.number}
("${pr.title}") in ${ctx.repo} before others see it. Find real problems they should fix.
${reviewWorkspaceBlock(wt, pr)}
TASK:
${task?.trim() || "Review the diff and propose inline comments with severity and confidence."}
${scopeBlock}

PR description:
${truncate(pr.body || "(none)", 4000)}

THE DIFF TO REVIEW (unified format, new-file line numbers derive from @@ hunk headers):
\`\`\`diff
${diff}
\`\`\`
${HITL_CONTRACT}
${REVIEW_CONTRACT}`;
  const prompt = applySkills(base, ctx.skills, ctx.config.skills.review);
  try {
    return await startAgent({
      kind: "review",
      relation: selection
        ? `self-review (${selection.path}:${selection.startLine}–${selection.endLine})`
        : "self-review",
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prompt,
      model: resolveModel(ctx, model, "review"),
      binary: ctx.global.cursorBinary,
      cwd: wt?.path,
      mode: "ask",
      onDone: async (run) => {
        try {
          const parsed = parseReviewOutput(run.resultText, diffText);
          const diffFiles = parseUnifiedDiff(diffText);
          const findings: ReviewFinding[] = parsed.comments.map((c) => ({
            key: uid("find-"),
            prNumber: pr.number,
            headSha: pr.headSha,
            path: c.path,
            line: c.line,
            startLine: c.startLine,
            side: c.side,
            severity: c.severity,
            confidence: c.confidence,
            body: c.body,
            suggestion: c.suggestion,
            anchorText: lineTextAt(diffFiles, c.path, c.side, c.line) ?? undefined,
            status: "open",
            createdAt: Date.now(),
          }));
          const note = parsed.dropped.length
            ? ` (${parsed.dropped.length} unanchorable finding(s) dropped: ${parsed.dropped.join(", ")})`
            : "";
          // scoped reviews merge into existing findings; full reviews replace them
          if (selection) {
            await useRepoStore.getState().mergeFindings(pr.number, findings);
          } else {
            await useRepoStore.getState().setFindings(pr.number, findings, parsed.summary + note);
          }
        } finally {
          if (wt) await releaseWorktree(wt);
        }
      },
    });
  } catch (e) {
    if (wt) await releaseWorktree(wt); // spawn failure: free the slot lease
    throw e;
  }
}

const findingInstruction = (f: ReviewFinding) =>
  `- ${f.path}:${f.startLine ? `${f.startLine}–` : ""}${f.line} [${f.severity}] ${f.body}` +
  (f.suggestion ? `\n  Suggested replacement code:\n${indent(f.suggestion, "    ")}` : "");

const indent = (s: string, pad: string) => s.split("\n").map((l) => pad + l).join("\n");

/**
 * Apply one or more local findings: a fix agent implements them in a worktree
 * and pushes to the user's own branch. Applies run in parallel — each run gets
 * its own worktree slot, and agents rebase-and-retry if a concurrent push
 * lands on the branch first.
 */
export async function applyFindings(
  ctx: FlowContext,
  pr: PrSummary,
  findings: ReviewFinding[],
  model?: string,
  guidance?: string
): Promise<string> {
  const store = useRepoStore.getState();
  for (const f of findings) await store.updateFinding(f.key, { status: "applying", agentRunId: undefined });

  const task = `Address the following self-review finding${findings.length > 1 ? "s" : ""} from an automated code review
of this PR. Treat each as a strong recommendation: verify it is correct in context, then implement the fix.
If a finding is wrong, skip it and say why in your final message.

${findings.map(findingInstruction).join("\n\n")}${
    guidance?.trim()
      ? `\n\nADDITIONAL GUIDANCE FROM THE USER (takes precedence):\n${guidance.trim()}`
      : ""
  }`;

  try {
    const wt = await createWorktree(ctx.gh, ctx.repo, ctx.config.localClonePath, pr);
    // propose=false: these findings are local-only — fix and push, no PR comment
    const prompt = applySkills(fixFlowWrapper(ctx, pr, wt, task, false), ctx.skills, ctx.config.skills.fix);
    try {
      const runId = await startAgent({
        kind: "feedback_fix",
        relation: findings.length > 1 ? `apply ${findings.length} findings` : "apply finding",
        repo: ctx.repo,
        prNumber: pr.number,
        prTitle: pr.title,
        prompt,
        model: resolveModel(ctx, model, "feedback_fix"),
        binary: ctx.global.cursorBinary,
        cwd: wt.path,
        onDone: async (run) => {
          try {
            await recordPushedCommit(run.id, wt);
            const s = useRepoStore.getState();
            for (const f of findings) await s.updateFinding(f.key, { status: "applied" });
          } finally {
            await releaseWorktree(wt);
          }
        },
      });
      for (const f of findings) await store.updateFinding(f.key, { status: "applying", agentRunId: runId });
      return runId;
    } catch (e) {
      await releaseWorktree(wt); // spawn failure: free the slot lease
      throw e;
    }
  } catch (e) {
    // worktree/spawn failure: findings go back to open so the user can retry
    for (const f of findings) await store.updateFinding(f.key, { status: "open", agentRunId: undefined });
    throw e;
  }
}

/**
 * Address a GitHub comment thread on the user's own PR: a fix agent verifies
 * the feedback, implements it in a worktree, pushes, and drafts a reply to the
 * thread — which lands as a pending proposal, never auto-posted. Works the
 * same for bot comments (bugbot etc.) and human reviewers.
 */
export async function runAddressComment(
  ctx: FlowContext,
  pr: PrSummary,
  root: CommentInfo,
  replies: CommentInfo[],
  model?: string,
  guidance?: string
): Promise<string> {
  const threadText = [root, ...replies]
    .map(
      (c) =>
        `${c.author}${c.authorIsBot ? " [bot]" : ""} (comment id ${c.id}):\n${indent(truncate(c.body, 6000), "  ")}`
    )
    .join("\n\n");
  const where = root.path ? ` on ${root.path}${root.line ? `:${root.line}` : ""}` : "";
  const isInline = root.kind === "review_comment";

  const task = `Address the following GitHub comment thread${where} from this PR. Treat the feedback as a strong
recommendation: verify it is correct in context, then implement the change. If you conclude no change is
warranted, do not commit or push — explain your reasoning in the reply instead.

THREAD:
${threadText}

After the work, draft a response to the thread${
    isInline
      ? `: use proposal type "reply" with in_reply_to ${root.id}`
      : ` as a top-level PR comment (proposal type "comment")`
  }, describing what you changed and pushed — or why you made no change.${
    guidance?.trim()
      ? `\n\nADDITIONAL GUIDANCE FROM THE USER (takes precedence):\n${guidance.trim()}`
      : ""
  }`;

  return runFixFlow(ctx, pr, task, `address comment by ${root.author}`, "feedback_fix", model, {
    // inline review comments get a threaded reply, never a root PR comment
    replyToCommentId: isInline ? root.id : undefined,
  });
}

/**
 * Auto CI triage: a read-only agent boils a failing check's log down to one or
 * two sentences for the checks panel. Model resolves via the `ci_analysis`
 * flow default (Settings → Checks, or the Default-models table) — seeded to the
 * fast install default but user-pickable. Resolves with the summary text.
 */
export async function runCheckAnalysis(
  ctx: FlowContext,
  pr: PrSummary,
  check: { name: string; url: string; id?: number; outputTitle?: string; outputSummary?: string }
): Promise<string> {
  const log = (await ctx.gh.getCheckLog(ctx.repo, check).catch(() => "")) || "(no log available)";
  const model = resolveModel(ctx, undefined, "ci_analysis");
  return new Promise((resolve, reject) => {
    const prompt = `You are a CI triage bot. A check failed on PR #${pr.number} in ${ctx.repo}.
Summarize WHY it failed in ONE or TWO short sentences — absolute maximum. Plain text only: no markdown,
no preamble, no advice. Name the failing test/step/file when identifiable.

CHECK: ${check.name}${check.outputTitle ? ` — ${check.outputTitle}` : ""}
LOG TAIL:
\`\`\`
${log.slice(-16_000)}
\`\`\``;
    startAgent({
      kind: "event",
      notifyCategory: "ci_analysis",
      hiddenFromActivity: true,
      relation: `CI analysis (${check.name})`,
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prompt,
      model,
      binary: ctx.global.cursorBinary,
      mode: "ask",
      onDone: (run) => {
        const text = cleanResultText(run.resultText)
          .replace(/\s+/g, " ")
          .trim();
        if (!text) return reject(new Error("no analysis produced"));
        // enforce the two-sentence cap even if the model rambles
        resolve(text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "));
      },
    }).catch(reject);
  });
}

/**
 * Analysis flow: read-only agent for events that don't warrant a worktree or a
 * diff review (lifecycle, mentions, dismissals, unknown future events). Can
 * still propose a PR comment — gated on approval like everything else.
 */
export async function runAnalysisFlow(
  ctx: FlowContext,
  pr: PrSummary,
  task: string,
  relation: string,
  model?: string
): Promise<string> {
  const prompt = `You are Charon's code's analysis agent for repository ${ctx.repo}, PR #${pr.number} ("${pr.title}") by ${pr.author}.
PR state: ${pr.state}${pr.merged ? " (merged)" : ""}${pr.draft ? " (draft)" : ""}; branch ${pr.headRef} → ${pr.baseRef}.

TASK:
${task}

PR description:
${truncate(pr.body || "(none)", 4000)}

You are running read-only: do not modify code.
${HITL_CONTRACT}
${PROPOSAL_CONTRACT}`;
  return startAgent({
    kind: "event",
    relation,
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    prompt,
    model: resolveModel(ctx, model, "event"),
    binary: ctx.global.cursorBinary,
    mode: "ask",
    onDone: (run) => createProposalFromFixOutput(ctx, pr, run.id, run.resultText, relation),
  });
}

/**
 * Drafts view: create a brand-new draft PR from a prompt. The agent owns code
 * implementation and pushing the generated branch; Charon owns GitHub PR
 * creation via `gh pr create --draft` after the push and metadata block land.
 */
export async function runDraftCreate(
  ctx: FlowContext,
  instruction: string,
  model?: string,
  onCreated?: (pr: { number: number; title: string; url: string; branch: string }) => void | Promise<void>
): Promise<string> {
  const task = instruction.trim();
  if (!task) throw new Error("describe the draft PR to create");
  const baseBranch = ctx.config.draftCreate.baseBranch.trim() || (await ctx.gh.defaultBranch(ctx.repo));
  const prBranch = await uniqueDraftBranch(ctx, task);
  const wt = await createDraftCreationWorktree(
    ctx.gh,
    ctx.repo,
    ctx.config.localClonePath,
    baseBranch,
    prBranch
  );

  let finishedCleanly = false;
  const base = `You are Charon's draft-create agent for repository ${ctx.repo}.

The user wants a brand-new GitHub draft pull request created from this prompt:
<<<
${task}
>>>

Your working directory is a dedicated git worktree at ${wt.path}.
It starts from origin/${baseBranch} on local branch ${wt.localBranch}.
The new PR branch Charon generated is: ${prBranch}

REPOSITORY SETTINGS FOR THIS FLOW:
- Branch naming: ${ctx.config.draftCreate.branchNameInstructions}
- PR title: ${ctx.config.draftCreate.titleInstructions}
- PR description: ${ctx.config.draftCreate.descriptionInstructions}
- Implementation: ${ctx.config.draftCreate.implementationInstructions}

WORKFLOW:
1. Implement the requested change in this worktree. Keep the PR coherent and tightly scoped.
2. If no code change is needed, do not commit, do not push, and report changed:false in the metadata block.
3. If code changed, commit with a clear message and push exactly this branch:
   git push origin HEAD:${prBranch}
   If the push is rejected because the remote branch exists or moved, stop and explain the failure. NEVER force-push.
4. Do NOT create a pull request. Do NOT run gh, use the GitHub API, post comments, request reviewers, or mutate GitHub in any way except the git push above.
5. After implementation and push, write a PR title and PR description from the final diff and repo conventions.

DEPENDENCY & VALIDATION POLICY:
${ctx.config.fixPolicy}

FINAL OUTPUT CONTRACT:
End your final message with EXACTLY ONE draft metadata block:
<draft-pr>{"changed":true|false,"title":"<PR title>","body":"<PR description markdown>","summary":"<short implementation summary>"}</draft-pr>
- Use changed:false only when no code changes were committed and pushed.
- For changed:true, title must be a single line and body must be reviewer-ready markdown.
- The block must be valid JSON on its own.`;

  const prompt = applySkills(base, ctx.skills, ctx.config.skills.draftCreate);
  try {
    return await startAgent({
      kind: "draft_create",
      relation: "draft creation",
      repo: ctx.repo,
      prNumber: null,
      prTitle: "New draft PR",
      prompt,
      model: resolveModel(ctx, model, "draft_create"),
      binary: ctx.global.cursorBinary,
      cwd: wt.path,
      draftCreate: {
        baseBranch,
        branch: prBranch,
        worktreePath: wt.path,
        clonePath: wt.clonePath,
        localBranch: wt.localBranch,
      },
      onDone: async (run) => {
        try {
          const head = await worktreeHead(wt);
          const meta = extractDraftPrJson(run.resultText);
          if (!head || head === wt.baseSha || meta?.changed === false) {
            finishedCleanly = true;
            await releaseWorktree(wt);
            return;
          }
          if (!meta) {
            throw new Error("draft-create agent did not return a valid <draft-pr> metadata block");
          }
          if (!meta.title) throw new Error("draft-create agent returned no PR title");
          const body = meta.body || meta.summary || cleanResultText(run.resultText);
          const created = await createDraftPrWithGh(ctx, wt, baseBranch, meta.title, body);
          useAgentStore.getState().update(run.id, {
            prNumber: created.number,
            prTitle: meta.title,
            commitSha: head,
            draftCreate: {
              ...(run.draftCreate ?? {
                baseBranch,
                branch: prBranch,
                worktreePath: wt.path,
                clonePath: wt.clonePath,
                localBranch: wt.localBranch,
              }),
              prUrl: created.url,
            },
          });
          await onCreated?.({ ...created, title: meta.title, branch: prBranch });
          finishedCleanly = true;
          await releaseWorktree(wt);
        } catch (e) {
          preserveWorktree(wt);
          throw e;
        }
      },
      onSettled: (run) => {
        if (!finishedCleanly && run.status !== "done") preserveWorktree(wt);
      },
    });
  } catch (e) {
    await releaseWorktree(wt);
    throw e;
  }
}

/**
 * Drafts view: line-scoped edit. User's own draft — no approve gate; the agent
 * commits and pushes immediately.
 */
export async function runDraftEdit(
  ctx: FlowContext,
  pr: PrSummary,
  selection: LineSelection | null,
  instruction: string,
  model?: string
): Promise<string> {
  const wt = await createWorktree(ctx.gh, ctx.repo, ctx.config.localClonePath, pr);
  const scope = selection
    ? `The user selected ${selection.path} lines ${selection.startLine}–${selection.endLine} (${selection.side} side of the diff):
\`\`\`
${selection.snippet}
\`\`\`
Apply the requested change to that code (and anything it forces you to touch).`
    : `The feedback applies to the PR diff as a whole.`;

  const task = `${scope}

REQUESTED CHANGE:
${instruction}`;

  const base = `You are Charon's code's draft-edit agent working on the user's own draft PR #${pr.number} ("${pr.title}") in ${ctx.repo}.

Your working directory is a dedicated git worktree at ${wt.path} on local branch ${wt.localBranch},
checked out from origin/${pr.headRef} (base: ${pr.baseRef}).

${task}

WORKFLOW:
1. Implement exactly what was asked — keep the change tightly scoped to the request.
2. Commit with a clear message and push with: git push origin HEAD:${pr.headRef}
   (This is the user's own draft; pushing is authorized and expected.)
   If the push is rejected because the remote moved (another agent pushed first), run
   \`git pull --rebase origin ${pr.headRef}\` and push again. NEVER force-push.
${HITL_CONTRACT}
${PROPOSAL_CONTRACT}`;

  const prompt = applySkills(base, ctx.skills, ctx.config.skills.draft);
  try {
    return await startAgent({
      kind: "draft_edit",
      relation: selection ? `draft edit (${selection.path}:${selection.startLine})` : "draft edit",
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prompt,
      model: resolveModel(ctx, model, "draft_edit"),
      binary: ctx.global.cursorBinary,
      cwd: wt.path,
      onDone: async (run) => {
        try {
          await recordPushedCommit(run.id, wt);
          await createProposalFromFixOutput(ctx, pr, run.id, run.resultText, "draft edit summary");
        } finally {
          await releaseWorktree(wt);
        }
      },
    });
  } catch (e) {
    await releaseWorktree(wt); // spawn failure: free the slot lease
    throw e;
  }
}

/**
 * Drafts view: general feedback / question. Read-only — no code change, no
 * GitHub write; the answer lives in the agent run (rendered in the UI).
 */
export async function runDraftQuestion(
  ctx: FlowContext,
  pr: PrSummary,
  question: string,
  selection: LineSelection | null,
  model?: string,
  followUpToRunId?: string
): Promise<string> {
  const diffText = await ctx.gh.getPullDiff(ctx.repo, pr.number);
  const scope = selection
    ? `\nThe question is about ${selection.path} lines ${selection.startLine}–${selection.endLine}:\n\`\`\`\n${selection.snippet}\n\`\`\`\n`
    : "";

  // Followups build on the prior Ask answer — thread it into context so the
  // agent continues rather than re-answering from scratch.
  let prior = "";
  if (followUpToRunId) {
    const parent = useAgentStore.getState().runs[followUpToRunId];
    if (parent) {
      const q = parent.userQuestion ? `PRIOR QUESTION:\n${parent.userQuestion}\n\n` : "";
      prior = `${q}PRIOR ANSWER (your previous reply):\n${truncate(parent.resultText, MAX_DIFF_CHARS)}\n\n`;
    }
  }

  const base = `You are Charon's code's analysis agent. The user has a question / wants feedback on
PR #${pr.number} ("${pr.title}") by ${pr.author} in ${ctx.repo}. Do NOT make any code changes — answer in text only.
${scope}
${prior}${followUpToRunId ? "FOLLOWUP QUESTION" : "QUESTION / FEEDBACK REQUEST"}:
${question}

THE DIFF:
\`\`\`diff
${truncate(diffText, MAX_DIFF_CHARS)}
\`\`\`

Answer directly and concretely; reference files and line numbers from the diff where useful.${
    followUpToRunId
      ? " You are continuing the prior exchange above — build on your earlier answer; don't repeat it."
      : ""
  }`;
  // expands any /skill references the user typed in the question
  const prompt = applySkills(base, ctx.skills, []);

  return startAgent({
    kind: "draft_question",
    relation: followUpToRunId ? "followup Q&A" : "draft Q&A",
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    prompt,
    model: resolveModel(ctx, model, "draft_question"),
    binary: ctx.global.cursorBinary,
    mode: "ask",
    followUpToRunId,
    userQuestion: question,
  });
}

/**
 * Draft a new PR description with an agent (read-only; it sees the current
 * description and the diff). Resolves with the proposed markdown — the caller
 * drops it into the description editor so the user reviews before saving;
 * nothing reaches GitHub until they do.
 */
export async function runDescriptionDraft(
  ctx: FlowContext,
  pr: PrSummary,
  instruction: string,
  model?: string
): Promise<string> {
  const diffText = await ctx.gh.getPullDiff(ctx.repo, pr.number);
  return new Promise((resolve, reject) => {
    const base = `You are Charon's code's writing agent. Draft an updated description for the user's own
PR #${pr.number} ("${pr.title}") in ${ctx.repo} (branch ${pr.headRef} → ${pr.baseRef}).

INSTRUCTION: ${instruction.trim() || "Rewrite the description so it accurately and clearly explains the change: what, why, and anything reviewers should know."}

CURRENT DESCRIPTION:
<<<
${truncate(pr.body || "(empty)", 8000)}
>>>

THE DIFF (ground truth — the description must match what actually changed):
\`\`\`diff
${truncate(diffText, MAX_DIFF_CHARS)}
\`\`\`

Respond with ONLY the new PR description markdown — no preamble, no commentary, no outer code fence.`;
    const prompt = applySkills(base, ctx.skills, ctx.config.skills.rewrite);
    startAgent({
      kind: "rewrite",
      relation: "description draft",
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prompt,
      model: resolveModel(ctx, model, "rewrite"),
      binary: ctx.global.cursorBinary,
      mode: "ask",
      onDone: (run) => {
        const text = cleanResultText(run.resultText);
        if (text) resolve(text);
        else reject(new Error("the agent produced no description text"));
      },
    }).catch(reject);
  });
}

/**
 * Draft a PR title with an agent (read-only). Recent PR titles from the repo
 * are provided as convention examples so the suggestion matches house style.
 * Resolves with a single-line title — the caller drops it into the title
 * editor for the user to review and save.
 */
export async function runTitleDraft(
  ctx: FlowContext,
  pr: PrSummary,
  instruction: string,
  model?: string
): Promise<string> {
  const [diffText, recentTitles] = await Promise.all([
    ctx.gh.getPullDiff(ctx.repo, pr.number),
    ctx.gh.listRecentPullTitles(ctx.repo).catch(() => [] as string[]),
  ]);
  const examples = recentTitles.filter((t) => t !== pr.title).slice(0, 25);
  return new Promise((resolve, reject) => {
    const base = `You are Charon's code's writing agent. Draft a title for the user's own PR #${pr.number}
in ${ctx.repo} (branch ${pr.headRef} → ${pr.baseRef}).

INSTRUCTION: ${instruction.trim() || "Write a clear, specific title that describes the change."}

CURRENT TITLE: ${pr.title}

PROJECT CONVENTION — recent PR titles from this repo; match their style (prefixes, tense, ticket
tags, capitalization, length):
${examples.length ? examples.map((t) => `- ${t}`).join("\n") : "(no examples available — use a concise imperative title)"}

PR description:
${truncate(pr.body || "(none)", 3000)}

THE DIFF (ground truth for what changed):
\`\`\`diff
${truncate(diffText, MAX_DIFF_CHARS)}
\`\`\`

Respond with ONLY the new title — one line, no quotes, no preamble, no markdown.`;
    const prompt = applySkills(base, ctx.skills, ctx.config.skills.rewrite);
    startAgent({
      kind: "rewrite",
      relation: "title draft",
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prompt,
      model: resolveModel(ctx, model, "rewrite"),
      binary: ctx.global.cursorBinary,
      mode: "ask",
      onDone: (run) => {
        const line = cleanResultText(run.resultText)
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)[0]
          ?.replace(/^["'`]+|["'`]+$/g, "");
        if (line) resolve(line);
        else reject(new Error("the agent produced no title"));
      },
    }).catch(reject);
  });
}

/**
 * Regenerate a piece of proposal text — either by custom instruction or via
 * the humanize skill. Resolves with the rewritten text.
 */
export function runRewrite(
  ctx: FlowContext,
  original: string,
  instruction: string,
  opts: { useHumanize?: boolean; prNumber: number; prTitle: string; model?: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const base = `Rewrite the following GitHub PR ${opts.prNumber ? `(#${opts.prNumber}) ` : ""}comment text.

INSTRUCTION: ${instruction || "Improve clarity and tone; keep all technical content."}

ORIGINAL TEXT:
<<<
${original}
>>>

Respond with ONLY the rewritten text — no preamble, no fences, no commentary.`;
    const skillNames = [...ctx.config.skills.rewrite];
    if (opts.useHumanize) skillNames.push("humanize");
    const prompt = applySkills(base, ctx.skills, skillNames);
    startAgent({
      kind: "rewrite",
      relation: opts.useHumanize ? "humanize rewrite" : "rewrite",
      repo: ctx.repo,
      prNumber: opts.prNumber,
      prTitle: opts.prTitle,
      prompt,
      model: resolveModel(ctx, opts.model, "rewrite"),
      binary: ctx.global.cursorBinary,
      mode: "ask",
      onDone: (run) => {
        const text = cleanResultText(run.resultText);
        if (text) resolve(text);
        else reject(new Error("rewrite produced no text"));
      },
    }).catch(reject);
  });
}

// ---------------------------------------------------------------------------
// Sending approved proposals — the ONLY place GitHub-facing writes happen.
// ---------------------------------------------------------------------------

export async function sendProposal(ctx: FlowContext, proposal: Proposal): Promise<string> {
  let url = "";
  if (proposal.type === "issue_comment") {
    url = await ctx.gh.createIssueComment(ctx.repo, proposal.prNumber, proposal.body);
  } else if (proposal.type === "comment_reply") {
    url = await ctx.gh.replyToReviewComment(
      ctx.repo,
      proposal.prNumber,
      proposal.inReplyToCommentId,
      proposal.body
    );
  } else {
    url = await ctx.gh.submitReview(ctx.repo, proposal.prNumber, {
      body: proposal.body,
      event: proposal.verdict,
      comments: proposal.comments,
    });
  }
  await useRepoStore.getState().upsertProposal({ ...proposal, status: "sent" });
  return url;
}

// Standard variable bag for event prompts.
export function eventVars(
  ctx: FlowContext,
  pr: PrSummary,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    ...prVars(pr),
    repo: ctx.repo,
    model: resolveModel(ctx, undefined, "event"),
    ...extra,
  };
}

export { interpolate };
