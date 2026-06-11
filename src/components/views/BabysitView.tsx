import { useState } from "react";
import { eventDef } from "../../lib/defaults";
import { usePrData } from "../../lib/events";
import { useRepoStore, useUiStore } from "../../lib/store";
import { Badge, CiBadge, MergeBadge, SortPicker, age, sortPrs, timeAgo, type SortKey } from "../common";
import { Sidebar } from "../Panels";
import { ProposalCard } from "../ProposalCard";
import { PrWorkspace } from "../PrWorkspace";

/**
 * Babysit: the user's open (non-draft) PRs under active watch. The event
 * system reacts automatically; selecting a PR opens the same workspace as the
 * Drafts view — diff with line-scoped Ask/Change runs, existing review
 * comments anchored in place, pending proposals, and manual fix triggers.
 */
export function BabysitView() {
  const myOpen = usePrData((s) => s.myOpen);
  const checks = usePrData((s) => s.checks);
  const proposals = useRepoStore((s) => s.proposals);
  const eventLog = useRepoStore((s) => s.eventLog);
  const selected = useUiStore((s) => s.focusedPr["open"] ?? null);
  const setSelected = (n: number) => useUiStore.getState().setFocusedPr("open", n);
  const [sort, setSort] = useState<SortKey>("updated");
  const sorted = sortPrs(myOpen, sort);
  const pr = sorted.find((p) => p.number === selected) ?? sorted[0] ?? null;

  const orphanProposals = proposals.filter(
    (p) => p.status === "pending" && !myOpen.some((x) => x.number === p.prNumber)
  );

  if (myOpen.length === 0) {
    return (
      <div className="main">
        <div className="empty">
          <h3>No open PRs to babysit</h3>
          <p>Your open (non-draft) pull requests are watched here: CI, conflicts, and incoming feedback.</p>
        </div>
        {orphanProposals.length > 0 && (
          <>
            <h3>Pending proposals</h3>
            {orphanProposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="main split">
      <Sidebar>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="subtle">
            {myOpen.length} open PR{myOpen.length > 1 ? "s" : ""}
          </span>
          <SortPicker value={sort} onChange={setSort} />
        </div>
        {sorted.map((p) => {
          const pending = proposals.filter(
            (x) => x.prNumber === p.number && x.status === "pending"
          ).length;
          return (
            <div
              key={p.number}
              className={`card selectable ${pr?.number === p.number ? "selected" : ""}`}
              onClick={() => setSelected(p.number)}
            >
              <h4>
                #{p.number} {p.title}
              </h4>
              <div className="meta">
                <CiBadge checks={checks[p.number] ?? []} />
                <MergeBadge state={p.mergeableState} />
                <span>
                  +{p.additions} −{p.deletions}
                </span>
                <Badge color="gray" title={`updated ${p.updatedAt}`}>
                  {age(p.updatedAt)}
                </Badge>
                {pending > 0 && <Badge color="yellow">{pending} pending</Badge>}
              </div>
            </div>
          );
        })}

        {eventLog.length > 0 && (
          <>
            <hr />
            <div className="subtle" style={{ marginBottom: 6 }}>
              Recent events
            </div>
            {eventLog.slice(0, 20).map((e, i) => (
              <div key={i} style={{ padding: "3px 0", fontSize: 12 }}>
                <span className="subtle">{timeAgo(e.firedAt)} · </span>
                <Badge color={e.prClass === "mine" ? "blue" : "purple"}>
                  {eventDef(e.id)?.label ?? e.id}
                </Badge>{" "}
                #{e.prNumber}
              </div>
            ))}
          </>
        )}

        {orphanProposals.length > 0 && (
          <>
            <hr />
            <div className="subtle" style={{ marginBottom: 6 }}>
              Proposals for closed/other PRs
            </div>
            {orphanProposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </>
        )}
      </Sidebar>
      <div className="content">{pr && <PrWorkspace key={pr.number} pr={pr} variant="babysit" />}</div>
    </div>
  );
}
