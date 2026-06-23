/**
 * SwarmHost — the comparison surface for an active Swarm.
 *
 * v1 shape: a vertical stack of contender panes, each embedding the contender's
 * live AgentCard (transcript + status). Per-pane Kill (if running); per-pane
 * Promote (enabled only when all contenders terminal AND this one is `done` —
 * Q5 strict). Top bar: Abandon (kill all + release, no push — ADR-0002).
 *
 * The comparison surface IS the transcripts — the user reads the N trials and
 * picks. A richer diff-rendering host (side-by-side panes, local diff per
 * mutable contender) is the documented follow-up; the architecture (contender
 * worktrees held, winner-only push) already supports it.
 *
 * Replaces RunResults when `activeSwarmFor(repo, pr.number)` is present, so
 * the no-swarm single-run path is byte-identical (Q4).
 */
import { useState } from "react";
import { activeSwarmFor, allContendersTerminal, abandonSwarm, contenderRun, killContender, promoteWinner } from "../lib/swarm";
import { useRepoStore } from "../lib/store";
import type { PrSummary } from "../types";
import { AgentCard } from "./AgentCard";
import { Spinner } from "./common";

export function SwarmHost({ pr, onReloadDiff }: { pr: PrSummary; onReloadDiff?: () => void }) {
  const repo = useRepoStore((s) => s.repo);
  const swarm = activeSwarmFor(repo, pr.number);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!swarm) return null;

  const terminal = allContendersTerminal(swarm);

  const onPromote = async (contenderId: string) => {
    setBusy(true);
    setError("");
    try {
      await promoteWinner(swarm.id, contenderId);
      onReloadDiff?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAbandon = async () => {
    setBusy(true);
    setError("");
    try {
      await abandonSwarm(swarm.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onKill = async (contenderId: string) => {
    setBusy(true);
    setError("");
    try {
      await killContender(swarm.id, contenderId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="subtle" style={{ fontSize: 12 }}>
          Swarm · {swarm.flowKind} · {swarm.contenders.length} contenders · {swarm.mode}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {error && <span className="composer-error" style={{ marginRight: 6 }}>{error}</span>}
          {swarm.status === "running" && (
            <button className="small" disabled={busy} onClick={() => void onAbandon()}>
              {busy ? <Spinner /> : null} Abandon
            </button>
          )}
        </div>
      </div>
      {swarm.contenders.map((c) => {
        const run = contenderRun(c);
        const status = run?.status ?? "starting";
        const isRunning = status === "running" || status === "starting";
        const isDone = status === "done";
        const canPromote = terminal && isDone && !busy;
        return (
          <div key={c.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span className="subtle" style={{ fontSize: 12 }}>
                {c.model || "default"} {c.worktree ? "· mutable" : "· read-only"}
              </span>
              <div className="row" style={{ gap: 6 }}>
                {isRunning && (
                  <button className="small" disabled={busy} onClick={() => void onKill(c.id)}>
                    Kill
                  </button>
                )}
                {swarm.status === "running" && (
                  <button
                    className="small primary"
                    disabled={!canPromote}
                    onClick={() => void onPromote(c.id)}
                    title={!terminal ? "wait for all contenders to finish" : !isDone ? "only a done run can be promoted" : "promote this contender as the winner"}
                  >
                    Promote
                  </button>
                )}
              </div>
            </div>
            {run ? (
              <AgentCard run={run} defaultOpen embedded />
            ) : (
              <div className="subtle">run not found (may have been evicted on restart)</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
