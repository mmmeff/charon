import type {
  ClassFilters,
  EventDef,
  GlobalConfig,
  Harness,
  HarnessModelPrefs,
  NotificationCategory,
  RepoConfig,
} from "../types";

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
    defaultPrompt:
      "investigate the failing CI for PR {pr-number}. Consider whether the changes are related, or if " +
      "it's from some other upstream issue or the result of flaky tests. If they're flaky, just rerun it. " +
      "If the breakages are legitimately the result of our changes, implement a fix on the PR's branch. " +
      "Make sure all related type-checking/linting/tests are passing before calling the work done. Avoid " +
      "running suites for the entire project and just focus on PR-related tests/files. Once all good, " +
      "commit and push to the associated PR's branch.",
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
    reviewPrompt: DEFAULT_REVIEW_PROMPT,
    fixPolicy: DEFAULT_FIX_POLICY,
    babysitFilters: { ...DEFAULT_BABYSIT_FILTERS },
    reviewFilters: { ...DEFAULT_REVIEW_FILTERS },
    ciAutoAnalysis: true,
    ignoredChecks: [],
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

// ---------------------------------------------------------------------------
// Per-harness model & reasoning defaults
//
// Model selections are never baked into a fresh config. They're applied — and
// reconciled against the harness's live model list — the moment a harness is
// selected in onboarding or switched in Settings. Every harness carries its
// own hardcoded defaults, so a switch always lands on sensible picks for that
// specific agent. Harnesses absent from this table get a clean "auto" seed
// ("auto" is always valid), and any id the live harness doesn't expose is
// dropped at reconcile time — so a default selection is never invalid.
// ---------------------------------------------------------------------------

export interface HarnessModelDefaults {
  /** install default model id, or "auto" to defer to the harness's own default */
  defaultModel: string;
  /** per-flow model overrides, keyed by AgentKind */
  modelOverrides: Record<string, string>;
  /** global default reasoning effort ("" = no axis / harness default) */
  reasoningEffort: string;
  /** per-flow reasoning-effort overrides, keyed by AgentKind */
  reasoningOverrides: Record<string, string>;
}

export const HARNESS_MODEL_DEFAULTS: Record<string, HarnessModelDefaults> = {
  // Cursor encodes thinking effort in the model id, so it has no separate
  // reasoning axis. Thinking-heavy models where judgment matters (review,
  // Q&A); a strong long-context coder for CI/branch work; a writing-tuned
  // model for prose; the fast composer for the rest.
  cursor: {
    defaultModel: "composer-2.5-fast",
    modelOverrides: {
      draft_question: "claude-opus-4-8-thinking-high",
      review: "claude-opus-4-8-thinking-high",
      ci_fix: "gpt-5.5-high",
      conflict_fix: "gpt-5.5-high",
      rewrite: "claude-4.6-sonnet-medium",
      draft_edit: "composer-2.5-fast",
      feedback_fix: "composer-2.5-fast",
      ci_analysis: "composer-2.5-fast",
    },
    reasoningEffort: "",
    reasoningOverrides: {},
  },
  // Codex exposes a reasoning-effort axis (low/medium/high/xhigh): the
  // codex-spark coder for edit/fix/writing, gpt-5.5 for Q&A/review/apply,
  // gpt-5.5-high for branch maintenance. xhigh where depth pays off; medium
  // for routine branch maintenance.
  codex: {
    defaultModel: "gpt-5.3-codex-spark",
    modelOverrides: {
      draft_question: "gpt-5.5",
      review: "gpt-5.5",
      feedback_fix: "gpt-5.5",
      event: "gpt-5.5",
      draft_edit: "gpt-5.3-codex-spark",
      ci_fix: "gpt-5.3-codex-spark",
      ci_analysis: "gpt-5.3-codex-spark",
      rewrite: "gpt-5.3-codex-spark",
      conflict_fix: "gpt-5.5-high",
    },
    reasoningEffort: "high",
    reasoningOverrides: {
      draft_edit: "xhigh",
      review: "xhigh",
      feedback_fix: "xhigh",
      ci_fix: "xhigh",
      ci_analysis: "xhigh",
      rewrite: "xhigh",
      conflict_fix: "medium",
    },
  },
};

/** Hardcoded defaults for a harness, or a clean "auto" seed for harnesses we
 *  don't ship presets for ("auto" is always a valid, available selection). */
export function harnessModelDefaults(id: string): HarnessModelDefaults {
  return (
    HARNESS_MODEL_DEFAULTS[id] ?? {
      defaultModel: "auto",
      modelOverrides: {},
      reasoningEffort: "",
      reasoningOverrides: {},
    }
  );
}

/** Reconcile a harness's hardcoded defaults against the ids it actually
 *  exposes, guaranteeing every selection is available: unknown model ids fall
 *  back to "auto", unknown reasoning ids are dropped (the flow inherits the
 *  global default). Pass the live `models` (incl. "auto") / `reasoningOptions`
 *  from a probe. */
export function reconcileHarnessDefaults(
  d: HarnessModelDefaults,
  models: string[],
  reasoningOptions: string[]
): Pick<HarnessModelDefaults, "defaultModel" | "modelOverrides" | "reasoningEffort" | "reasoningOverrides"> {
  const okModel = (m: string) => models.includes(m);
  const okR = (r: string) => reasoningOptions.includes(r);
  const modelOverrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.modelOverrides)) if (okModel(v)) modelOverrides[k] = v;
  const reasoningOverrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.reasoningOverrides)) if (okR(v)) reasoningOverrides[k] = v;
  return {
    defaultModel: okModel(d.defaultModel) ? d.defaultModel : "auto",
    modelOverrides,
    reasoningEffort: okR(d.reasoningEffort) ? d.reasoningEffort : "",
    reasoningOverrides,
  };
}

/** Seed model/label/reasoning lists from a harness's hardcoded defaults so the
 *  selections are listable in the brief window between switching and the live
 *  probe (refreshModels then replaces these with the real list + labels). */
function seedListsFromDefaults(d: HarnessModelDefaults): {
  models: string[];
  modelLabels: Record<string, string>;
  reasoningOptions: string[];
  reasoningLabels: Record<string, string>;
} {
  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
  const ids = uniq(["auto", d.defaultModel, ...Object.values(d.modelOverrides)]);
  const modelLabels: Record<string, string> = {};
  for (const id of ids) modelLabels[id] = id === "auto" ? "Auto" : id;
  const rids = uniq([d.reasoningEffort, ...Object.values(d.reasoningOverrides)]);
  const reasoningLabels: Record<string, string> = {};
  for (const r of rids) reasoningLabels[r] = r.charAt(0).toUpperCase() + r.slice(1);
  return { models: ids, modelLabels, reasoningOptions: rids, reasoningLabels };
}

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
    kind: "ci_analysis",
    label: "CI failure analysis",
    capability: "auto-summary · model picker ✓ (also in Checks)",
  },
  {
    kind: "conflict_fix",
    label: "Branch maintenance (conflicts, merge from base)",
    capability: "prompt + model picker per event (Events section)",
  },
  {
    kind: "event",
    label: "Automated event handlers",
    capability: "prompt + model picker per event (Events section)",
  },
  {
    kind: "rewrite",
    label: "Writing (description / title drafts, comment rewrites)",
    capability: "instruction ✓ · model picker ✓ on drafts; rewrites have none",
  },
];

/**
 * Every OS-notification category, with its user-facing label, description, and
 * out-of-the-box default. The single source of truth for both notify()'s gate
 * and the Settings → Notifications toggles. CI triage defaults OFF — it fires
 * on every failing check and is low-signal.
 */
export const NOTIFICATION_CATALOG: {
  id: NotificationCategory;
  label: string;
  description: string;
  defaultEnabled: boolean;
}[] = [
  { id: "agent_finished", label: "Agent finished", description: "An agent run completes.", defaultEnabled: true },
  { id: "agent_failed", label: "Agent failed", description: "An agent run errors out.", defaultEnabled: true },
  { id: "agent_started", label: "Agent started", description: "An agent run begins.", defaultEnabled: true },
  {
    id: "ci_analysis",
    label: "CI failure analysis",
    description: "The read-only CI triage agent starts or finishes. Fires on every failing check — low-signal, off by default.",
    defaultEnabled: false,
  },
  {
    id: "automation_event",
    label: "Automation events",
    description: "An enabled automation event fires (CI failed, review submitted, conflict detected, …).",
    defaultEnabled: true,
  },
  {
    id: "pr_activity",
    label: "PR activity",
    description: "A PR you acted on is merged, approved, closed, converted to draft, or opened for review.",
    defaultEnabled: true,
  },
  {
    id: "app_update",
    label: "App updates",
    description: "An update is available, installed, or the check failed.",
    defaultEnabled: true,
  },
  {
    id: "clone_setup",
    label: "Workspace setup",
    description: "First-run local clone preparation for a repo.",
    defaultEnabled: true,
  },
];

/** Whether `category` is enabled in `prefs`, defaulting to the catalog value
 *  when unset. The one resolver both notify() and the settings UI read. */
export function notificationEnabled(
  prefs: Record<string, boolean> | undefined,
  category: NotificationCategory
): boolean {
  const stored = prefs?.[category];
  if (typeof stored === "boolean") return stored;
  return NOTIFICATION_CATALOG.find((c) => c.id === category)?.defaultEnabled ?? true;
}

/**
 * Built-in harness templates (ACP servers). `cursor` and `opencode` are
 * verified firsthand (`cursor-agent acp`, `opencode acp`); claude-code uses
 * Zed's documented adapter; codex has no native ACP server and needs a bridge
 * — onboarding's live verify is the source of truth for the unverified ones.
 */
export function harnessTemplates(cursorBinary = "cursor-agent"): Harness[] {
  return [
    { id: "cursor", name: "Cursor", command: cursorBinary, args: ["acp"], verified: true,
      note: "Run `cursor-agent login` if prompts fail with an auth error." },
    { id: "opencode", name: "opencode", command: "opencode", args: ["acp"], verified: true,
      note: "Configure a provider/API key in opencode first." },
    { id: "claude-code", name: "Claude Code", command: "npx", args: ["-y", "@zed-industries/claude-code-acp"],
      note: "Adapter via npx; needs ANTHROPIC_API_KEY in the environment." },
    // Codex has no native ACP server, so it runs through Zed's codex-acp
    // bridge (a Rust binary shipped via npx). `codex acp` would just open the
    // interactive REPL and fail on piped stdin. Verified firsthand.
    { id: "codex", name: "Codex CLI", command: "npx", args: ["-y", "@zed-industries/codex-acp"], verified: true,
      note: "ACP bridge via npx (@zed-industries/codex-acp); uses your Codex login / OPENAI_API_KEY." },
  ];
}

export function defaultGlobalConfig(): GlobalConfig {
  return {
    githubUrl: "https://github.com",
    token: "",
    insecureTls: false,
    login: "",
    cursorBinary: "cursor-agent",
    // Cursor by default; onboarding can switch it. Model selections are NOT
    // baked in here — they're applied (and reconciled against the harness's
    // live model list) once a harness is selected in onboarding or switched in
    // Settings. Until then everything resolves to "auto", which is always valid.
    harnesses: [harnessTemplates().find((h) => h.id === "cursor")!],
    activeHarness: "cursor",
    models: ["auto"],
    modelLabels: { auto: "Auto" },
    disabledModels: [],
    defaultModel: "auto",
    reasoningOptions: [],
    reasoningLabels: {},
    reasoningEffort: "",
    modelOverrides: {},
    reasoningOverrides: {},
    modelPrefs: {},
    repos: [],
    lastRepo: "",
    extraSkillDirs: [],
    notifications: {}, // empty = every category resolves to its catalog default
  };
}

/** Resolve the active harness, tolerating older configs that predate harnesses. */
export function activeHarness(cfg: GlobalConfig): Harness {
  const list = cfg.harnesses?.length ? cfg.harnesses : [harnessTemplates(cfg.cursorBinary)[0]];
  return list.find((h) => h.id === cfg.activeHarness) ?? list[0];
}

/** Snapshot the active harness's flat model fields into modelPrefs[active].
 *  Called on every global save as an informational record of each harness's
 *  last-known selections. Switching harness does NOT restore from it — every
 *  switch resets to the harness's hardcoded defaults (see switchHarness). */
export function syncActiveModelPrefs(cfg: GlobalConfig): GlobalConfig {
  if (!cfg.activeHarness) return cfg;
  const prefs: HarnessModelPrefs = {
    models: cfg.models,
    modelLabels: cfg.modelLabels,
    defaultModel: cfg.defaultModel,
    disabledModels: cfg.disabledModels ?? [],
    modelOverrides: cfg.modelOverrides ?? {},
    reasoningOptions: cfg.reasoningOptions ?? [],
    reasoningLabels: cfg.reasoningLabels ?? {},
    reasoningEffort: cfg.reasoningEffort ?? "",
    reasoningOverrides: cfg.reasoningOverrides ?? {},
  };
  return { ...cfg, modelPrefs: { ...(cfg.modelPrefs ?? {}), [cfg.activeHarness]: prefs } };
}

/**
 * Switch the active harness. Every switch lands on the TARGET harness's
 * hardcoded defaults (not the user's prior picks) — seeded so the selections
 * are listable immediately. The caller then runs refreshModels, which sources
 * the live model list and reconciles these defaults against it so every
 * selection is guaranteed available.
 */
export function switchHarness(cfg: GlobalConfig, h: Harness): GlobalConfig {
  const synced = syncActiveModelPrefs(cfg);
  const harnesses = [...(synced.harnesses ?? []).filter((x) => x.id !== h.id), h];
  // Re-saving the already-active harness (e.g. tweaking its command/args) keeps
  // the current selections — only an actual change of harness resets to the
  // target's hardcoded defaults.
  if (synced.activeHarness === h.id) return { ...synced, harnesses };
  const d = harnessModelDefaults(h.id);
  const seed = seedListsFromDefaults(d);
  return {
    ...synced,
    harnesses,
    activeHarness: h.id,
    models: seed.models,
    modelLabels: seed.modelLabels,
    defaultModel: d.defaultModel,
    disabledModels: [],
    modelOverrides: { ...d.modelOverrides },
    reasoningOptions: seed.reasoningOptions,
    reasoningLabels: seed.reasoningLabels,
    reasoningEffort: d.reasoningEffort,
    reasoningOverrides: { ...d.reasoningOverrides },
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
