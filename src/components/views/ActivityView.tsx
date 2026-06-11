import { useState } from "react";
import { useAgentStore } from "../../lib/store";
import { AgentCard } from "../AgentCard";

type Filter = "all" | "active" | "done" | "failed";

/** Activity Feed: every agent run — its PR, relation, prompt, and live stream. */
export function ActivityView() {
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);
  const [filter, setFilter] = useState<Filter>("all");

  const all = order.map((id) => runs[id]).filter(Boolean);
  const filtered = all.filter((r) => {
    if (filter === "active") return r.status === "running" || r.status === "starting";
    if (filter === "done") return r.status === "done";
    if (filter === "failed") return r.status === "error" || r.status === "killed";
    return true;
  });
  const activeCount = all.filter((r) => r.status === "running" || r.status === "starting").length;

  return (
    <div className="main">
      <div className="row" style={{ marginBottom: 14 }}>
        {(["all", "active", "done", "failed"] as Filter[]).map((f) => (
          <button key={f} className={`small ${filter === f ? "primary" : ""}`} onClick={() => setFilter(f)}>
            {f}
            {f === "active" && activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="empty">
          <h3>No agent activity{filter !== "all" ? ` (${filter})` : ""}</h3>
          <p>
            Agent runs appear here live: which PR they work on, in what relation (review, CI fix, conflict
            fix, draft edit, response…), their prompt, and a stream of what they're doing.
          </p>
        </div>
      )}
      {filtered.map((r) => (
        <AgentCard key={r.id} run={r} defaultOpen={r.status === "running" || r.status === "starting"} />
      ))}
    </div>
  );
}
