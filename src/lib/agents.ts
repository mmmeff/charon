import {
  AcpConnection,
  AcpRpcError,
  labeledModels,
  probeHarness,
  reasoningConfigOption,
  summarizeAcpError,
  type AcpSessionUpdate,
} from "./acp";
import { isHiddenAgentRun, isVisibleAgentRun } from "./agent-runs";
import { activeHarness } from "./defaults";
import { native } from "./tauri";
import { notify } from "./notify";
import { uid } from "./template";
import { useAgentStore, useGlobalConfig } from "./store";
import type {
  AgentKind,
  AgentRun,
  DraftCreateRunState,
  NotificationCategory,
  ToolKind,
  ToolStatus,
} from "../types";

const agentNotif = (
  run: AgentRun,
  outcome: "started" | "finished" | "failed",
  category: NotificationCategory,
  extra = ""
) => {
  if (isHiddenAgentRun(run)) return;
  const icon = outcome === "started" ? "▶" : outcome === "finished" ? "✓" : "✗";
  const subject = run.prNumber == null ? run.prTitle : `PR #${run.prNumber} ${run.prTitle}`;
  void notify(
    category,
    `${icon} Agent ${outcome}: ${run.relation}`,
    `${subject} · ${run.repo}${extra}`,
    run.prNumber == null ? undefined : { repo: run.repo, prNumber: run.prNumber }
  );
};

// lifecycle notification category for a run: an explicit per-run override
// (e.g. CI triage → "ci_analysis") wins, else it's keyed by outcome — so each
// gates independently in Settings → Notifications
const lifecycleCategory = (
  run: AgentRun,
  outcome: "started" | "finished" | "failed"
): NotificationCategory =>
  run.notifyCategory ??
  (outcome === "started" ? "agent_started" : outcome === "finished" ? "agent_finished" : "agent_failed");

export interface StartAgentOptions {
  kind: AgentKind;
  relation: string;
  repo: string;
  prNumber: number | null;
  prTitle: string;
  prompt: string;
  model: string;
  binary: string;
  cwd?: string;
  /** "ask" runs read-only (questions/feedback); default is full access. */
  mode?: "ask" | "plan" | "write";
  /** Override the lifecycle notification category for this run (e.g. CI triage
   *  runs use "ci_analysis" so they gate separately). Defaults by outcome. */
  notifyCategory?: NotificationCategory;
  /** Internal/background runs still collect output, but stay out of user-visible agent activity. */
  hiddenFromActivity?: boolean;
  draftCreate?: DraftCreateRunState;
  /** Ask followup: root Ask run this one extends. */
  followUpToRunId?: string;
  /** Raw user-authored prompt text (Ask questions / followups). */
  userQuestion?: string;
  onDone?: (run: AgentRun) => void | Promise<void>;
  onSettled?: (run: AgentRun) => void | Promise<void>;
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
const settledCallbacks = new Map<string, (run: AgentRun) => void | Promise<void>>();
// runs whose turn produced a harness "can't reach the model provider" error —
// the turn still ends end_turn, so finalize() converts these to a failure
const providerFailures = new Map<string, string>();

/**
 * Detect a harness "can't reach the model provider" error in agent output
 * (e.g. Cursor's `Provider Error … trouble connecting to the model provider`,
 * which arrives as a normal message chunk with stopReason end_turn). Returns a
 * clean message to fail the run with, or null for ordinary content.
 */
function harnessProviderError(text: string): string | null {
  if (/provider error|trouble connecting to the model provider/i.test(text)) {
    return "The harness couldn't reach this model's provider — it may be unavailable on your plan or temporarily down. Try a different model.";
  }
  return null;
}

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
        const provErr = harnessProviderError(t);
        if (provErr) {
          // suppress the raw provider error; finalize() fails the run cleanly
          providerFailures.set(id, provErr);
        } else {
          store.appendChunk(id, "message", t);
          store.appendResultText(id, t); // drives proposal/finding extraction
        }
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
    notifyCategory: opts.notifyCategory,
    hiddenFromActivity: opts.hiddenFromActivity,
    draftCreate: opts.draftCreate,
    followUpToRunId: opts.followUpToRunId,
    userQuestion: opts.userQuestion,
  };
  useAgentStore.getState().register(run);
  if (opts.onDone) doneCallbacks.set(id, opts.onDone);
  if (opts.onSettled) settledCallbacks.set(id, opts.onSettled);
  agentNotif(run, "started", lifecycleCategory(run, "started"));

  const fail = (msg: string, detail?: string) => {
    const cur = useAgentStore.getState().runs[id];
    // don't clobber a run already finalized (e.g. by a graceful-cancel race)
    if (cur && cur.status !== "running" && cur.status !== "starting") {
      active.delete(id);
      return;
    }
    useAgentStore.getState().update(id, {
      status: "error",
      error: msg,
      errorDetail: detail,
      endedAt: Date.now(),
      steerable: false,
    });
    doneCallbacks.delete(id);
    providerFailures.delete(id);
    active.delete(id);
    agentNotif(run, "failed", lifecycleCategory(run, "failed"), " — " + msg.slice(0, 80));
    runSettledCallback(id);
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
      // spawn the configured ACP harness (cursor by default); opts.binary is a
      // legacy fallback for callers that predate the harness config
      const harness = activeHarness(useGlobalConfig.getState().config!);
      const command = harness?.command || opts.binary;
      const args = harness?.args ?? ["acp"];
      await conn.spawn(command, args, opts.cwd);
      await conn.initialize();
      const ns = await conn.newSession(sessionCwd);
      const sessionId = ns.sessionId;
      active.set(id, { conn, sessionId, pendingSteer: null, cancelRequested: false });
      useAgentStore.getState().update(id, {
        status: "running",
        steerable: true,
        mode: ns.modes?.currentModeId,
      });

      // set mode (default session mode is "agent"). We no longer swallow
      // setup-call errors — a `-32603 / {service:"session"}` from set_mode
      // used to be `.catch(() => {})`-ed away, after which session/prompt
      // ran against a corrupted session and surfaced a misleading
      // "prompt failed" instead of the real "set_mode failed". Now any
      // setup throw propagates to the surrounding catch and is attributed
      // to the call that actually failed (the AcpRpcError carries
      // `method: "session/set_mode"` etc.).
      const targetMode = ACP_MODE[opts.mode ?? "write"];
      if (targetMode && ns.modes && ns.modes.currentModeId !== targetMode &&
          ns.modes.availableModes.some((m) => m.id === targetMode)) {
        await conn.setMode(sessionId, targetMode);
      }
      // set model — only via the harness's NATIVE set_model mechanism
      // (cursor and anything that exposes `models.availableModels` over
      // ACP). Harnesses that instead expose model as a `model` config
      // option (opencode, codex) deliberately keep pr-copilot's hands off:
      //
      //   opencode 1.15.13's `session/set_config_option("model", …)` succeeds
      //   but emits `session.next.model.switched`, whose handler calls
      //   `appendMessage` with `seq = NULL` over an empty `session_message`
      //   table (`MAX(seq)` returns NULL, no COALESCE) → SQLite NOT NULL
      //   constraint failure, propagated synchronously inside every subsequent
      //   `session/prompt`'s `createUserMessage` and surfaced as
      //   `-32603 / {service:"session"}`. Switching the model at all
      //   corrupts the session — pr-copilot's per-run override would fail
      //   every agent, every time, on opencode 1.15.13. The user's harness-
      //   level config (`opencode.json`, codex's `~/.codex/config.toml`)
      //   is the source of truth for these harnesses' default model; pr-copilot
      //   shouldn't override what the user already configured there. The
      //   model picker for such harnesses stays informational (the probe list
      //   populates `cfg.models` for display only). Native `set_model` is a
      //   real ACP method with its own handler, exercised and reliable on
      //   cursor; keep that path.
      if (opts.model && opts.model !== "auto" && ns.models?.availableModels?.length) {
        await conn.setModel(sessionId, opts.model);
      }
      // reasoning effort — a separate config-option axis where the harness
      // exposes it (codex). Per-flow override > global default.
      const cfg = useGlobalConfig.getState().config;
      const reasoning = cfg?.reasoningOverrides?.[opts.kind] || cfg?.reasoningEffort;
      const rc = reasoningConfigOption(ns);
      if (reasoning && rc && rc.options!.some((o) => o.value === reasoning)) {
        await conn.setConfigOption(sessionId, rc.id, reasoning);
      }

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
      // Log the *whole* error object so `tauri dev` and devtools show the
      // structured RPC code/data + stderr tail — these are what's missing
      // from "Internal error: OpenCode service failure" and they're discarded
      // if we only read `e.message`.
      console.error(`[agent] run ${id} failed (${run.relation} · ${run.repo})`, e);
      let msg: string;
      let detail: string | undefined;
      if (e instanceof AcpRpcError) {
        msg = summarizeAcpError(e);
        detail = e.toDetail();
      } else if (e instanceof Error) {
        msg = e.message;
        detail = `${e.name}: ${e.message}\n${e.stack ?? ""}`;
      } else {
        msg = String(e);
        detail = String(e);
      }
      fail(msg, detail);
    }
  })();

  return id;
}

/** Run the onDone contract + status transition when a turn settles. */
function finalize(id: string, status: "done" | "killed") {
  const store = useAgentStore.getState();
  const run = store.runs[id];
  if (!run) return;
  // a clean end_turn whose only content was a provider error is really a failure
  const provErr = providerFailures.get(id);
  providerFailures.delete(id);
  if (status === "done" && provErr) {
    store.update(id, { status: "error", error: provErr, endedAt: Date.now(), exitCode: 1, steerable: false });
    agentNotif(run, "failed", lifecycleCategory(run, "failed"), " — " + provErr.slice(0, 80));
    doneCallbacks.delete(id); // don't run post-processing on a failed turn
    runSettledCallback(id);
    return;
  }
  store.update(id, {
    status,
    endedAt: Date.now(),
    exitCode: status === "done" ? 0 : -9,
    steerable: false,
  });
  if (status === "done") {
    agentNotif(run, "finished", lifecycleCategory(run, "finished"), ` — ${Math.round((Date.now() - run.startedAt) / 1000)}s`);
    // onDone runs only on clean completion (matches pre-ACP semantics)
    const cb = doneCallbacks.get(id);
    doneCallbacks.delete(id);
    if (cb) {
      Promise.resolve(cb(useAgentStore.getState().runs[id])).catch((e) => {
        useAgentStore.getState().update(id, {
          status: "error",
          error: `post-processing failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        agentNotif(run, "failed", lifecycleCategory(run, "failed"), " — post-processing failed");
      }).finally(() => runSettledCallback(id));
    } else runSettledCallback(id);
  } else {
    doneCallbacks.delete(id); // killed-by-user stays silent
    runSettledCallback(id);
  }
}

function runSettledCallback(id: string) {
  const cb = settledCallbacks.get(id);
  settledCallbacks.delete(id);
  if (!cb) return;
  const run = useAgentStore.getState().runs[id];
  if (!run) return;
  Promise.resolve(cb(run)).catch((e) => {
    console.warn("agent settled callback failed", e);
  });
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
      .filter((r) => r && r.repo === repo && isVisibleAgentRun(r))
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

/**
 * Refresh the available-model list from the ACTIVE harness over ACP (the
 * model list `session/new` returns). Harness-agnostic: cursor exposes models
 * here, others (e.g. opencode) don't — those keep an empty list and run on
 * their own default. Called on each window's startup so the picker is fresh.
 */
export async function refreshModels(
  global: import("../types").GlobalConfig,
  save: (cfg: import("../types").GlobalConfig) => Promise<void>
): Promise<void> {
  const harness = activeHarness(global);
  if (!harness) return;
  const cwd = await native.appDataDir();
  const probe = await probeHarness(harness.command, harness.args, cwd);
  if (!probe.ok || probe.models.length === 0) return; // harness exposes no model list
  // Clean display labels (Cursor bracket params -> "(level, context)",
  // `default` -> "Auto"), sorted alphabetically by label. No synthetic "auto"
  // entry — harnesses with a "let me pick" option expose their own (Cursor's
  // `default[]`); "auto" stays the internal "defer to harness" sentinel.
  const labeled = labeledModels(probe.models);
  const models = labeled.map((x) => x.modelId);
  const modelLabels: Record<string, string> = {};
  for (const x of labeled) modelLabels[x.modelId] = x.label;

  // reasoning effort — a separate picker where the harness exposes it
  const reasoningOptions = (probe.reasoning?.options ?? []).map((o) => o.modelId);
  const reasoningLabels: Record<string, string> = {};
  for (const o of probe.reasoning?.options ?? []) reasoningLabels[o.modelId] = o.name;

  // Reconcile every selection against what's actually available now: keep the
  // configured pick if still offered, else the harness's own current/default,
  // else fall through. Stale overrides — referencing a model or reasoning
  // effort the harness no longer lists — are dropped so a selection is never
  // invalid. This is what enforces "defaults are always valid & available"
  // both after a harness switch (seeded defaults get pruned to reality) and on
  // every startup (a harness that dropped a model self-heals).
  const defaultModel = models.includes(global.defaultModel)
    ? global.defaultModel
    : probe.currentId && models.includes(probe.currentId)
      ? probe.currentId
      : models[0] ?? "auto";
  const reasoningEffort = reasoningOptions.includes(global.reasoningEffort)
    ? global.reasoningEffort
    : probe.reasoning?.currentId && reasoningOptions.includes(probe.reasoning.currentId)
      ? probe.reasoning.currentId
      : "";
  const modelOverrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(global.modelOverrides ?? {}))
    if (models.includes(v)) modelOverrides[k] = v;
  const reasoningOverrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(global.reasoningOverrides ?? {}))
    if (reasoningOptions.includes(v)) reasoningOverrides[k] = v;

  const next = {
    ...global,
    models,
    modelLabels,
    defaultModel,
    reasoningOptions,
    reasoningLabels,
    reasoningEffort,
    modelOverrides,
    reasoningOverrides,
  };
  const sig = (c: import("../types").GlobalConfig) =>
    JSON.stringify([
      c.models, c.modelLabels, c.defaultModel,
      c.reasoningOptions, c.reasoningLabels, c.reasoningEffort,
      c.modelOverrides, c.reasoningOverrides,
    ]);
  if (sig(next) !== sig(global)) await save(next);
}
