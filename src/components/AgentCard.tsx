import { useEffect, useRef, useState } from "react";
import { killAgent } from "../lib/agents";
import { useGlobalConfig } from "../lib/store";
import type { AgentRun } from "../types";
import { Badge, Spinner, timeAgo, useNow } from "./common";

const statusColor = (s: AgentRun["status"]) =>
  s === "running" || s === "starting" ? "blue" : s === "done" ? "green" : s === "killed" ? "gray" : "red";

/** One agent run in the Activity Feed: relation, prompt, and live work view. */
export function AgentCard({ run, defaultOpen = false }: { run: AgentRun; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showPrompt, setShowPrompt] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const githubUrl = useGlobalConfig((s) => s.config?.githubUrl ?? "https://github.com");
  const prUrl = `${githubUrl}/${run.repo}/pull/${run.prNumber}`;
  const active = run.status === "running" || run.status === "starting";
  useNow(active ? 1000 : 0); // tick the elapsed counter while running

  // follow the live stream
  useEffect(() => {
    if (open && active && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [run.lines.length, open, active]);

  const elapsed = Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1000);

  return (
    <div className={`card ${active ? "agent-running" : ""}`}>
      <div className="row between">
        <div className="row">
          {active && <Spinner />}
          <Badge color={statusColor(run.status)}>{run.status}</Badge>
          <strong>{run.relation}</strong>
          <a href={prUrl} target="_blank" rel="noreferrer" title={prUrl}>
            PR #{run.prNumber} — {run.prTitle}
          </a>
        </div>
        <div className="row">
          <span className="subtle">
            {run.model} · {elapsed}s · {timeAgo(run.startedAt)}
          </span>
          {active && (
            <button className="small danger" onClick={() => void killAgent(run.id)}>
              Stop
            </button>
          )}
          <button className="small" onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Watch"}
          </button>
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
          <div className="agent-log" ref={logRef}>
            {run.lines.length === 0 && <span className="subtle">waiting for output…</span>}
            {run.lines.map((l, i) => (
              <div key={i} className={`agent-line ${l.kind === "stderr" ? "stderr" : ""}`}>
                {l.text}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
