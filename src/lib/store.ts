import { create } from "zustand";
import type {
  AgentPlanEntry,
  AgentRun,
  AgentStatus,
  AgentToolCall,
  FiredEvent,
  GlobalConfig,
  PrReviewFilter,
  PrReviewFilters,
  Proposal,
  PrSnapshot,
  RepoConfig,
  ReviewFinding,
  Skill,
  Swarm,
} from "../types";
import { defaultGlobalConfig, defaultRepoConfig, syncActiveModelPrefs, DEFAULT_FIX_POLICY, LEGACY_FIX_POLICY } from "./defaults";
import { reLeaseWorktree, removeWorktree } from "./worktree";
import { native } from "./tauri";

const repoKey = (repo: string) => repo.replace(/[^a-zA-Z0-9_.-]/g, "__");

// ---------------------------------------------------------------------------
// Global config store
// ---------------------------------------------------------------------------

interface GlobalState {
  config: GlobalConfig | null;
  loaded: boolean;
  load(): Promise<GlobalConfig | null>;
  save(cfg: GlobalConfig): Promise<void>;
  setLastRepo(repo: string): Promise<void>;
}

/** Forward-migrate a loaded global config: seed the cursor harness from a
 *  legacy cursorBinary when the harness fields are absent. */
function migrateGlobal(cfg: GlobalConfig): GlobalConfig {
  if (!cfg.harnesses || cfg.harnesses.length === 0) {
    cfg.harnesses = [
      { id: "cursor", name: "Cursor", command: cfg.cursorBinary || "cursor-agent", args: ["acp"], verified: true },
    ];
    cfg.activeHarness = "cursor";
  }
  return cfg;
}

export const useGlobalConfig = create<GlobalState>((set) => ({
  config: null,
  loaded: false,
  async load() {
    const raw = await native.loadBlob("global.json");
    const config = raw ? migrateGlobal({ ...defaultGlobalConfig(), ...JSON.parse(raw) }) : null;
    set({ config, loaded: true });
    return config;
  },
  async save(cfg) {
    // mirror the active harness's model selections into modelPrefs so they
    // persist and survive a harness switch-and-return
    const synced = syncActiveModelPrefs(cfg);
    set({ config: synced });
    await native.saveBlob("global.json", JSON.stringify(synced, null, 2));
  },
  // read-modify-write against the file so concurrent repo windows don't
  // clobber each other's global config changes
  async setLastRepo(repo) {
    const raw = await native.loadBlob("global.json");
    if (!raw) return;
    const cfg: GlobalConfig = { ...defaultGlobalConfig(), ...JSON.parse(raw), lastRepo: repo };
    set({ config: cfg });
    await native.saveBlob("global.json", JSON.stringify(cfg, null, 2));
  },
}));

// ---------------------------------------------------------------------------
// Per-repo store: config, snapshots, proposals, event log
// ---------------------------------------------------------------------------

interface RepoState {
  repo: string;
  config: RepoConfig;
  loaded: boolean;
  snapshots: Record<number, PrSnapshot>;
  proposals: Proposal[];
  eventLog: FiredEvent[];
  findings: ReviewFinding[];
  /** summary text of the last self-review per PR */
  reviewSummaries: Record<number, { text: string; at: number }>;

  init(repo: string): Promise<void>;
  saveConfig(cfg: RepoConfig): Promise<void>;
  saveSnapshots(s: Record<number, PrSnapshot>): Promise<void>;
  upsertProposal(p: Proposal): Promise<void>;
  removeProposal(id: string): Promise<void>;
  logEvent(e: FiredEvent): Promise<void>;
  /** replace all findings for a PR with a fresh review's output */
  setFindings(prNumber: number, list: ReviewFinding[], summary: string): Promise<void>;
  /** append findings (line-scoped reviews) without touching existing ones */
  mergeFindings(prNumber: number, list: ReviewFinding[]): Promise<void>;
  updateFinding(key: string, patch: Partial<ReviewFinding>): Promise<void>;
  clearFindings(prNumber: number): Promise<void>;

  /** locally-dismissed Ask findings by agent run id — hidden from RunResults. */
  dismissedAskRuns: string[];
  dismissAskRun(runId: string): Promise<void>;
  undismissAskRun(runId: string): Promise<void>;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function migrateClassFilters(raw: unknown, fallback: RepoConfig["babysitFilters"]): RepoConfig["babysitFilters"] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    processDrafts: typeof obj.processDrafts === "boolean" ? obj.processDrafts : fallback.processDrafts,
    excludeLabels: Array.isArray(obj.excludeLabels) ? stringList(obj.excludeLabels) : fallback.excludeLabels,
  };
}

function migrateReviewFilters(raw: unknown): PrReviewFilters {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const filters = Array.isArray(obj.filters) ? obj.filters : [];
  return {
    filters: filters
      .map((f): PrReviewFilter | null => {
        if (!f || typeof f !== "object") return null;
        const row = f as Record<string, unknown>;
        const qualifier = String(row.qualifier ?? "");
        if (
          qualifier !== "review" &&
          qualifier !== "reviewed-by" &&
          qualifier !== "review-requested" &&
          qualifier !== "user-review-requested" &&
          qualifier !== "team-review-requested"
        ) {
          return null;
        }
        return {
          id: String(row.id || `${qualifier}-${Math.random().toString(36).slice(2)}`),
          qualifier: qualifier as PrReviewFilter["qualifier"],
          value: String(row.value ?? "").trim(),
        };
      })
      .filter((f): f is PrReviewFilter => !!f && !!f.value),
  };
}

function migrateSkillSelection(raw: unknown, fallback: RepoConfig["skills"]): RepoConfig["skills"] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    review: Array.isArray(obj.review) ? stringList(obj.review) : fallback.review,
    rewrite: Array.isArray(obj.rewrite) ? stringList(obj.rewrite) : fallback.rewrite,
    fix: Array.isArray(obj.fix) ? stringList(obj.fix) : fallback.fix,
    draft: Array.isArray(obj.draft) ? stringList(obj.draft) : fallback.draft,
    draftCreate: Array.isArray(obj.draftCreate) ? stringList(obj.draftCreate) : fallback.draftCreate,
  };
}

function migrateDraftCreate(
  raw: unknown,
  fallback: RepoConfig["draftCreate"]
): RepoConfig["draftCreate"] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (key: keyof RepoConfig["draftCreate"]) =>
    typeof obj[key] === "string" ? String(obj[key]) : fallback[key];
  return {
    baseBranch: str("baseBranch"),
    branchNameInstructions: str("branchNameInstructions"),
    titleInstructions: str("titleInstructions"),
    descriptionInstructions: str("descriptionInstructions"),
    implementationInstructions: str("implementationInstructions"),
  };
}

function migrateRepoConfig(raw: string | null): RepoConfig {
  const defaults = defaultRepoConfig();
  if (!raw) return defaults;
  const parsed = JSON.parse(raw) as Partial<RepoConfig> & Record<string, unknown>;
  const cfg: RepoConfig = { ...defaults, ...parsed };
  cfg.babysitFilters = migrateClassFilters(parsed.babysitFilters, defaults.babysitFilters);
  // Legacy reviewFilters contained draft/label/LLM criteria fields. To Review
  // now starts from all open repo PRs not authored by the viewer; only the new
  // GitHub review-filter builder should narrow that list.
  cfg.reviewFilters = migrateReviewFilters(parsed.reviewFilters);
  cfg.skills = migrateSkillSelection(parsed.skills, defaults.skills);
  cfg.draftCreate = migrateDraftCreate(parsed.draftCreate, defaults.draftCreate);
 // Pre-gate configs persisted the old default fix policy verbatim. If the
 // user never customized it, upgrade to the current default (which pairs
 // with the app-owned validation gate). Customized policies are untouched.
 if (cfg.fixPolicy.trim() === LEGACY_FIX_POLICY.trim()) cfg.fixPolicy = DEFAULT_FIX_POLICY;
  return cfg;
}

export const useRepoStore = create<RepoState>((set, get) => ({
  repo: "",
  config: defaultRepoConfig(),
  loaded: false,
  snapshots: {},
  proposals: [],
  eventLog: [],

  findings: [],
  reviewSummaries: {},
  dismissedAskRuns: [],

  async init(repo) {
    const k = repoKey(repo);
    const [cfgRaw, snapRaw, propRaw, logRaw, findRaw, dismissRaw] = await Promise.all([
      native.loadBlob(`repos/${k}/config.json`),
      native.loadBlob(`repos/${k}/snapshots.json`),
      native.loadBlob(`repos/${k}/proposals.json`),
      native.loadBlob(`repos/${k}/events.json`),
      native.loadBlob(`repos/${k}/findings.json`),
      native.loadBlob(`repos/${k}/dismissed-ask.json`),
    ]);
    const findData = findRaw ? JSON.parse(findRaw) : { findings: [], summaries: {} };
    const dismissed = dismissRaw ? (JSON.parse(dismissRaw) as string[]) : [];
    set({
      repo,
      config: migrateRepoConfig(cfgRaw),
      snapshots: snapRaw ? JSON.parse(snapRaw) : {},
      proposals: propRaw ? JSON.parse(propRaw) : [],
      eventLog: logRaw ? JSON.parse(logRaw) : [],
      findings: (findData.findings ?? []).map((f: ReviewFinding) =>
        // an in-flight apply can't survive a restart
        f.status === "applying" ? { ...f, status: "open", agentRunId: undefined } : f
      ),
      reviewSummaries: findData.summaries ?? {},
      dismissedAskRuns: dismissed,
      loaded: true,
    });
  },

  async saveConfig(cfg) {
    const { repo } = get();
    set({ config: cfg });
    await native.saveBlob(`repos/${repoKey(repo)}/config.json`, JSON.stringify(cfg, null, 2));
  },

  async saveSnapshots(snapshots) {
    const { repo } = get();
    set({ snapshots });
    await native.saveBlob(`repos/${repoKey(repo)}/snapshots.json`, JSON.stringify(snapshots));
  },

  async upsertProposal(p) {
    const { repo, proposals } = get();
    const next = [...proposals.filter((x) => x.id !== p.id), p].sort(
      (a, b) => b.createdAt - a.createdAt
    );
    set({ proposals: next });
    await native.saveBlob(`repos/${repoKey(repo)}/proposals.json`, JSON.stringify(next, null, 2));
  },

  async removeProposal(id) {
    const { repo, proposals } = get();
    const next = proposals.filter((x) => x.id !== id);
    set({ proposals: next });
    await native.saveBlob(`repos/${repoKey(repo)}/proposals.json`, JSON.stringify(next, null, 2));
  },

  async logEvent(e) {
    const { repo, eventLog } = get();
    const next = [e, ...eventLog].slice(0, 300);
    set({ eventLog: next });
    await native.saveBlob(`repos/${repoKey(repo)}/events.json`, JSON.stringify(next));
  },

  async setFindings(prNumber, list, summary) {
    const { repo, findings, reviewSummaries } = get();
    const next = [...findings.filter((f) => f.prNumber !== prNumber), ...list];
    const summaries = { ...reviewSummaries, [prNumber]: { text: summary, at: Date.now() } };
    set({ findings: next, reviewSummaries: summaries });
    await persistFindings(repo, next, summaries);
  },

  async mergeFindings(prNumber, list) {
    const { repo, findings, reviewSummaries } = get();
    const next = [...findings, ...list];
    set({ findings: next });
    await persistFindings(repo, next, reviewSummaries);
  },

  async updateFinding(key, patch) {
    const { repo, findings, reviewSummaries } = get();
    const next = findings.map((f) => (f.key === key ? { ...f, ...patch } : f));
    set({ findings: next });
    await persistFindings(repo, next, reviewSummaries);
  },

  async clearFindings(prNumber) {
    const { repo, findings, reviewSummaries } = get();
    const next = findings.filter((f) => f.prNumber !== prNumber);
    const summaries = { ...reviewSummaries };
    delete summaries[prNumber];
    set({ findings: next, reviewSummaries: summaries });
    await persistFindings(repo, next, summaries);
  },

  async dismissAskRun(runId) {
    const { repo, dismissedAskRuns } = get();
    if (dismissedAskRuns.includes(runId)) return;
    const next = [...dismissedAskRuns, runId];
    set({ dismissedAskRuns: next });
    await persistDismissedAsk(repo, next);
  },

  async undismissAskRun(runId) {
    const { repo, dismissedAskRuns } = get();
    const next = dismissedAskRuns.filter((id) => id !== runId);
    set({ dismissedAskRuns: next });
    await persistDismissedAsk(repo, next);
  },
}));

function persistDismissedAsk(repo: string, dismissed: string[]) {
  return native.saveBlob(
    `repos/${repoKey(repo)}/dismissed-ask.json`,
    JSON.stringify(dismissed, null, 2)
  );
}

function persistFindings(
  repo: string,
  findings: ReviewFinding[],
  summaries: Record<number, { text: string; at: number }>
) {
  return native.saveBlob(
    `repos/${repoKey(repo)}/findings.json`,
    JSON.stringify({ findings, summaries }, null, 2)
  );
}

// ---------------------------------------------------------------------------
// Agent runs (in-memory; the Activity Feed renders this)
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 1000;

interface AgentState {
  runs: Record<string, AgentRun>;
  order: string[]; // newest first
  register(run: AgentRun): void;
  update(id: string, patch: Partial<AgentRun>): void;
  remove(id: string): void;
  /** Append agent prose / a user steer; consecutive message|thought chunks merge. */
  appendChunk(id: string, kind: "message" | "thought" | "steer", text: string): void;
  /** Insert or patch a tool call by id (ACP tool_call / tool_call_update). */
  upsertTool(id: string, tool: Partial<AgentToolCall> & { toolCallId: string }): void;
  setPlan(id: string, plan: AgentPlanEntry[]): void;
  appendResultText(id: string, text: string): void;
  /** restore persisted history (app start) — keeps newest-first order */
  hydrate(history: AgentRun[]): void;
  /** wipe finished runs; active ones stay (persistence follows via subscribe) */
  clearHistory(): void;
}

export const useAgentStore = create<AgentState>((set) => ({
  runs: {},
  order: [],
  register(run) {
    set((s) => ({
      runs: { ...s.runs, [run.id]: run },
      order: [run.id, ...s.order],
    }));
  },
  update(id, patch) {
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      return { runs: { ...s.runs, [id]: { ...run, ...patch } } };
    });
  },
  remove(id) {
    set((s) => {
      if (!s.runs[id]) return s;
      const runs = { ...s.runs };
      delete runs[id];
      return { runs, order: s.order.filter((x) => x !== id) };
    });
  },
  appendChunk(id, kind, text) {
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      const last = run.entries[run.entries.length - 1];
      // merge consecutive message/thought chunks; steers stay discrete
      if (last && last.type === kind && kind !== "steer") {
        const entries = [...run.entries.slice(0, -1), { ...last, text: last.text + text }];
        return { runs: { ...s.runs, [id]: { ...run, entries } } };
      }
      const entry = { type: kind, at: Date.now(), text } as AgentRun["entries"][number];
      const entries =
        run.entries.length >= MAX_ENTRIES
          ? [...run.entries.slice(-MAX_ENTRIES + 1), entry]
          : [...run.entries, entry];
      return { runs: { ...s.runs, [id]: { ...run, entries } } };
    });
  },
  upsertTool(id, tool) {
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      const existing = run.tools[tool.toolCallId];
      const merged: AgentToolCall = {
        toolCallId: tool.toolCallId,
        title: tool.title ?? existing?.title ?? tool.toolCallId,
        kind: tool.kind ?? existing?.kind ?? "other",
        status: tool.status ?? existing?.status ?? "pending",
        locations: tool.locations ?? existing?.locations ?? [],
        input: tool.input ?? existing?.input,
        output: tool.output ?? existing?.output,
      };
      const tools = { ...run.tools, [tool.toolCallId]: merged };
      // first sighting → append an ordered entry referencing it
      const entries = existing
        ? run.entries
        : [...run.entries, { type: "tool", at: Date.now(), toolCallId: tool.toolCallId } as const];
      return { runs: { ...s.runs, [id]: { ...run, tools, entries } } };
    });
  },
  setPlan(id, plan) {
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      return { runs: { ...s.runs, [id]: { ...run, plan } } };
    });
  },
  appendResultText(id, text) {
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      return { runs: { ...s.runs, [id]: { ...run, resultText: run.resultText + text } } };
    });
  },
  hydrate(history) {
    set((s) => {
      const restored = history.filter((r) => !s.runs[r.id]);
      if (restored.length === 0) return s;
      return {
        runs: { ...s.runs, ...Object.fromEntries(restored.map((r) => [r.id, r])) },
        order: [...s.order, ...restored.map((r) => r.id)],
      };
    });
  },
  clearHistory() {
    set((s) => {
      const keep = s.order.filter((id) => {
        const r = s.runs[id];
        return r && (r.status === "running" || r.status === "starting");
      });
      return {
        order: keep,
        runs: Object.fromEntries(keep.map((id) => [id, s.runs[id]])),
      };
    });
  },
}));

// ---------------------------------------------------------------------------
// Transient UI state — which PR is focused in each tab, kept across tab
// switches (views unmount when hidden, so this can't live in component state)
// ---------------------------------------------------------------------------

export interface DiffScrollTarget {
  path: string;
  side: "LEFT" | "RIGHT";
  line: number;
  /** changes every request so repeat clicks on the same line still fire */
  nonce: number;
}

interface UiState {
  focusedPr: Record<string, number | null>;
  setFocusedPr(tab: string, prNumber: number): void;
  /** PR workspace currently mounted in the visible content layer. */
  visiblePrWorkspace: { source: string; prNumber: number } | null;
  setVisiblePrWorkspace(source: string, prNumber: number | null): void;
  diffScrollTarget: DiffScrollTarget | null;
  requestDiffScroll(path: string, side: "LEFT" | "RIGHT", line: number): void;
  /** PR whose title scrolled out of view — shown as a topstrip breadcrumb */
  scrolledPrTitle: { number: number; title: string } | null;
  setScrolledPrTitle(v: { number: number; title: string } | null): void;
  /** right-hand GitHub activity panel visibility (persisted; topstrip toggle) */
  activityPanelOpen: boolean;
  setActivityPanelOpen(v: boolean): void;
  /** hero side panel active tab: "stack" | "ci" | null (persisted; null = collapsed) */
  heroSideTab: "stack" | "ci" | null;
  setHeroSideTab(v: "stack" | "ci" | null): void;
  /** orphan PR view: a PR number opened outside the normal tab/sidebar flow */
  orphanPr: number | null;
  setOrphanPr(v: number | null): void;
  /** command palette visibility */
  paletteOpen: boolean;
  setPaletteOpen(v: boolean): void;
  /** left-hand PR list sidebar visibility (persisted; topstrip toggle) */
  prSidebarOpen: boolean;
  setPrSidebarOpen(v: boolean): void;
  /** commit-diff modal: the commit whose diff is being viewed, or null */
  commitView: { repo: string; sha: string } | null;
  openCommit(repo: string, sha: string): void;
  closeCommit(): void;
  /** cross-component tab switch request (RepoApp applies it) */
  requestedTab: { tab: string; nonce: number } | null;
  requestTab(tab: string): void;
  /** request opening the new draft composer in Drafts */
  requestedNewDraft: { nonce: number } | null;
  requestNewDraft(): void;
  clearNewDraftRequest(): void;
  /** browser-style location history: (tab, focused PR) pairs */
  navHistory: { tab: string; pr: number | null }[];
  navIndex: number;
  /** true while back/forward is being applied — suppresses history pushes */
  navApplying: boolean;
  navPush(tab: string, pr: number | null): void;
  /** step through history; returns the location to apply, or null at an edge */
  navGo(delta: 1 | -1): { tab: string; pr: number | null } | null;
  navApplied(): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  focusedPr: {},
  setFocusedPr(tab, prNumber) {
    set((s) => ({ focusedPr: { ...s.focusedPr, [tab]: prNumber } }));
    get().navPush(tab, prNumber);
  },
  visiblePrWorkspace: null,
  setVisiblePrWorkspace(source, prNumber) {
    set((s) => {
      if (prNumber == null) {
        return s.visiblePrWorkspace?.source === source ? { visiblePrWorkspace: null } : s;
      }
      return { visiblePrWorkspace: { source, prNumber } };
    });
  },
  diffScrollTarget: null,
  requestDiffScroll(path, side, line) {
    set({ diffScrollTarget: { path, side, line, nonce: Date.now() } });
  },
  scrolledPrTitle: null,
  setScrolledPrTitle(v) {
    set({ scrolledPrTitle: v });
  },
  activityPanelOpen: localStorage.getItem("prc-activity-open") !== "off",
  setActivityPanelOpen(v) {
    localStorage.setItem("prc-activity-open", v ? "on" : "off");
    set({ activityPanelOpen: v });
  },
  heroSideTab: (() => {
    const saved = localStorage.getItem("prc-hero-side-tab");
    return saved === "stack" || saved === "ci" ? saved : "stack";
  })(),
  setHeroSideTab(v) {
    localStorage.setItem("prc-hero-side-tab", v ?? "");
    set({ heroSideTab: v });
  },
  orphanPr: null,
  setOrphanPr(v) {
    set({ orphanPr: v });
  },
  paletteOpen: false,
  setPaletteOpen(v) {
    set({ paletteOpen: v });
  },
  prSidebarOpen: localStorage.getItem("prc-pr-sidebar-open") !== "off",
  setPrSidebarOpen(v) {
    localStorage.setItem("prc-pr-sidebar-open", v ? "on" : "off");
    set({ prSidebarOpen: v });
  },
  commitView: null,
  openCommit(repo, sha) {
    set({ commitView: { repo, sha } });
  },
  closeCommit() {
    set({ commitView: null });
  },
  requestedTab: null,
  requestTab(tab) {
    set({ requestedTab: { tab, nonce: Date.now() } });
  },
  requestedNewDraft: null,
  requestNewDraft() {
    set({ requestedNewDraft: { nonce: Date.now() } });
  },
  clearNewDraftRequest() {
    set({ requestedNewDraft: null });
  },
  navHistory: [],
  navIndex: -1,
  navApplying: false,
  navPush(tab, pr) {
    set((s) => {
      if (s.navApplying) return s;
      const cur = s.navHistory[s.navIndex];
      if (cur && cur.tab === tab && cur.pr === pr) return s;
      const navHistory = [...s.navHistory.slice(0, s.navIndex + 1), { tab, pr }].slice(-100);
      return { navHistory, navIndex: navHistory.length - 1 };
    });
  },
  navGo(delta) {
    const s = get();
    const i = s.navIndex + delta;
    if (i < 0 || i >= s.navHistory.length) return null;
    set({ navIndex: i, navApplying: true });
    return s.navHistory[i];
  },
  navApplied() {
    set({ navApplying: false });
  },
}));

// ---------------------------------------------------------------------------
// CI failure auto-analysis: one-line summaries keyed by pr:check:headSha.
// Session-scoped; a new head invalidates naturally via the key.
// ---------------------------------------------------------------------------

export interface CiAnalysis {
  status: "running" | "done" | "error" | "dismissed";
  text: string;
}

interface CiAnalysisState {
  map: Record<string, CiAnalysis>;
  set(key: string, v: CiAnalysis): void;
}

export const useCiAnalysis = create<CiAnalysisState>((set) => ({
  map: {},
  set(key, v) {
    set((s) => ({ map: { ...s.map, [key]: v } }));
  },
}));

// ---------------------------------------------------------------------------
// Skills registry
// ---------------------------------------------------------------------------

interface SkillState {
  skills: Skill[];
  loaded: boolean;
  setSkills(s: Skill[]): void;
}

export const useSkillStore = create<SkillState>((set) => ({
  skills: [],
  loaded: false,
  setSkills(skills) {
    set({ skills, loaded: true });
  },
}));

// ---------------------------------------------------------------------------
// Swarms — in-memory; persisted per-repo in parallel to agent history
// (ADR-0003). On restart, in-flight contender runs are restored as `killed`
// by initAgentPersistence; swarms re-attach with surviving `done` contenders'
// held worktrees re-leased, so an unpromoted-but-finished swarm keeps its
// comparison + single-promote affordance post-restart.
// ---------------------------------------------------------------------------

interface SwarmState {
  swarms: Record<string, Swarm>;
  order: string[]; // newest first
  register(s: Swarm): void;
  update(id: string, patch: Partial<Swarm>): void;
  remove(id: string): void;
  /** restore persisted history (app start, after initAgentPersistence). */
  hydrate(history: Swarm[]): void;
}

export const useSwarmStore = create<SwarmState>((set) => ({
  swarms: {},
  order: [],
  register(s) {
    set((st) => ({
      swarms: { ...st.swarms, [s.id]: s },
      order: [s.id, ...st.order],
    }));
  },
  update(id, patch) {
    set((st) => {
      const cur = st.swarms[id];
      if (!cur) return st;
      return { swarms: { ...st.swarms, [id]: { ...cur, ...patch } } };
    });
  },
  remove(id) {
    set((st) => {
      if (!st.swarms[id]) return st;
      const swarms = { ...st.swarms };
      delete swarms[id];
      return { swarms, order: st.order.filter((x) => x !== id) };
    });
  },
  hydrate(history) {
    set((st) => {
      const restored = history.filter((s) => !st.swarms[s.id]);
      if (restored.length === 0) return st;
      return {
        swarms: { ...st.swarms, ...Object.fromEntries(restored.map((s) => [s.id, s])) },
        order: [...restored.map((s) => s.id), ...st.order],
      };
    });
  },
}));

/**
 * Per-contender AgentRun status from the (already-hydrated) agent store.
 * Returns null for runs the agent store doesn't have (e.g. MAX_PERSISTED_RUNS
 * truncation dropped one) so the boot step treats it as "release its worktree".
 */
function contenderRunStatus(contender: Swarm["contenders"][number]): AgentStatus | null {
  return useAgentStore.getState().runs[contender.runId]?.status ?? null;
}

const swarmHistoryPath = (repo: string) =>
  `repos/${repo.replace(/[^a-zA-Z0-9_.-]/g, "__")}/swarms.json`;

/**
 * Load persisted swarms for this repo, re-lease held worktrees for surviving
 * `done` contenders, release worktrees of contenders that died on restart, and
 * keep persisting changes (debounced). MUST run after initAgentPersistence so
 * the agent store contains the (killed-on-restart) contender statuses.
 *
 * Tolerates an unknown future `mode` (e.g. Consensus) by skipping those swarms
 * on hydrate rather than crashing — the same forward-compat discipline as
 * migrateGlobalConfig (ADR-0003).
 */
export async function initSwarmPersistence(repo: string): Promise<() => void> {
  try {
    const raw = await native.loadBlob(swarmHistoryPath(repo));
    if (raw) {
      const history: Swarm[] = JSON.parse(raw);
      const compatible = history.filter((s) => s.mode === "race" && Array.isArray(s.contenders));
      for (const s of compatible) {
        for (const c of s.contenders) {
          if (!c.worktree) continue;
          // re-lease the parked trial of a finished contender; clean up the
          // worktree of any contender that died on restart (killed) or errored
          // (Q5: errored mutable contender releases its worktree immediately —
          // on restart the in-memory lease is gone but the temp tree may persist).
          if (contenderRunStatus(c) === "done") {
            reLeaseWorktree(c.worktree.path);
          } else {
            void removeWorktree(c.worktree).catch(() => undefined);
          }
        }
      }
      useSwarmStore.getState().hydrate(compatible);
    }
  } catch (e) {
    console.error("swarm history load failed", e);
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    const st = useSwarmStore.getState();
    const swarms = st.order
      .map((id) => st.swarms[id])
      .filter((s) => s && s.trigger.repo === repo);
    void native
      .saveBlob(swarmHistoryPath(repo), JSON.stringify(swarms))
      .catch((e) => console.error("swarm history save failed", e));
  };
  const unsubscribe = useSwarmStore.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 800);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
