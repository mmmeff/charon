import { useEffect, useRef, useState } from "react";
import { parseUnifiedDiff } from "../../lib/diff";
import { usePrData } from "../../lib/events";
import { stackedPrList, type PrStackRenderItem } from "../../lib/pr-stacks";
import { useRepoStore, useUiStore } from "../../lib/store";
import type { FileDiff, Proposal, PrSummary } from "../../types";
import { age, usePastHero, useScrollMemory, useScrolledPrTitle, type SortKey } from "../../lib/ui";
import { Badge, BranchBadge, CiBadge, EmptyState, LoadingField, RunningAgentsChip, Section, SortPicker, Spinner } from "../common";
import { ChecksPanel } from "../ChecksPanel";
import { Composer, RunResults, type ComposerMode } from "../Composer";
import { DiffViewer, type DiffAnchor } from "../DiffViewer";
import { Sidebar } from "../Panels";
import { groupCommentThreads } from "../../lib/threads";
import { DiffCommentThread, PrActivityPanel, PrDescription, PrHeroRail, PrLabels } from "../PrMeta";
import { InlineCommentEditor, ReviewStrip } from "../ProposalCard";
import { PrHeroSidePanel } from "../PrStackDrawer";
import { useFlow } from "../flow";
import { PrStackCard } from "../PrStackList";

/**
 * Review: teammate PRs needing my attention. Runs the automated self-review
 * (thermonuclear skill), overlays proposed inline comments on the diff for
 * tweaking, then submits the final review — only on explicit approval.
 */
export function ReviewView() {
  const { prStacks } = useFlow();
  const queue = usePrData((s) => s.reviewQueue);
  const lastPollAt = usePrData((s) => s.lastPollAt);
  const loading = lastPollAt === null;
  const selected = useUiStore((s) => s.focusedPr["review"] ?? null);
  const setSelected = (n: number) => useUiStore.getState().setFocusedPr("review", n);
  const [sort, setSort] = useState<SortKey>("updated");
  const stacked = stackedPrList(queue, prStacks, sort);
  const pr = stacked.find((item) => item.pr.number === selected)?.pr ?? stacked[0]?.pr ?? null;

  useEffect(() => {
    useUiStore.getState().setVisiblePrWorkspace("review", pr?.number ?? null);
    return () => useUiStore.getState().setVisiblePrWorkspace("review", null);
  }, [pr?.number]);

  if (queue.length === 0) {
    return (
      <div className="main">
        <EmptyState title="Nothing to review" loading={loading}>
          Open pull requests by other people appear here when they match your To Review filters.
        </EmptyState>
      </div>
    );
  }

  const needsAttention = stackedPrList(
    queue.filter((p) => p.requestedFromMe),
    prStacks,
    sort
  );
  const repositoryPrs = stackedPrList(
    queue.filter((p) => !p.requestedFromMe),
    prStacks,
    sort
  );

  const card = (item: PrStackRenderItem) => {
    const p = item.pr;
    return (
      <PrStackCard
        key={p.number}
        item={item}
        selected={pr?.number === p.number}
        onClick={() => setSelected(p.number)}
      >
        <h4>
          #{p.number} {p.title}
        </h4>
        <div className="meta">
          <RunningAgentsChip prNumber={p.number} />
          <span>by {p.author}</span>
          <span>
            +{p.additions} −{p.deletions}
          </span>
          <Badge color="gray" title={`updated ${p.updatedAt}`}>
            {age(p.updatedAt)}
          </Badge>
        </div>
      </PrStackCard>
    );
  };

  return (
    <div className="main split">
      <Sidebar>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="subtle">{needsAttention.length} waiting on you</span>
          <SortPicker value={sort} onChange={setSort} />
        </div>
        {needsAttention.length > 0 && (
          <div className="list-group-label">Needs attention ({needsAttention.length})</div>
        )}
        {needsAttention.map(card)}
        {repositoryPrs.length > 0 && (
          <div className="list-group-label" title="Open PRs by other people that match your To Review filters">
            Repository PRs ({repositoryPrs.length})
          </div>
        )}
        {repositoryPrs.map(card)}
      </Sidebar>
      <div className="content">{pr && <ReviewWorkspace key={pr.number} pr={pr} />}</div>
    </div>
  );
}

function ReviewWorkspace({ pr }: { pr: PrSummary }) {
  const { ctx, poller } = useFlow();
  const proposals = useRepoStore((s) => s.proposals);
  const upsert = useRepoStore((s) => s.upsertProposal);
  const comments = usePrData((s) => s.comments[pr.number]) ?? [];
  const checks = usePrData((s) => s.checks[pr.number]) ?? [];
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [error, setError] = useState("");
  // GitHub's per-file viewed state — shared with github.com's own UI, and
  // GitHub flips files back to unviewed (DISMISSED) when they change
  const [viewedState, setViewedState] = useState<{ id: string; states: Record<string, string> } | null>(
    null
  );
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

  useEffect(() => {
    ctx.gh
      .getPullDiff(ctx.repo, pr.number)
      .then((d) => setFiles(parseUnifiedDiff(d)))
      .catch((e) => setError(String(e)));
    ctx.gh
      .viewedFiles(ctx.repo, pr.number)
      .then(setViewedState)
      .catch(() => setViewedState(null)); // older GHE: feature silently absent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, pr.headSha]);

  const toggleFileViewed = (path: string, viewed: boolean) => {
    if (!viewedState) return;
    const prev = viewedState.states[path];
    // optimistic; revert on failure
    setViewedState((s) => s && { ...s, states: { ...s.states, [path]: viewed ? "VIEWED" : "UNVIEWED" } });
    ctx.gh.setFileViewed(viewedState.id, path, viewed).catch(() => {
      setViewedState((s) => s && { ...s, states: { ...s.states, [path]: prev } });
    });
  };

  const reviewProposal = proposals.find(
    (p): p is Extract<Proposal, { type: "review" }> =>
      p.type === "review" && p.prNumber === pr.number && p.status === "pending"
  );

  // existing GitHub comment threads, with inline reply
  const threadInfos = usePrData((s) => s.threads[pr.number]) ?? [];
  const threadAnchors: DiffAnchor[] = groupCommentThreads(comments).map(({ root, replies }) => ({
    path: root.path!,
    line: root.line!,
    side: root.side ?? "RIGHT",
    tone: "github" as const,
    resolved: threadInfos.find((t) => t.commentIds.includes(root.id))?.isResolved ?? false,
    node: <DiffCommentThread pr={pr} root={root} replies={replies} />,
  }));

  // anchor proposed comments onto the diff
  const proposalAnchors: DiffAnchor[] =
    reviewProposal && files
      ? reviewProposal.comments.map((c) => ({
          path: c.path,
          line: c.line,
          side: c.side,
          tone: "local" as const,
          resolved: !c.included,
          node: (
            <InlineCommentEditor
              comment={c}
              prNumber={pr.number}
              prTitle={pr.title}
              onChange={(next) =>
                void upsert({
                  ...reviewProposal,
                  comments: reviewProposal.comments.map((x) => (x.key === c.key ? next : x)),
                })
              }
              onDelete={() =>
                void upsert({
                  ...reviewProposal,
                  comments: reviewProposal.comments.filter((x) => x.key !== c.key),
                })
              }
              onSubmitOne={async () => {
                // post this single comment on its line, as the user, right now
                await ctx.gh.createReviewComment(
                  ctx.repo,
                  pr.number,
                  pr.headSha,
                  c.path,
                  c.line,
                  c.side,
                  c.startLine,
                  c.body
                );
                await upsert({
                  ...reviewProposal,
                  comments: reviewProposal.comments.filter((x) => x.key !== c.key),
                });
                void poller.refreshPr(pr.number); // the posted comment returns as a GitHub thread
              }}
            />
          ),
        }))
      : [];
  const anchors = [...threadAnchors, ...proposalAnchors];

  const consoleModes: ComposerMode[] = ["review", "ask"];
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
          reviewKind="teammate"
        />

        {/* ── hero: the textured header well — identity, description, CI, agent ── */}
        <header className="pr-hero" ref={heroRef}>
          {/* the PR itself: title + state */}
          <div className="pr-hero-id">
            <h2 className="viewtitle">
              <a href={pr.url} title="Open on GitHub">
                #{pr.number} {pr.title} <span className="ext">↗</span>
              </a>
            </h2>
            <div className="row pr-hero-meta">
              <Badge color={pr.requestedFromMe ? "purple" : "gray"}>
                {pr.requestedFromMe ? "review requested" : "teammate PR"}
              </Badge>
              <CiBadge checks={checks} />
              <BranchBadge head={pr.headRef} base={pr.baseRef} />
              <PrLabels pr={pr} />
              <span className="subtle">
                by {pr.author} · {pr.changedFiles} files
              </span>
            </div>
          </div>

          {/* description + side panel (stack control room + CI) — teammate PRs
              may have no body, in which case the panel stands alone */}
          <PrHeroSidePanel
            pr={pr}
            onJump={jumpToStackPr}
            ciContent={
              checks.some((c) => c.conclusion !== "skipped") ? (
                <ChecksPanel pr={pr} />
              ) : undefined
            }
          >
            {pr.body?.trim() && <PrDescription pr={pr} />}
          </PrHeroSidePanel>

          {/* drive the review agent */}
          <Section>
            <Composer pr={pr} modes={consoleModes} reviewKind="teammate" />
            <RunResults pr={pr} />
            {error && <p style={{ color: "var(--red)" }}>{error}</p>}
          </Section>

          {reviewProposal && (
            <Section label="Proposed review">
              <ReviewStrip proposal={reviewProposal} />
            </Section>
          )}
        </header>

        {/* ── the diff: the main "canvas" view below the hero ── */}
        <section className="pr-diff">
          {!files && <div className="pr-diff-head">{diffTitle(null)}</div>}
          {!files && !error && <LoadingField label="loading diff…" />}
          {files && (
            <DiffViewer
              files={files}
              titleBar={diffTitle(files.length)}
              anchors={anchors}
              selectable
              remoteViewed={
                viewedState ? { map: viewedState.states, toggle: toggleFileViewed } : undefined
              }
              loadFileText={(path, side) =>
                ctx.gh.getFileText(
                  side === "RIGHT" ? pr.headRepoFullName || ctx.repo : ctx.repo,
                  path,
                  side === "RIGHT" ? pr.headSha : pr.baseSha
                )
              }
              renderCommentForm={(sel, close) => (
                <Composer
                  pr={pr}
                  modes={["comment", "review", "ask"]}
                  reviewKind="teammate"
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
