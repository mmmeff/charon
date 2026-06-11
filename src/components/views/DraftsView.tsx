import { useState } from "react";
import { usePrData } from "../../lib/events";
import { Badge, SortPicker, age, sortPrs, type SortKey } from "../common";
import { PrWorkspace } from "../PrWorkspace";

/**
 * Drafts: the user's own draft PRs. Line-scoped feedback triggers an agent
 * immediately (no approval gate — it's the user's own draft); questions and
 * general feedback run read-only.
 */
export function DraftsView() {
  const drafts = usePrData((s) => s.myDrafts);
  const [selected, setSelected] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("updated");
  const sorted = sortPrs(drafts, sort);
  const pr = sorted.find((p) => p.number === selected) ?? sorted[0] ?? null;

  if (drafts.length === 0) {
    return (
      <div className="main">
        <div className="empty">
          <h3>No draft PRs</h3>
          <p>Your draft pull requests appear here as a workspace for iterating on the diff.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="main split">
      <div className="sidebar">
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="subtle">{drafts.length} draft{drafts.length > 1 ? "s" : ""}</span>
          <SortPicker value={sort} onChange={setSort} />
        </div>
        {sorted.map((p) => (
          <div
            key={p.number}
            className={`card selectable ${pr?.number === p.number ? "selected" : ""}`}
            onClick={() => setSelected(p.number)}
          >
            <h4>
              #{p.number} {p.title}
            </h4>
            <div className="meta">
              <Badge color="gray">draft</Badge>
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
      </div>
      <div className="content">{pr && <PrWorkspace key={pr.number} pr={pr} variant="draft" />}</div>
    </div>
  );
}
