import { useState } from "react";
import { applyFindings } from "../lib/flows";
import { useRepoStore, useUiStore } from "../lib/store";
import type { PrSummary, ReviewFinding } from "../types";
import { Badge, ConfidenceBadge, SeverityBadge, Spinner, timeAgo } from "./common";
import { Markdown } from "./Markdown";
import { useFlow } from "./RepoApp";

/**
 * Slim status strip for a PR's local self-review findings: counts, apply-all,
 * clear, and the collapsible review summary. Only renders when findings
 * exist; the review itself is launched from the composer.
 */
export function FindingsStrip({ pr }: { pr: PrSummary }) {
  const { ctx } = useFlow();
  const findings = useRepoStore((s) => s.findings).filter((f) => f.prNumber === pr.number);
  const summary = useRepoStore((s) => s.reviewSummaries[pr.number]);
  const clearFindings = useRepoStore((s) => s.clearFindings);
  const model = useUiStore((s) => s.composerModel);
  const [error, setError] = useState("");
  const [showSummary, setShowSummary] = useState(false);

  if (findings.length === 0) return null;
  const open = findings.filter((f) => f.status === "open");
  const applying = findings.some((f) => f.status === "applying");
  const applied = findings.filter((f) => f.status === "applied").length;

  const applyAll = async () => {
    setError("");
    try {
      await applyFindings(ctx, pr, open, model || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card" style={{ padding: "8px 14px" }}>
      <div className="row">
        <Badge color={open.length > 0 ? "yellow" : "green"}>
          {open.length} finding{open.length === 1 ? "" : "s"} open · {applied} applied
        </Badge>
        {open.length > 0 && (
          <button className="small" disabled={applying} onClick={() => void applyAll()}>
            {applying ? <Spinner /> : null} Apply all open
          </button>
        )}
        {summary && (
          <button className="link small" onClick={() => setShowSummary(!showSummary)}>
            {showSummary ? "▾" : "▸"} summary ({timeAgo(summary.at)})
          </button>
        )}
        <button className="link small" onClick={() => void clearFindings(pr.number)}>
          clear all
        </button>
        {error && <span style={{ color: "var(--red)" }}>{error}</span>}
      </div>
      {showSummary && summary && (
        <div style={{ marginTop: 6 }}>
          <Markdown text={summary.text} className="compact" />
        </div>
      )}
    </div>
  );
}

/** One local finding, anchored inline on the diff. */
export function FindingCard({ finding, pr }: { finding: ReviewFinding; pr: PrSummary }) {
  const { ctx } = useFlow();
  const updateFinding = useRepoStore((s) => s.updateFinding);
  const anyApplying = useRepoStore((s) =>
    s.findings.some((f) => f.prNumber === pr.number && f.status === "applying")
  );
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const stale = finding.headSha !== pr.headSha;

  const apply = async () => {
    setError("");
    try {
      await applyFindings(ctx, pr, [finding]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ opacity: finding.status === "applied" ? 0.55 : 1 }}>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="origin-chip local" title="Only in this app — not on GitHub">
          Local only
        </span>
        <SeverityBadge severity={finding.severity} />
        <ConfidenceBadge confidence={finding.confidence} />
        {finding.status === "applied" && <Badge color="green">applied</Badge>}
        {finding.status === "applying" && (
          <Badge color="blue">
            applying… <Spinner />
          </Badge>
        )}
        {stale && finding.status === "open" && (
          <Badge color="gray" title="The branch moved since this review ran">
            stale
          </Badge>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            rows={3}
            value={finding.body}
            onChange={(e) => void updateFinding(finding.key, { body: e.target.value })}
          />
          <div className="subtle" style={{ margin: "6px 0 2px" }}>
            Suggested change (optional):
          </div>
          <textarea
            rows={4}
            value={finding.suggestion ?? ""}
            onChange={(e) =>
              void updateFinding(finding.key, { suggestion: e.target.value || undefined })
            }
          />
        </>
      ) : (
        <>
          <Markdown text={finding.body} className="compact" />
          {finding.suggestion && (
            <pre className="suggestion-block">
              <code>{finding.suggestion}</code>
            </pre>
          )}
        </>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        {finding.status === "open" && (
          <>
            <button className="small primary" disabled={anyApplying} onClick={() => void apply()}>
              Apply
            </button>
            <button className="small" onClick={() => setEditing(!editing)}>
              {editing ? "Done" : "Edit"}
            </button>
            <button
              className="small danger"
              onClick={() => void updateFinding(finding.key, { status: "dismissed" })}
            >
              Dismiss
            </button>
          </>
        )}
        {finding.status === "applying" && (
          <button
            className="link small"
            title="Reset if the apply agent failed"
            onClick={() => void updateFinding(finding.key, { status: "open" })}
          >
            reset to open
          </button>
        )}
        {finding.status === "applied" && (
          <button
            className="link small"
            onClick={() => void updateFinding(finding.key, { status: "open" })}
          >
            reopen
          </button>
        )}
        {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}
