import { AcpConnection, type AcpModel, type AcpSessionUpdate } from "./acp";
import { native } from "./tauri";
import { notify } from "./notify";
import { uid } from "./template";
import { useAgentStore } from "./store";
import type { AgentKind, AgentRun, ToolKind, ToolStatus } from "../types";

const agentNotif = (run: AgentRun, outcome: "started" | "finished" | "failed", extra = "") => {
  const icon = outcome === "started" ? "▶" : outcome === "finished" ? "✓" : "✗";
  void notify(
    `${icon} Agent ${outcome}: ${run.relation}`,
    `PR #${run.prNumber} ${run.prTitle} · ${run.repo}${extra}`
  );
};

export interface StartAgentOptions {
  kind: AgentKind;
  relation: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prompt: string;
  model: string;
  binary: string;
  cwd?: string;
  /** "ask" runs read-only (questions/feedback); default is full access. */
  mode?: "ask" | "plan" | "write";
  onDone?: (run: AgentRun) => void | Promise<void>;
}

// app mode → ACP session mode (cursor exposes agent/plan/ask)
const ACP_MODE: Record<string, string> = { write: "agent", plan: "plan", ask: "ask" };

interface ActiveRun {
  conn: AcpConnection;
  sessionId: string;
  pendingSteer: string | null;
  cancelRequested: boolean;
}
const active = new Map<string, ActiveRun>();
const doneCallbacks = new Map<string, (run: AgentRun) => void | Promise<void>>();

// ---------------------------------------------------------------------------
// session/update → store translation
// ---------------------------------------------------------------------------

const textOf = (content: any): string =>
  typeof content === "string" ? content : (content?.text ?? "");

/** The most human-meaningful bit of a tool call's raw arguments. */
function toolSummary(rawArgs: any): string | undefined {
  if (!rawArgs || typeof rawArgs !== "object") return undefined;
  const interesting =
    rawArgs.command ??
    rawArgs.cmd ??
    rawArgs.path ??
    rawArgs.file_path ??
    rawArgs.filePath ??
    rawArgs.pattern ??
    rawArgs.query ??
    rawArgs.url ??
    Object.values(rawArgs).find((v) => typeof v === "string" && v.trim());
  if (typeof interesting !== "string") return undefined;
  const s = interesting.replace(/\s+/g, " ").trim();
  return s ? (s.length > 200 ? s.slice(0, 200) + "…" : s) : undefined;
}

/** Pull readable output from a tool call's content blocks. */
function toolOutput(content: any): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const b of content) {
    if (b?.type === "content") {
      const t = textOf(b.content);
      if (t) parts.push(t);
    } else if (b?.type === "diff") {
      parts.push(`${b.path ? `${b.path}\n` : ""}${b.newText ?? b.oldText ?? ""}`);
    } else if (typeof b?.text === "string") {
      parts.push(b.text);
    }
  }
  const s = parts.join("\n").trim();
  return s ? s.slice(0, 6000) : undefined;
}

function applyUpdate(id: string, u: AcpSessionUpdate): void {
  const store = useAgentStore.getState();
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const t = textOf((u as any).content);
      if (t) {
        store.appendChunk(id, "message", t);
        store.appendResultText(id, t); // drives proposal/finding extraction
      }
      break;
    }
    case "agent_thought_chunk": {
      const t = textOf((u as any).content);
      if (t) store.appendChunk(id, "thought", t);
      break;
    }
    case "tool_call":
    case "tool_call_update": {
      const tc = u as any;
      store.upsertTool(id, {
        toolCallId: tc.toolCallId,
        title: tc.title,
        kind: tc.kind as ToolKind | undefined,
        status: tc.status as ToolStatus | undefined,
        locations: Array.isArray(tc.locations)
          ? tc.locations.map((l: any) => (l.line ? `${l.path}:${l.line}` : l.path))
          : undefined,
        input: toolSummary(tc.rawInput),
        output: toolOutput(tc.content),
      });
      break;
    }
    case "plan": {
      const entries = (u as any).entries ?? [];
      store.setPlan(
        id,
        entries.map((e: any) => ({ content: e.content, status: e.status, priority: e.priority }))
      );
      break;
    }
    case "current_mode_update":
      store.update(id, { mode: (u as any).modeId });
      break;
    case "session_info_update":
      if ((u as any).title) store.update(id, { sessionTitle: (u as any).title });
      break;
    // available_commands_update / user_message_chunk: not surfaced
  }
}

/** Map the app's resolved model id to an ACP modelId by name-root (best effort). */
function matchAcpModel(appModel: string, models: AcpModel[]): string | undefined {
  if (!appModel || appModel === "auto") return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(appModel);
  let best: { id: string; len: number } | null = null;
  for (const m of models) {
    const n = norm(m.name);
    if (n && target.startsWith(n) && (!best || n.length > best.len)) best = { id: m.modelId, len: n.length };
  }
  return best?.id;
}

// ---------------------------------------------------------------------------
// startAgent — spawn an ACP agent, run the prompt turn(s), finalize
// ---------------------------------------------------------------------------

export async function startAgent(opts: StartAgentOptions): Promise<string> {
  const id = uid("agent-");
  const run: AgentRun = {
    id,
    kind: opts.kind,
    relation: opts.relation,
    repo: opts.repo,
    prNumber: opts.prNumber,
    prTitle: opts.prTitle,
    prompt: opts.prompt,
    model: opts.model,
    cwd: opts.cwd ?? null,
    status: "starting",
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    entries: [],
    tools: {},
    plan: [],
    steerable: false,
    resultText: "",
    proposalIds: [],
  };
  useAgentStore.getState().register(run);
  if (opts.onDone) doneCallbacks.set(id, opts.onDone);
  agentNotif(run, "started");

  const fail = (msg: string) => {
    const cur = useAgentStore.getState().runs[id];
    // don't clobber a run already finalized (e.g. by a graceful-cancel race)
    if (cur && cur.status !== "running" && cur.status !== "starting") {
      active.delete(id);
      return;
    }
    useAgentStore.getState().update(id, { status: "error", error: msg, endedAt: Date.now(), steerable: false });
    doneCallbacks.delete(id);
    active.delete(id);
    agentNotif(run, "failed", " — " + msg.slice(0, 80));
  };

  const conn = new AcpConnection(id, {
    onUpdate: (u) => applyUpdate(id, u),
    // auto-approve tool calls (mirrors the old --force/--trust); read-only
    // ask/plan modes prevent writes regardless, so this is safe
    choosePermission: (options) => {
      const allow =
        options.find((o) => o.kind === "allow_once") ??
        options.find((o) => o.kind === "allow_always") ??
        options.find((o) => o.kind?.startsWith("allow"));
      return allow?.optionId ?? null;
    },
  });

  // drive the session asynchronously; startAgent returns the id immediately
  void (async () => {
    try {
      const sessionCwd = opts.cwd || (await native.appDataDir());
      await conn.spawn(opts.binary, ["acp"], opts.cwd);
      await conn.initialize();
      const ns = await conn.newSession(sessionCwd);
      const sessionId = ns.sessionId;
      active.set(id, { conn, sessionId, pendingSteer: null, cancelRequested: false });
      useAgentStore.getState().update(id, {
        status: "running",
        steerable: true,
        mode: ns.modes?.currentModeId,
      });

      // set mode (default session mode is "agent")
      const targetMode = ACP_MODE[opts.mode ?? "write"];
      if (targetMode && ns.modes && ns.modes.currentModeId !== targetMode &&
          ns.modes.availableModes.some((m) => m.id === targetMode)) {
        await conn.setMode(sessionId, targetMode).catch(() => {});
      }
      // set model (best-effort name match against the ACP model list)
      const acpModelId = ns.models ? matchAcpModel(opts.model, ns.models.availableModels) : undefined;
      if (acpModelId) await conn.setModel(sessionId, acpModelId).catch(() => {});

      // prompt turn loop — steering re-prompts the same session
      let text = opts.prompt;
      let stop = "end_turn";
      for (;;) {
        stop = await conn.prompt(sessionId, [{ type: "text", text }]);
        const a = active.get(id);
        if (a && a.pendingSteer != null && !a.cancelRequested) {
          text = a.pendingSteer;
          a.pendingSteer = null;
          continue;
        }
        break;
      }

      const cancelled = active.get(id)?.cancelRequested || stop === "cancelled";
      conn.kill();
      active.delete(id);
      finalize(id, cancelled ? "killed" : "done");
    } catch (e) {
      conn.kill();
      fail(e instanceof Error ? e.message : String(e));
    }
  })();

  return id;
}

/** Run the onDone contract + status transition when a turn settles. */
function finalize(id: string, status: "done" | "killed") {
  const store = useAgentStore.getState();
  const run = store.runs[id];
  if (!run) return;
  store.update(id, {
    status,
    endedAt: Date.now(),
    exitCode: status === "done" ? 0 : -9,
    steerable: false,
  });
  if (status === "done") {
    agentNotif(run, "finished", ` — ${Math.round((Date.now() - run.startedAt) / 1000)}s`);
    // onDone runs only on clean completion (matches pre-ACP semantics)
    const cb = doneCallbacks.get(id);
    doneCallbacks.delete(id);
    if (cb) {
      Promise.resolve(cb(useAgentStore.getState().runs[id])).catch((e) => {
        useAgentStore.getState().update(id, {
          status: "error",
          error: `post-processing failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        agentNotif(run, "failed", " — post-processing failed");
      });
    }
  } else {
    doneCallbacks.delete(id); // killed-by-user stays silent
  }
}

/** Send a follow-up prompt to steer a running agent (cancel+reprompt). */
export function steerAgent(id: string, text: string): void {
  const a = active.get(id);
  if (!a || !text.trim()) return;
  useAgentStore.getState().appendChunk(id, "steer", text.trim());
  a.pendingSteer = a.pendingSteer ? `${a.pendingSteer}\n\n${text.trim()}` : text.trim();
  a.conn.cancel(a.sessionId); // end the current turn so the loop applies the steer
}

/** Interrupt a running agent gracefully (ACP session/cancel); hard-kill fallback. */
export async function killAgent(id: string): Promise<void> {
  const a = active.get(id);
  if (a) {
    a.cancelRequested = true;
    useAgentStore.getState().update(id, { steerable: false });
    a.conn.cancel(a.sessionId);
    // fallback: if the agent ignores cancel, force the process down
    setTimeout(() => {
      if (active.has(id)) {
        a.conn.kill();
        active.delete(id);
        finalize(id, "killed");
      }
    }, 5000);
  } else {
    await native.killAgent(id).catch(() => {});
    useAgentStore.getState().update(id, { status: "killed", endedAt: Date.now() });
    doneCallbacks.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Persistence: the Activity Feed survives app restarts. Live sessions can't be
// re-attached after a restart, so runs that were mid-flight are restored as
// "killed — interrupted by app restart" with their full transcript intact.
// ---------------------------------------------------------------------------

const MAX_PERSISTED_RUNS = 120;
const MAX_PERSISTED_ENTRIES = 250;

const agentHistoryPath = (repo: string) =>
  `repos/${repo.replace(/[^a-zA-Z0-9_.-]/g, "__")}/agents.json`;

/**
 * Hydrate persisted agent history for this repo and keep persisting changes
 * (debounced). Returns a cleanup function.
 */
export async function initAgentPersistence(repo: string): Promise<() => void> {
  try {
    const raw = await native.loadBlob(agentHistoryPath(repo));
    if (raw) {
      const history: AgentRun[] = JSON.parse(raw).map((r: AgentRun) => {
        // normalize: pre-ACP runs lack entries/tools/plan
        const base: AgentRun = {
          ...r,
          entries: r.entries ?? [],
          tools: r.tools ?? {},
          plan: r.plan ?? [],
          steerable: false,
        };
        return base.status === "running" || base.status === "starting"
          ? {
              ...base,
              status: "killed" as const,
              steerable: false,
              error: "interrupted by app restart",
              endedAt: base.endedAt ?? Date.now(),
            }
          : base;
      });
      useAgentStore.getState().hydrate(history);
    }
  } catch (e) {
    console.error("agent history load failed", e);
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    const s = useAgentStore.getState();
    const runs = s.order
      .map((id) => s.runs[id])
      .filter((r) => r && r.repo === repo)
      .slice(0, MAX_PERSISTED_RUNS)
      .map((r) => ({ ...r, entries: r.entries.slice(-MAX_PERSISTED_ENTRIES) }));
    void native
      .saveBlob(agentHistoryPath(repo), JSON.stringify(runs))
      .catch((e) => console.error("agent history save failed", e));
  };
  const unsubscribe = useAgentStore.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 800);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

// ---------------------------------------------------------------------------
// Structured output extraction
// ---------------------------------------------------------------------------

/**
 * Agents are instructed to end with `<proposal>{json}</proposal>`. Extract the
 * last such block; fall back to the last fenced/naked JSON object that looks
 * like a proposal.
 */
export function extractProposalJson(text: string): any | null {
  const blocks = [...text.matchAll(/<proposal>([\s\S]*?)<\/proposal>/g)];
  const candidates: string[] = blocks.map((m) => m[1]);
  if (candidates.length === 0) {
    const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
    candidates.push(...fenced);
  }
  for (const raw of candidates.reverse()) {
    try {
      const obj = JSON.parse(raw.trim());
      if (obj && typeof obj === "object") return obj;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Text with proposal/control blocks removed — what a human should read. */
export function cleanResultText(text: string): string {
  return text
    .replace(/<proposal>[\s\S]*?<\/proposal>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface CursorModel {
  id: string;
  label: string;
}

/** Parse `cursor-agent models` output: one `id - Display Name` per line. */
export async function listCursorModels(binary: string): Promise<CursorModel[]> {
  try {
    const res = await native.runExec(binary, ["models"]);
    if (res.code !== 0) return [];
    const out: CursorModel[] = [];
    for (const line of res.stdout.split("\n")) {
      const m = /^([\w.\/:-]+)\s+-\s+(.+)$/.exec(line.trim());
      if (m) out.push({ id: m[1], label: m[2].trim() });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Refresh the available-model list from the Cursor CLI (called on startup of
 * each window so the picker is never stale).
 */
export async function refreshModels(
  global: import("../types").GlobalConfig,
  save: (cfg: import("../types").GlobalConfig) => Promise<void>
): Promise<void> {
  const found = await listCursorModels(global.cursorBinary);
  if (found.length === 0) return;
  const models = found.map((f) => f.id);
  const modelLabels = Object.fromEntries(found.map((f) => [f.id, f.label]));
  const changed =
    JSON.stringify(models) !== JSON.stringify(global.models) ||
    JSON.stringify(modelLabels) !== JSON.stringify(global.modelLabels);
  if (changed) {
    // keep the configured default when the CLI still lists it; otherwise
    // prefer the install default, then "auto"
    const { DEFAULT_MODEL_ID } = await import("./defaults");
    const defaultModel = models.includes(global.defaultModel)
      ? global.defaultModel
      : models.includes(DEFAULT_MODEL_ID)
        ? DEFAULT_MODEL_ID
        : "auto";
    await save({ ...global, models, modelLabels, defaultModel });
  }
}
