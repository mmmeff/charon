import { useEffect, useRef, useState } from "react";
import { killAgent, steerAgent } from "../lib/agents";
import { navigateToPr } from "../lib/nav";
import { useGlobalConfig } from "../lib/store";
import type { AgentEntry, AgentLine, AgentPlanEntry, AgentRun, AgentToolCall, ToolKind } from "../types";
import { timeAgo, useNow } from "../lib/ui";
import { Badge, LoadingField, Spinner } from "./common";
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

/** A rich tool-call row: kind glyph, title, status, expandable input/output. */
function ToolRow({ tool }: { tool: AgentToolCall }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(tool.input || tool.output || tool.locations.length);
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
        <span className="agent-tool-title">{tool.title}</span>
        {tool.input && <span className="agent-tool-arg">{tool.input}</span>}
        {tool.status === "failed" && <Badge color="red">failed</Badge>}
        {hasDetail && <span className="agent-tool-caret">{open ? "▾" : "▸"}</span>}
      </div>
      {open && (
        <div className="agent-tool-detail">
          {tool.locations.map((l) => (
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

/** Render the structured ACP transcript (or legacy lines for hydrated runs). */
function Transcript({ run }: { run: AgentRun }) {
  // legacy pre-ACP runs persisted `lines` and no entries
  if ((!run.entries || run.entries.length === 0) && run.lines && run.lines.length > 0) {
    return (
      <>
        {run.lines.map((l: AgentLine, i) =>
          l.kind === "tool" ? (
            <div key={i} className="agent-tool-row">
              <div className="agent-tool-head">
                <span className="agent-tool-glyph">⚙</span>
                <span className="agent-tool-arg">{l.text}</span>
              </div>
            </div>
          ) : l.kind === "thinking" ? (
            <div key={i} className="agent-thinking">{l.text}</div>
          ) : l.kind === "text" ? (
            <div key={i} className="agent-msg">
              <Markdown text={l.text} className="compact" />
            </div>
          ) : (
            <div key={i} className={`agent-line ${l.kind === "stderr" ? "stderr" : ""}`}>{l.text}</div>
          )
        )}
      </>
    );
  }
  return (
    <>
      {run.entries.map((e: AgentEntry, i) => {
        if (e.type === "message")
          return (
            <div key={i} className="agent-msg">
              <Markdown text={e.text} className="compact" />
            </div>
          );
        if (e.type === "thought") return <div key={i} className="agent-thinking">{e.text}</div>;
        if (e.type === "steer")
          return (
            <div key={i} className="agent-steer-echo">
              ↪ {e.text}
            </div>
          );
        const tool = run.tools[e.toolCallId];
        return tool ? <ToolRow key={i} tool={tool} /> : null;
      })}
    </>
  );
}

/** One agent run in the Activity Feed: relation, transcript, steering. */
export function AgentCard({
  run,
  defaultOpen = false,
  embedded = false,
}: {
  run: AgentRun;
  defaultOpen?: boolean;
  /** rendered inside another card (e.g. the composer) — no outer chrome */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showPrompt, setShowPrompt] = useState(false);
  const [steer, setSteer] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const githubUrl = useGlobalConfig((s) => s.config?.githubUrl ?? "https://github.com");
  const prUrl = `${githubUrl}/${run.repo}/pull/${run.prNumber}`;
  const active = run.status === "running" || run.status === "starting";
  useNow(active ? 1000 : 0); // tick the elapsed counter while running

  // jump to this PR inside the app (the ↗ stays for web). No-op if the PR left
  // the lists (closed/merged) — only the web link remains.
  const openInApp = () => void navigateToPr(run.prNumber);

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

  return (
    <div className={embedded ? "agent-embedded" : `card ${active ? "agent-running" : ""}`}>
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
      {run.error && <div style={{ color: "var(--red)", marginTop: 6, fontSize: 12.5 }}>{run.error}</div>}
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
                <LoadingField label="waiting for output…" height={44} />
              ) : (
                <span className="subtle">no output</span>
              ))}
            <Transcript run={run} />
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
