import type {
  GlobalConfig,
  LineSelection,
  Proposal,
  ProposedInlineComment,
  PrSummary,
  RepoConfig,
  Severity,
  Skill,
} from "../types";
import { cleanResultText, extractProposalJson, startAgent } from "./agents";
import { lineInDiff, nearestDiffLine, parseUnifiedDiff } from "./diff";
import type { GitHubClient } from "./github";
import { applySkills } from "./skills";
import { interpolate, prVars, truncate, uid } from "./template";
import { useRepoStore } from "./store";
import { createWorktree, removeWorktree, type Worktree } from "./worktree";

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
     "confidence": <integer 0-100>}
  ]
}</proposal>
- "line"/"start_line" MUST be line numbers that appear in the provided diff (use LEFT side + old line numbers
  only for deleted lines).
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
2. Run whatever builds/tests are cheap enough to validate the change.
3. Commit with a clear message and push to the PR branch with:
   git push origin HEAD:${pr.headRef}
   (Pushing to this branch is explicitly authorized — it is the user's own PR branch.)
4. If you determine no code change is needed, do not commit or push; explain why in the proposal.
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

async function createReviewProposal(
  ctx: FlowContext,
  pr: PrSummary,
  runId: string,
  resultText: string,
  diffText: string,
  context: string
): Promise<void> {
  const store = useRepoStore.getState();
  const obj = extractProposalJson(resultText);
  const files = parseUnifiedDiff(diffText);

  const rawComments: any[] = Array.isArray(obj?.comments) ? obj.comments : [];
  const comments: ProposedInlineComment[] = [];
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
      key: uid("ic-"),
      path: String(c.path),
      line,
      startLine: c.start_line ? Number(c.start_line) : undefined,
      side,
      body: String(c.body),
      severity: SEVERITIES.includes(c.severity) ? c.severity : "minor",
      confidence: Math.max(0, Math.min(100, Number(c.confidence) || 50)),
      included: true,
    });
  }

  const summary =
    String(obj?.summary ?? obj?.body ?? "").trim() || cleanResultText(resultText) || "Automated review.";
  const note = dropped.length
    ? `\n\n_(${dropped.length} proposed comment(s) could not be anchored to the diff and were dropped: ${dropped.join(", ")})_`
    : "";

  await store.upsertProposal({
    id: uid("prop-"),
    type: "review",
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    body: summary + note,
    verdict: obj?.verdict === "APPROVE" || obj?.verdict === "REQUEST_CHANGES" ? obj.verdict : "COMMENT",
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
  return startAgent({
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
        await removeWorktree(wt);
      }
    },
  });
}

/** Review flow: diff + skills → agent → review proposal with inline comments. */
export async function runReviewFlow(
  ctx: FlowContext,
  pr: PrSummary,
  task: string,
  model?: string
): Promise<string> {
  const diffText = await ctx.gh.getPullDiff(ctx.repo, pr.number);
  const diff = truncate(diffText, MAX_DIFF_CHARS, "\n…[diff truncated — review what is shown]");
  const base = `You are PR Copilot's review agent. Review PR #${pr.number} ("${pr.title}") by ${pr.author} in ${ctx.repo}.

TASK:
${task}

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
    relation: "review",
    repo: ctx.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    prompt,
    model: resolveModel(ctx, model),
    binary: ctx.global.cursorBinary,
    mode: "ask", // read-only: a review must never touch code or GitHub
    onDone: (run) =>
      createReviewProposal(ctx, pr, run.id, run.resultText, diffText, "automated self-review"),
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
${HITL_CONTRACT}
${PROPOSAL_CONTRACT}`;

  const prompt = applySkills(base, ctx.skills, ctx.config.skills.draft);
  return startAgent({
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
        await removeWorktree(wt);
      }
    },
  });
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
  const base = `You are PR Copilot's analysis agent. The user has a question / wants feedback on their own draft
PR #${pr.number} ("${pr.title}") in ${ctx.repo}. Do NOT make any code changes — answer in text only.
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
