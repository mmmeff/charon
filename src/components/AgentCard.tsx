import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, memo, useMemo } from "react";
import { killAgent, steerAgent } from "../lib/agents";
import { navigateToPr } from "../lib/nav";
import { activeHarness, harnessReasoningCollapsed } from "../lib/defaults";
import { useGlobalConfig, useUiStore } from "../lib/store";
import type { AgentEntry, AgentLine, AgentPlanEntry, AgentRun, AgentToolCall, ToolKind } from "../types";
import { timeAgo, useNow } from "../lib/ui";
import { Badge, Spinner, ThinkingField } from "./common";
import { Markdown } from "./Markdown";

const statusColor = (s: AgentRun["status"]) =>
  s === "running" || s === "starting" ? "blue" : s === "done" ? "green" : s === "killed" ? "gray" : "red";

const TOOL_GLYPH: Record<ToolKind, string> = {
  read: "≡",
  edit: "✎",
  delete: "✕",
  move: "→",
  search: "⌕",
  execute: "$",
  think: "✻",
  fetch: "↓",
  other: "⚙",
};
const TOOL_STATUS_COLOR: Record<string, string> = {
  pending: "var(--fg-subtle)",
  in_progress: "var(--amber)",
  completed: "var(--acid)",
  failed: "var(--red)",
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pathRoots(run: AgentRun): string[] {
  return [run.cwd, run.draftCreate?.worktreePath, run.draftCreate?.clonePath]
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/\/+$/, ""))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function shortenRootPaths(text: string | undefined, roots: string[]): string | undefined {
  if (!text) return text;
  let next = text;
  for (const root of roots) {
    const quotedRoot = escapeRegExp(root);
    next = next
      .replace(new RegExp(`${quotedRoot}/`, "g"), "")
      .replace(new RegExp(`${quotedRoot}(?=\\s|$|["'):,;\\]])`, "g"), ".");
  }
  return next;
}

/** A rich tool-call row: kind glyph, title, status, expandable input/output. */
function ToolRow({ tool, roots }: { tool: AgentToolCall; roots: string[] }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(tool.input || tool.output || tool.locations.length);
  const title = shortenRootPaths(tool.title, roots);
  const input = shortenRootPaths(tool.input, roots);
  const locations = tool.locations.map((l) => shortenRootPaths(l, roots) ?? l);
  return (
    <div className={`agent-tool-row ${tool.status}`}>
      <div
        className="agent-tool-head"
        onClick={() => hasDetail && setOpen(!open)}
        style={{ cursor: hasDetail ? "pointer" : "default" }}
      >
        <span className="agent-tool-glyph" style={{ color: TOOL_STATUS_COLOR[tool.status] }}>
          {tool.status === "in_progress" ? <Spinner /> : TOOL_GLYPH[tool.kind] ?? "⚙"}
        </span>
        <span className="agent-tool-title">{title}</span>
        {input && <span className="agent-tool-arg">{input}</span>}
        {tool.status === "failed" && <Badge color="red">failed</Badge>}
        {hasDetail && <span className="agent-tool-caret">{open ? "▾" : "▸"}</span>}
      </div>
      {open && (
        <div className="agent-tool-detail">
          {locations.map((l) => (
            <div key={l} className="agent-tool-loc">
              {l}
            </div>
          ))}
          {tool.output && <pre>{tool.output}</pre>}
        </div>
      )}
    </div>
  );
}

function PlanView({ plan }: { plan: AgentPlanEntry[] }) {
  if (plan.length === 0) return null;
  const glyph = (s: string) => (s === "completed" ? "✓" : s === "in_progress" ? "▸" : "○");
  return (
    <div className="agent-plan">
      <div className="agent-plan-label">Plan</div>
      {plan.map((e, i) => (
        <div key={i} className={`agent-plan-item ${e.status}`}>
          <span className="agent-plan-glyph">{glyph(e.status)}</span> {e.content}
        </div>
      ))}
    </div>
  );
}

/** A collapsible group of consecutive reasoning/thinking entries. Rendered
 *  as a <details>; its initial open state is the inverse of the harness's
 *  `reasoningCollapsed` setting (default-on => collapsed). Reasoning is never
 *  dropped outright — it's always available one click away.
 *
 *  The <details> is UNCONTROLLED: we set `open` imperatively on mount via a ref
 *  and never pass it as a prop. This is critical for streaming performance —
 *  ActivityView subscribes to the whole runs map, so every chunk re-renders
 *  every visible AgentCard. A controlled `open` prop would (a) diff the
 *  attribute against the DOM on every re-render for every group and (b) reset
 *  the user's click-toggle on every chunk. With the ref approach React never
 *  touches `open` after mount; the native toggle persists across re-renders.
 *  memoized so a stable `entries` prop (cached by Transcript's useMemo) skips
 *  the inner re-render — and the `shortenRootPaths` regex work — for cards
 *  whose `run` didn't change. */
const ReasoningGroup = memo(function ReasoningGroup({
  entries,
  defaultOpen,
  startKey,
}: {
  entries: { text: string }[];
  defaultOpen: boolean;
  startKey: number;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // set the initial open state before first paint; defaultOpen is stable
  // (derived from the harness config), so this runs once on mount only.
  useLayoutEffect(() => {
    if (ref.current) ref.current.open = defaultOpen;
  }, [defaultOpen]);
  if (entries.length === 0) return null;
  const label = entries.length === 1 ? "reasoning" : `reasoning (${entries.length})`;
  return (
    <details className="agent-reasoning" ref={ref} key={startKey}>
      <summary className="agent-reasoning-summary">{label}</summary>
      <div className="agent-reasoning-body">
        {entries.map((e, i) => (
          <div key={i} className="agent-thinking">{e.text}</div>
        ))}
      </div>
    </details>
  );
});

/** Render the structured ACP transcript (or legacy lines for hydrated runs).
 *  Reasoning/thinking entries are tucked behind a collapsible disclosure whose
 *  default open state is the inverse of the active harness's
 *  `reasoningCollapsed` setting (default-on => collapsed). Consecutive
 *  reasoning entries are grouped into one disclosure so the stream stays
 *  scannable.
 *
 *  The whole grouping is memoized on `[run, defaultOpen]`. ActivityView
 *  subscribes to the entire runs map, so a chunk on ONE agent re-renders EVERY
 *  visible AgentCard — but only the card whose `run` actually changed gets a
 *  new `run` reference; the others hit the cache and skip the O(n) grouping
 *  pass, the `shortenRootPaths` regex construction (which builds `new RegExp`
 *  per root per entry), and the `buf`/`out`/`{text}` allocations. This is the
 *  dominant cost during streaming, so the cache turns an O(cards × n) per-chunk
 *  cost into O(n) for the single active card. */
function Transcript({ run, reasoningCollapsed }: { run: AgentRun; reasoningCollapsed: boolean }) {
  const defaultOpen = !reasoningCollapsed;
  const isLegacy = (!run.entries || run.entries.length === 0) && !!(run.lines && run.lines.length > 0);

  // Memoized on `[run, defaultOpen]`: a chunk on one agent re-renders every
  // visible AgentCard (ActivityView selects the whole runs map), but only the
  // card whose `run` actually changed gets a new `run` reference — the others
  // hit the cache and skip the O(n) grouping pass, the `shortenRootPaths`
  // regex construction, and the `buf`/`out`/`{text}` allocations.
  // `roots` is derived inside the memo (from `run`) for the same reason.
  const out = useMemo(() => {
    const roots = pathRoots(run);
    if (isLegacy) return buildLegacyTranscript(run.lines!, roots, defaultOpen);
    return buildEntryTranscript(run.entries, run.tools, roots, defaultOpen);
  }, [isLegacy, run, defaultOpen]);

  return <>{out}</>;
}

/** Group legacy pre-ACP `lines` into transcript nodes, tucking consecutive
 *  `thinking` lines into collapsible ReasoningGroups. */
function buildLegacyTranscript(
  lines: AgentLine[],
  roots: string[],
  defaultOpen: boolean
): ReactNode[] {
  const out: ReactNode[] = [];
  let buf: { text: string }[] = [];
  let groupStart = 0;
  const flush = (key: number) => {
    if (buf.length > 0) {
      out.push(
        <ReasoningGroup
          key={`r-${key}`}
          entries={buf}
          defaultOpen={defaultOpen}
          startKey={key}
        />
      );
      buf = [];
    }
  };
  lines.forEach((l: AgentLine, i) => {
    if (l.kind === "thinking") {
      if (buf.length === 0) groupStart = i;
      buf.push({ text: l.text });
      return;
    }
    flush(groupStart);
    if (l.kind === "tool") {
      out.push(
        <div key={i} className="agent-tool-row">
          <div className="agent-tool-head">
            <span className="agent-tool-glyph">⚙</span>
            <span className="agent-tool-arg">{shortenRootPaths(l.text, roots)}</span>
          </div>
        </div>
      );
    } else if (l.kind === "text") {
      out.push(
        <div key={i} className="agent-msg">
          <Markdown text={shortenRootPaths(l.text, roots) ?? l.text} className="compact" throttleMs={120} />
        </div>
      );
    } else {
      out.push(
        <div key={i} className={`agent-line ${l.kind === "stderr" ? "stderr" : ""}`}>
          {shortenRootPaths(l.text, roots)}
        </div>
      );
    }
  });
  flush(groupStart);
  return out;
}

/** Group structured ACP `entries` into transcript nodes, tucking consecutive
 *  `thought` entries into collapsible ReasoningGroups. */
function buildEntryTranscript(
  entries: AgentEntry[],
  tools: Record<string, AgentToolCall>,
  roots: string[],
  defaultOpen: boolean
): ReactNode[] {
  const out: ReactNode[] = [];
  let buf: { text: string }[] = [];
  let groupStart = 0;
  const flush = (key: number) => {
    if (buf.length > 0) {
      out.push(
        <ReasoningGroup
          key={`r-${key}`}
          entries={buf}
          defaultOpen={defaultOpen}
          startKey={key}
        />
      );
      buf = [];
    }
  };
  entries.forEach((e: AgentEntry, i) => {
    if (e.type === "thought") {
      if (buf.length === 0) groupStart = i;
      buf.push({ text: shortenRootPaths(e.text, roots) ?? e.text });
      return;
    }
    flush(groupStart);
    if (e.type === "message") {
      out.push(
        <div key={i} className="agent-msg">
          <Markdown text={shortenRootPaths(e.text, roots) ?? e.text} className="compact" throttleMs={120} />
        </div>
      );
    } else if (e.type === "steer") {
      out.push(
        <div key={i} className="agent-steer-echo">
          ↪ {shortenRootPaths(e.text, roots)}
        </div>
      );
    } else if (e.type === "tool") {
      const tool = tools[e.toolCallId];
      if (tool) out.push(<ToolRow key={i} tool={tool} roots={roots} />);
    }
  });
  flush(groupStart);
  return out;
}

/** One agent run in the Activity Feed: relation, transcript, steering. */
export function AgentCard({
  run,
  defaultOpen = false,
  embedded = false,
  streamContext,
}: {
  run: AgentRun;
  defaultOpen?: boolean;
  /** rendered inside another card (e.g. the composer) — no outer chrome */
  embedded?: boolean;
  /** layout variant for streams embedded in constrained contexts */
  streamContext?: "inline-comment";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showPrompt, setShowPrompt] = useState(false);
  const [steer, setSteer] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const githubUrl = useGlobalConfig((s) => s.config?.githubUrl ?? "https://github.com");
  const openCommit = useUiStore((s) => s.openCommit);
  const prUrl = run.prNumber == null ? "" : `${githubUrl}/${run.repo}/pull/${run.prNumber}`;
  const active = run.status === "running" || run.status === "starting";
  // Reasoning/thinking entries render inside a collapsible disclosure; this
  // sets its initial open state (default-on => collapsed). Resolved per render
  // from the live global config so a settings flip takes effect on the next
  // chunk.
  const cfg = useGlobalConfig.getState().config;
  const reasoningCollapsed = cfg ? harnessReasoningCollapsed(activeHarness(cfg)) : true;
  useNow(active ? 1000 : 0); // tick the elapsed counter while running

  // jump to this PR inside the app (the ↗ stays for web). No-op if the PR left
  // the lists (closed/merged) — only the web link remains.
  const openInApp = () => {
    if (run.prNumber != null) void navigateToPr(run.prNumber);
  };

  // follow the live stream as entries/tools grow
  useEffect(() => {
    if (open && active && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [run.entries, run.tools, open, active]);

  const elapsed = Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1000);
  const isEmpty = run.entries.length === 0 && !(run.lines && run.lines.length > 0);

  const submitSteer = () => {
    if (!steer.trim()) return;
    steerAgent(run.id, steer);
    setSteer("");
  };

  const frameClass = [
    embedded ? "agent-embedded" : "card",
    !embedded && active ? "agent-running" : "",
    streamContext === "inline-comment" ? "agent-stream-inline-comment" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={frameClass}>
      <div
        className="row between agent-head"
        onClick={() => setOpen(!open)}
        title={open ? "Collapse stream" : "Expand stream"}
      >
        <div className="row">
          <span className="agent-caret">{open ? "▾" : "▸"}</span>
          {active && <Spinner />}
          <Badge color={statusColor(run.status)}>{run.status}</Badge>
          <strong>{run.relation}</strong>
          {run.prNumber == null ? (
            <span className="subtle">{run.prTitle}</span>
          ) : (
            <>
              <button
                className="link agent-pr-link"
                title="Open in this app"
                onClick={(e) => {
                  e.stopPropagation();
                  openInApp();
                }}
              >
                PR #{run.prNumber} — {run.prTitle}
              </button>
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="subtle"
                title="Open on GitHub"
                onClick={(e) => e.stopPropagation()}
              >
                ↗
              </a>
            </>
          )}
          {run.commitSha && (
            <button
              className="link agent-commit-link"
              title="View the diff this agent pushed"
              onClick={(e) => {
                e.stopPropagation();
                openCommit(run.repo, run.commitSha!);
              }}
            >
              ⧉ {run.commitSha.slice(0, 7)}
            </button>
          )}
        </div>
        <div className="row">
          <span className="subtle">
            {run.mode ? `${run.mode} · ` : ""}
            {run.model} · {elapsed}s · {timeAgo(run.startedAt)}
          </span>
          {active && (
            <button
              className="small danger"
              title="Interrupt this agent"
              onClick={(e) => {
                e.stopPropagation();
                void killAgent(run.id);
              }}
            >
              Stop
            </button>
          )}
        </div>
      </div>
      {run.error && (
        <div style={{ color: "var(--red)", marginTop: 6, fontSize: 12.5 }}>
          {run.error}
          {run.errorDetail && (
            <details style={{ marginTop: 4 }}>
              <summary className="subtle" style={{ cursor: "pointer", fontSize: 11.5 }}>
                diagnostic details
              </summary>
              <pre
                style={{
                  margin: "6px 0 0",
                  padding: 8,
                  background: "var(--bg-inset)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 11.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 320,
                  overflow: "auto",
                }}
              >
                {run.errorDetail}
              </pre>
            </details>
          )}
        </div>
      )}
      {open && (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="link small" onClick={() => setShowPrompt(!showPrompt)}>
              {showPrompt ? "hide prompt" : "show prompt"}
            </button>
            {run.cwd && <span className="subtle">worktree: {run.cwd}</span>}
          </div>
          {showPrompt && <div className="prompt-box">{run.prompt}</div>}
          <PlanView plan={run.plan} />
          <div className="agent-log" ref={logRef}>
            {isEmpty &&
              (active ? (
                <ThinkingField compact ariaLabel="Waiting for agent output" />
              ) : (
                <span className="subtle">no output</span>
              ))}
            <Transcript run={run} reasoningCollapsed={reasoningCollapsed} />
          </div>
          {run.steerable && (
            <div className="agent-steer">
              <input
                type="text"
                placeholder="Steer the agent — add guidance or redirect…"
                value={steer}
                onChange={(e) => setSteer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSteer();
                }}
              />
              <button className="small" disabled={!steer.trim()} onClick={submitSteer}>
                Steer
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
