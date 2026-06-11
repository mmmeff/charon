import { useEffect, useRef, useState } from "react";
import { findLineByText, parseUnifiedDiff } from "../lib/diff";
import { usePrData } from "../lib/events";
import { useRepoStore } from "../lib/store";
import type { FileDiff, PrSummary } from "../types";
import { timeAgo, useScrolledPrTitle } from "../lib/ui";
import { Badge, BranchBadge, CiBadge, LoadingField, Section } from "./common";
import { ApprovalsMenu, ReviewersMenu } from "./ReviewerMenus";
import { ChecksPanel } from "./ChecksPanel";
import { Composer, RunResults } from "./Composer";
import { DiffViewer, type DiffAnchor } from "./DiffViewer";
import { FindingCard, FindingsStrip } from "./Findings";
import { groupCommentThreads } from "../lib/threads";
import { DiffCommentThread, PrActivityPanel, PrDescription, PrLabels, PrTitle } from "./PrMeta";
import { ProposalCard } from "./ProposalCard";
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
  const proposals = useRepoStore((s) => s.proposals);
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [diffErr, setDiffErr] = useState("");
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

  const commentIds = new Set(comments.map((c) => c.id));
  const prProposals = proposals.filter(
    (p) =>
      p.prNumber === pr.number &&
      p.status !== "dismissed" &&
      // replies render inline inside their thread, not up top (unless the
      // target comment vanished — then this list is the fallback)
      !(p.type === "comment_reply" && p.status === "pending" && commentIds.has(p.inReplyToCommentId))
  );

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

      {/* ── the PR itself: title, state, description ── */}
      <Section>
        <PrTitle pr={pr} />
        <div className="row" style={{ marginBottom: 12 }}>
          {pr.draft && <Badge color="gray">draft</Badge>}
          {pr.autoMerge && (
            <Badge color="green" title="Auto-merge is armed — merges once all requirements pass">
              ⏻ automerge
            </Badge>
          )}
          {variant === "babysit" && (
            <>
              <ApprovalsMenu pr={pr} />
              <ReviewersMenu pr={pr} />
            </>
          )}
          <BranchBadge head={pr.headRef} base={pr.baseRef} />
          <PrLabels pr={pr} />
          <span className="subtle">
            +{pr.additions} −{pr.deletions} · updated {timeAgo(pr.updatedAt)}
          </span>
        </div>
        <PrDescription pr={pr} />
      </Section>

      {/* ── what needs attention: CI + pending approvals (branch ops moved
            to the BranchOps block atop the activity panel) ── */}
      {(checks.some((c) => c.conclusion !== "skipped") || prProposals.length > 0) && (
        <Section label="Status">
          <ChecksPanel pr={pr} />
          {prProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </Section>
      )}

      {/* ── drive agents: ask / change / review + their output ── */}
      <Section label="Console">
        <Composer
          pr={pr}
          // drafts lead with Review (the pre-flight ritual); open PRs lead with Ask
          modes={variant === "draft" ? ["review", "edit", "ask"] : ["ask", "edit", "review"]}
          reviewKind="self"
        />
        <FindingsStrip pr={pr} />
        <RunResults pr={pr} onReloadDiff={() => void loadDiff()} />
      </Section>

      <Section label="Diff">
      {diffErr && <p style={{ color: "var(--red)" }}>{diffErr}</p>}
      {!files && !diffErr && <LoadingField label="loading diff…" />}
      {files && (
        <DiffViewer
          files={files}
          selectable
          anchors={anchors}
          viewedKey={variant === "draft" ? `prc-viewed-${ctx.repo}-${pr.number}` : undefined}
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
      </Section>
      </div>
      <PrActivityPanel pr={pr} />
    </div>
  );
}

