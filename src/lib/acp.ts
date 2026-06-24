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
  | {
      sessionUpdate: "available_commands_update";
      availableCommands: { name: string; description?: string }[];
    }
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
export function modelConfigOption(
  ns: NewSessionResult,
): AcpConfigOption | undefined {
  return ns.configOptions?.find(
    (o) =>
      (o.id === "model" || o.category === "model") &&
      o.type === "select" &&
      o.options?.length,
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
    params.set(
      eq < 0 ? kv.trim() : kv.slice(0, eq).trim(),
      eq < 0 ? "" : kv.slice(eq + 1).trim(),
    );
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
export function labeledModels(
  models: AcpModel[],
): { modelId: string; label: string }[] {
  return models
    .map((m) => ({ modelId: m.modelId, label: modelLabel(m) }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );
}

/** The reasoning-effort config option, if the harness exposes one (codex). */
export function reasoningConfigOption(
  ns: NewSessionResult,
): AcpConfigOption | undefined {
  return ns.configOptions?.find(
    (o) =>
      (o.category === "thought_level" ||
        /reason|effort|thinking/i.test(o.id)) &&
      o.type === "select" &&
      o.options?.length,
  );
}

/**
 * The model list + current id for a session, sourced from whichever mechanism
 * the harness uses: native ACP models (cursor) or a `model` config option
 * (codex). Empty when the harness manages its own model (opencode).
 */
export function sessionModels(ns: NewSessionResult): {
  models: AcpModel[];
  currentId?: string;
} {
  if (ns.models?.availableModels?.length) {
    return {
      models: ns.models.availableModels,
      currentId: ns.models.currentModelId,
    };
  }
  const opt = modelConfigOption(ns);
  if (opt) {
    return {
      models: opt.options!.map((o) => ({
        modelId: o.value,
        name: o.name ?? o.value,
      })),
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

/**
 * An error from the ACP wire layer: a JSON-RPC error response, a spawn
 * failure, or a non-zero agent exit. Carries the structured RPC `code`
 * and `data` (which harnesses like opencode use to explain internal
 * failures) plus a tail of the agent's stderr (where the harness logs
 * diagnostic context that the JSON-RPC `message` doesn't include), so
 * the caller can surface a debuggable trace instead of just
 * `error.message` — which by itself is often a one-liner like
 * "Internal error: OpenCode service failure".
 */
export class AcpRpcError extends Error {
  /** JSON-RPC `error.code` when the harness replied with an error; undefined for spawn/exit failures. */
  readonly rpcCode?: number;
  /** JSON-RPC `error.data` (structured harness detail). */
  readonly rpcData?: unknown;
  /** Up to ~4 KiB of the agent's most recent stderr at the time of failure. */
  readonly stderr?: string;
  /** Process exit code, when the failure was an exit (or -9 for a kill). */
  readonly exitCode?: number;
  /** The agent id (spawn key) so a logged error points back to the run. */
  readonly agentId?: string;
  /** The ACP method we sent that the harness rejected (e.g. "session/prompt").
   *  Set by the connection when a per-request rejection lands; absent on
   *  connection-wide deaths (spawn-error/exit) where no single method is at
   *  fault. Logging this is what makes "Internal error: OpenCode service
   *  failure" actionable — you see *which* call the harness choked on. */
  method?: string;

  constructor(
    message: string,
    opts: {
      rpcCode?: number;
      rpcData?: unknown;
      stderr?: string;
      exitCode?: number;
      agentId?: string;
      method?: string;
      cause?: unknown;
    },
  ) {
    super(
      message,
      opts.cause !== undefined ? { cause: opts.cause } : undefined,
    );
    this.name = "AcpRpcError";
    this.rpcCode = opts.rpcCode;
    this.rpcData = opts.rpcData;
    this.stderr = opts.stderr?.trim() || undefined;
    this.exitCode = opts.exitCode;
    this.agentId = opts.agentId;
    this.method = opts.method;
  }

  /** Multi-line, human-readable dump of everything we know — for logs/UI detail. */
  toDetail(): string {
    const lines: string[] = [];
    lines.push(`agent: ${this.agentId ?? "(unknown)"}`);
    if (this.method) lines.push(`method: ${this.method}`);
    if (this.rpcCode !== undefined) lines.push(`rpc code: ${this.rpcCode}`);
    if (this.rpcData !== undefined) {
      let dataStr: string;
      try {
        dataStr = JSON.stringify(this.rpcData, null, 2);
      } catch {
        dataStr = String(this.rpcData);
      }
      lines.push(`rpc data: ${dataStr}`);
    }
    if (this.exitCode !== undefined) lines.push(`exit code: ${this.exitCode}`);
    if (this.stderr) lines.push(`agent stderr (tail):\n${this.stderr}`);
    return lines.join("\n");
  }
}

/**
 * Format the user-facing summary line: keep the harness's `message` verbatim
 * (it's the only clue when `data` is empty), prepend the method we sent when
 * known, append the RPC code, and a short stderr tail when present. Bounded
 * length so it fits in the activity card; the full dump lives on
 * `AcpRpcError.toDetail()`.
 */
export function summarizeAcpError(e: AcpRpcError): string {
  let summary = e.message || "ACP error";
  if (e.method) summary = `${e.method}: ${summary}`;
  if (e.rpcCode !== undefined) summary += ` (rpc ${e.rpcCode})`;
  if (e.stderr) {
    const tail = e.stderr.split("\n").filter(Boolean).slice(-3).join(" ⏎ ");
    if (tail && tail.length <= 300) summary += ` · ${tail}`;
  }
  return summary;
}

/**
 * Attach the ACP method we sent to a rejection error so logs/surfaces can show
 * "session/prompt failed" rather than an anonymous "id 4 failed". If the error
 * is already an `AcpRpcError` (e.g. an RPC error response) we just set `method`
 * when absent; otherwise we wrap the plain Error in an `AcpRpcError` carrying
 * the method and the connection's current stderr tail.
 */
function stampMethod(err: Error, method: string): AcpRpcError {
  if (err instanceof AcpRpcError) {
    if (!err.method) err.method = method;
    return err;
  }
  // Wrap so connection-level deaths (e.g. "agent killed") carry the in-flight
  // method too — preserved via Error.cause so the original stack stays reachable.
  return new AcpRpcError(err.message, { method, cause: err });
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
  choosePermission: (
    options: { optionId: string; name: string; kind: string }[],
  ) => string | null;
}

export class AcpConnection {
  readonly id: string;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; method: string }
  >();
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
  async spawn(
    binary: string,
    args: string[],
    cwd?: string,
    env?: Record<string, string>,
  ): Promise<void> {
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
      this.fail(
        new AcpRpcError(ev.line ?? "spawn failed", {
          agentId: this.id,
          stderr: this.stderr,
        }),
      );
    } else if (ev.kind === "exit") {
      // Surface the exit code on the error so callers/logs can tell a crash
      // apart from a harness that exited cleanly with stderr noise.
      this.fail(
        new AcpRpcError(
          this.stderr.trim() || `agent exited (code ${ev.code ?? "?"})`,
          {
            exitCode: ev.code ?? undefined,
            stderr: this.stderr,
            agentId: this.id,
          },
        ),
      );
      this.exitResolve(ev.code ?? 0);
      connections.delete(this.id);
    }
  }

  private fail(err: Error) {
    if (this.dead) return;
    this.dead = true;
    // Stamp each in-flight request's method onto the rejection so logs say
    // "session/prompt: agent killed" rather than a context-less "agent killed"
    // when the whole connection dies mid-turn.
    for (const { reject, method } of this.pending.values())
      reject(stampMethod(err, method));
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
    if (
      msg.id != null &&
      (msg.result !== undefined || msg.error !== undefined)
    ) {
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.error) {
        // Preserve the harness's structured error — `code`/`data` plus the
        // stderr it logged alongside the failure, and the method we sent —
        // instead of flattening to just `error.message`. opencode returns
        // `data` with the real cause of "Internal error: OpenCode service
        // failure"; Cursor returns a provider-specific code. Without this
        // we only see the one-liner and have to guess which call failed.
        p.reject(
          new AcpRpcError(msg.error.message || "ACP error", {
            rpcCode: msg.error.code,
            rpcData: msg.error.data,
            stderr: this.stderr,
            agentId: this.id,
            method: p.method,
          }),
        );
      } else p.resolve(msg.result);
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
      native
        .agentSend(
          this.id,
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }),
        )
        .catch((e) => {
          console.error(
            `acp send response failed on ${this.id} id=${msg.id}`,
            e,
          );
          this.fail(
            new Error("lost agent connection sending response", { cause: e }),
          );
        });
    const respondError = (code: number, message: string) =>
      native
        .agentSend(
          this.id,
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code, message },
          }),
        )
        .catch((e) => {
          console.error(
            `acp send response failed on ${this.id} id=${msg.id}`,
            e,
          );
          this.fail(
            new Error("lost agent connection sending response", { cause: e }),
          );
        });

    switch (msg.method) {
      case "session/request_permission": {
        const opts = (msg.params?.options ?? []) as {
          optionId: string;
          name: string;
          kind: string;
        }[];
        const chosen = this.handlers.choosePermission(opts);
        await respond(
          chosen
            ? { outcome: { outcome: "selected", optionId: chosen } }
            : { outcome: { outcome: "cancelled" } },
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
    if (this.dead)
      return Promise.reject(
        stampMethod(new Error("agent connection closed"), method),
      );
    const id = this.nextId++;
    const p = new Promise<T>((resolve, reject) =>
      this.pending.set(id, { resolve, reject, method }),
    );
    void native
      .agentSend(
        this.id,
        JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      )
      .catch((e) => {
        const pend = this.pending.get(id);
        if (pend) {
          this.pending.delete(id);
          pend.reject(
            stampMethod(e instanceof Error ? e : new Error(String(e)), method),
          );
        }
      });
    return p;
  }

  private notify(method: string, params: unknown): void {
    void native
      .agentSend(this.id, JSON.stringify({ jsonrpc: "2.0", method, params }))
      .catch((e) => {
        console.error(
          `acp send notification failed on ${this.id} method=${method}`,
          e,
        );
      });
  }

  // -- ACP methods ----------------------------------------------------------

  initialize() {
    return this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "charon", title: "Charon", version: "1" },
      // no fs/terminal: the agent uses its own disk/shell access, as the CLI does
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
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
    return this.request("session/set_config_option", {
      sessionId,
      configId,
      value,
    });
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
    void native.killAgent(this.id).catch((e) => {
      console.error(`acp kill failed on ${this.id}`, e);
    });
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
  if (p.models.length === 0)
    return "Connected — this agent manages its own model";
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
  timeoutMs = 15000,
): Promise<HarnessProbe> {
  const conn = new AcpConnection(uid("probe-"), {
    onUpdate: () => {},
    choosePermission: () => null,
  });
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
              options: rc.options!.map((o) => ({
                modelId: o.value,
                name: o.name ?? o.value,
              })),
              currentId: rc.currentValue,
            }
          : undefined;
        return {
          ok: true,
          models,
          currentId,
          reasoning,
          modes: ns.modes?.availableModes ?? [],
        };
      })(),
      new Promise<HarnessProbe>((_, rej) =>
        setTimeout(
          () => rej(new Error("timed out — is the command an ACP server?")),
          timeoutMs,
        ),
      ),
    ]);
    return result;
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    // Surface the structured RPC context the harness gave us — without this
    // the verify result just says "Internal error: OpenCode service failure".
    if (e instanceof AcpRpcError) {
      msg = summarizeAcpError(e);
    }
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
