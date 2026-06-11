import type { ClassFilters, EventDef, GlobalConfig, RepoConfig } from "../types";

// ---------------------------------------------------------------------------
// Event catalog. Forward-compatible by design: detectors fire event ids and
// the engine resolves handlers from this catalog overlaid with per-repo
// config. Adding a future event = appending an entry here (or persisting an
// unknown id in repo config) — no engine changes required.
// ---------------------------------------------------------------------------

export const EVENT_CATALOG: EventDef[] = [
  // --- My PRs — CI & Checks ---
  {
    id: "ci_failed",
    label: "CI failed",
    description: "A required check failed on one of your PRs.",
    group: "My PRs — CI & Checks",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt: "investigate and fix the failing CI for PR {pr-number}",
  },
  {
    id: "ci_succeeded",
    label: "CI succeeded",
    description: "All checks passed. Mostly a notification; no agent work needed.",
    group: "My PRs — CI & Checks",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "all checks passed on PR {pr-number}; summarize the PR state and anything left before merge",
  },
  {
    id: "check_timed_out",
    label: "Check timed out",
    description: "A check timed out — often an infra flake; let the user decide to retry.",
    group: "My PRs — CI & Checks",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "check {check-name} timed out on PR {pr-number}; investigate whether it is a flake or a real failure",
  },
  {
    id: "check_cancelled",
    label: "Check cancelled",
    description: "A check was cancelled — often transient.",
    group: "My PRs — CI & Checks",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "check {check-name} was cancelled on PR {pr-number}; investigate whether it needs a retry",
  },

  // --- My PRs — Merge & Branch State ---
  {
    id: "merge_conflict_detected",
    label: "Merge conflict detected",
    description: "Branch no longer merges cleanly into its base.",
    group: "My PRs — Merge & Branch State",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt: "run /fix-merge-conflicts for PR {pr-number}",
  },
  {
    id: "base_branch_updated",
    label: "Base branch updated",
    description:
      "Base moved; branch is behind. Auto-rebasing every base push is noisy — usually only matters when it conflicts.",
    group: "My PRs — Merge & Branch State",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "the base branch {base-branch} moved for PR {pr-number}; rebase or merge the branch up to date and push",
  },
  {
    id: "branch_out_of_date",
    label: "Branch out of date",
    description: "GitHub flags an update is required before merging.",
    group: "My PRs — Merge & Branch State",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "PR {pr-number} is flagged out-of-date with {base-branch}; update the branch and push",
  },

  // --- My PRs — Incoming Feedback ---
  {
    id: "bug_bot_finding",
    label: "Bug-bot finding",
    description: "An automated bug/security bot left a finding.",
    group: "My PRs — Incoming Feedback",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "evaluate this bug-bot finding on PR {pr-number} and either propose a fix via worktree or propose a response: {comment-body}",
  },
  {
    id: "automated_review_received",
    label: "Automated review received",
    description: "A non-human code-review tool posted a review.",
    group: "My PRs — Incoming Feedback",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "triage this automated review on PR {pr-number} and propose responses or fixes: {comment-body}",
  },
  {
    id: "teammate_review_submitted",
    label: "Teammate review submitted",
    description: "A human submitted a review (changes requested / approved / commented).",
    group: "My PRs — Incoming Feedback",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "address the review feedback on PR {pr-number} and propose responses or fixes: {comment-body}",
  },
  {
    id: "teammate_comment_received",
    label: "Teammate comment received",
    description: "A standalone human comment or reply on your PR.",
    group: "My PRs — Incoming Feedback",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "assess whether this comment on PR {pr-number} needs a response or code change and propose one: {comment-body}",
  },
  {
    id: "review_dismissed",
    label: "Review dismissed",
    description: "A prior review on your PR was dismissed.",
    group: "My PRs — Incoming Feedback",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "a review by {author} on PR {pr-number} was dismissed; assess whether anything needs follow-up",
  },

  // --- My PRs — Lifecycle ---
  {
    id: "pr_approved",
    label: "PR approved",
    description: "Enough approvals to merge. Merge by hand; optionally tidy the description.",
    group: "My PRs — Lifecycle",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "PR {pr-number} has enough approvals; propose an updated, accurate PR description reflecting the final diff",
  },
  {
    id: "pr_merged",
    label: "PR merged",
    description: "Your PR merged. Optional cleanup prompt.",
    group: "My PRs — Lifecycle",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt: "PR {pr-number} merged; clean up any local worktrees or follow-ups for {branch}",
  },
  {
    id: "pr_closed_unmerged",
    label: "PR closed unmerged",
    description: "Your PR was closed without merging.",
    group: "My PRs — Lifecycle",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "PR {pr-number} was closed without merging; summarize why it might have been closed and what is salvageable",
  },

  // --- Teammate PRs — Review Triggers ---
  {
    id: "review_requested",
    label: "Review requested",
    description:
      "You were requested as a reviewer — directly or via a team you're on (treated identically).",
    group: "Teammate PRs — Review Triggers",
    appliesTo: "teammate",
    defaultEnabled: false,
    defaultPrompt:
      "run the thermonuclear code quality review on PR {pr-number} and propose inline comments with severity and confidence",
  },
  {
    id: "pr_updated_under_review",
    label: "PR updated under review",
    description:
      "A PR you're already reviewing got new commits. Can burn agent runs on tiny pushes; opt in when desired.",
    group: "Teammate PRs — Review Triggers",
    appliesTo: "teammate",
    defaultEnabled: false,
    defaultPrompt:
      "re-review only the new changes on PR {pr-number} since your last pass and propose inline comments",
  },
  {
    id: "author_replied_to_your_comment",
    label: "Author replied to your comment",
    description: "Author responded to a comment you left. Threads are usually a human call.",
    group: "Teammate PRs — Review Triggers",
    appliesTo: "teammate",
    defaultEnabled: false,
    defaultPrompt:
      "the author replied to your review comment on PR {pr-number}; assess the reply and propose a response if warranted: {comment-body}",
  },

  // --- Cross-Cutting / Both Classes ---
  {
    id: "pr_opened",
    label: "PR opened",
    description:
      "A new PR appears in scope. Broad — turning this on means processing everything.",
    group: "Cross-Cutting",
    appliesTo: "both",
    defaultEnabled: false,
    defaultPrompt: "a new PR {pr-number} ({pr-title}) by {author} appeared; triage it",
  },
  {
    id: "draft_marked_ready",
    label: "Draft marked ready",
    description: "Draft flipped to ready-for-review. Default ON for teammate PRs (triggers review), OFF for yours.",
    group: "Cross-Cutting",
    appliesTo: "teammate",
    defaultEnabled: false,
    defaultPrompt:
      "PR {pr-number} just became ready for review; run the thermonuclear code quality review and propose inline comments with severity and confidence",
  },
  {
    id: "draft_marked_ready_mine",
    label: "Draft marked ready (your PR)",
    description: "Your own draft flipped to ready-for-review.",
    group: "Cross-Cutting",
    appliesTo: "mine",
    defaultEnabled: false,
    defaultPrompt:
      "your PR {pr-number} is now ready for review; propose a final self-check summary comment",
  },
  {
    id: "marked_as_draft",
    label: "Marked as draft",
    description: "A ready PR moved back to draft.",
    group: "Cross-Cutting",
    appliesTo: "both",
    defaultEnabled: false,
    defaultPrompt: "PR {pr-number} moved back to draft; note any in-flight work to pause",
  },
  {
    id: "labeled",
    label: "Label added",
    description:
      "More useful as scoping inside prompts (e.g. skip `do-not-review`) than as a standalone trigger.",
    group: "Cross-Cutting",
    appliesTo: "both",
    defaultEnabled: false,
    defaultPrompt: "label {label} was added to PR {pr-number}; react if it changes how to handle the PR",
  },
  {
    id: "unlabeled",
    label: "Label removed",
    description: "A label was removed.",
    group: "Cross-Cutting",
    appliesTo: "both",
    defaultEnabled: false,
    defaultPrompt: "label {label} was removed from PR {pr-number}; react if it changes how to handle the PR",
  },
  {
    id: "mentioned",
    label: "You were @-mentioned",
    description: "You were @-mentioned in a comment anywhere in scope. Can be noisy.",
    group: "Cross-Cutting",
    appliesTo: "both",
    defaultEnabled: false,
    defaultPrompt:
      "you were mentioned on PR {pr-number}; assess the comment and propose a response: {comment-body}",
  },
];

export const eventDef = (id: string): EventDef | undefined =>
  EVENT_CATALOG.find((e) => e.id === id);

// ---------------------------------------------------------------------------
// Default filters & repo config
// ---------------------------------------------------------------------------

export const DEFAULT_BABYSIT_FILTERS: ClassFilters = {
  processDrafts: false,
  excludeLabels: ["pr-copilot-ignore"],
  criteria:
    "Ignore pure acknowledgements (LGTM, thanks, +1), emoji-only comments, and already-resolved threads. " +
    "Respond to direct questions, change requests, and bug findings. Prefer a code fix over a rebuttal when the " +
    "feedback is plausibly right; push back politely with reasoning when it is wrong.",
};

export const DEFAULT_REVIEW_FILTERS: ClassFilters = {
  processDrafts: false,
  excludeLabels: ["pr-copilot-ignore", "do-not-review"],
  criteria:
    "Focus on correctness, security, concurrency, and maintainability. Skip generated files, lockfiles, and pure " +
    "formatting churn. Only raise an inline comment when you can articulate the concrete failure mode or cost; " +
    "do not pad reviews with style nits unless severity is marked accordingly.",
};

export const DEFAULT_REVIEW_PROMPT =
  "Run the thermonuclear code quality review on PR {pr-number} and propose inline comments with severity and confidence.";

export const DEFAULT_FIX_POLICY = `- Do NOT install dependencies (npm/pnpm/yarn install, pip, cargo fetch, bundle install, …) and do NOT run
  full builds or test suites. This may be a large monorepo; installs are slow, expensive, and waste disk.
- Validate by reading the code carefully. You may run fast static checks that need no installation
  (parsing a file, a single-file typecheck if the toolchain already works) — nothing that downloads anything.
- CI on the pushed branch is the validation backstop. In your proposal, note what CI should confirm.
- If you are genuinely unable to make the change safely without running something heavyweight, make the
  smallest correct change you can and say exactly what you could not verify.`;

export function defaultRepoConfig(): RepoConfig {
  return {
    localClonePath: "",
    pollIntervalSec: 60,
    model: "",
    reviewPrompt: DEFAULT_REVIEW_PROMPT,
    fixPolicy: DEFAULT_FIX_POLICY,
    babysitFilters: { ...DEFAULT_BABYSIT_FILTERS },
    reviewFilters: { ...DEFAULT_REVIEW_FILTERS },
    events: {},
    skills: {
      review: ["thermonuclear-code-quality-review"],
      rewrite: [],
      fix: [],
      draft: [],
    },
    bugBotPatterns: ["bugbot", "cursor", "coderabbit", "copilot", "sonar", "snyk", "codeql"],
    requiredApprovals: 1,
  };
}

/** Out-of-the-box default model for every installation. If the Cursor CLI
 *  doesn't list it, the startup model refresh falls back to "auto". */
export const DEFAULT_MODEL_ID = "composer-2.5-fast";

/**
 * Out-of-the-box per-flow defaults: thinking-heavy models where judgment
 * matters (reviews, Q&A), a strong long-context coder for CI/branch work,
 * a writing-tuned model for prose, fast default for the rest. Ids the
 * user's CLI doesn't list are ignored at resolve time (falls through to
 * the global default).
 */
export const DEFAULT_MODEL_OVERRIDES: Record<string, string> = {
  draft_question: "claude-opus-4-8-thinking-high",
  review: "claude-opus-4-8-thinking-high",
  ci_fix: "gpt-5.5-high",
  conflict_fix: "gpt-5.5-high",
  rewrite: "claude-4.6-sonnet-medium",
  draft_edit: DEFAULT_MODEL_ID,
  feedback_fix: DEFAULT_MODEL_ID,
};

/**
 * Every AI-prompt-driven flow, keyed by its AgentKind, with what the user can
 * steer at launch time. Drives the Default-models settings table; overrides
 * land in GlobalConfig.modelOverrides.
 */
export const FLOW_MODEL_CATALOG: { kind: string; label: string; capability: string }[] = [
  { kind: "draft_question", label: "Ask / Q&A", capability: "prompt ✓ · model picker ✓" },
  { kind: "draft_edit", label: "Edit (composer Change mode)", capability: "prompt ✓ · model picker ✓" },
  { kind: "review", label: "Review (self-review & teammate review)", capability: "prompt ✓ · model picker ✓" },
  {
    kind: "feedback_fix",
    label: "Apply findings / address comments",
    capability: "guidance ✓ · model picker ✓",
  },
  { kind: "ci_fix", label: "CI fix", capability: "guidance ✓ · model picker ✓" },
  {
    kind: "conflict_fix",
    label: "Branch maintenance (conflicts, merge from base)",
    capability: "prompt from event settings · no launch form",
  },
  {
    kind: "event",
    label: "Automated event handlers",
    capability: "prompt per event (Events section) · no model picker at launch",
  },
  {
    kind: "rewrite",
    label: "Writing (description / title drafts, comment rewrites)",
    capability: "instruction ✓ · model picker ✓ on drafts; rewrites have none",
  },
];

export function defaultGlobalConfig(): GlobalConfig {
  return {
    githubUrl: "https://github.com",
    token: "",
    insecureTls: false,
    login: "",
    cursorBinary: "cursor-agent",
    // placeholder until `cursor-agent models` is queried on startup
    models: ["auto", DEFAULT_MODEL_ID],
    modelLabels: { auto: "Auto", [DEFAULT_MODEL_ID]: "Composer 2.5 Fast" },
    disabledModels: [],
    defaultModel: DEFAULT_MODEL_ID,
    modelOverrides: { ...DEFAULT_MODEL_OVERRIDES },
    repos: [],
    lastRepo: "",
    extraSkillDirs: [],
  };
}

// ---------------------------------------------------------------------------
// Shipped skills — used when the user's ~/.cursor does not provide them.
// Local files with the same name always win over these fallbacks.
// ---------------------------------------------------------------------------

export const SHIPPED_SKILLS: { name: string; content: string }[] = [
  {
    name: "thermonuclear-code-quality-review",
    content: `# Thermonuclear Code Quality Review

You are performing the most rigorous code review you are capable of. Treat the diff as guilty until proven
innocent. Hunt, in priority order:

1. **Correctness** — logic errors, inverted conditions, off-by-one, broken error handling, unhandled nulls,
   wrong API usage, race conditions, resource leaks, broken invariants between files.
2. **Security** — injection, authz/authn gaps, secrets, unsafe deserialization, path traversal, SSRF.
3. **Data integrity** — migrations, serialization compatibility, partial-failure states, idempotency.
4. **Performance** — quadratic loops on unbounded input, N+1 queries, sync IO on hot paths, unbounded memory.
5. **Maintainability** — misleading names, dead code, duplicated logic, missing tests for risky paths.

Rules of engagement:
- Read the surrounding context, not just changed lines. A hunk can be locally fine and globally wrong.
- Every finding must name the concrete failure mode ("this NPEs when X is empty"), not vibes ("could be cleaner").
- Assign **severity**: blocker | major | minor | nit, and **confidence** 0-100 reflecting how sure you are the
  issue is real after reading the available context.
- Do not raise style opinions a formatter or linter would catch.
- If the diff is clean, say so — a short review with zero comments is a valid outcome.`,
  },
  {
    name: "humanize",
    content: `# Humanize

Rewrite the given text so it reads like a busy, competent engineer wrote it — not an AI.

- Cut filler ("I hope this helps", "great question", "as an AI"), hedging stacks, and restating the obvious.
- Prefer short, direct sentences. Contractions are fine. Mild informality is fine.
- Keep all technical content, code references, and reasoning intact; only change the voice.
- No bullet-point explosions for two-item lists. No headers in short comments. No sign-offs.
- Match how people actually talk in PR threads: lead with the point, then the reasoning, then (optionally) a question.`,
  },
];
