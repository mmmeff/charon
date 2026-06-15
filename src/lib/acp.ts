import { native, type AgentStreamEvent } from "./tauri";
import { uid } from "./template";

/**
 * Agent Client Protocol (ACP) client — the host side of agentclientprotocol.com.
 *
 * The app launches an agent subprocess (e.g. `cursor-agent acp`) and speaks
 * JSON-RPC 2.0 over its stdio: newline-delimited messages, requests correlated
 * by id, plus notifications (session/update) and agent→client requests
 * (session/request_permission) we must answer. This layer is agent-agnostic —
 * swapping in `gemini --experimental-acp` or `npx claude-code-acp` later is a
 * config change, not a code change.
 *
 * Transport rides the existing spawn_agent / agent-stream / agent_send bridge:
 * each stdout line is one JSON-RPC message; agent_send writes one to stdin.
 */

// ---- wire types (subset we use) ------------------------------------------

export interface AcpContentBlock {
  type: string; // "text" | "image" | "resource_link" | ...
  text?: string;
  [k: string]: unknown;
}

export interface AcpToolCall {
  toolCallId: string;
  title?: string;
  kind?: string; // read | edit | delete | move | search | execute | think | fetch | other
  status?: string; // pending | in_progress | completed | failed
  content?: any[];
  locations?: { path: string; line?: number }[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpPlanEntry {
  content: string;
  priority?: string;
  status?: string;
}

/** A session/update notification's `update` payload, discriminated by sessionUpdate. */
export type AcpSessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: AcpContentBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: AcpContentBlock }
  | { sessionUpdate: "user_message_chunk"; content: AcpContentBlock }
  | ({ sessionUpdate: "tool_call" } & AcpToolCall)
  | ({ sessionUpdate: "tool_call_update" } & AcpToolCall)
  | { sessionUpdate: "plan"; entries: AcpPlanEntry[] }
  | { sessionUpdate: "current_mode_update"; modeId: string }
  | { sessionUpdate: "available_commands_update"; availableCommands: { name: string; description?: string }[] }
  | { sessionUpdate: "session_info_update"; title?: string }
  | { sessionUpdate: string; [k: string]: unknown };

export interface AcpModel {
  modelId: string;
  name: string;
}
export interface AcpMode {
  id: string;
  name: string;
  description?: string;
}
/** A session config select (e.g. codex's `model` / `reasoning_effort`). */
export interface AcpConfigOption {
  id: string;
  name?: string;
  category?: string;
  type?: string;
  currentValue?: string;
  options?: { value: string; name?: string }[];
}
export interface NewSessionResult {
  sessionId: string;
  modes?: { currentModeId: string; availableModes: AcpMode[] };
  models?: { currentModelId: string; availableModels: AcpModel[] };
  configOptions?: AcpConfigOption[];
}

/** The `model` config option, if the harness exposes models that way (codex). */
export function modelConfigOption(ns: NewSessionResult): AcpConfigOption | undefined {
  return ns.configOptions?.find(
    (o) => (o.id === "model" || o.category === "model") && o.type === "select" && o.options?.length
  );
}

/**
 * Display label for a model. Cursor encodes variant params in the modelId
 * brackets; reformat `model[thinking=true,context=300k,effort=high,fast=true]`
 * to `model (high, 300k, fast)` — the reasoning level (effort or reasoning),
 * the context window, then a "fast" tag when fast=true, dropping the rest.
 * `default` becomes "Auto". Harnesses without bracketed ids (e.g. codex) just
 * keep their name.
 */
export function modelLabel(m: AcpModel): string {
  const base = m.modelId.replace(/\[.*\]$/, "");
  if (base.toLowerCase() === "default") return "Auto";
  const inner = /\[(.*)\]$/.exec(m.modelId)?.[1] ?? "";
  const params = new Map<string, string>();
  for (const kv of inner.split(",")) {
    if (!kv.trim()) continue;
    const eq = kv.indexOf("=");
    params.set(eq < 0 ? kv.trim() : kv.slice(0, eq).trim(), eq < 0 ? "" : kv.slice(eq + 1).trim());
  }
  const detail = [
    params.get("effort") || params.get("reasoning"),
    params.get("context"),
    params.get("fast") === "true" ? "fast" : "",
  ]
    .filter(Boolean)
    .join(", ");
  const name = m.name || base;
  return detail ? `${name} (${detail})` : name;
}

/** Models paired with display labels, sorted alphabetically by label. */
export function labeledModels(models: AcpModel[]): { modelId: string; label: string }[] {
  return models
    .map((m) => ({ modelId: m.modelId, label: modelLabel(m) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/** The reasoning-effort config option, if the harness exposes one (codex). */
export function reasoningConfigOption(ns: NewSessionResult): AcpConfigOption | undefined {
  return ns.configOptions?.find(
    (o) =>
      (o.category === "thought_level" || /reason|effort|thinking/i.test(o.id)) &&
      o.type === "select" &&
      o.options?.length
  );
}

/**
 * The model list + current id for a session, sourced from whichever mechanism
 * the harness uses: native ACP models (cursor) or a `model` config option
 * (codex). Empty when the harness manages its own model (opencode).
 */
export function sessionModels(ns: NewSessionResult): { models: AcpModel[]; currentId?: string } {
  if (ns.models?.availableModels?.length) {
    return { models: ns.models.availableModels, currentId: ns.models.currentModelId };
  }
  const opt = modelConfigOption(ns);
  if (opt) {
    return {
      models: opt.options!.map((o) => ({ modelId: o.value, name: o.name ?? o.value })),
      currentId: opt.currentValue,
    };
  }
  return { models: [] };
}

interface JsonRpcMsg {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// One agent subprocess + JSON-RPC loop. id == the agent-run id (spawn key).
// ---------------------------------------------------------------------------

const connections = new Map<string, AcpConnection>();
let listenerInstalled = false;

async function ensureListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  await native.onAgentStream((ev) => connections.get(ev.id)?.ingest(ev));
}

export interface AcpHandlers {
  onUpdate: (update: AcpSessionUpdate) => void;
  /** Policy for session/request_permission. Return the chosen optionId, or null to reject. */
  choosePermission: (options: { optionId: string; name: string; kind: string }[]) => string | null;
}

export class AcpConnection {
  readonly id: string;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buf = "";
  private stderr = "";
  private dead = false;
  private handlers: AcpHandlers;
  private exitResolve!: (code: number) => void;
  readonly exited: Promise<number>;

  constructor(id: string, handlers: AcpHandlers) {
    this.id = id;
    this.handlers = handlers;
    this.exited = new Promise((res) => (this.exitResolve = res));
  }

  /** Spawn the agent process and start the JSON-RPC loop. */
  async spawn(binary: string, args: string[], cwd?: string, env?: Record<string, string>): Promise<void> {
    await ensureListener();
    connections.set(this.id, this);
    await native.spawnAgent({ id: this.id, binary, args, cwd, env });
  }

  ingest(ev: AgentStreamEvent): void {
    if (ev.kind === "stdout" && ev.line) {
      this.buf += ev.line + "\n";
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (line.trim()) this.handleLine(line);
      }
    } else if (ev.kind === "stderr" && ev.line) {
      this.stderr = (this.stderr + ev.line + "\n").slice(-4000);
    } else if (ev.kind === "spawn-error") {
      this.fail(new Error(ev.line ?? "spawn failed"));
    } else if (ev.kind === "exit") {
      this.fail(new Error(this.stderr.trim() || `agent exited (code ${ev.code ?? "?"})`));
      this.exitResolve(ev.code ?? 0);
      connections.delete(this.id);
    }
  }

  private fail(err: Error) {
    if (this.dead) return;
    this.dead = true;
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  private handleLine(line: string) {
    let msg: JsonRpcMsg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // non-JSON (banner/log) — ignore
    }
    // response to one of our requests
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.error) p.reject(new Error(msg.error.message || "ACP error"));
      else p.resolve(msg.result);
      return;
    }
    // agent→client request (must respond)
    if (msg.method && msg.id != null) {
      void this.serve(msg);
      return;
    }
    // notification
    if (msg.method === "session/update" && msg.params?.update) {
      this.handlers.onUpdate(msg.params.update as AcpSessionUpdate);
    }
  }

  private async serve(msg: JsonRpcMsg) {
    const respond = (result: unknown) =>
      native.agentSend(this.id, JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })).catch(() => {});
    const respondError = (code: number, message: string) =>
      native
        .agentSend(this.id, JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code, message } }))
        .catch(() => {});

    switch (msg.method) {
      case "session/request_permission": {
        const opts = (msg.params?.options ?? []) as { optionId: string; name: string; kind: string }[];
        const chosen = this.handlers.choosePermission(opts);
        await respond(
          chosen
            ? { outcome: { outcome: "selected", optionId: chosen } }
            : { outcome: { outcome: "cancelled" } }
        );
        return;
      }
      // We advertise no fs/terminal capability, so the agent does its own disk
      // and shell IO (like the CLI). If it asks anyway, decline cleanly.
      default:
        await respondError(-32601, `method not handled: ${msg.method}`);
    }
  }

  private request<T = any>(method: string, params: unknown): Promise<T> {
    if (this.dead) return Promise.reject(new Error("agent connection closed"));
    const id = this.nextId++;
    const p = new Promise<T>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    void native
      .agentSend(this.id, JSON.stringify({ jsonrpc: "2.0", id, method, params }))
      .catch((e) => {
        const pend = this.pending.get(id);
        if (pend) {
          this.pending.delete(id);
          pend.reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    return p;
  }

  private notify(method: string, params: unknown): void {
    void native.agentSend(this.id, JSON.stringify({ jsonrpc: "2.0", method, params })).catch(() => {});
  }

  // -- ACP methods ----------------------------------------------------------

  initialize() {
    return this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "charon", title: "Charon", version: "1" },
      // no fs/terminal: the agent uses its own disk/shell access, as the CLI does
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
  }

  newSession(cwd: string): Promise<NewSessionResult> {
    return this.request("session/new", { cwd, mcpServers: [] });
  }

  setMode(sessionId: string, modeId: string) {
    return this.request("session/set_mode", { sessionId, modeId });
  }

  setModel(sessionId: string, modelId: string) {
    return this.request("session/set_model", { sessionId, modelId });
  }

  /** Set a session config option (codex's model/reasoning selectors). */
  setConfigOption(sessionId: string, configId: string, value: string) {
    return this.request("session/set_config_option", { sessionId, configId, value });
  }

  /** Run one prompt turn; resolves with the stop reason. */
  async prompt(sessionId: string, blocks: AcpContentBlock[]): Promise<string> {
    const res = await this.request<{ stopReason?: string }>("session/prompt", {
      sessionId,
      prompt: blocks,
    });
    return res?.stopReason ?? "end_turn";
  }

  /** Interrupt the active turn (notification). The in-flight prompt then
   *  resolves with stopReason "cancelled". */
  cancel(sessionId: string): void {
    this.notify("session/cancel", { sessionId });
  }

  kill(): void {
    // settle any in-flight requests first — otherwise an await (e.g. the
    // session-driver's pending prompt) dangles forever when we kill the
    // process out from under it. fail() is idempotent (guards on `dead`).
    this.fail(new Error("agent killed"));
    this.exitResolve(-9);
    connections.delete(this.id);
    void native.killAgent(this.id).catch(() => {});
  }
}

export interface HarnessProbe {
  ok: boolean;
  error?: string;
  /** unified model list — native ACP models or a `model` config option */
  models: AcpModel[];
  /** the harness's default/current model id, if any */
  currentId?: string;
  /** reasoning-effort options, if the harness exposes them (codex) */
  reasoning?: { options: AcpModel[]; currentId?: string };
  modes: AcpMode[];
}

/** Human-readable verify result. */
export function summarizeProbe(p: HarnessProbe): string {
  if (!p.ok) return p.error ?? "could not connect";
  if (p.models.length === 0) return "Connected — this agent manages its own model";
  const m = `${p.models.length} model${p.models.length === 1 ? "" : "s"}`;
  return `Connected — ${m}${p.modes.length ? `, ${p.modes.length} modes` : ""}`;
}

/**
 * One-shot connectivity check for a harness: spawn, initialize, open a session
 * in the given cwd, and report whether it speaks ACP plus any model list it
 * exposes. Used by onboarding's live verify and by the startup model refresh.
 */
export async function probeHarness(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 15000
): Promise<HarnessProbe> {
  const conn = new AcpConnection(uid("probe-"), { onUpdate: () => {}, choosePermission: () => null });
  try {
    const result = await Promise.race([
      (async (): Promise<HarnessProbe> => {
        await conn.spawn(command, args, cwd);
        await conn.initialize();
        const ns = await conn.newSession(cwd);
        const { models, currentId } = sessionModels(ns);
        const rc = reasoningConfigOption(ns);
        const reasoning = rc
          ? {
              options: rc.options!.map((o) => ({ modelId: o.value, name: o.name ?? o.value })),
              currentId: rc.currentValue,
            }
          : undefined;
        return { ok: true, models, currentId, reasoning, modes: ns.modes?.availableModes ?? [] };
      })(),
      new Promise<HarnessProbe>((_, rej) =>
        setTimeout(() => rej(new Error("timed out — is the command an ACP server?")), timeoutMs)
      ),
    ]);
    return result;
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    // a non-ACP command launches an interactive REPL and bails on our piped
    // stdin ("stdin is not a terminal") — translate to something actionable
    if (/not a terminal|stdin|interactive|\btty\b|raw mode/i.test(msg)) {
      msg = `\`${command}${args.length ? " " + args.join(" ") : ""}\` isn't an ACP server — it started an interactive session instead. Check the command (e.g. Codex needs a separate ACP bridge).`;
    }
    return { ok: false, error: msg, models: [], modes: [] };
  } finally {
    conn.kill();
  }
}
