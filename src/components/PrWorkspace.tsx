import { useEffect, useRef, useState } from "react";
import { eventDef } from "../lib/defaults";
import { findLineByText, parseUnifiedDiff } from "../lib/diff";
import { resolveHandler, usePrData } from "../lib/events";
import { runFixFlow } from "../lib/flows";
import { interpolate, prVars } from "../lib/template";
import { useAgentStore, useRepoStore } from "../lib/store";
import type { FileDiff, PrSummary } from "../types";
import { timeAgo, useScrolledPrTitle } from "../lib/ui";
import { Badge, CiBadge, MergeBadge, Spinner } from "./common";
import { ChecksPanel } from "./ChecksPanel";
import { Composer, RunResults } from "./Composer";
import { DiffViewer, type DiffAnchor } from "./DiffViewer";
import { FindingCard, FindingsStrip } from "./Findings";
import { groupCommentThreads } from "../lib/threads";
import { DiffCommentThread, PrActivityPanel, PrDescription, PrLabels, PrTitle } from "./PrMeta";
import { ProposalCard } from "./ProposalCard";
import { SubmitForReview } from "./SubmitForReview";
import { useFlow } from "./flow";

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
  const mainRef = useRef<HTMLDivElement>(null);
  useScrolledPrTitle(mainRef, pr);

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

  // review-comment threads (bug-bots and humans) anchored onto the diff,
  // each with inline reply
  const threads = groupCommentThreads(comments);
  const threadInfos = usePrData((s) => s.threads[pr.number] ?? []);
  const findings = useRepoStore((s) => s.findings).filter(
    (f) => f.prNumber === pr.number && f.status !== "dismissed"
  );
  const anchors: DiffAnchor[] = [
    ...threads.map(
      ({ root, replies }): DiffAnchor => ({
        path: root.path!,
        line: root.line!,
        side: root.side ?? "RIGHT",
        tone: "github",
        resolved: threadInfos.find((t) => t.commentIds.includes(root.id))?.isResolved ?? false,
        node: <DiffCommentThread pr={pr} root={root} replies={replies} />,
      })
    ),
    // local-only self-review findings, inline next to the code they're about
    ...findings.map(
      (f): DiffAnchor => ({
        path: f.path,
        line: f.line,
        side: f.side,
        tone: "local",
        resolved: f.status !== "open",
        node: <FindingCard finding={f} pr={pr} />,
      })
    ),
  ];

  return (
    <div className="workspace">
      <div className="ws-main" ref={mainRef}>
      <PrTitle pr={pr} />
      <div className="row" style={{ marginBottom: 12 }}>
        {pr.draft && <Badge color="gray">draft</Badge>}
        {variant === "draft" && pr.draft && <SubmitForReview pr={pr} />}
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

      <ChecksPanel pr={pr} />

      {(pr.mergeableState === "dirty" || activeRuns.length > 0) && (
        <div className="card" style={{ padding: "8px 14px" }}>
          <div className="row">
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

