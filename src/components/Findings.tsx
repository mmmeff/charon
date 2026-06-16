import { useEffect, useState } from "react";
import { applyFindings } from "../lib/flows";
import { useAgentStore, useRepoStore } from "../lib/store";
import type { PrSummary, ReviewFinding } from "../types";
import { AgentCard } from "./AgentCard";
import { AgentLaunchForm } from "./AgentLaunchForm";
import { timeAgo } from "../lib/ui";
import { Badge, ConfidenceBadge, SeverityBadge, Spinner } from "./common";
import { Markdown } from "./Markdown";
import { useFlow } from "./flow";

/** Launch form for applying findings (guidance + model). */
function ApplyForm({
  pr,
  findings,
  onClose,
  label,
}: {
  pr: PrSummary;
  findings: ReviewFinding[];
  onClose: () => void;
  label: string;
}) {
  const { ctx } = useFlow();
  return (
    <AgentLaunchForm
      label={label}
      flowKind="feedback_fix"
      onRun={(model, guidance) => applyFindings(ctx, pr, findings, model, guidance)}
      onClose={onClose}
    />
  );
}

/**
 * Slim status strip for a PR's local self-review findings: counts, apply-all,
 * clear, and the collapsible review summary. Only renders when findings
 * exist; the review itself is launched from the composer.
 */
export function FindingsStrip({ pr }: { pr: PrSummary }) {
  const findings = useRepoStore((s) => s.findings).filter((f) => f.prNumber === pr.number);
  const summary = useRepoStore((s) => s.reviewSummaries[pr.number]);
  const clearFindings = useRepoStore((s) => s.clearFindings);
  const [showSummary, setShowSummary] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);

  if (findings.length === 0) return null;
  const open = findings.filter((f) => f.status === "open");
  const applying = findings.filter((f) => f.status === "applying").length;
  const applied = findings.filter((f) => f.status === "applied").length;

  return (
    <div className="card" style={{ padding: "8px 14px" }}>
      <div className="row">
        <Badge color={open.length > 0 ? "yellow" : "green"}>
          {open.length} finding{open.length === 1 ? "" : "s"} open · {applied} applied
        </Badge>
        {applying > 0 && (
          <Badge color="blue">
            {applying} applying <Spinner />
          </Badge>
        )}
        {open.length > 0 && (
          <button className="small" onClick={() => setApplyOpen(!applyOpen)}>
            Apply all open
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
      </div>
      {applyOpen && (
        <ApplyForm
          pr={pr}
          findings={open}
          label={`Apply ${open.length} finding${open.length === 1 ? "" : "s"}`}
          onClose={() => setApplyOpen(false)}
        />
      )}
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
  const updateFinding = useRepoStore((s) => s.updateFinding);
  const run = useAgentStore((s) => (finding.agentRunId ? s.runs[finding.agentRunId] : undefined));
  const [applyOpen, setApplyOpen] = useState(false);
  const stale = finding.headSha !== pr.headSha;
  const runStatus = run?.status;

  useEffect(() => {
    if (finding.status !== "applying") return;
    if (runStatus === "error" || runStatus === "killed") {
      void updateFinding(finding.key, { status: "open" });
    }
  }, [finding.key, finding.status, runStatus, updateFinding]);

  return (
    <div>
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

        <Markdown text={finding.body} className="compact" />
        {finding.suggestion && (
          <pre className="suggestion-block">
            <code>{finding.suggestion}</code>
          </pre>
        )}

        <div className="row" style={{ marginTop: 8 }}>
          {finding.status === "open" && (
            <>
              <button
                className={`small ${applyOpen ? "" : "primary"}`}
                onClick={() => setApplyOpen(!applyOpen)}
              >
                Apply
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
              onClick={() => void updateFinding(finding.key, { status: "open", agentRunId: undefined })}
            >
              reset to open
            </button>
          )}
          {finding.status === "applied" && (
            <button
              className="link small"
              onClick={() => void updateFinding(finding.key, { status: "open", agentRunId: undefined })}
            >
              reopen
            </button>
          )}
        </div>
        {applyOpen && finding.status === "open" && (
          <ApplyForm
            pr={pr}
            findings={[finding]}
            label="Run apply"
            onClose={() => setApplyOpen(false)}
          />
        )}
      </div>
      {run && <AgentCard run={run} embedded defaultOpen streamContext="inline-comment" />}
    </div>
  );
}
