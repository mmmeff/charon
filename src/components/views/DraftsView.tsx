import { useState } from "react";
import { deleteDraftCreateArtifacts } from "../../lib/flows";
import { usePrData } from "../../lib/events";
import { useAgentStore, useUiStore } from "../../lib/store";
import { age, sortPrs, type SortKey } from "../../lib/ui";
import type { AgentRun } from "../../types";
import { AgentCard } from "../AgentCard";
import { ApprovalsBadge, Badge, CiBadge, EmptyState, RunningAgentsChip, SortPicker, Spinner } from "../common";
import { useFlow } from "../flow";
import { Sidebar } from "../Panels";
import { PrWorkspace } from "../PrWorkspace";
import { NewDraftWorkspace } from "../NewDraftWorkspace";

/**
 * Drafts: the user's own draft PRs. Line-scoped feedback triggers an agent
 * immediately (no approval gate — it's the user's own draft); questions and
 * general feedback run read-only.
 */
export function DraftsView() {
  const { ctx } = useFlow();
  const drafts = usePrData((s) => s.myDrafts);
  const checks = usePrData((s) => s.checks);
  const selected = useUiStore((s) => s.focusedPr["drafts"] ?? null);
  const [creating, setCreating] = useState(false);
  const [selectedPendingId, setSelectedPendingId] = useState<string | null>(null);
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);
  const pendingDraftRuns = order
    .map((id) => runs[id])
    .filter(
      (r): r is AgentRun =>
        !!r &&
        r.kind === "draft_create" &&
        r.repo === ctx.repo &&
        r.prNumber == null &&
        !r.draftCreate?.dismissed
    );
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
  const sorted = sortPrs(drafts, sort);
  const selectedPending = selectedPendingId
    ? pendingDraftRuns.find((r) => r.id === selectedPendingId) ?? null
    : null;
  const defaultPr = sorted.find((p) => p.number === selected) ?? sorted[0] ?? null;
  const visiblePending = selectedPending ?? (!creating && !defaultPr ? pendingDraftRuns[0] ?? null : null);
  const pr = creating || visiblePending ? null : defaultPr;
  const clearPendingSelection = () => setSelectedPendingId(null);

  return (
    <div className="main split">
      <Sidebar>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="subtle">
            {drafts.length} draft{drafts.length === 1 ? "" : "s"}
            {pendingDraftRuns.length > 0 ? ` · ${pendingDraftRuns.length} building` : ""}
          </span>
          <div className="row" style={{ gap: 6 }}>
            {drafts.length > 0 && <SortPicker value={sort} onChange={setSort} />}
          </div>
        </div>
        <button
          type="button"
          className={`card selectable draft-create-row ${creating ? "selected" : ""}`}
          onClick={startCreating}
        >
          <h4>+ Draft</h4>
          <div className="meta">
            <span>Start a new prompt-to-PR draft</span>
          </div>
        </button>
        {drafts.length === 0 && pendingDraftRuns.length === 0 && <p className="subtle">No draft PRs.</p>}
        {pendingDraftRuns.map((run) => (
          <PendingDraftCard
            key={run.id}
            run={run}
            selected={!creating && visiblePending?.id === run.id}
            onClick={() => selectPending(run.id)}
          />
        ))}
        {sorted.map((p) => (
          <div
            key={p.number}
            className={`card selectable ${!creating && pr?.number === p.number ? "selected" : ""}`}
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
          </div>
        ))}
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
  selected,
  onClick,
}: {
  run: AgentRun;
  selected: boolean;
  onClick: () => void;
}) {
  const active = isActiveDraftRun(run);
  const status = pendingDraftStatus(run);
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

function PendingDraftWorkspace({ run, onCleared }: { run: AgentRun; onCleared: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const active = isActiveDraftRun(run);
  const status = pendingDraftStatus(run);
  const canDeleteArtifacts = run.prNumber == null && run.status !== "done";

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
            <h2>{pendingDraftTitle(run)}</h2>
            <div className="row pr-hero-meta">
              <Badge color={status.color}>{status.label}</Badge>
              <Badge color="gray">new draft</Badge>
              {run.draftCreate?.branch && <span className="subtle">{run.draftCreate.branch}</span>}
            </div>
          </div>
          <div className={`pending-draft-agent ${active ? "active" : ""}`}>
            <AgentCard run={run} defaultOpen />
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
