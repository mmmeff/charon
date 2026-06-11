import { native, type AgentStreamEvent } from "./tauri";
import { notify } from "./notify";
import { uid } from "./template";
import { useAgentStore } from "./store";
import type { AgentKind, AgentRun } from "../types";

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

const doneCallbacks = new Map<string, (run: AgentRun) => void | Promise<void>>();
let listenerInstalled = false;

async function ensureListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  await native.onAgentStream(handleStreamEvent);
}

function handleStreamEvent(ev: AgentStreamEvent) {
  const store = useAgentStore.getState();
  const run = store.runs[ev.id];
  if (!run) return;

  if (ev.kind === "stdout" && ev.line) {
    const parsed = parseStreamLine(ev.line);
    for (const p of parsed.pieces) store.appendStream(ev.id, p.kind, p.text);
    if (parsed.assistantText) store.appendResultText(ev.id, parsed.assistantText);
    if (parsed.finalResult) {
      // the final result usually repeats the streamed text — only display it
      // when nothing streamed (short runs sometimes emit result-only)
      const cur = useAgentStore.getState().runs[ev.id];
      if (cur && !cur.resultText.trim()) store.appendStream(ev.id, "text", parsed.finalResult);
      store.appendResultText(ev.id, "\n" + parsed.finalResult);
    }
    if (run.status === "starting") store.update(ev.id, { status: "running" });
    return;
  }
  if (ev.kind === "stderr" && ev.line) {
    store.appendStream(ev.id, "stderr", ev.line);
    return;
  }
  if (ev.kind === "spawn-error") {
    store.update(ev.id, {
      status: "error",
      error: ev.line ?? "spawn failed",
      endedAt: Date.now(),
    });
    doneCallbacks.delete(ev.id);
    agentNotif(run, "failed", " — could not start the Cursor agent");
    return;
  }
  if (ev.kind === "exit") {
    if (run.status === "killed") {
      doneCallbacks.delete(ev.id);
      return;
    }
    const ok = ev.code === 0;
    const wasKilled = ev.code === -9;
    store.update(ev.id, {
      status: wasKilled ? "killed" : ok ? "done" : "error",
      exitCode: ev.code,
      endedAt: Date.now(),
      ...(ok ? {} : wasKilled ? {} : { error: `agent exited with code ${ev.code}` }),
    });
    const elapsed = ` — ${Math.round((Date.now() - run.startedAt) / 1000)}s`;
    if (ok) agentNotif(run, "finished", elapsed);
    else if (!wasKilled) agentNotif(run, "failed", ` — exit code ${ev.code}`);
    // killed-by-user stays silent: they did it themselves

    const cb = doneCallbacks.get(ev.id);
    doneCallbacks.delete(ev.id);
    if (cb && ok) {
      const finished = useAgentStore.getState().runs[ev.id];
      Promise.resolve(cb(finished)).catch((e) => {
        useAgentStore.getState().update(ev.id, {
          status: "error",
          error: `post-processing failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        agentNotif(run, "failed", " — post-processing failed");
      });
    }
  }
}

interface StreamPiece {
  kind: "text" | "thinking" | "tool" | "system" | "stderr";
  text: string;
}

interface ParsedStreamLine {
  pieces: StreamPiece[];
  assistantText: string | null;
  /** authoritative full text from a `result` event (often repeats the stream) */
  finalResult: string | null;
}

const NOTHING: ParsedStreamLine = { pieces: [], assistantText: null, finalResult: null };

/** The most human-meaningful bit of a tool call's arguments. */
function toolSummary(name: string, rawArgs: any): string {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  const interesting =
    args.command ??
    args.cmd ??
    args.path ??
    args.file_path ??
    args.filePath ??
    args.pattern ??
    args.query ??
    args.url ??
    Object.values(args).find((v) => typeof v === "string" && v.trim());
  const detail = (
    typeof interesting === "string" ? interesting : JSON.stringify(rawArgs ?? {})
  ).replace(/\s+/g, " ").trim();
  return `${name}  ${detail.length > 180 ? detail.slice(0, 180) + "…" : detail}`.trim();
}

/**
 * Parse one NDJSON line of `cursor-agent --output-format stream-json` into
 * typed display pieces. The schema is treated defensively: assistant text is
 * extracted wherever it lives; chunk merging happens in the store.
 */
function parseStreamLine(line: string): ParsedStreamLine {
  const trimmed = line.trim();
  if (!trimmed) return NOTHING;
  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    // plain-text output (e.g. --output-format text fallback)
    return { pieces: [{ kind: "text", text: trimmed + "\n" }], assistantText: trimmed + "\n", finalResult: null };
  }

  const collectText = (content: any): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content))
      return content
        .map((c) => (typeof c === "string" ? c : c?.text ?? c?.content ?? ""))
        .filter(Boolean)
        .join("");
    return content?.text ?? "";
  };

  switch (obj?.type) {
    case "system": {
      const text = `${obj.subtype ?? "session"} ${obj.model ?? ""}`.trim();
      return { pieces: [{ kind: "system", text }], assistantText: null, finalResult: null };
    }
    case "user":
      return NOTHING;
    case "assistant": {
      const text = collectText(obj.message?.content ?? obj.content ?? obj.text);
      if (!text) return NOTHING;
      return { pieces: [{ kind: "text", text }], assistantText: text, finalResult: null };
    }
    case "thinking": {
      const text = obj.text ?? collectText(obj.message?.content ?? obj.content);
      if (!text) return NOTHING;
      return { pieces: [{ kind: "thinking", text }], assistantText: null, finalResult: null };
    }
    case "tool_call": {
      const name =
        obj.tool_call?.name ?? obj.name ?? obj.subtype ?? Object.keys(obj.tool_call ?? {})[0] ?? "tool";
      const args = obj.tool_call?.args ?? obj.args ?? obj.tool_call;
      return {
        pieces: [{ kind: "tool", text: toolSummary(String(name), args) }],
        assistantText: null,
        finalResult: null,
      };
    }
    case "tool_result":
      return NOTHING; // completion is implied by the next event; "[tool done]" was noise
    case "result": {
      const text = typeof obj.result === "string" ? obj.result : collectText(obj.result);
      return { pieces: [], assistantText: null, finalResult: text || null };
    }
    default: {
      const text = collectText(obj?.message?.content ?? obj?.text);
      if (text) return { pieces: [{ kind: "text", text }], assistantText: text, finalResult: null };
      return NOTHING;
    }
  }
}

export async function startAgent(opts: StartAgentOptions): Promise<string> {
  await ensureListener();
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
    lines: [],
    resultText: "",
    proposalIds: [],
  };
  useAgentStore.getState().register(run);
  if (opts.onDone) doneCallbacks.set(id, opts.onDone);
  agentNotif(run, "started");

  const args = ["--print", "--output-format", "stream-json", "--trust"];
  if (opts.mode === "ask" || opts.mode === "plan") {
    args.push("--mode", opts.mode);
  } else {
    args.push("--force"); // fix flows / draft edits need shell + write access
  }
  if (opts.model && opts.model !== "auto") args.push("--model", opts.model);
  args.push(opts.prompt);

  try {
    await native.spawnAgent({ id, binary: opts.binary, args, cwd: opts.cwd });
  } catch (e) {
    useAgentStore.getState().update(id, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      endedAt: Date.now(),
    });
    doneCallbacks.delete(id);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Persistence: the Activity Feed survives app restarts. Stream pipes can't be
// re-attached after a restart, so runs that were mid-flight are restored as
// "killed — interrupted by app restart" with their full prompt/log intact.
// ---------------------------------------------------------------------------

const MAX_PERSISTED_RUNS = 120;
const MAX_PERSISTED_LINES = 250;

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
      const history: AgentRun[] = JSON.parse(raw).map((r: AgentRun) =>
        r.status === "running" || r.status === "starting"
          ? {
              ...r,
              status: "killed" as const,
              error: "interrupted by app restart",
              endedAt: r.endedAt ?? Date.now(),
            }
          : r
      );
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
      .map((r) => ({ ...r, lines: r.lines.slice(-MAX_PERSISTED_LINES) }));
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

export async function killAgent(id: string): Promise<void> {
  await native.killAgent(id);
  useAgentStore.getState().update(id, { status: "killed", endedAt: Date.now() });
  doneCallbacks.delete(id);
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
