import { useState } from "react";
import { usePrData } from "../lib/events";
import type { PrSummary } from "../types";
import { Badge, age } from "./common";
import { Markdown } from "./Markdown";

export function PrLabels({ pr }: { pr: PrSummary }) {
  if (pr.labels.length === 0) return null;
  return (
    <>
      {pr.labels.map((l) => (
        <Badge key={l} color="blue">
          {l}
        </Badge>
      ))}
    </>
  );
}

/** PR description, rendered as markdown; collapsible when long. */
export function PrDescription({ pr }: { pr: PrSummary }) {
  const long = (pr.body ?? "").length > 700;
  const [open, setOpen] = useState(!long);
  if (!pr.body?.trim()) return null;
  return (
    <div className="card">
      <Markdown text={open ? pr.body : pr.body.slice(0, 700) + "\n\n…"} />
      {long && (
        <button className="link small" onClick={() => setOpen(!open)}>
          {open ? "show less" : "show full description"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ActivityItem {
  at: number;
  author: string;
  isBot: boolean;
  label: string;
  labelColor: "gray" | "green" | "red" | "yellow" | "blue" | "purple";
  body: string;
  url: string;
}

/**
 * Right-hand column: the PR's GitHub-derived activity — reviews, comments,
 * and inline diff comments, newest first.
 */
export function PrActivityPanel({ pr }: { pr: PrSummary }) {
  const comments = usePrData((s) => s.comments[pr.number] ?? []);
  const reviews = usePrData((s) => s.reviews[pr.number] ?? []);

  const items: ActivityItem[] = [
    ...comments.map((c): ActivityItem => ({
      at: Date.parse(c.createdAt) || 0,
      author: c.author,
      isBot: c.authorIsBot,
      label: c.kind === "issue" ? "commented" : `on ${shortPath(c.path)}${c.line ? `:${c.line}` : ""}`,
      labelColor: c.kind === "issue" ? "gray" : "purple",
      body: c.body,
      url: c.url,
    })),
    ...reviews
      .filter((r) => r.state && r.state !== "PENDING")
      .map((r): ActivityItem => ({
        at: Date.parse(r.submittedAt) || 0,
        author: r.author,
        isBot: r.authorIsBot,
        label: reviewLabel(r.state),
        labelColor:
          r.state === "APPROVED" ? "green" : r.state === "CHANGES_REQUESTED" ? "red" : "gray",
        body: r.body,
        url: "",
      })),
  ].sort((a, b) => b.at - a.at);

  return (
    <div className="ws-activity">
      <div className="subtle" style={{ marginBottom: 8, fontWeight: 600 }}>
        Activity ({items.length})
      </div>
      {items.length === 0 && <div className="subtle">No comments or reviews yet.</div>}
      {items.map((it, i) => (
        <div key={i} className="act-item">
          <div className="row" style={{ marginBottom: 3 }}>
            <strong>{it.author}</strong>
            {it.isBot && <Badge color="purple">bot</Badge>}
            <Badge color={it.labelColor}>{it.label}</Badge>
            <span className="subtle">{age(it.at)}</span>
            {it.url && (
              <a href={it.url} target="_blank" rel="noreferrer" className="subtle">
                ↗
              </a>
            )}
          </div>
          {it.body?.trim() && <Markdown text={it.body} className="compact" />}
        </div>
      ))}
    </div>
  );
}

const shortPath = (p?: string) => {
  if (!p) return "diff";
  const parts = p.split("/");
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
};

const reviewLabel = (state: string) =>
  state === "APPROVED"
    ? "approved"
    : state === "CHANGES_REQUESTED"
      ? "requested changes"
      : state === "DISMISSED"
        ? "review dismissed"
        : "reviewed";
