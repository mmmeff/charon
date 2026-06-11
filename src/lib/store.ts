import { create } from "zustand";
import type {
  AgentLine,
  AgentRun,
  FiredEvent,
  GlobalConfig,
  Proposal,
  PrSnapshot,
  RepoConfig,
  ReviewFinding,
  Skill,
} from "../types";
import { defaultGlobalConfig, defaultRepoConfig } from "./defaults";
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

export const useGlobalConfig = create<GlobalState>((set) => ({
  config: null,
  loaded: false,
  async load() {
    const raw = await native.loadBlob("global.json");
    const config = raw ? { ...defaultGlobalConfig(), ...JSON.parse(raw) } : null;
    set({ config, loaded: true });
    return config;
  },
  async save(cfg) {
    set({ config: cfg });
    await native.saveBlob("global.json", JSON.stringify(cfg, null, 2));
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

  async init(repo) {
    const k = repoKey(repo);
    const [cfgRaw, snapRaw, propRaw, logRaw, findRaw] = await Promise.all([
      native.loadBlob(`repos/${k}/config.json`),
      native.loadBlob(`repos/${k}/snapshots.json`),
      native.loadBlob(`repos/${k}/proposals.json`),
      native.loadBlob(`repos/${k}/events.json`),
      native.loadBlob(`repos/${k}/findings.json`),
    ]);
    const findData = findRaw ? JSON.parse(findRaw) : { findings: [], summaries: {} };
    set({
      repo,
      config: cfgRaw ? { ...defaultRepoConfig(), ...JSON.parse(cfgRaw) } : defaultRepoConfig(),
      snapshots: snapRaw ? JSON.parse(snapRaw) : {},
      proposals: propRaw ? JSON.parse(propRaw) : [],
      eventLog: logRaw ? JSON.parse(logRaw) : [],
      findings: (findData.findings ?? []).map((f: ReviewFinding) =>
        // an in-flight apply can't survive a restart
        f.status === "applying" ? { ...f, status: "open" } : f
      ),
      reviewSummaries: findData.summaries ?? {},
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
}));

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

const MAX_LINES = 2000;

interface AgentState {
  runs: Record<string, AgentRun>;
  order: string[]; // newest first
  register(run: AgentRun): void;
  update(id: string, patch: Partial<AgentRun>): void;
  appendLine(id: string, line: AgentLine): void;
  /** Append a stream piece; consecutive text/thinking chunks merge into one entry. */
  appendStream(id: string, kind: AgentLine["kind"], text: string): void;
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
  appendLine(id, line) {
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      const lines =
        run.lines.length >= MAX_LINES ? [...run.lines.slice(-MAX_LINES + 1), line] : [...run.lines, line];
      return { runs: { ...s.runs, [id]: { ...run, lines } } };
    });
  },
  appendStream(id, kind, text) {
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      const last = run.lines[run.lines.length - 1];
      // chunks of one streamed message arrive as separate events — merge them
      if (last && last.kind === kind && (kind === "text" || kind === "thinking")) {
        const lines = [...run.lines.slice(0, -1), { ...last, text: last.text + text }];
        return { runs: { ...s.runs, [id]: { ...run, lines } } };
      }
      const line: AgentLine = { kind, text, at: Date.now() };
      const lines =
        run.lines.length >= MAX_LINES ? [...run.lines.slice(-MAX_LINES + 1), line] : [...run.lines, line];
      return { runs: { ...s.runs, [id]: { ...run, lines } } };
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
  diffScrollTarget: DiffScrollTarget | null;
  requestDiffScroll(path: string, side: "LEFT" | "RIGHT", line: number): void;
  /** model chosen in any composer — shared so one choice applies everywhere */
  composerModel: string;
  setComposerModel(m: string): void;
  /** PR whose title scrolled out of view — shown as a topstrip breadcrumb */
  scrolledPrTitle: { number: number; title: string } | null;
  setScrolledPrTitle(v: { number: number; title: string } | null): void;
  /** right-hand GitHub activity panel visibility (persisted; topstrip toggle) */
  activityPanelOpen: boolean;
  setActivityPanelOpen(v: boolean): void;
}

export const useUiStore = create<UiState>((set) => ({
  focusedPr: {},
  setFocusedPr(tab, prNumber) {
    set((s) => ({ focusedPr: { ...s.focusedPr, [tab]: prNumber } }));
  },
  diffScrollTarget: null,
  requestDiffScroll(path, side, line) {
    set({ diffScrollTarget: { path, side, line, nonce: Date.now() } });
  },
  composerModel: "",
  setComposerModel(m) {
    set({ composerModel: m });
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
