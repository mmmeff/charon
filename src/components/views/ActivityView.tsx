import { useState, useMemo } from "react";
import type { AgentRun } from "../../types";
import { isActiveAgentStatus as isActive, isVisibleAgentRun } from "../../lib/agent-runs";
import { useAgentStore } from "../../lib/store";
import { AgentCard } from "../AgentCard";
import { EmptyState } from "../common";

type Filter = "all" | "active" | "done" | "failed";

const groupOrder = ["today", "yesterday", "thisWeek", "later"] as const;
type GroupKey = (typeof groupOrder)[number];

const LATER_PAGE = 10;

function todayMs(): number {
  const d = new Date();
  return d.setHours(0, 0, 0, 0);
}

/** Start (00:00) of the Monday containing `date` (ISO week). */
function startOfWeekMs(date: Date): number {
  const day = date.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(date);
  monday.setDate(monday.getDate() + diffToMonday);
  return monday.setHours(0, 0, 0, 0);
}

function groupForRun(run: AgentRun): GroupKey {
  if (run.endedAt == null) return "later";
  const t = todayMs();
  const dayAgo = t - 86_400_000;
  const weekStart = startOfWeekMs(new Date());
  if (run.endedAt >= t) return "today";
  if (run.endedAt >= dayAgo) return "yesterday";
  if (run.endedAt >= weekStart) return "thisWeek";
  return "later";
}

const groupLabels: Record<GroupKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  later: "Later",
};

/** Activity Feed: every agent run — its PR, relation, prompt, and live stream. */
export function ActivityView() {
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);
  const clearHistory = useAgentStore((s) => s.clearHistory);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const all = order.map((id) => runs[id]).filter((r) => r && isVisibleAgentRun(r));
  const activeAgents = all.filter((r) => isActive(r.status));
  const finishedAgents = all.filter((r) => !isActive(r.status));
  const activeCount = activeAgents.length;
  const finishedCount = finishedAgents.length;

  const filteredFinished = useMemo(() => {
    return finishedAgents.filter((r) => {
      if (filter === "active") return false;
      if (filter === "done") return r.status === "done";
      if (filter === "failed") return r.status === "error" || r.status === "killed";
      return true; // "all"
    });
  }, [finishedAgents, filter]);

  const groups = useMemo(() => {
    const buckets: Record<GroupKey, AgentRun[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      later: [],
    };
    for (const r of filteredFinished) buckets[groupForRun(r)].push(r);
    return groupOrder
      .map((key): [GroupKey, AgentRun[]] => [key, buckets[key]])
      .filter(([, runs]) => runs.length > 0);
  }, [filteredFinished]);

  const hasActive = activeCount > 0;
  const hasGroups = groups.length > 0;

  return (
    <div className="main agent-feed">
      {/* ---- filter + clear toolbar ---- */}
      <div className="row" style={{ marginBottom: 14 }}>
        {(["all", "active", "done", "failed"] as Filter[]).map((f) => (
          <button key={f} className={`small ${filter === f ? "primary" : ""}`} onClick={() => setFilter(f)}>
            {f}
            {f === "active" && activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {finishedCount > 0 &&
          (confirmClear ? (
            <>
              <button
                className="small danger"
                onClick={() => {
                  clearHistory();
                  setConfirmClear(false);
                }}
              >
                Clear {finishedCount} finished run{finishedCount > 1 ? "s" : ""}
              </button>
              <button className="small" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="small"
              title="Remove finished runs from the feed — active agents stay"
              onClick={() => setConfirmClear(true)}
            >
              Clear history
            </button>
          ))}
      </div>

      {/* ---- active agents grid ---- */}
      {hasActive && (
        <div className="agent-grid">
          {activeAgents.map((r) => (
            <AgentCard key={r.id} run={r} defaultOpen={true} />
          ))}
        </div>
      )}

      {/* ---- completed runs grouped by completion date ---- */}
      {hasGroups && (
        <div className="agent-completed-section">
          <div className="agent-completed-heading">
            Completed runs
            <span className="agent-completed-count">{filteredFinished.length}</span>
          </div>
          {groups.map(([key, runs]) => (
            <CollapsibleGroup
              key={key}
              label={groupLabels[key]}
              runs={runs}
              defaultOpen={key === "today"}
              lazy={key === "later"}
            />
          ))}
        </div>
      )}

      {/* ---- empty state when nothing matches ---- */}
      {!hasActive && !hasGroups && (
        <EmptyState title={`All agents idle${filter !== "all" ? ` (${filter})` : ""}`}>
          Agent runs appear here live: which PR they're on, what they were asked to do, and a stream of
          their work as it happens.
        </EmptyState>
      )}
    </div>
  );
}

/** A completed-runs date bucket. The header collapses/expands the contents.
 *  `lazy` (the "Later" bucket) renders only `LATER_PAGE` at a time with a
 *  "Load more" affordance; otherwise the whole bucket renders when open. */
function CollapsibleGroup({
  label,
  runs,
  defaultOpen,
  lazy = false,
}: {
  label: string;
  runs: AgentRun[];
  defaultOpen: boolean;
  lazy?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [page, setPage] = useState(0);
  const shown = lazy ? runs.slice(0, page) : runs;
  const hasMore = lazy && runs.length > page;

  const onToggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next && lazy && page === 0) setPage(LATER_PAGE);
      return next;
    });
  };

  return (
    <div className={`agent-group ${open ? "open" : ""}`}>
      <button
        className="agent-group-heading agent-group-toggle"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? "Collapse runs" : `Expand ${runs.length} run${runs.length > 1 ? "s" : ""}`}
      >
        {label}
        <span className="agent-completed-count">{runs.length}</span>
      </button>
      {open && (
        <>
          {shown.map((r) => (
            <AgentCard key={r.id} run={r} defaultOpen={false} />
          ))}
          {hasMore && (
            <div className="agent-group-more">
              <button className="small" onClick={() => setPage((c) => c + LATER_PAGE)}>
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
