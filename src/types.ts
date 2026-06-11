// ---------------------------------------------------------------------------
// Global (cross-repo) configuration — kept minimal by design: just enough to
// connect to GitHub and launch per-repo windows. Everything else is per-repo.
// ---------------------------------------------------------------------------

export interface GlobalConfig {
  /** Base web URL, e.g. "https://github.com" or "https://ghe.corp.example" */
  githubUrl: string;
  token: string;
  /** Accept self-signed TLS certs (GHE behind corp CA) */
  insecureTls: boolean;
  /** Resolved at connect time */
  login: string;
  /** Path or name of the cursor agent binary */
  cursorBinary: string;
  /** Model ids available for runs (refreshed from `cursor-agent models` on startup) */
  models: string[];
  /** Display labels keyed by model id */
  modelLabels: Record<string, string>;
  defaultModel: string;
  /** Repos the user has added, "owner/name" */
  repos: string[];
  /** Extra directories to scan for skills, beyond ~/.cursor */
  extraSkillDirs: string[];
}

// ---------------------------------------------------------------------------
// Per-repo configuration
// ---------------------------------------------------------------------------

export interface ClassFilters {
  /** Process draft PRs in this class at all */
  processDrafts: boolean;
  /** PRs carrying any of these labels are ignored entirely */
  excludeLabels: string[];
  /**
   * Freeform criteria injected into LLM prompts ({filter-criteria}) deciding
   * e.g. which comments warrant a response, what to focus a review on.
   */
  criteria: string;
}

export interface EventHandlerConfig {
  enabled: boolean;
  prompt: string;
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
  model: string; // default model for this repo ("" = global default)
  babysitFilters: ClassFilters;
  reviewFilters: ClassFilters;
  /** Overrides keyed by event id; missing ids fall back to catalog defaults */
  events: Record<string, EventHandlerConfig>;
  skills: SkillSelection;
  /** Bot login fragments that classify a comment author as a bug-bot */
  bugBotPatterns: string[];
  /** Approvals needed before pr_approved fires */
  requiredApprovals: number;
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
  requestedFromMe: boolean;
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
}

export interface CommentInfo {
  id: number;
  kind: "issue" | "review_comment";
  author: string;
  authorIsBot: boolean;
  body: string;
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
  submittedAt: string;
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
  /** Raw streamed lines (capped) */
  lines: AgentLine[];
  /** Accumulated assistant text extracted from the stream */
  resultText: string;
  /** Proposal ids produced by this run */
  proposalIds: string[];
  error?: string;
}

export interface AgentLine {
  kind: "stdout" | "stderr" | "info";
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
