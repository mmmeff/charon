import { native, type AgentStreamEvent } from "./tauri";
import { uid } from "./template";
import { useAgentStore } from "./store";
import type { AgentKind, AgentRun } from "../types";

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
    const { display, assistantText } = parseStreamLine(ev.line);
    if (display) store.appendLine(ev.id, { kind: "stdout", text: display, at: Date.now() });
    if (assistantText) store.appendResultText(ev.id, assistantText);
    if (run.status === "starting") store.update(ev.id, { status: "running" });
    return;
  }
  if (ev.kind === "stderr" && ev.line) {
    store.appendLine(ev.id, { kind: "stderr", text: ev.line, at: Date.now() });
    return;
  }
  if (ev.kind === "spawn-error") {
    store.update(ev.id, {
      status: "error",
      error: ev.line ?? "spawn failed",
      endedAt: Date.now(),
    });
    doneCallbacks.delete(ev.id);
    return;
  }
  if (ev.kind === "exit") {
    const ok = ev.code === 0;
    const wasKilled = ev.code === -9;
    store.update(ev.id, {
      status: wasKilled ? "killed" : ok ? "done" : "error",
      exitCode: ev.code,
      endedAt: Date.now(),
      ...(ok ? {} : wasKilled ? {} : { error: `agent exited with code ${ev.code}` }),
    });
    const cb = doneCallbacks.get(ev.id);
    doneCallbacks.delete(ev.id);
    if (cb && ok) {
      const finished = useAgentStore.getState().runs[ev.id];
      Promise.resolve(cb(finished)).catch((e) => {
        useAgentStore.getState().update(ev.id, {
          status: "error",
          error: `post-processing failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      });
    }
  }
}

/**
 * Parse one NDJSON line of `cursor-agent --output-format stream-json`.
 * The schema is treated defensively: we extract assistant text wherever it
 * lives and render a compact human-readable display line for everything else.
 */
function parseStreamLine(line: string): { display: string | null; assistantText: string | null } {
  const trimmed = line.trim();
  if (!trimmed) return { display: null, assistantText: null };
  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    // plain-text output (e.g. --output-format text fallback)
    return { display: trimmed, assistantText: trimmed + "\n" };
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
    case "system":
      return { display: `[system] ${obj.subtype ?? ""} ${obj.model ?? ""}`.trim(), assistantText: null };
    case "user":
      return { display: null, assistantText: null };
    case "assistant": {
      const text = collectText(obj.message?.content ?? obj.content ?? obj.text);
      return { display: text || null, assistantText: text || null };
    }
    case "thinking":
      return { display: obj.text ? `[thinking] ${obj.text}` : null, assistantText: null };
    case "tool_call": {
      const name =
        obj.tool_call?.name ?? obj.name ?? obj.subtype ?? Object.keys(obj.tool_call ?? {})[0] ?? "tool";
      const args = JSON.stringify(obj.tool_call?.args ?? obj.args ?? obj.tool_call ?? {});
      return {
        display: `[tool] ${name} ${args.length > 220 ? args.slice(0, 220) + "…" : args}`,
        assistantText: null,
      };
    }
    case "tool_result":
      return { display: `[tool done]`, assistantText: null };
    case "result": {
      const text = typeof obj.result === "string" ? obj.result : collectText(obj.result);
      // final result usually repeats accumulated assistant text; keep it as
      // authoritative by replacing nothing but appending a marker-free copy
      return { display: text ? `[result] ${firstLine(text)}` : "[result]", assistantText: text ? "\n" + text : null };
    }
    default: {
      const text = collectText(obj?.message?.content ?? obj?.text);
      if (text) return { display: text, assistantText: text };
      return { display: null, assistantText: null };
    }
  }
}

function firstLine(s: string): string {
  const l = s.split("\n").find((x) => x.trim());
  return l ? (l.length > 160 ? l.slice(0, 160) + "…" : l) : "";
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

export async function listCursorModels(binary: string): Promise<string[]> {
  try {
    const res = await native.runExec(binary, ["models"]);
    if (res.code !== 0) return [];
    return res.stdout
      .split("\n")
      .map((l) => l.replace(/^[\s*•-]+/, "").trim())
      .filter((l) => l && !/^(available|models|name|---|\w+:)/i.test(l) && !l.includes(" "));
  } catch {
    return [];
  }
}
