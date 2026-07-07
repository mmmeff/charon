import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteDraftCreateArtifacts } from "../../lib/flows";
import { usePrData } from "../../lib/events";
import { stackedPrList } from "../../lib/pr-stacks";
import { useAgentStore, useSwarmStore, useUiStore } from "../../lib/store";
import { formatShortcut, resolveShortcutMap } from "../../lib/shortcuts";
import { age, type SortKey } from "../../lib/ui";
import type { AgentRun, Swarm } from "../../types";
import { AgentCard } from "../AgentCard";
import { ApprovalsBadge, Badge, CiBadge, EmptyState, RunningAgentsChip, SortPicker, Spinner } from "../common";
import { useFlow } from "../flow";
import { Sidebar } from "../Panels";
import { PrStackCard } from "../PrStackList";
import { PrWorkspace } from "../PrWorkspace";
import { NewDraftWorkspace } from "../NewDraftWorkspace";
import { SwarmHost } from "../SwarmHost";

/**
 * Drafts: the user's own draft PRs. Line-scoped feedback triggers an agent
 * immediately (no approval gate — it's the user's own draft); questions and
 * general feedback run read-only.
 */
export function DraftsView() {
  const { ctx, prStacks } = useFlow();
  const drafts = usePrData((s) => s.myDrafts);
  const checks = usePrData((s) => s.checks);
  const lastPollAt = usePrData((s) => s.lastPollAt);
  const loading = lastPollAt === null;
  const selected = useUiStore((s) => s.focusedPr["drafts"] ?? null);
  const requestedNewDraft = useUiStore((s) => s.requestedNewDraft);
  const [creating, setCreating] = useState(false);
  const [selectedPendingId, setSelectedPendingId] = useState<string | null>(null);
  // Pending draft_create runs (prNumber == null, not dismissed) — slice to a
  // shallow-compared array so chunks to unrelated runs never re-render the
  // Drafts list. Each chunk on a matching run bumps that run's ref; the array
  // shallow-changes and we re-render only then.
  const pendingDraftRuns = useAgentStore(
    useShallow((s) =>
      s.order
        .map((id) => s.runs[id])
        .filter(
          (r): r is AgentRun =>
            !!r &&
            r.kind === "draft_create" &&
            r.repo === ctx.repo &&
            r.prNumber == null &&
            !r.draftCreate?.dismissed
        )
    )
  );
  // Group pending runs that share a swarmId into ONE row (winner if present,
  // else first one). The row opens a workspace that renders SwarmHost with N
  // tabs — so the swarm's contenders never appear as N disconnected rows.
  const swarmsById = useSwarmStore((s) => s.swarms);
  const pendingItems = useMemo(() => {
    const seen = new Set<string>();
    const items: AgentRun[] = [];
    for (const r of pendingDraftRuns) {
      if (r.swarmId && swarmsById[r.swarmId]) {
        if (swarmsById[r.swarmId].status === "abandoned") continue;
        if (seen.has(r.swarmId)) continue;
        seen.add(r.swarmId);
      }
      items.push(r);
    }
    return items;
  }, [pendingDraftRuns, swarmsById]);
  const setSelected = (n: number) => {
    setCreating(false);
    setSelectedPendingId(null);
    useUiStore.getState().setFocusedPr("drafts", n);
  };
  const startCreating = () => {
    setCreating(true);
    setSelectedPendingId(null);
  };
  const selectPending = (id: string) => {
    setCreating(false);
    setSelectedPendingId(id);
  };
  const [sort, setSort] = useState<SortKey>("updated");
  const stacked = stackedPrList(drafts, prStacks, sort);
  const selectedPending = selectedPendingId
    ? pendingDraftRuns.find((r) => r.id === selectedPendingId) ?? null
    : null;
  const defaultPr = stacked.find((item) => item.pr.number === selected)?.pr ?? stacked[0]?.pr ?? null;
  const visiblePending = selectedPending ?? (!creating && !defaultPr ? pendingDraftRuns[0] ?? null : null);
  const pr = creating || visiblePending ? null : defaultPr;
  const clearPendingSelection = () => setSelectedPendingId(null);
  const newDraftShortcut = formatShortcut(resolveShortcutMap(ctx.global.shortcuts).new_draft);

  useEffect(() => {
    if (!requestedNewDraft) return;
    startCreating();
    useUiStore.getState().clearNewDraftRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedNewDraft?.nonce]);

  useEffect(() => {
    useUiStore.getState().setVisiblePrWorkspace("drafts", pr?.number ?? null);
    return () => useUiStore.getState().setVisiblePrWorkspace("drafts", null);
  }, [pr?.number]);

  return (
    <div className="main split">
      <Sidebar>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="subtle">
            {drafts.length} draft{drafts.length === 1 ? "" : "s"}
            {pendingItems.length > 0 ? ` · ${pendingItems.length} building` : ""}
          </span>
          <div className="row" style={{ gap: 6 }}>
            {drafts.length > 0 && <SortPicker value={sort} onChange={setSort} />}
          </div>
        </div>
        <button
          type="button"
          className={`draft-create-row ${creating ? "active" : ""}`}
          onClick={startCreating}
        >
          <span className="draft-create-main">
            <span className="draft-create-icon">+</span>
            <span>Create draft</span>
          </span>
          <span className="draft-create-hint">{newDraftShortcut}</span>
        </button>
        {drafts.length === 0 && pendingItems.length === 0 && <p className="subtle">No draft PRs.</p>}
        {pendingItems.map((run) => (
          <PendingDraftCard
            key={run.swarmId ? `swarm-group-${run.swarmId}:${run.id}` : run.id}
            run={run}
            swarm={run.swarmId ? swarmsById[run.swarmId] : undefined}
            selected={!creating && visiblePending?.id === run.id}
            onClick={() => selectPending(run.id)}
          />
        ))}
        {stacked.map((item) => {
          const p = item.pr;
          return (
            <PrStackCard
              key={p.number}
              item={item}
              selected={!creating && pr?.number === p.number}
              onClick={() => setSelected(p.number)}
            >
              <h4>
                #{p.number} {p.title}
              </h4>
              <div className="meta">
                <RunningAgentsChip prNumber={p.number} />
                <Badge color="gray">draft</Badge>
                <CiBadge checks={checks[p.number] ?? []} />
                <ApprovalsBadge prNumber={p.number} />
                <span>{p.headRef}</span>
                <span>
                  +{p.additions} −{p.deletions}
                </span>
                <Badge color="gray" title={`updated ${p.updatedAt}`}>
                  {age(p.updatedAt)}
                </Badge>
              </div>
            </PrStackCard>
          );
        })}
      </Sidebar>
      <div className="content">
        {creating ? (
          <NewDraftWorkspace
            onStarted={(id) => {
              setCreating(false);
              setSelectedPendingId(id);
            }}
            onCreated={(n) => {
              setCreating(false);
              setSelectedPendingId(null);
              useUiStore.getState().setFocusedPr("drafts", n);
            }}
          />
        ) : visiblePending ? (
          <PendingDraftWorkspace run={visiblePending} onCleared={clearPendingSelection} />
        ) : pr ? (
          <PrWorkspace key={pr.number} pr={pr} variant="draft" />
        ) : (
          <div className="main">
            <EmptyState
              title="No drafts"
              loading={loading}
              action={
                <button className="primary empty-primary-action" onClick={startCreating}>
                  + Draft
                </button>
              }
            >
              Your draft pull requests appear here — a workspace for iterating before anyone is asked to review.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingDraftCard({
  run,
  swarm,
  selected,
  onClick,
}: {
  run: AgentRun;
  swarm?: Swarm;
  selected: boolean;
  onClick: () => void;
}) {
  const active = isActiveDraftRun(run);
  const status = pendingDraftStatus(run);
  if (swarm) {
    // One row per swarm — title from the swarm's trigger prompt, with an N-model
    // badge. Click opens a workspace that mounts the tabbed SwarmHost.
    const swarmStatus =
      swarm.status === "running" ? { label: "under construction", color: "blue" as const }
      : swarm.status === "resolved" ? { label: "resolved", color: "green" as const }
      : { label: "abandoned", color: "gray" as const };
    const title = swarmPromptTitle(swarm);
    return (
      <div
        className={`card selectable pending-draft-card ${selected ? "selected" : ""} ${active ? "active" : ""}`}
        onClick={onClick}
      >
        <h4>{title}</h4>
        <div className="meta">
          <Badge color={swarmStatus.color}>{swarmStatus.label}</Badge>
          <Badge color="gray">swarm · {swarm.contenders.length} models</Badge>
          <Badge color="gray" title={`started ${new Date(swarm.startedAt).toLocaleString()}`}>
            {age(new Date(swarm.startedAt).toISOString())}
          </Badge>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`card selectable pending-draft-card ${selected ? "selected" : ""} ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <h4>{pendingDraftTitle(run)}</h4>
      <div className="meta">
        <Badge color={status.color}>{status.label}</Badge>
        <Badge color="gray">new draft</Badge>
        {run.draftCreate?.branch && <span>{run.draftCreate.branch}</span>}
        {run.draftCreate?.baseBranch && <span>from {run.draftCreate.baseBranch}</span>}
        <Badge color="gray" title={`started ${new Date(run.startedAt).toLocaleString()}`}>
          {age(new Date(run.startedAt).toISOString())}
        </Badge>
      </div>
    </div>
  );
}

/** Short title for a swarm: prefer the user's instruction prompt (matches
 *  PendingDraftCard's standalone title derivation). */
function swarmPromptTitle(swarm: Swarm): string {
  const t = swarm.trigger.prompt.trim();
  const firstLine = t.split("\n").find((l) => l.trim())?.trim() ?? "";
  return compactTitle(firstLine || t.slice(0, 80)) || "New draft PR";
}

function PendingDraftWorkspace({ run, onCleared }: { run: AgentRun; onCleared: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const active = isActiveDraftRun(run);
  const status = pendingDraftStatus(run);
  const canDeleteArtifacts = run.prNumber == null && run.status !== "done";
  // If this run is a swarm contender, mount the tabbed SwarmHost — its N
  // contender cards collapse into one comparison surface (Q4 unaffected: the
  // standalone run path below is unchanged otherwise).
  const swarm = useSwarmStore((s) => (run.swarmId ? s.swarms[run.swarmId] : undefined));

  const dismiss = () => {
    if (run.draftCreate) {
      useAgentStore.getState().update(run.id, {
        draftCreate: { ...run.draftCreate, dismissed: true },
      });
    } else {
      useAgentStore.getState().remove(run.id);
    }
    onCleared();
  };

  const deleteArtifacts = async () => {
    setDeleting(true);
    setError("");
    try {
      await deleteDraftCreateArtifacts(run);
      onCleared();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="workspace pending-draft-workspace">
      <div className="ws-main pr-shell">
        <header className="pr-hero pending-draft-hero">
          <div className="pr-hero-id">
            <h2>{swarm ? swarmPromptTitle(swarm) : pendingDraftTitle(run)}</h2>
            <div className="row pr-hero-meta">
              {swarm ? (
                <>
                  <Badge color={swarm.status === "running" ? "blue" : swarm.status === "resolved" ? "green" : "gray"}>
                    {swarm.status === "running" ? "under construction" : swarm.status === "resolved" ? "resolved" : "abandoned"}
                  </Badge>
                  <Badge color="gray">swarm · {swarm.contenders.length} models</Badge>
                </>
              ) : (
                <>
                  <Badge color={status.color}>{status.label}</Badge>
                  <Badge color="gray">new draft</Badge>
                  {run.draftCreate?.branch && <span className="subtle">{run.draftCreate.branch}</span>}
                </>
              )}
            </div>
          </div>
          <div className={`pending-draft-agent ${active ? "active" : ""}`}>
            {swarm ? (
              <SwarmHost swarm={swarm} />
            ) : (
              <AgentCard run={run} defaultOpen />
            )}
          </div>
          {!active && (
            <div className="row pending-draft-actions">
              {canDeleteArtifacts && (
                confirmDelete ? (
                  <>
                    <button className="small danger" disabled={deleting} onClick={() => void deleteArtifacts()}>
                      {deleting ? <Spinner /> : null} Confirm delete
                    </button>
                    <button className="small" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="small danger" onClick={() => setConfirmDelete(true)}>
                    Delete worktree
                  </button>
                )
              )}
              <button className="small" disabled={deleting} onClick={dismiss}>
                Dismiss
              </button>
              {(error || run.draftCreate?.cleanupError) && (
                <span style={{ color: "var(--red)" }}>{error || run.draftCreate?.cleanupError}</span>
              )}
            </div>
          )}
        </header>
      </div>
    </div>
  );
}

function isActiveDraftRun(run: AgentRun): boolean {
  return run.status === "running" || run.status === "starting";
}

function pendingDraftStatus(run: AgentRun): {
  label: string;
  color: "gray" | "green" | "red" | "yellow" | "blue" | "purple";
} {
  if (run.status === "running" || run.status === "starting") return { label: "under construction", color: "blue" };
  if (run.status === "error") return { label: "needs attention", color: "red" };
  if (run.status === "killed") return { label: "stopped", color: "gray" };
  if (run.status === "done") return { label: "no PR created", color: "yellow" };
  return { label: run.status, color: "gray" };
}

function pendingDraftTitle(run: AgentRun): string {
  if (run.prTitle && run.prTitle !== "New draft PR") return run.prTitle;
  if (run.sessionTitle) return run.sessionTitle;
  const task = /The user wants a brand-new GitHub draft pull request created from this prompt:\s*<<<\s*([\s\S]*?)\s*>>>/
    .exec(run.prompt)?.[1]
    ?.trim();
  return task ? compactTitle(task) : "New draft PR";
}

function compactTitle(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 74 ? `${compact.slice(0, 71)}...` : compact;
}
