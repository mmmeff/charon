import { useState } from "react";
import { isActiveAgentStatus, isVisibleAgentRun } from "../../lib/agent-runs";
import { useAgentStore } from "../../lib/store";
import { AgentCard } from "../AgentCard";
import { EmptyState } from "../common";

type Filter = "all" | "active" | "done" | "failed";

/** Activity Feed: every agent run — its PR, relation, prompt, and live stream. */
export function ActivityView() {
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);
  const clearHistory = useAgentStore((s) => s.clearHistory);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const all = order.map((id) => runs[id]).filter((r) => r && isVisibleAgentRun(r));
  const filtered = all.filter((r) => {
    if (filter === "active") return isActiveAgentStatus(r.status);
    if (filter === "done") return r.status === "done";
    if (filter === "failed") return r.status === "error" || r.status === "killed";
    return true;
  });
  const activeCount = all.filter((r) => isActiveAgentStatus(r.status)).length;
  const finishedCount = all.length - activeCount;

  return (
    <div className="main">
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
      {filtered.length === 0 && (
        <EmptyState title={`All agents idle${filter !== "all" ? ` (${filter})` : ""}`}>
          Agent runs appear here live: which PR they're on, what they were asked to do, and a stream of
          their work as it happens.
        </EmptyState>
      )}
      {filtered.map((r) => (
        <AgentCard key={r.id} run={r} defaultOpen={r.status === "running" || r.status === "starting"} />
      ))}
    </div>
  );
}
