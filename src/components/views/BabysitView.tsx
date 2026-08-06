import { useEffect, useState } from "react";
import { usePrData } from "../../lib/events";
import { stackedPrList } from "../../lib/pr-stacks";
import { useRepoStore, useUiStore } from "../../lib/store";
import { age, type SortKey } from "../../lib/ui";
import { FadeIn } from "../amicro/fade-in";
import { Stagger, StaggerItem } from "../amicro/stagger";
import { ApprovalsBadge, Badge, CiBadge, EmptyState, MergeBadge, RunningAgentsChip, SortPicker } from "../common";
import { useFlow } from "../flow";
import { Sidebar } from "../Panels";
import { PrStackCard } from "../PrStackList";
import { PrWorkspace } from "../PrWorkspace";

/**
 * Babysit: the user's open (non-draft) PRs under active watch. The event
 * system reacts automatically; selecting a PR opens the same workspace as the
 * Drafts view — diff with line-scoped Ask/Change runs, existing review
 * comments anchored in place, pending proposals, and manual fix triggers.
 */
export function BabysitView() {
  const { prStacks } = useFlow();
  const myOpen = usePrData((s) => s.myOpen);
  const checks = usePrData((s) => s.checks);
  const lastPollAt = usePrData((s) => s.lastPollAt);
  const loading = lastPollAt === null;
  const proposals = useRepoStore((s) => s.proposals);
  const selected = useUiStore((s) => s.focusedPr["open"] ?? null);
  const setSelected = (n: number) => useUiStore.getState().setFocusedPr("open", n);
  const [sort, setSort] = useState<SortKey>("updated");
  const stacked = stackedPrList(myOpen, prStacks, sort);
  const pr = stacked.find((item) => item.pr.number === selected)?.pr ?? stacked[0]?.pr ?? null;

  useEffect(() => {
    useUiStore.getState().setVisiblePrWorkspace("open", pr?.number ?? null);
    return () => useUiStore.getState().setVisiblePrWorkspace("open", null);
  }, [pr?.number]);

  if (myOpen.length === 0) {
    return (
      <div className="main">
        <EmptyState title="No open PRs" loading={loading}>
          Your open pull requests are watched here — CI, merge state, and incoming feedback, with agents on call.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="main split">
      <Sidebar>
        <div className="row between pr-list-toolbar" style={{ marginBottom: 8 }}>
          <span className="subtle">
            {myOpen.length} open PR{myOpen.length > 1 ? "s" : ""}
          </span>
          <SortPicker value={sort} onChange={setSort} />
        </div>
        <Stagger>
        {stacked.map((item) => {
          const p = item.pr;
          const pending = proposals.filter(
            (x) => x.prNumber === p.number && x.status === "pending"
          ).length;
          return (
            <StaggerItem key={p.number}>
            <PrStackCard
              item={item}
              selected={pr?.number === p.number}
              onClick={() => setSelected(p.number)}
            >
              <h4 title={`#${p.number} ${p.title}`}>
                #{p.number} {p.title}
              </h4>
              <div className="meta pr-card-meta">
                <div className="pr-card-status">
                  <RunningAgentsChip prNumber={p.number} variant="inline" />
                  <CiBadge checks={checks[p.number] ?? []} variant="inline" />
                  <MergeBadge state={p.mergeableState} variant="inline" />
                  <ApprovalsBadge prNumber={p.number} variant="inline" />
                  {pending > 0 && <Badge color="yellow" variant="inline">{pending} pending</Badge>}
                </div>
                <div className="pr-card-footer">
                  <span className="pr-card-change">
                    +{p.additions} −{p.deletions}
                  </span>
                  <span className="pr-card-age" title={`updated ${p.updatedAt}`}>
                    {age(p.updatedAt)}
                  </span>
                </div>
              </div>
            </PrStackCard>
            </StaggerItem>
          );
        })}
        </Stagger>

      </Sidebar>
      <FadeIn className="content" key={pr?.number ?? "none"} duration={0.35}>
        {pr && <PrWorkspace key={pr.number} pr={pr} variant="babysit" />}
      </FadeIn>
    </div>
  );
}
