import { type ReactNode } from "react";
import { useAgentStore } from "../lib/store";
import type { SortKey } from "../lib/ui";
import type { Severity } from "../types";
import { AsciiField } from "./AsciiField";

// NOTE: keep this file component-only. Hooks and plain functions belong in
// src/lib/ui.ts — mixed exports here break Vite Fast Refresh in dev.

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

/**
 * Workspace section: a logical grouping with breathing room and an optional
 * schematic-style micro-label rule above it.
 */
export function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="ws-section">
      {label && (
        <div className="ws-section-label">
          <span>{label}</span>
        </div>
      )}
      {children}
    </section>
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

/** Slim animated ASCII strip for loading/waiting states. */
export function LoadingField({
  label,
  height = 56,
  color,
}: {
  label: string;
  height?: number;
  color?: string;
}) {
  return (
    <div className="loading-field">
      <AsciiField height={height} opacity={0.35} speed={1.6} color={color} />
      <span className="subtle">
        <Spinner /> {label}
      </span>
    </div>
  );
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
