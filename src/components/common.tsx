import { useState, type ReactNode } from "react";
import { isActiveAgentStatus, isVisibleAgentRun } from "../lib/agent-runs";
import { usePrData } from "../lib/events";
import { useAgentStore } from "../lib/store";
import { useFlow } from "./flow";
import type { SortKey } from "../lib/ui";
import type { Severity } from "../types";
import { AsciiField } from "./AsciiField";
import { AsciiMoon } from "./AsciiMoon";

// NOTE: keep this file component-only. Hooks and plain functions belong in
// src/lib/ui.ts — mixed exports here break Vite Fast Refresh in dev.

/** Live indicator: how many agents are currently executing against a PR. */
export function RunningAgentsChip({ prNumber }: { prNumber: number }) {
  const count = useAgentStore(
    (s) =>
      s.order.filter((id) => {
        const r = s.runs[id];
        return r && isVisibleAgentRun(r) && r.prNumber === prNumber && isActiveAgentStatus(r.status);
      }).length
  );
  if (count === 0) return null;
  return (
    <span className="badge green agents-live" title={`${count} agent${count > 1 ? "s" : ""} working on this PR — see the Agents tab`}>
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

/** head → base branch badge; each branch name click-copies itself. */
export function BranchBadge({ head, base }: { head: string; base: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (name: string) => {
    navigator.clipboard?.writeText(name).catch(() => {
      // webview fallback
      const ta = document.createElement("textarea");
      ta.value = name;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    });
    setCopied(name);
    setTimeout(() => setCopied(null), 1200);
  };
  return (
    <span className="badge gray branch-badge">
      <button className="branch-name" title={`Copy "${head}"`} onClick={() => copy(head)}>
        {copied === head ? "✓ copied" : head}
      </button>
      <span>→</span>
      <button className="branch-name" title={`Copy "${base}"`} onClick={() => copy(base)}>
        {copied === base ? "✓ copied" : base}
      </button>
    </span>
  );
}

/** "n/m approvals" badge for PR list cards — green once requirements met. */
export function ApprovalsBadge({ prNumber }: { prNumber: number }) {
  const { ctx } = useFlow();
  const reviews = usePrData((s) => s.reviews[prNumber] ?? []);
  const n = new Set(reviews.filter((r) => r.state === "APPROVED").map((r) => r.author)).size;
  const req = ctx.config.requiredApprovals;
  return (
    <Badge color={n >= req ? "green" : "gray"} title={`${n} of ${req} required approvals`}>
      {n}/{req} approvals
    </Badge>
  );
}

/** Empty-state block: the orbiting ASCII Charon + tracked uppercase title. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <AsciiMoon height={190} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
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

/** Ambient thinking/routing field for agent-owned work surfaces. */
export function ThinkingField({
  compact = false,
  ariaLabel = "Thinking",
  lines = [],
}: {
  compact?: boolean;
  ariaLabel?: string;
  /** Live terminal rows; the cursor attaches to the newest row. */
  lines?: string[];
}) {
  const terminalLines = lines.length ? lines.slice(-4) : [""];
  return (
    <div
      className={`thinking-field ${compact ? "compact" : ""} ${lines.length ? "live" : ""}`}
      aria-label={ariaLabel}
      aria-live={lines.length ? "polite" : undefined}
      aria-atomic="false"
      role={lines.length ? "status" : undefined}
    >
      <div className="thinking-track">
        <span className="thinking-node active" />
        <span className="thinking-node" />
        <span className="thinking-node" />
        <span className="thinking-pulse p1" />
        <span className="thinking-pulse p2" />
        <span className="thinking-pulse p3" />
      </div>
      <div className="thinking-terminal">
        {terminalLines.map((line, i) => {
          const current = i === terminalLines.length - 1;
          return (
            <div key={`${line}-${i}`} className={`thinking-terminal-row ${current ? "current" : ""}`}>
              <span className="prompt-mark">›</span>
              <span className="thinking-terminal-command">
                {line && <span className="thinking-terminal-text">{line}</span>}
                {current && <span className="thinking-cursor" />}
              </span>
            </div>
          );
        })}
      </div>
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
