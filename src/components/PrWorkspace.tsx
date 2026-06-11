import { useEffect, useState } from "react";
import { eventDef } from "../lib/defaults";
import { findLineByText, parseUnifiedDiff } from "../lib/diff";
import { resolveHandler, usePrData } from "../lib/events";
import { runFixFlow } from "../lib/flows";
import { interpolate, prVars } from "../lib/template";
import { useAgentStore, useRepoStore } from "../lib/store";
import type { CommentInfo, FileDiff, PrSummary } from "../types";
import { Badge, CiBadge, MergeBadge, Spinner, age, timeAgo } from "./common";
import { Composer, RunResults } from "./Composer";
import { DiffViewer, type DiffAnchor } from "./DiffViewer";
import { FindingCard, FindingsStrip } from "./Findings";
import { Markdown } from "./Markdown";
import { PrActivityPanel, PrDescription, PrLabels } from "./PrMeta";
import { ProposalCard } from "./ProposalCard";
import { useFlow } from "./RepoApp";

/**
 * Shared PR workspace for the user's own PRs (Drafts and Open). All agent
 * flows are driven through one composer (Ask / Change / Review) — whole-diff
 * at the top, line-scoped via GitHub-style selection on the diff. Existing
 * review comments and local findings anchor inline on the diff.
 */
export function PrWorkspace({ pr, variant }: { pr: PrSummary; variant: "draft" | "babysit" }) {
  const { ctx } = useFlow();
  const checks = usePrData((s) => s.checks[pr.number] ?? []);
  const comments = usePrData((s) => s.comments[pr.number] ?? []);
  const reviews = usePrData((s) => s.reviews[pr.number] ?? []);
  const proposals = useRepoStore((s) => s.proposals);
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [diffErr, setDiffErr] = useState("");
  const [error, setError] = useState("");
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);

  const loadDiff = async () => {
    setDiffErr("");
    try {
      setFiles(parseUnifiedDiff(await ctx.gh.getPullDiff(ctx.repo, pr.number)));
    } catch (e) {
      setDiffErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void loadDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, pr.headSha]);

  // Content-based re-anchoring: when the branch moved since a finding's
  // review ran, relocate it by its recorded line text in the fresh diff.
  useEffect(() => {
    if (!files) return;
    const store = useRepoStore.getState();
    for (const f of store.findings) {
      if (f.prNumber !== pr.number || f.status !== "open" || f.headSha === pr.headSha) continue;
      if (!f.anchorText) continue;
      const hit = findLineByText(files, f.path, f.side, f.anchorText, f.line);
      if (hit) {
        void store.updateFinding(f.key, { line: hit.line, side: hit.side, headSha: pr.headSha });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, pr.headSha]);

  const activeRuns = order
    .map((id) => runs[id])
    .filter((r) => r && r.prNumber === pr.number && (r.status === "running" || r.status === "starting"));
  const prProposals = proposals.filter((p) => p.prNumber === pr.number && p.status !== "dismissed");

  const failing = checks.filter((c) => c.conclusion === "failure" || c.conclusion === "error");
  const approvals = new Set(reviews.filter((r) => r.state === "APPROVED").map((r) => r.author)).size;

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

  // review comments (bug-bots and humans) anchored onto the diff
  const inlineComments = comments.filter((c) => c.kind === "review_comment" && c.path && c.line);
  const findings = useRepoStore((s) => s.findings).filter(
    (f) => f.prNumber === pr.number && f.status !== "dismissed"
  );
  const anchors: DiffAnchor[] = [
    ...inlineComments.map(
      (c): DiffAnchor => ({
        path: c.path!,
        line: c.line!,
        side: c.side ?? "RIGHT",
        tone: "github",
        node: <ExistingComment comment={c} />,
      })
    ),
    // local-only self-review findings, inline next to the code they're about
    ...findings.map(
      (f): DiffAnchor => ({
        path: f.path,
        line: f.line,
        side: f.side,
        tone: "local",
        node: <FindingCard finding={f} pr={pr} />,
      })
    ),
  ];

  return (
    <div className="workspace">
      <div className="ws-main">
      <h2 className="viewtitle">
        #{pr.number} {pr.title}{" "}
        <a href={pr.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
          open on GitHub ↗
        </a>
      </h2>
      <div className="row" style={{ marginBottom: 12 }}>
        {pr.draft && <Badge color="gray">draft</Badge>}
        {variant === "babysit" && (
          <>
            <CiBadge checks={checks} />
            <MergeBadge state={pr.mergeableState} />
            <Badge color={approvals >= ctx.config.requiredApprovals ? "green" : "gray"}>
              {approvals}/{ctx.config.requiredApprovals} approvals
            </Badge>
          </>
        )}
        <Badge color="gray">
          {pr.headRef} → {pr.baseRef}
        </Badge>
        <PrLabels pr={pr} />
        <span className="subtle">
          +{pr.additions} −{pr.deletions} · updated {timeAgo(pr.updatedAt)}
        </span>
      </div>

      <PrDescription pr={pr} />

      {variant === "babysit" && (failing.length > 0 || pr.mergeableState === "dirty" || activeRuns.length > 0) && (
        <div className="card" style={{ padding: "8px 14px" }}>
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
            {failing.length > 0 && (
              <span className="subtle">failing: {failing.map((c) => c.name).join(", ")}</span>
            )}
            {activeRuns.length > 0 && (
              <span className="subtle">
                <Spinner /> {activeRuns.length} agent{activeRuns.length > 1 ? "s" : ""} working — see Activity Feed
              </span>
            )}
            {error && <span style={{ color: "var(--red)" }}>{error}</span>}
          </div>
        </div>
      )}

      {prProposals.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {prProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      )}

      <Composer pr={pr} modes={["ask", "edit", "review"]} reviewKind="self" />
      <FindingsStrip pr={pr} />
      <RunResults pr={pr} onReloadDiff={() => void loadDiff()} />

      {diffErr && <p style={{ color: "var(--red)" }}>{diffErr}</p>}
      {!files && !diffErr && (
        <p className="subtle">
          <Spinner /> loading diff…
        </p>
      )}
      {files && (
        <DiffViewer
          files={files}
          selectable
          anchors={anchors}
          renderCommentForm={(sel, close) => (
            <Composer
              pr={pr}
              modes={["edit", "comment", "review", "ask"]}
              reviewKind="self"
              compact
              selection={sel}
              onClose={close}
            />
          )}
        />
      )}
      </div>
      <PrActivityPanel pr={pr} />
    </div>
  );
}

/** A review comment that already exists on GitHub, shown in place on the diff. */
function ExistingComment({ comment }: { comment: CommentInfo }) {
  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="origin-chip github" title="This comment is on GitHub — everyone can see it">
          GitHub
        </span>
        <strong>{comment.author}</strong>
        {comment.authorIsBot && <Badge color="purple">bot</Badge>}
        <span className="subtle">{age(comment.createdAt)}</span>
        <a href={comment.url} target="_blank" rel="noreferrer" className="subtle">
          view ↗
        </a>
      </div>
      <Markdown text={comment.body} className="compact" />
    </div>
  );
}
