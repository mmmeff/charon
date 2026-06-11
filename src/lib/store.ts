import { create } from "zustand";
import type {
  AgentLine,
  AgentRun,
  FiredEvent,
  GlobalConfig,
  Proposal,
  PrSnapshot,
  RepoConfig,
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

  init(repo: string): Promise<void>;
  saveConfig(cfg: RepoConfig): Promise<void>;
  saveSnapshots(s: Record<number, PrSnapshot>): Promise<void>;
  upsertProposal(p: Proposal): Promise<void>;
  removeProposal(id: string): Promise<void>;
  logEvent(e: FiredEvent): Promise<void>;
}

export const useRepoStore = create<RepoState>((set, get) => ({
  repo: "",
  config: defaultRepoConfig(),
  loaded: false,
  snapshots: {},
  proposals: [],
  eventLog: [],

  async init(repo) {
    const k = repoKey(repo);
    const [cfgRaw, snapRaw, propRaw, logRaw] = await Promise.all([
      native.loadBlob(`repos/${k}/config.json`),
      native.loadBlob(`repos/${k}/snapshots.json`),
      native.loadBlob(`repos/${k}/proposals.json`),
      native.loadBlob(`repos/${k}/events.json`),
    ]);
    set({
      repo,
      config: cfgRaw ? { ...defaultRepoConfig(), ...JSON.parse(cfgRaw) } : defaultRepoConfig(),
      snapshots: snapRaw ? JSON.parse(snapRaw) : {},
      proposals: propRaw ? JSON.parse(propRaw) : [],
      eventLog: logRaw ? JSON.parse(logRaw) : [],
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
}));

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
  appendResultText(id: string, text: string): void;
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
  appendResultText(id, text) {
    set((s) => {
      const run = s.runs[id];
      if (!run) return s;
      return { runs: { ...s.runs, [id]: { ...run, resultText: run.resultText + text } } };
    });
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
