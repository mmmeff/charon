import { useEffect, useRef, useState } from "react";
import { findLineByText, parseUnifiedDiff } from "../lib/diff";
import { usePrData } from "../lib/events";
import { useRepoStore, useUiStore } from "../lib/store";
import type { FileDiff, PrSummary } from "../types";
import { timeAgo, usePastHero, useScrollMemory, useScrolledPrTitle } from "../lib/ui";
import { Badge, BranchBadge, LoadingField, Section } from "./common";
import { ApprovalsMenu, ReviewersMenu } from "./ReviewerMenus";
import { ChecksPanel } from "./ChecksPanel";
import { Composer, RunResults, type ComposerMode } from "./Composer";
import { DiffViewer, type DiffAnchor } from "./DiffViewer";
import { FindingCard, FindingsStrip } from "./Findings";
import { groupCommentThreads } from "../lib/threads";
import { DiffCommentThread, PrActivityPanel, PrDescription, PrHeroRail, PrLabels, PrTitle } from "./PrMeta";
import { ProposalCard } from "./ProposalCard";
import { PrHeroSidePanel } from "./PrStackDrawer";
import { useFlow } from "./flow";

/**
 * Shared PR workspace for the user's own PRs (Drafts and Open). All agent
 * flows are driven through one composer (Ask / Change / Review) — whole-diff
 * at the top, line-scoped via GitHub-style selection on the diff. Existing
 * review comments and local findings anchor inline on the diff.
 */
export function PrWorkspace({ pr, variant }: { pr: PrSummary; variant: "draft" | "babysit" }) {
  const { ctx } = useFlow();
  const checks = usePrData((s) => s.checks[pr.number]) ?? [];
  const comments = usePrData((s) => s.comments[pr.number]) ?? [];
  const proposals = useRepoStore((s) => s.proposals);
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [diffErr, setDiffErr] = useState("");
  const mainRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  useScrolledPrTitle(mainRef, pr);
  useScrollMemory(mainRef, `pr:${ctx.repo}:${pr.number}`);
  const condensed = usePastHero(mainRef, heroRef);

  // Stack control room: jump to a sibling PR in-app, switching tabs if it
  // lives in another view, or fall back to opening it on GitHub.
  const myDrafts = usePrData((s) => s.myDrafts);
  const myOpen = usePrData((s) => s.myOpen);
  const reviewQueue = usePrData((s) => s.reviewQueue);
  const openPulls = usePrData((s) => s.openPulls);
  const jumpToStackPr = (n: number) => {
    if (myDrafts.some((p) => p.number === n)) {
      useUiStore.getState().requestTab("drafts");
      useUiStore.getState().setFocusedPr("drafts", n);
    } else if (myOpen.some((p) => p.number === n)) {
      useUiStore.getState().requestTab("open");
      useUiStore.getState().setFocusedPr("open", n);
    } else if (reviewQueue.some((p) => p.number === n)) {
      useUiStore.getState().requestTab("review");
      useUiStore.getState().setFocusedPr("review", n);
    } else {
      const target = openPulls.find((p) => p.number === n);
      if (target) window.open(target.url, "_blank", "noreferrer");
    }
  };

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
  const threadInfos = usePrData((s) => s.threads[pr.number]) ?? [];
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

  // drafts lead with Review (the pre-flight ritual); open PRs lead with Ask
  const consoleModes: ComposerMode[] =
    variant === "draft" ? ["review", "edit", "ask"] : ["ask", "edit", "review"];
  const selectedRangeModes: ComposerMode[] =
    pr.author === ctx.gh.login ? ["comment", "edit", "review", "ask"] : ["comment", "review", "ask"];
  const diffTitle = (fileCount: number | null) => (
    <>
      <span className="pr-diff-eyebrow">Diff</span>
      {fileCount !== null && (
        <span className="pr-diff-count">
          {fileCount} file{fileCount === 1 ? "" : "s"}
        </span>
      )}
      <span className="pr-diff-stat">
        <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span>
      </span>
    </>
  );

  return (
    <div className="workspace">
      <div className="ws-main pr-shell" ref={mainRef}>
        <PrHeroRail
          pr={pr}
          checks={checks}
          show={condensed}
          onTop={() => mainRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          composerModes={consoleModes}
          reviewKind="self"
        />

        {/* ── hero: the textured header well — identity, description, CI, agent ── */}
        <header className="pr-hero" ref={heroRef}>
          {/* the PR itself: title + state */}
          <div className="pr-hero-id">
            <PrTitle pr={pr} />
            <div className="row pr-hero-meta">
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
          </div>

          <PrHeroSidePanel
            pr={pr}
            onJump={jumpToStackPr}
            ciContent={
              checks.some((c) => c.conclusion !== "skipped") || prProposals.length > 0 ? (
                <>
                  <ChecksPanel pr={pr} />
                  {prProposals.map((p) => (
                    <ProposalCard key={p.id} proposal={p} />
                  ))}
                </>
              ) : undefined
            }
          >
            <PrDescription pr={pr} />
          </PrHeroSidePanel>

          {/* drive agents: ask / change / review + their output */}
          <Section>
            <Composer pr={pr} modes={consoleModes} reviewKind="self" />
            <FindingsStrip pr={pr} />
            <RunResults pr={pr} onReloadDiff={() => void loadDiff()} />
          </Section>
        </header>

        {/* ── the diff: the main "canvas" view below the hero ── */}
        <section className="pr-diff">
          {!files && <div className="pr-diff-head">{diffTitle(null)}</div>}
          {diffErr && <p style={{ color: "var(--red)" }}>{diffErr}</p>}
          {!files && !diffErr && <LoadingField label="loading diff…" />}
          {files && (
            <DiffViewer
              files={files}
              titleBar={diffTitle(files.length)}
              selectable
              anchors={anchors}
              viewedKey={variant === "draft" ? `prc-viewed-${ctx.repo}-${pr.number}` : undefined}
              renderCommentForm={(sel, close) => (
                <Composer
                  pr={pr}
                  modes={selectedRangeModes}
                  reviewKind="self"
                  compact
                  selection={sel}
                  onClose={close}
                />
              )}
            />
          )}
        </section>
      </div>
      <PrActivityPanel pr={pr} />
    </div>
  );
}
