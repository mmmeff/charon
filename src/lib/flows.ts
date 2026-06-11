import type {
  GlobalConfig,
  LineSelection,
  Proposal,
  ProposedInlineComment,
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
import { interpolate, prVars, truncate, uid } from "./template";
import { useRepoStore } from "./store";
import { createWorktree, releaseWorktree, type Worktree } from "./worktree";

export interface FlowContext {
  gh: GitHubClient;
  repo: string;
  config: RepoConfig;
  global: GlobalConfig;
  skills: Skill[];
}

const MAX_DIFF_CHARS = 90_000;

export function resolveModel(ctx: FlowContext, explicit?: string): string {
  return explicit || ctx.config.model || ctx.global.defaultModel || "auto";
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

function fixFlowWrapper(ctx: FlowContext, pr: PrSummary, wt: Worktree, task: string): string {
  return `You are PR Copilot's autonomous fix agent working on repository ${ctx.repo}, PR #${pr.number} ("${pr.title}").

Your working directory is a dedicated git worktree at ${wt.path}, checked out from origin/${pr.headRef}
on local branch ${wt.localBranch}. The PR's base branch is ${pr.baseRef}.

TASK:
${task}

WORKFLOW:
1. Investigate and implement the fix in this worktree.
2. Commit with a clear message and push to the PR branch with:
   git push origin HEAD:${pr.headRef}
   (Pushing to this branch is explicitly authorized — it is the user's own PR branch.)
   Other agents may be pushing fixes to this branch concurrently. If the push is rejected because
   the remote moved, run \`git pull --rebase origin ${pr.headRef}\`, resolve any conflicts in favor of
   keeping both fixes intact, and push again. NEVER force-push.
3. If you determine no code change is needed, do not commit or push; explain why in the proposal.

DEPENDENCY & VALIDATION POLICY:
${ctx.config.fixPolicy}
${HITL_CONTRACT}
${PROPOSAL_CONTRACT}`;
}

// ---------------------------------------------------------------------------
// Proposal creation from agent output
// ---------------------------------------------------------------------------

async function createProposalFromFixOutput(
  ctx: FlowContext,
  pr: PrSummary,
  runId: string,
  resultText: string,
  context: string
): Promise<void> {
  const store = useRepoStore.getState();
  const obj = extractProposalJson(resultText);
  const fallbackBody = cleanResultText(resultText);

  if (obj?.type === "none") return;

  if (obj?.type === "reply" && obj.in_reply_to) {
    await store.upsertProposal({
      id: uid("prop-"),
      type: "comment_reply",
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      body: String(obj.body ?? fallbackBody),
      inReplyToCommentId: Number(obj.in_reply_to),
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
 * response becomes a pending proposal (gated on approval).
 */
export async function runFixFlow(
  ctx: FlowContext,
  pr: PrSummary,
  task: string,
  relation: string,
  kind: "ci_fix" | "conflict_fix" | "feedback_fix" | "event",
  model?: string
): Promise<string> {
  const wt = await createWorktree(ctx.gh, ctx.repo, ctx.config.localClonePath, pr);
  const prompt = applySkills(fixFlowWrapper(ctx, pr, wt, task), ctx.skills, ctx.config.skills.fix);
  try {
    return await startAgent({
      kind,
      relation,
      repo: ctx.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prompt,
      model: resolveModel(ctx, model),
      binary: ctx.global.cursorBinary,
      cwd: wt.path,
      onDone: async (run) => {
        try {
          await createProposalFromFixOutput(ctx, pr, run.id, run.resultText, relation);
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
  const base = `You are PR Copilot's review agent. Review PR #${pr.number} ("${pr.title}") by ${pr.author} in ${ctx.repo}.

TASK:
${task}
${scopeBlock}

Reviewer guidance configured for this repo:
${ctx.config.reviewFilters.criteria}

PR description:
${truncate(pr.body || "(none)", 4000)}

THE DIFF TO REVIEW (unified format, new-file line numbers derive from @@ hunk headers):
\`\`\`diff
${diff}
\`\`\`
${HITL_CONTRACT}
${REVIEW_CONTRACT}`;

  const prompt = applySkills(base, ctx.skills, ctx.config.skills.review);
  return startAgent({
    kind: "review",
    relation: selection
      ? `review (${selection.path}:${selection.startLine}–${selection.endLine})`
      : "review",
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    prompt,
    model: resolveModel(ctx, model),
    binary: ctx.global.cursorBinary,
    mode: "ask", // read-only: a review must never touch code or GitHub
    onDone: (run) =>
      selection
        ? mergeIntoReviewProposal(ctx, pr, run.id, run.resultText, diffText)
        : createReviewProposal(ctx, pr, run.id, run.resultText, diffText, "automated self-review"),
  });
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
  const base = `You are PR Copilot's review agent. The user wants a critical self-review of THEIR OWN PR #${pr.number}
("${pr.title}") in ${ctx.repo} before others see it. Find real problems they should fix.

TASK:
${task?.trim() || "Review the diff and propose inline comments with severity and confidence."}
${scopeBlock}
Reviewer guidance configured for this repo:
${ctx.config.reviewFilters.criteria}

PR description:
${truncate(pr.body || "(none)", 4000)}

THE DIFF TO REVIEW (unified format, new-file line numbers derive from @@ hunk headers):
\`\`\`diff
${diff}
\`\`\`
${HITL_CONTRACT}
${REVIEW_CONTRACT}`;
  const prompt = applySkills(base, ctx.skills, ctx.config.skills.review);
  return startAgent({
    kind: "review",
    relation: selection
      ? `self-review (${selection.path}:${selection.startLine}–${selection.endLine})`
      : "self-review",
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    prompt,
    model: resolveModel(ctx, model),
    binary: ctx.global.cursorBinary,
    mode: "ask",
    onDone: async (run) => {
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
    },
  });
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
  for (const f of findings) await store.updateFinding(f.key, { status: "applying" });

  const task = `Address the following self-review finding${findings.length > 1 ? "s" : ""} from an automated code review
of this PR. Treat each as a strong recommendation: verify it is correct in context, then implement the fix.
If a finding is wrong, skip it and say why in the proposal.

${findings.map(findingInstruction).join("\n\n")}${
    guidance?.trim()
      ? `\n\nADDITIONAL GUIDANCE FROM THE USER (takes precedence):\n${guidance.trim()}`
      : ""
  }`;

  try {
    const wt = await createWorktree(ctx.gh, ctx.repo, ctx.config.localClonePath, pr);
    const prompt = applySkills(fixFlowWrapper(ctx, pr, wt, task), ctx.skills, ctx.config.skills.fix);
    try {
      return await startAgent({
        kind: "feedback_fix",
        relation: findings.length > 1 ? `apply ${findings.length} findings` : "apply finding",
        repo: ctx.repo,
        prNumber: pr.number,
        prTitle: pr.title,
        prompt,
        model: resolveModel(ctx, model),
        binary: ctx.global.cursorBinary,
        cwd: wt.path,
        onDone: async (run) => {
          try {
            const s = useRepoStore.getState();
            for (const f of findings) await s.updateFinding(f.key, { status: "applied" });
            await createProposalFromFixOutput(ctx, pr, run.id, run.resultText, "applied self-review findings");
          } finally {
            await releaseWorktree(wt);
          }
        },
      });
    } catch (e) {
      await releaseWorktree(wt); // spawn failure: free the slot lease
      throw e;
    }
  } catch (e) {
    // worktree/spawn failure: findings go back to open so the user can retry
    for (const f of findings) await store.updateFinding(f.key, { status: "open" });
    throw e;
  }
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
  const prompt = `You are PR Copilot's analysis agent for repository ${ctx.repo}, PR #${pr.number} ("${pr.title}") by ${pr.author}.
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
    model: resolveModel(ctx, model),
    binary: ctx.global.cursorBinary,
    mode: "ask",
    onDone: (run) => createProposalFromFixOutput(ctx, pr, run.id, run.resultText, relation),
  });
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

  const base = `You are PR Copilot's draft-edit agent working on the user's own draft PR #${pr.number} ("${pr.title}") in ${ctx.repo}.

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
      model: resolveModel(ctx, model),
      binary: ctx.global.cursorBinary,
      cwd: wt.path,
      onDone: async (run) => {
        try {
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
  model?: string
): Promise<string> {
  const diffText = await ctx.gh.getPullDiff(ctx.repo, pr.number);
  const scope = selection
    ? `\nThe question is about ${selection.path} lines ${selection.startLine}–${selection.endLine}:\n\`\`\`\n${selection.snippet}\n\`\`\`\n`
    : "";
  const base = `You are PR Copilot's analysis agent. The user has a question / wants feedback on
PR #${pr.number} ("${pr.title}") by ${pr.author} in ${ctx.repo}. Do NOT make any code changes — answer in text only.
${scope}
QUESTION / FEEDBACK REQUEST:
${question}

THE DIFF:
\`\`\`diff
${truncate(diffText, MAX_DIFF_CHARS)}
\`\`\`

Answer directly and concretely; reference files and line numbers from the diff where useful.`;
  // expands any /skill references the user typed in the question
  const prompt = applySkills(base, ctx.skills, []);

  return startAgent({
    kind: "draft_question",
    relation: "draft Q&A",
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    prompt,
    model: resolveModel(ctx, model),
    binary: ctx.global.cursorBinary,
    mode: "ask",
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
      model: resolveModel(ctx, opts.model),
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
    model: resolveModel(ctx),
    "filter-criteria":
      pr.author === ctx.gh.login ? ctx.config.babysitFilters.criteria : ctx.config.reviewFilters.criteria,
    ...extra,
  };
}

export { interpolate };
