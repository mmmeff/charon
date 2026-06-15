// ---------------------------------------------------------------------------
// Global (cross-repo) configuration — kept minimal by design: just enough to
// connect to GitHub and launch per-repo windows. Everything else is per-repo.
// ---------------------------------------------------------------------------

/** A harness's saved model selections — swapped in/out as the active harness
 *  changes so each agent remembers its own picks. */
export interface HarnessModelPrefs {
  models: string[];
  modelLabels: Record<string, string>;
  defaultModel: string;
  disabledModels: string[];
  modelOverrides: Record<string, string>;
  reasoningOptions: string[];
  reasoningLabels: Record<string, string>;
  reasoningEffort: string;
  reasoningOverrides: Record<string, string>;
}

/** An ACP agent harness: a command that speaks Agent Client Protocol. */
export interface Harness {
  /** stable id, e.g. "cursor" | "opencode" | "claude-code" | "codex" | "custom-…" */
  id: string;
  name: string;
  /** executable to spawn (e.g. "cursor-agent", "opencode", "npx") */
  command: string;
  /** args that start the ACP server (e.g. ["acp"] or ["-y","@…/claude-code-acp"]) */
  args: string[];
  /** confirmed working firsthand (vs. an unverified template) */
  verified?: boolean;
  /** auth / setup hint shown when a connection probe fails */
  note?: string;
}

export interface GlobalConfig {
  /** Base web URL, e.g. "https://github.com" or "https://ghe.corp.example" */
  githubUrl: string;
  token: string;
  /** Accept self-signed TLS certs (GHE behind corp CA) */
  insecureTls: boolean;
  /** Resolved at connect time */
  login: string;
  /** Path or name of the cursor agent binary (legacy; seeds the cursor harness) */
  cursorBinary: string;
  /** Configured agent harnesses (ACP servers) */
  harnesses: Harness[];
  /** id of the harness used for every agent run */
  activeHarness: string;
  /** Model ids available for runs (sourced from the active harness over ACP) */
  models: string[];
  /** Display labels keyed by model id */
  modelLabels: Record<string, string>;
  /** Model ids hidden from every model picker (managed in Settings) */
  disabledModels: string[];
  defaultModel: string;
  /** Reasoning-effort options the active harness exposes (codex); else empty */
  reasoningOptions: string[];
  reasoningLabels: Record<string, string>;
  /** Chosen reasoning effort; "" = the harness's own default */
  reasoningEffort: string;
  /** Per-flow default model overrides, keyed by AgentKind; empty = global default */
  modelOverrides: Record<string, string>;
  /** Per-flow reasoning-effort overrides, keyed by AgentKind; "" = global default */
  reasoningOverrides: Record<string, string>;
  /** Per-harness saved model selections, keyed by harness id. The flat model
   *  fields above mirror modelPrefs[activeHarness]; switching harness swaps
   *  them so each agent remembers its own default / overrides / reasoning. */
  modelPrefs: Record<string, HarnessModelPrefs>;
  /** Repos the user has added, "owner/name" */
  repos: string[];
  /** Most recently opened repo — auto-opened on next app boot */
  lastRepo: string;
  /** Extra directories to scan for skills, beyond ~/.cursor */
  extraSkillDirs: string[];
  /** OS-notification prefs keyed by NotificationCategory; a missing key falls
   *  back to the category's catalog default. Gated centrally in notify() so no
   *  call site can bypass them. */
  notifications: Record<string, boolean>;
}

/**
 * Every distinct reason the app raises an OS notification. notify() requires
 * one of these, and Settings → Notifications toggles them — so preferences are
 * enforced in exactly one place and can't be silently bypassed.
 */
export type NotificationCategory =
  | "agent_started"
  | "agent_finished"
  | "agent_failed"
  | "ci_analysis"
  | "automation_event"
  | "pr_activity"
  | "app_update"
  | "clone_setup";

// ---------------------------------------------------------------------------
// Per-repo configuration
// ---------------------------------------------------------------------------

export interface ClassFilters {
  /** Process draft PRs in this class at all */
  processDrafts: boolean;
  /** PRs carrying any of these labels are ignored entirely */
  excludeLabels: string[];
}

export type PrReviewFilterQualifier =
  | "review"
  | "reviewed-by"
  | "review-requested"
  | "user-review-requested"
  | "team-review-requested";

export type PrReviewStatusFilter = "none" | "required" | "approved" | "changes_requested";

export interface PrReviewFilter {
  id: string;
  qualifier: PrReviewFilterQualifier;
  value: string;
}

export interface PrReviewFilters {
  filters: PrReviewFilter[];
}

export interface EventHandlerConfig {
  enabled: boolean;
  prompt: string;
  /** per-event model override; "" / undefined = inherit the flow default */
  model?: string;
}

export interface SkillSelection {
  /** skill names applied when reviewing teammate PRs */
  review: string[];
  /** skill names applied when regenerating/rewriting proposal text */
  rewrite: string[];
  /** skill names applied during fix flows (CI, conflicts, feedback) */
  fix: string[];
  /** skill names applied during drafts-view edits */
  draft: string[];
}

export interface RepoConfig {
  /** Local clone path; empty = app-managed clone under appData/clones */
  localClonePath: string;
  pollIntervalSec: number;
  /** default instructions prefilled in the composer's Review mode */
  reviewPrompt: string;
  /** dependency/validation policy injected into every fix-flow prompt */
  fixPolicy: string;
  babysitFilters: ClassFilters;
  reviewFilters: PrReviewFilters;
  /** Overrides keyed by event id; missing ids fall back to catalog defaults */
  events: Record<string, EventHandlerConfig>;
  skills: SkillSelection;
  /** Bot login fragments that classify a comment author as a bug-bot */
  bugBotPatterns: string[];
  /** Approvals needed before pr_approved fires */
  requiredApprovals: number;
  /** Auto-run the CI triage agent on failed checks */
  ciAutoAnalysis: boolean;
  /** Check names exempt from auto-analysis (managed in Settings → CI) */
  ignoredChecks: string[];
}

// ---------------------------------------------------------------------------
// Event system
// ---------------------------------------------------------------------------

export type PrClass = "mine" | "teammate" | "both";

export interface EventDef {
  id: string;
  label: string;
  description: string;
  group: string;
  appliesTo: PrClass;
  defaultEnabled: boolean;
  defaultPrompt: string;
}

export interface FiredEvent {
  id: string; // event def id
  firedAt: number;
  repo: string;
  prNumber: number;
  prTitle: string;
  /** Interpolation variables for the prompt template */
  vars: Record<string, string>;
  prClass: "mine" | "teammate";
}

// ---------------------------------------------------------------------------
// GitHub domain objects (subset of REST payloads we care about)
// ---------------------------------------------------------------------------

export interface PrSummary {
  number: number;
  title: string;
  body: string;
  /** GitHub-rendered HTML (signed asset URLs, <video> tags) — preferred for display */
  bodyHtml?: string;
  author: string;
  authorIsBot: boolean;
  draft: boolean;
  state: "open" | "closed";
  merged: boolean;
  headRef: string;
  headSha: string;
  headRepoFullName: string;
  baseRef: string;
  baseSha: string;
  labels: string[];
  url: string;
  mergeableState: string; // clean | dirty | behind | blocked | unstable | unknown
  /** GitHub auto-merge is armed on this PR */
  autoMerge: boolean;
  /** logins with an outstanding review request */
  requestedReviewers: string[];
  /** team slugs with an outstanding review request */
  requestedTeams: string[];
  requestedFromMe: boolean;
  /** GraphQL review decision when available */
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface CheckInfo {
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | timed_out | ...
  url: string;
  /** check-run id (annotations lookup) */
  id?: number;
  startedAt?: string;
  completedAt?: string;
  outputTitle?: string;
  outputSummary?: string;
}

export interface CommentInfo {
  id: number;
  kind: "issue" | "review_comment";
  author: string;
  authorIsBot: boolean;
  body: string;
  /** GitHub-rendered HTML (signed asset URLs, <video> tags) */
  bodyHtml?: string;
  createdAt: string;
  url: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  inReplyTo?: number;
}

export interface ReviewInfo {
  id: number;
  author: string;
  authorIsBot: boolean;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED
  body: string;
  bodyHtml?: string;
  submittedAt: string;
}

/** A non-comment PR timeline entry (pushed, merged, labeled, …). */
export interface TimelineEventInfo {
  id: string;
  at: number;
  actor: string;
  /** short badge label, e.g. "pushed", "merged" */
  verb: string;
  /** sentence completing "<actor> …", e.g. "requested a review from jsnelling" */
  text: string;
  /** optional secondary line (commit message) */
  sub?: string;
  color: "gray" | "green" | "red" | "yellow" | "blue" | "purple";
  url?: string;
  /** full commit sha for push/merge events — opens the in-app commit diff */
  sha?: string;
}

/** A single commit's metadata, for the commit-diff modal header. */
export interface CommitInfo {
  sha: string;
  message: string;
  /** GitHub login when known, else the raw git author name */
  author: string;
  /** authored timestamp (ms) */
  date: number;
  additions: number;
  deletions: number;
  filesChanged: number;
  /** github.com commit page */
  url: string;
}

/** Snapshot persisted between polls; diffing two snapshots yields events. */
export interface PrSnapshot {
  pr: PrSummary;
  checks: Record<string, string>; // name -> conclusion|status
  commentIds: number[];
  reviewIds: number[];
  reviewStates: Record<number, string>;
  approvals: number;
  firstSeenAt: number;
  myCommentIds: number[];
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentKind =
  | "ci_fix"
  | "conflict_fix"
  | "feedback_fix"
  | "review"
  | "draft_edit"
  | "draft_question"
  | "rewrite"
  | "event"
  | "custom";

export type AgentStatus = "starting" | "running" | "done" | "error" | "killed";

export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "other";
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

/** A tool invocation reported over ACP (tool_call + tool_call_update merged). */
export interface AgentToolCall {
  toolCallId: string;
  title: string;
  kind: ToolKind;
  status: ToolStatus;
  /** "path:line" of affected files, for follow-along display */
  locations: string[];
  /** short human summary of the call's arguments (command / path / query) */
  input?: string;
  /** text or diff output captured from the tool's content blocks */
  output?: string;
}

/** One ACP plan item (the agent's running to-do list; replaced wholesale). */
export interface AgentPlanEntry {
  content: string;
  status: string; // pending | in_progress | completed
  priority?: string;
}

/**
 * An ordered entry in an agent run's transcript. Messages/thoughts carry their
 * text inline (chunks merge); tool entries reference the tools map by id so
 * later tool_call_update patches are O(1).
 */
export type AgentEntry =
  | { type: "message"; at: number; text: string }
  | { type: "thought"; at: number; text: string }
  | { type: "steer"; at: number; text: string }
  | { type: "tool"; at: number; toolCallId: string };

export interface AgentRun {
  id: string;
  kind: AgentKind;
  /** Human description of the relation, e.g. "CI fix", "review" */
  relation: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prompt: string;
  model: string;
  cwd: string | null;
  status: AgentStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  /** ACP transcript: ordered messages / thoughts / tool refs */
  entries: AgentEntry[];
  /** tool calls keyed by toolCallId (referenced from entries) */
  tools: Record<string, AgentToolCall>;
  /** the agent's current plan (ACP `plan` updates; replaced wholesale) */
  plan: AgentPlanEntry[];
  /** current ACP session mode (agent | plan | ask) */
  mode?: string;
  /** agent-assigned session title */
  sessionTitle?: string;
  /** true while a turn is in flight and the user can steer/interrupt */
  steerable: boolean;
  /** overrides the lifecycle notification category (e.g. CI triage → "ci_analysis") */
  notifyCategory?: NotificationCategory;
  /** legacy raw lines — only on runs persisted before the ACP migration */
  lines?: AgentLine[];
  /** Accumulated assistant message text (drives proposal/finding extraction) */
  resultText: string;
  /** Proposal ids produced by this run */
  proposalIds: string[];
  /** the commit this run pushed (worktree HEAD when it advanced past the
   *  branch tip the run started from) — links straight to its diff */
  commitSha?: string;
  error?: string;
}

/** Legacy pre-ACP transcript line (kept for hydrated old runs). */
export interface AgentLine {
  kind: "stdout" | "stderr" | "info" | "text" | "thinking" | "tool" | "system";
  text: string;
  at: number;
}

// ---------------------------------------------------------------------------
// Proposals — every GitHub-facing write is one of these, gated on approval.
// ---------------------------------------------------------------------------

export type Severity = "blocker" | "major" | "minor" | "nit";

export interface ProposedInlineComment {
  key: string;
  path: string;
  line: number;
  startLine?: number;
  side: "LEFT" | "RIGHT";
  body: string;
  severity: Severity;
  /** 0..100 */
  confidence: number;
  included: boolean;
}

export type Proposal =
  | {
      id: string;
      type: "issue_comment";
      repo: string;
      prNumber: number;
      prTitle: string;
      body: string;
      context: string; // why this was proposed (event, source comment...)
      createdAt: number;
      status: "pending" | "sent" | "dismissed";
      agentRunId: string | null;
    }
  | {
      id: string;
      type: "comment_reply";
      repo: string;
      prNumber: number;
      prTitle: string;
      body: string;
      inReplyToCommentId: number;
      context: string;
      createdAt: number;
      status: "pending" | "sent" | "dismissed";
      agentRunId: string | null;
    }
  | {
      id: string;
      type: "review";
      repo: string;
      prNumber: number;
      prTitle: string;
      body: string; // review summary
      verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
      comments: ProposedInlineComment[];
      context: string;
      createdAt: number;
      status: "pending" | "sent" | "dismissed";
      agentRunId: string | null;
    };

// ---------------------------------------------------------------------------
// Local review findings (own PRs): agent-generated inline feedback that lives
// only in the app — never synced to GitHub. "Applying" a finding spawns a fix
// agent that implements it and pushes to the user's own branch.
// ---------------------------------------------------------------------------

export interface ReviewFinding {
  key: string;
  prNumber: number;
  /** head sha the review ran against — mismatch with current head = stale */
  headSha: string;
  path: string;
  line: number;
  startLine?: number;
  side: "LEFT" | "RIGHT";
  severity: Severity;
  confidence: number;
  body: string;
  /** concrete replacement code, when the reviewer could produce one */
  suggestion?: string;
  /** fix agent currently/previously applying this finding */
  agentRunId?: string;
  /** text of the anchored diff line at review time — used for content-based
   * re-anchoring after the branch moves */
  anchorText?: string;
  status: "open" | "applying" | "applied" | "dismissed";
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Diff model
// ---------------------------------------------------------------------------

export interface DiffLine {
  type: "context" | "add" | "del" | "hunk";
  oldNum: number | null;
  newNum: number | null;
  text: string;
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  lines: DiffLine[];
}

export interface LineSelection {
  path: string;
  side: "LEFT" | "RIGHT";
  startLine: number;
  endLine: number;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export interface Skill {
  name: string;
  source: "command" | "skill" | "builtin" | "user" | "shipped";
  path: string;
  content: string;
}
