/**
 * SwarmHost — the unified surface for a Swarm of N parallel contenders.
 *
 * Renders the swarm as ONE card with tabs (one per contender, labelled by
 * model), not as a vertical stack. The active tab shows the contender's
 * embedded AgentCard (transcript + status); the tab strip carries per-tab
 * Kill (running) and Promote (running + all contenders terminal + this one
 * `done` — Q5 strict). The header carries status + Abandon (running only).
 *
 * Used everywhere a swarm's runs would otherwise appear so the N contenders
 * never render as N disconnected cards: Composer (RunResults, review-active),
 * NewDraftWorkspace, ActivityView (active grid + completed groups), and
 * DraftsView's pending workspaces. Q4 invariant: the no-swarm paths in
 * those surfaces stay byte-identical — this host only mounts when a swarm is
 * found for the (repo, prNumber) / run's swarmId.
 *
 * Renders for ANY swarm status (running / resolved / abandoned). Kill &
 * Promote actions (which mutate state) are only offered when
 * `swarm.status === "running"`; resolved/abandoned swarms render as
 * read-only comparison cards, with the resolved winner's tab marked.
 */
import { useEffect, useState } from "react";
import { allContendersTerminal, abandonSwarm, contenderDiffFiles, contenderRun, killContender, promoteWinner } from "../lib/swarm";
import { AgentCard } from "./AgentCard";
import { DiffViewer } from "./DiffViewer";
import { Spinner } from "./common";
import { useFlow } from "./flow";
import type { FileDiff, Swarm, SwarmContender } from "../types";

export function SwarmHost({
  swarm,
  onReloadDiff,
  embedded = false,
  showDiff = true,
  defaultContenderId,
}: {
  swarm: Swarm;
  /** Reload the diff after a draft_edit winner pushes (Composer path). */
  onReloadDiff?: () => void;
  /** When true (e.g. mounted inside the Composer review branch) drop the outer
   *  card chrome — behaves like AgentCard's `embedded`. */
  embedded?: boolean;
  /** Whether to render the per-contender diff below the stream. The Activity
   *  feed mounts many SwarmHosts and diffs there are both noise and a perf
   *  drag — diffs belong on the dedicated draft/review PR pages. */
  showDiff?: boolean;
  /** Initial open tab. Defaults to the winner (resolved) or the first contender. */
  defaultContenderId?: string;
}) {
  const { ctx } = useFlow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialId =
    defaultContenderId ??
    swarm.winnerContenderId ??
    swarm.contenders[0]?.id ??
    "";
  const [activeId, setActiveId] = useState<string>(initialId);

  const terminal = allContendersTerminal(swarm);
  const running = swarm.status === "running";
  const activeContender = swarm.contenders.find((c) => c.id === activeId) ?? swarm.contenders[0];

  const onPromote = async (contenderId: string) => {
    setBusy(true);
    setError("");
    try {
      await promoteWinner(ctx, swarm.id, contenderId);
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

  const headerLabel =
    swarm.status === "running"
      ? `Swarm · ${swarm.flowKind} · ${swarm.contenders.length} models`
      : swarm.status === "resolved"
        ? `Swarm · ${swarm.flowKind} · resolved · result promoted`
        : `Swarm · ${swarm.flowKind} · abandoned`;

  const frameClass = embedded ? "agent-embedded" : "card";
  return (
    <div className={`${frameClass} swarm-host`} style={{ marginBottom: embedded ? 0 : 14 }}>
      <div className="row swarm-host-header">
        <span className="subtle swarm-host-label">{headerLabel}</span>
        <div className="row" style={{ gap: 6 }}>
          {error && <span className="composer-error" style={{ marginRight: 6 }}>{error}</span>}
          {running && (
            <button className="small" disabled={busy} onClick={() => void onAbandon()}>
              {busy && !activeContender ? <Spinner /> : null} Abandon
            </button>
          )}
        </div>
      </div>
      <div className="seg swarm-host-tabs">
        {swarm.contenders.map((c, i) => {
          const run = contenderRun(c);
          const status = run?.status ?? "starting";
          const isRunning = status === "running" || status === "starting";
          const isWinner = swarm.status === "resolved" && swarm.winnerContenderId === c.id;
          const isActive = (activeContender ?? swarm.contenders[0]).id === c.id;
          return (
            <button
              key={c.id}
              className={`small swarm-host-tab ${isActive ? "primary" : ""} ${isWinner ? "swarm-tab-winner" : ""}`}
              title={status}
              disabled={busy && !isRunning && !isWinner}
              onClick={() => setActiveId(c.id)}
            >
              <span className="swarm-host-tab-dot" data-status={status} />
              <span className="swarm-host-tab-label">{c.model || "default"}</span>
              {isWinner && <span className="swarm-host-tab-badge" title="chosen result">★</span>}
              {!isWinner && isRunning && <span className="subtle" style={{ fontSize: 10 }}>·{i + 1}</span>}
            </button>
          );
        })}
      </div>
      {activeContender && (
        <ContenderPane
          key={activeContender.id}
          swarm={swarm}
          contender={activeContender}
          running={running}
          busy={busy}
          terminal={terminal}
          showDiff={showDiff}
          onPromote={onPromote}
          onKill={onKill}
        />
      )}
    </div>
  );
}

function ContenderPane({
  swarm,
  contender,
  running,
  busy,
  terminal,
  showDiff,
  onPromote,
  onKill,
}: {
  swarm: Swarm;
  contender: SwarmContender;
  running: boolean;
  busy: boolean;
  terminal: boolean;
  showDiff: boolean;
  onPromote: (id: string) => void;
  onKill: (id: string) => void;
}) {
  const run = contenderRun(contender);
  const status = run?.status ?? "starting";
  const isRunning = status === "running" || status === "starting";
  const isDone = status === "done";
  const isWinner = swarm.status === "resolved" && swarm.winnerContenderId === contender.id;
  const canPromote = terminal && isDone && !busy && running;

  return (
    <div className="swarm-host-pane">
      <div className="row swarm-host-pane-bar">
        <span className="subtle">
          {contender.model || "default"} {contender.worktree ? "· mutable" : "· read-only"}
          {isWinner ? " · chosen" : status !== "starting" ? ` · ${status}` : " · starting"}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {running && isRunning && (
            <button className="small" disabled={busy} onClick={() => void onKill(contender.id)}>
              Kill
            </button>
          )}
          {running && (
            <button
              className="small primary"
              disabled={!canPromote}
              onClick={() => void onPromote(contender.id)}
              title={
                !terminal
                  ? "wait for all contenders to finish"
                  : !isDone
                    ? "only a done run can be promoted"
                    : "promote this contender's result"
              }
            >
              Promote
            </button>
          )}
        </div>
      </div>
      {run ? (
        <AgentCard run={run} defaultOpen embedded />
      ) : (
        <div className="subtle" style={{ padding: 8 }}>run not found (may have been evicted on restart)</div>
      )}
      {showDiff && contender.worktree && isDone && <ContenderDiff contender={contender} />}
    </div>
  );
}

/** The contender's own `baseSha..HEAD` diff, rendered below its stream. Only
 *  mutable contenders (draft_edit/draft_create) carry a worktree, so
 *  review/question contenders render nothing here — their output is prose that
 *  already lives in the stream. Loads once per mount; the pane is keyed by
 *  contender id, so switching tabs re-mounts this and swaps the diff to the
 *  newly-active contender's. */
function ContenderDiff({ contender }: { contender: SwarmContender }) {
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setErr("");
    void (async () => {
      try {
        const f = await contenderDiffFiles(contender);
        if (!cancelled) setFiles(f);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contender]);

  return (
    <div className="swarm-host-diff">
      <div className="row swarm-host-diff-head">
        <span className="subtle">Diff</span>
        {files === null && !err && <Spinner />}
      </div>
      {err && <p style={{ color: "var(--red)", margin: 0 }}>{err}</p>}
      {files !== null && files.length === 0 && !err && (
        <p className="subtle" style={{ margin: 0 }}>
          No file changes — the agent concluded no change was needed.
        </p>
      )}
      {files !== null && files.length > 0 && <DiffViewer files={files} />}
    </div>
  );
}
