import type { ReactNode } from "react";
import type { Severity } from "../types";

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
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return `${Math.floor(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
