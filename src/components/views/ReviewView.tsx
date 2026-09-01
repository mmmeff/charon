import { useEffect, useRef, useState } from "react";
import { parseUnifiedDiff } from "../../lib/diff";
import { usePrData } from "../../lib/events";
import {
  currentPrVersionValue,
  prVersionKey,
} from "../../lib/pr-version";
import { stackedPrList, type PrStackRenderItem } from "../../lib/pr-stacks";
import { useRepoStore, useUiStore } from "../../lib/store";
import {
  useUltraReviewGenerationStatus,
} from "../../lib/ultrareview-store";
import type { FileDiff, Proposal, PrSummary } from "../../types";
import { age, usePastHero, useScrollMemory, useScrolledPrTitle, type SortKey } from "../../lib/ui";
import { AetherField } from "../AetherField";
import { FadeIn } from "../amicro/fade-in";
import { Stagger, StaggerItem } from "../amicro/stagger";
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
import { UltraReviewEntry } from "../ultrareview";
import { UltraReviewWorkspace } from "../UltraReviewWorkspace";

interface VersionedReviewValue<Value> {
  key: string;
  value: Value;
}

interface ReviewDiffValue {
  files: FileDiff[] | null;
  error: string;
}

interface ReviewViewedValue {
  id: string;
  states: Record<string, string>;
}

/**
 * Review: teammate PRs needing my attention. Runs the automated self-review
 * (thermonuclear skill), overlays proposed inline comments on the diff for
 * tweaking, then submits the final review — only on explicit approval.
 */
export function ReviewView() {
  const { ctx, prStacks } = useFlow();
  const queue = usePrData((s) => s.reviewQueue);
  const lastPollAt = usePrData((s) => s.lastPollAt);
  const loading = lastPollAt === null;
  const selected = useUiStore((s) => s.focusedPr["review"] ?? null);
  const setSelected = (n: number) => useUiStore.getState().setFocusedPr("review", n);
  const [sort, setSort] = useState<SortKey>("updated");
  const [loadedDiff, setLoadedDiff] =
    useState<VersionedReviewValue<ReviewDiffValue> | null>(null);
  const [diffReload, setDiffReload] = useState(0);
  const [loadedViewedState, setLoadedViewedState] =
    useState<VersionedReviewValue<ReviewViewedValue> | null>(null);
  const stacked = stackedPrList(queue, prStacks, sort);
  const pr = stacked.find((item) => item.pr.number === selected)?.pr ?? stacked[0]?.pr ?? null;
  const activeDataKey = pr ? prVersionKey(pr) : null;
  const diff = currentPrVersionValue(loadedDiff, pr);
  const files = diff?.files ?? null;
  const error = diff?.error ?? "";
  const viewedState = currentPrVersionValue(
    loadedViewedState,
    pr
  );
  const ultraOpen = useUiStore((state) => {
    const location = state.navHistory[state.navIndex];
    return pr !== null
      && location?.tab === "review"
      && location.pr === pr.number
      && location.view === "ultrareview";
  });

  useEffect(() => {
    useUiStore.getState().setVisiblePrWorkspace("review", pr?.number ?? null);
    return () => useUiStore.getState().setVisiblePrWorkspace("review", null);
  }, [pr?.number]);

  useEffect(() => {
    if (!pr) {
      setLoadedDiff(null);
      setLoadedViewedState(null);
      return;
    }

    let cancelled = false;
    const key = prVersionKey(pr);
    setLoadedDiff({
      key,
      value: {
        files: null,
        error: "",
      },
    });
    setLoadedViewedState(null);
    void ctx.gh
      .getPullDiff(ctx.repo, pr.number)
      .then((diff) => {
        if (cancelled) return;
        setLoadedDiff({
          key,
          value: {
            files: parseUnifiedDiff(diff),
            error: "",
          },
        });
      })
      .catch((caught) => {
        if (cancelled) return;
        setLoadedDiff({
          key,
          value: {
            files: null,
            error: String(caught),
          },
        });
      });
    void ctx.gh
      .viewedFiles(ctx.repo, pr.number)
      .then((next) => {
        if (cancelled) return;
        setLoadedViewedState({
          key,
          value: next,
        });
      })
      .catch(() => {
        if (!cancelled) setLoadedViewedState(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    ctx.gh,
    ctx.repo,
    diffReload,
    pr?.headSha,
    pr?.number,
  ]);

  const toggleFileViewed = (path: string, viewed: boolean) => {
    if (
      !activeDataKey ||
      !viewedState ||
      loadedViewedState?.key !== activeDataKey
    ) {
      return;
    }
    const previous = viewedState.states[path];
    const viewedId = viewedState.id;
    setLoadedViewedState((current) => {
      if (current?.key !== activeDataKey) return current;
      return {
        ...current,
        value: {
          ...current.value,
          states: {
            ...current.value.states,
            [path]: viewed ? "VIEWED" : "UNVIEWED",
          },
        },
      };
    });
    void ctx.gh
      .setFileViewed(viewedId, path, viewed)
      .catch(() => {
        setLoadedViewedState((current) => {
          if (current?.key !== activeDataKey) return current;
          return {
            ...current,
            value: {
              ...current.value,
              states: {
                ...current.value.states,
                [path]: previous,
              },
            },
          };
        });
      });
  };

  if (queue.length === 0) {
    return (
      <div className="main">
        <EmptyState title="Nothing to review" loading={loading}>
          Open pull requests by other people appear here when they match your To Review filters.
        </EmptyState>
      </div>
    );
  }

  if (ultraOpen && pr) {
    return (
      <UltraReviewWorkspace
        pr={pr}
        mode="teammate"
        files={files}
        filesError={error}
        onRetryFiles={() =>
          setDiffReload((current) => current + 1)}
        onLeave={() =>
          useUiStore.getState().navPush(
            "review",
            pr.number,
          )}
      />
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
        <h4 title={`#${p.number} ${p.title}`}>
          #{p.number} {p.title}
        </h4>
        <div className="meta pr-card-meta">
          <div className="pr-card-status">
            <RunningAgentsChip prNumber={p.number} variant="inline" />
          </div>
          <div className="pr-card-context" title={`by ${p.author}`}>
            by {p.author}
          </div>
          <div className="pr-card-footer">
            <span className="pr-card-change">
              +{p.additions} −{p.deletions}
            </span>
            <span className="pr-card-age" title={`updated ${p.updatedAt}`}>
              {age(p.updatedAt)}
            </span>
          </div>
        </div>
      </PrStackCard>
    );
  };

  return (
    <div className="main split">
      <Sidebar>
        <div className="row between pr-list-toolbar" style={{ marginBottom: 8 }}>
          <span className="subtle">{needsAttention.length} waiting on you</span>
          <SortPicker value={sort} onChange={setSort} />
        </div>
        {needsAttention.length > 0 && (
          <div className="list-group-label">Needs attention ({needsAttention.length})</div>
        )}
        <Stagger>{needsAttention.map((item) => <StaggerItem key={item.pr.number}>{card(item)}</StaggerItem>)}</Stagger>
        {repositoryPrs.length > 0 && (
          <div className="list-group-label" title="Open PRs by other people that match your To Review filters">
            Repository PRs ({repositoryPrs.length})
          </div>
        )}
        <Stagger>{repositoryPrs.map((item) => <StaggerItem key={item.pr.number}>{card(item)}</StaggerItem>)}</Stagger>
      </Sidebar>
      <FadeIn className="content" key={pr?.number ?? "none"} duration={0.35}>
        {pr && (
          <ReviewWorkspace
            key={pr.number}
            pr={pr}
            files={files}
            error={error}
            viewedState={viewedState}
            toggleFileViewed={toggleFileViewed}
            onOpenUltraReview={() =>
              useUiStore.getState().navPush(
                "review",
                pr.number,
                "ultrareview",
              )}
          />
        )}
      </FadeIn>
    </div>
  );
}

function ReviewWorkspace({
  pr,
  files,
  error,
  viewedState,
  toggleFileViewed,
  onOpenUltraReview,
}: {
  pr: PrSummary;
  files: FileDiff[] | null;
  error: string;
  viewedState: {
    id: string;
    states: Record<string, string>;
  } | null;
  toggleFileViewed: (path: string, viewed: boolean) => void;
  onOpenUltraReview: () => void;
}) {
  const { ctx, poller } = useFlow();
  const ultraReviewGenerationStatus =
    useUltraReviewGenerationStatus({
      repo: ctx.repo,
      prNumber: pr.number,
      baseSha: pr.baseSha,
      headSha: pr.headSha,
    });
  const proposals = useRepoStore((s) => s.proposals);
  const upsert = useRepoStore((s) => s.upsertProposal);
  const comments = usePrData((s) => s.comments[pr.number]) ?? [];
  const checks = usePrData((s) => s.checks[pr.number]) ?? [];
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
          <AetherField seed={pr.number + 211} />
          {/* the PR itself: title + state */}
          <div className="pr-hero-id">
            <a className="pr-hero-num" href={pr.url} title="Open on GitHub">
              <span className="pr-hero-num-hash">#</span>
              {pr.number}
            </a>
            <div className="pr-hero-idmain">
              <h2 className="viewtitle">
                <a href={pr.url} title="Open on GitHub">
                  {pr.title} <span className="ext">↗</span>
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
          </div>

          {/* UltraReview is the primary action before the pull request body. */}
          <UltraReviewEntry
            generationStatus={ultraReviewGenerationStatus}
            onBegin={onOpenUltraReview}
          />

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
