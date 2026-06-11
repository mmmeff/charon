import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useAgentStore, useUiStore } from "../lib/store";
import type { PrSummary, Severity } from "../types";
import { AsciiField } from "./AsciiField";

/**
 * Report when the workspace's PR title scrolls out of view so the topstrip
 * can show a breadcrumb (`/ #1234 title`) that jumps back to the top.
 */
export function useScrolledPrTitle(
  mainRef: RefObject<HTMLDivElement | null>,
  pr: PrSummary
): void {
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const update = () => {
      const past = el.scrollTop > 64;
      const ui = useUiStore.getState();
      const cur = ui.scrolledPrTitle;
      if (past && (cur?.number !== pr.number || cur?.title !== pr.title)) {
        ui.setScrolledPrTitle({ number: pr.number, title: pr.title });
      } else if (!past && cur) {
        ui.setScrolledPrTitle(null);
      }
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      el.removeEventListener("scroll", update);
      useUiStore.getState().setScrolledPrTitle(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, pr.title]);
}

/** Live indicator: how many agents are currently executing against a PR. */
export function RunningAgentsChip({ prNumber }: { prNumber: number }) {
  const count = useAgentStore(
    (s) =>
      s.order.filter((id) => {
        const r = s.runs[id];
        return r && r.prNumber === prNumber && (r.status === "running" || r.status === "starting");
      }).length
  );
  if (count === 0) return null;
  return (
    <span className="badge green agents-live" title={`${count} agent${count > 1 ? "s" : ""} working on this PR — see Activity Feed`}>
      <span className="livedot" />
      {count} agent{count > 1 ? "s" : ""}
    </span>
  );
}

/** Empty-state block: ASCII flow-field texture + tracked uppercase title. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <AsciiField height={96} opacity={0.4} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

/**
 * Re-render ticker for relative timestamps ("synced 5s ago", elapsed
 * counters). Pass 0 to disable the timer (e.g. for finished agents).
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!intervalMs) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Badge({
  color,
  children,
  title,
}: {
  color: "gray" | "green" | "red" | "yellow" | "blue" | "purple";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge ${color}`} title={title}>
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const color =
    severity === "blocker" ? "red" : severity === "major" ? "yellow" : severity === "minor" ? "blue" : "gray";
  return <Badge color={color}>{severity}</Badge>;
}

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const color = confidence >= 80 ? "green" : confidence >= 50 ? "yellow" : "red";
  return (
    <Badge color={color} title="How confident the agent is that this finding is real">
      {confidence}% conf
    </Badge>
  );
}

export function CiBadge({ checks }: { checks: { conclusion: string | null; status: string }[] }) {
  if (checks.length === 0) return <Badge color="gray">no checks</Badge>;
  if (checks.some((c) => c.conclusion === "failure" || c.conclusion === "error"))
    return <Badge color="red">CI failing</Badge>;
  if (checks.some((c) => !c.conclusion)) return <Badge color="yellow">CI running</Badge>;
  if (checks.every((c) => c.conclusion === "success" || c.conclusion === "skipped" || c.conclusion === "neutral"))
    return <Badge color="green">CI green</Badge>;
  return <Badge color="yellow">CI mixed</Badge>;
}

export function MergeBadge({ state }: { state: string }) {
  if (state === "dirty") return <Badge color="red">conflicts</Badge>;
  if (state === "behind") return <Badge color="yellow">behind base</Badge>;
  if (state === "clean") return <Badge color="green">mergeable</Badge>;
  if (state === "blocked") return <Badge color="yellow">blocked</Badge>;
  return <Badge color="gray">{state || "unknown"}</Badge>;
}

export function Spinner() {
  return <span className="spin" />;
}

export function timeAgo(ts: number | string): string {
  return `${age(ts)} ago`;
}

/** Compact age: "40s", "12m", "3h", "5d". */
export function age(ts: number | string): string {
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

// ---------------------------------------------------------------------------
// PR list sorting
// ---------------------------------------------------------------------------

export type SortKey = "updated" | "oldest" | "number" | "size";

export function sortPrs(prs: PrSummary[], key: SortKey): PrSummary[] {
  const list = [...prs];
  switch (key) {
    case "updated":
      return list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    case "oldest":
      return list.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    case "number":
      return list.sort((a, b) => b.number - a.number);
    case "size":
      return list.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
  }
}

export function SortPicker({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      title="Sort order"
      style={{ fontSize: 12, padding: "3px 6px" }}
    >
      <option value="updated">recently updated</option>
      <option value="oldest">least recently updated</option>
      <option value="number">newest (PR #)</option>
      <option value="size">largest diff</option>
    </select>
  );
}
