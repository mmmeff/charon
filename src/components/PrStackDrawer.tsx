import { Fragment, type ReactNode } from "react";
import { usePrData } from "../lib/events";
import type { CheckInfo, PrStackEntry, PrStackIndex, PrSummary } from "../types";
import { age } from "../lib/ui";
import { useUiStore } from "../lib/store";
import { useFlow } from "./flow";
import { Badge, CiBadge, MergeBadge } from "./common";
import { useResizablePanel } from "./useResizablePanel";

/**
 * A stack member is one of the open PRs in the repo that shares the current
 * PR's stack root. The index is built from all open pulls (see pr-stacks.ts),
 * so every member has full PrSummary data — closed/merged ancestors fall off
 * the chain (the child re-parents to its surviving base) and simply won't
 * appear here.
 */
interface StackNode {
  pr: PrSummary;
  entry: PrStackEntry;
  depth: number;
  /** sibling index within its parent's children, for tree connector rendering */
  indexInParent: number;
  parentChildrenCount: number;
}

/** Walk the stack tree depth-first from `rootNumber`, emitting flat nodes. */
function walkStack(
  rootNumber: number,
  stackIndex: PrStackIndex,
  prByNumber: Map<number, PrSummary>
): StackNode[] {
  const out: StackNode[] = [];
  const visit = (number: number, depth: number, indexInParent: number, parentChildrenCount: number) => {
    const entry = stackIndex.byNumber[number];
    const pr = prByNumber.get(number);
    if (!entry || !pr) return;
    out.push({ pr, entry, depth, indexInParent, parentChildrenCount });
    const children = [...entry.childPrNumbers];
    children.forEach((c, i) => visit(c, depth + 1, i, children.length));
  };
  visit(rootNumber, 0, 0, 1);
  return out;
}

/** True when `pr` belongs to a stack of more than one open PR — either it has
 *  a stacked parent, or it has other PRs stacked beneath it (the root case).
 *  Note: `entry.stackPrNumbers` is the ancestor chain (root → this PR), so it
 *  is length 1 for the root even when children exist — we can't use it here. */
export function isStackedPr(pr: PrSummary, stackIndex: PrStackIndex): boolean {
  const entry = stackIndex.byNumber[pr.number];
  if (!entry) return false;
  return entry.parentPrNumber !== null || entry.childPrNumbers.length > 0;
}

// ---------------------------------------------------------------------------
// CI status summary — powers the CI tab's status indicator
// ---------------------------------------------------------------------------

export interface CiSummary {
  passed: number;
  running: number;
  failed: number;
  total: number;
}

/** Compact pass/running/fail counts from a check list (skipped jobs excluded). */
export function ciSummary(checks: CheckInfo[]): CiSummary {
  const real = checks.filter((c) => c.conclusion !== "skipped");
  return {
    passed: real.filter((c) => c.conclusion === "success").length,
    running: real.filter((c) => !c.conclusion).length,
    failed: real.filter(
      (c) => c.conclusion === "failure" || c.conclusion === "error"
    ).length,
    total: real.length,
  };
}

type HeroTab = "stack" | "ci";

/**
 * The hero's side panel: a vertical tab strip that's always visible (when any
 * tab is available), with an expandable content area to its left. Houses the
 * Stack control room (stacked PRs) and the CI panel — consolidating what used
 * to be separate hero sections into one situational dashboard.
 *
 * The tab strip persists in the UI store (`heroSideTab`): selecting a tab
 * expands its content alongside; selecting null (or clicking the active tab
 * again) collapses back to just the strip.
 */
export function PrHeroSidePanel({
  pr,
  onJump,
  ciContent,
  children,
}: {
  pr: PrSummary;
  onJump: (prNumber: number) => void;
  /** CI tab body (ChecksPanel + optional proposals); omitted = no CI tab */
  ciContent?: ReactNode;
  /** Description section (or false for bodyless teammate PRs) */
  children: ReactNode;
}) {
  const { prStacks } = useFlow();
  const activeTab = useUiStore((s) => s.heroSideTab);
  const setActiveTab = useUiStore((s) => s.setHeroSideTab);
  const openPulls = usePrData((s) => s.openPulls);
  const checksMap = usePrData((s) => s.checks);
  // right-docked panel: handle on its left edge, drag left = wider.
  // Hook runs unconditionally (before any early returns) per the Rules of Hooks.
  const { width, handle } = useResizablePanel("prc-hero-side-w", 420, 260, 960, "left");

  const entry = prStacks.byNumber[pr.number];
  const prByNumber = new Map(openPulls.map((p) => [p.number, p]));
  const stackNodes = entry ? walkStack(entry.rootPrNumber, prStacks, prByNumber) : [];
  const hasStack = stackNodes.length >= 2;
  const hasCi = ciContent != null && ciContent !== false;
  const prChecks = checksMap[pr.number] ?? [];
  const ci = ciSummary(prChecks);

  const tabs: HeroTab[] = [];
  if (hasStack) tabs.push("stack");
  if (hasCi) tabs.push("ci");

  if (tabs.length === 0) return <Fragment>{children}</Fragment>;

  // resolve the showing tab — if the persisted tab isn't available for this PR,
  // fall back to a sensible default: stack when stacked, else CI.
  const defaultTab: HeroTab | null = hasStack ? "stack" : hasCi ? "ci" : null;
  const showing: HeroTab | null =
    activeTab && tabs.includes(activeTab) ? activeTab : defaultTab;

  const toggle = (tab: HeroTab) =>
    setActiveTab(showing === tab ? null : tab);

  const tabStrip = (
    <div className="hero-side-tabs">
      {hasStack && (
        <button
          className={`hero-tab hero-tab-stack ${showing === "stack" ? "active" : ""}`}
          title="Stack control room"
          onClick={() => toggle("stack")}
        >
          <span className="hero-tab-label">Stack</span>
          <span className="hero-tab-stack-count">{stackNodes.length}</span>
        </button>
      )}
      {hasCi && (
        <button
          className={`hero-tab hero-tab-ci ${showing === "ci" ? "active" : ""}`}
          title="CI checks"
          onClick={() => toggle("ci")}
        >
          <span className="hero-tab-label">Checks</span>
          <CiTabStatus ci={ci} />
        </button>
      )}
    </div>
  );

  if (!showing) {
    // collapsed: tab strip only, hugging the right edge of the description row
    return (
      <div className="pr-hero-desc-row has-side-panel collapsed">
        <div className="pr-hero-desc-main">{children}</div>
        {tabStrip}
      </div>
    );
  }

  // expanded: [description] [content panel + resize handle]
  // The panel itself is [horizontal tab strip on top] [content below]
  const hasDesc = children != null && children !== false;
  return (
    <div className="pr-hero-desc-row has-side-panel expanded">
      {hasDesc && <div className="pr-hero-desc-main">{children}</div>}
      <div
        className="hero-side-panel"
        style={{ flexBasis: width, width: hasDesc ? width : "100%" }}
      >
        {handle}
        {tabStrip}
        <div className="hero-side-content">
          {showing === "stack" && (
            <StackPanelContent
              pr={pr}
              onJump={onJump}
              nodes={stackNodes}
              entry={entry}
              checksMap={checksMap}
            />
          )}
          {showing === "ci" && ciContent}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CI tab status indicator (compact pass / running / fail counts)
// ---------------------------------------------------------------------------

function CiTabStatus({ ci }: { ci: CiSummary }) {
  if (ci.total === 0) return <Badge color="gray">no checks</Badge>;
  return (
    <span className="hero-tab-ci-status">
      {ci.passed > 0 && <span className="ci-pass">✓{ci.passed}</span>}
      {ci.running > 0 && <span className="ci-run">↻{ci.running}</span>}
      {ci.failed > 0 && <span className="ci-fail">✗{ci.failed}</span>}
      {ci.passed === 0 && ci.running === 0 && ci.failed === 0 && (
        <span className="ci-other">{ci.total}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stack tab content (the original stack control room, now a tab body)
// ---------------------------------------------------------------------------

function StackPanelContent({
  pr,
  onJump,
  nodes,
  entry,
  checksMap,
}: {
  pr: PrSummary;
  onJump: (prNumber: number) => void;
  nodes: StackNode[];
  entry: PrStackEntry;
  checksMap: Record<number, CheckInfo[]>;
}) {
  const position = entry.stackPrNumbers.indexOf(pr.number) + 1;
  const mergeableCount = nodes.filter((n) => n.pr.mergeableState === "clean").length;
  const blockedCount = nodes.length - mergeableCount;

  return (
    <Fragment>
      <div className="stack-drawer-head">
        <span className="stack-drawer-title">
          Stack <span className="subtle">· {nodes.length} PRs</span>
        </span>
      </div>

      <div className="stack-drawer-pos">
        <span className="subtle">
          {entry.targetsMain ? "root → leaf" : `#${entry.rootPrNumber} → leaf`}
        </span>
        <span style={{ flex: 1 }} />
        <span className="subtle" title="This PR's position in the stack">
          {position} / {entry.stackPrNumbers.length}
        </span>
      </div>

      <div className="stack-drawer-body">
        {nodes.map((node) => {
          const isCurrent = node.pr.number === pr.number;
          const prChecks = checksMap[node.pr.number] ?? [];
          return (
            <StackRow
              key={node.pr.number}
              node={node}
              current={isCurrent}
              checks={prChecks}
              onJump={onJump}
            />
          );
        })}
      </div>

      <div className="stack-drawer-foot">
        <span className="subtle" title="PRs whose mergeable state is clean">
          {mergeableCount} mergeable
        </span>
        {blockedCount > 0 && (
          <span className="subtle" title="PRs blocked, behind, dirty, or unknown">
            · {blockedCount} blocked
          </span>
        )}
      </div>
    </Fragment>
  );
}

function StackRow({
  node,
  current,
  checks,
  onJump,
}: {
  node: StackNode;
  current: boolean;
  checks: { conclusion: string | null; status: string }[];
  onJump: (prNumber: number) => void;
}) {
  const { pr } = node;
  return (
    <div
      className={`stack-drawer-row ${current ? "current" : ""}`}
      style={{ "--depth": node.depth } as React.CSSProperties}
    >
      <div className="stack-drawer-tree" aria-hidden>
        {Array.from({ length: node.depth }).map((_, i) => (
          <span key={i} className="stack-drawer-rail" />
        ))}
        <span className="stack-drawer-node" />
      </div>

      <button className="stack-drawer-main" onClick={() => onJump(pr.number)}>
        <div className="stack-drawer-id">
          <span className="stack-drawer-num">#{pr.number}</span>
          <span className="stack-drawer-title-text" title={pr.title}>
            {pr.title}
          </span>
          {current && <Badge color="orange">current</Badge>}
        </div>
        <div className="stack-drawer-meta">
          {pr.merged ? (
            <Badge color="purple">merged</Badge>
          ) : (
            <>
              {pr.draft && <Badge color="gray">draft</Badge>}
              <CiBadge checks={checks} />
              <ReviewStatus pr={pr} />
              <MergeBadge state={pr.mergeableState} />
            </>
          )}
        </div>
        <div className="stack-drawer-sub subtle">
          {pr.author}
          {pr.authorIsBot ? " · bot" : ""} · +{pr.additions} −{pr.deletions} · {age(pr.updatedAt)}
        </div>
      </button>

      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="stack-drawer-ext subtle"
        title="Open on GitHub"
      >
        ↗
      </a>
    </div>
  );
}

/** Compact review-state chip derived from the GraphQL review decision. */
function ReviewStatus({ pr }: { pr: PrSummary }) {
  if (pr.merged) return null;
  if (pr.reviewDecision === "APPROVED") return <Badge color="green">approved</Badge>;
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    return <Badge color="red">changes</Badge>;
  if (pr.reviewDecision === "REVIEW_REQUIRED")
    return <Badge color="yellow">review required</Badge>;
  if (pr.requestedFromMe) return <Badge color="purple">waiting on you</Badge>;
  return null;
}
