import { useState } from "react";
import { eventDef } from "../../lib/defaults";
import { resolveHandler, usePrData } from "../../lib/events";
import { runFixFlow } from "../../lib/flows";
import { interpolate, prVars } from "../../lib/template";
import { useAgentStore, useRepoStore } from "../../lib/store";
import type { PrSummary } from "../../types";
import { Badge, CiBadge, MergeBadge, Spinner, timeAgo } from "../common";
import { ProposalCard } from "../ProposalCard";
import { useFlow } from "../RepoApp";

/**
 * Babysit: the user's open (non-draft) PRs under active watch. The event
 * system reacts automatically; this view shows state, pending proposals, and
 * manual triggers for the same flows.
 */
export function BabysitView() {
  const myOpen = usePrData((s) => s.myOpen);
  const proposals = useRepoStore((s) => s.proposals);
  const eventLog = useRepoStore((s) => s.eventLog);

  const orphanProposals = proposals.filter(
    (p) => p.status === "pending" && !myOpen.some((pr) => pr.number === p.prNumber)
  );

  return (
    <div className="main">
      {myOpen.length === 0 && (
        <div className="empty">
          <h3>No open PRs to babysit</h3>
          <p>Your open (non-draft) pull requests are watched here: CI, conflicts, and incoming feedback.</p>
        </div>
      )}
      {myOpen.map((pr) => (
        <BabysitCard key={pr.number} pr={pr} />
      ))}

      {orphanProposals.length > 0 && (
        <>
          <hr />
          <h3>Other pending proposals</h3>
          {orphanProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </>
      )}

      {eventLog.length > 0 && (
        <>
          <hr />
          <h3>Recent events</h3>
          {eventLog.slice(0, 30).map((e, i) => (
            <div key={i} className="row" style={{ padding: "3px 0", fontSize: 12.5 }}>
              <span className="subtle">{timeAgo(e.firedAt)}</span>
              <Badge color={e.prClass === "mine" ? "blue" : "purple"}>
                {eventDef(e.id)?.label ?? e.id}
              </Badge>
              <span>
                #{e.prNumber} {e.prTitle}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function BabysitCard({ pr }: { pr: PrSummary }) {
  const { ctx } = useFlow();
  const checks = usePrData((s) => s.checks[pr.number] ?? []);
  const comments = usePrData((s) => s.comments[pr.number] ?? []);
  const reviews = usePrData((s) => s.reviews[pr.number] ?? []);
  const proposals = useRepoStore((s) => s.proposals);
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);
  const [error, setError] = useState("");

  const prProposals = proposals.filter((p) => p.prNumber === pr.number && p.status !== "dismissed");
  const activeRuns = order
    .map((id) => runs[id])
    .filter((r) => r && r.prNumber === pr.number && (r.status === "running" || r.status === "starting"));

  const failing = checks.filter((c) => c.conclusion === "failure" || c.conclusion === "error");
  const approvals = new Set(
    reviews.filter((r) => r.state === "APPROVED").map((r) => r.author)
  ).size;

  const manualFix = async (eventId: string, kind: "ci_fix" | "conflict_fix") => {
    setError("");
    try {
      const handler = resolveHandler(ctx.config.events, eventId);
      const extra: Record<string, string> =
        kind === "ci_fix" && failing.length > 0
          ? { "check-name": failing[0].name, "check-url": failing[0].url }
          : {};
      const prompt = interpolate(handler.prompt, { ...prVars(pr), repo: ctx.repo, ...extra });
      await runFixFlow(ctx, pr, prompt, eventDef(eventId)?.label ?? eventId, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card">
      <div className="row between">
        <h4>
          #{pr.number}{" "}
          <a href={pr.url} target="_blank" rel="noreferrer">
            {pr.title}
          </a>
        </h4>
        <span className="subtle">updated {timeAgo(pr.updatedAt)}</span>
      </div>
      <div className="row" style={{ margin: "6px 0" }}>
        <CiBadge checks={checks} />
        <MergeBadge state={pr.mergeableState} />
        <Badge color={approvals >= ctx.config.requiredApprovals ? "green" : "gray"}>
          {approvals}/{ctx.config.requiredApprovals} approvals
        </Badge>
        <Badge color="gray">{comments.length} comments</Badge>
        <span className="subtle">
          {pr.headRef} → {pr.baseRef}
        </span>
      </div>

      {failing.length > 0 && (
        <div className="subtle" style={{ marginBottom: 6 }}>
          failing: {failing.map((c) => c.name).join(", ")}
        </div>
      )}

      <div className="row">
        {failing.length > 0 && (
          <button className="small" onClick={() => void manualFix("ci_failed", "ci_fix")}>
            Fix CI now
          </button>
        )}
        {pr.mergeableState === "dirty" && (
          <button className="small" onClick={() => void manualFix("merge_conflict_detected", "conflict_fix")}>
            Resolve conflicts now
          </button>
        )}
        {activeRuns.length > 0 && (
          <span className="subtle">
            <Spinner /> {activeRuns.length} agent{activeRuns.length > 1 ? "s" : ""} working — see Activity Feed
          </span>
        )}
        {error && <span style={{ color: "var(--red)" }}>{error}</span>}
      </div>

      {prProposals.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {prProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      )}
    </div>
  );
}
