import { useEffect, useRef, useState } from "react";
import { parseUnifiedDiff } from "../../lib/diff";
import { usePrData } from "../../lib/events";
import { useRepoStore, useUiStore } from "../../lib/store";
import type { FileDiff, Proposal, PrSummary } from "../../types";
import { age, sortPrs, useScrolledPrTitle, type SortKey } from "../../lib/ui";
import { Badge, EmptyState, RunningAgentsChip, Section, SortPicker, Spinner } from "../common";
import { Composer, RunResults } from "../Composer";
import { DiffViewer, type DiffAnchor } from "../DiffViewer";
import { Sidebar } from "../Panels";
import { groupCommentThreads } from "../../lib/threads";
import { DiffCommentThread, PrActivityPanel, PrDescription, PrLabels } from "../PrMeta";
import { InlineCommentEditor, ProposalCard } from "../ProposalCard";
import { useFlow } from "../flow";

/**
 * Review: teammate PRs needing my attention. Runs the automated self-review
 * (thermonuclear skill), overlays proposed inline comments on the diff for
 * tweaking, then submits the final review — only on explicit approval.
 */
export function ReviewView() {
  const queue = usePrData((s) => s.reviewQueue);
  const selected = useUiStore((s) => s.focusedPr["review"] ?? null);
  const setSelected = (n: number) => useUiStore.getState().setFocusedPr("review", n);
  const [sort, setSort] = useState<SortKey>("updated");
  const sorted = sortPrs(queue, sort);
  const pr = sorted.find((p) => p.number === selected) ?? sorted[0] ?? null;

  if (queue.length === 0) {
    return (
      <div className="main">
        <EmptyState title="No inbound traffic">
          PRs where your review is requested (directly or via a team) appear here.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="main split">
      <Sidebar>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="subtle">
            {queue.length} review{queue.length > 1 ? "s" : ""} waiting
          </span>
          <SortPicker value={sort} onChange={setSort} />
        </div>
        {sorted.map((p) => (
          <div
            key={p.number}
            className={`card selectable ${pr?.number === p.number ? "selected" : ""}`}
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
          </div>
        ))}
      </Sidebar>
      <div className="content">{pr && <ReviewWorkspace key={pr.number} pr={pr} />}</div>
    </div>
  );
}

function ReviewWorkspace({ pr }: { pr: PrSummary }) {
  const { ctx } = useFlow();
  const proposals = useRepoStore((s) => s.proposals);
  const upsert = useRepoStore((s) => s.upsertProposal);
  const comments = usePrData((s) => s.comments[pr.number] ?? []);
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [error, setError] = useState("");
  const mainRef = useRef<HTMLDivElement>(null);
  useScrolledPrTitle(mainRef, pr);

  useEffect(() => {
    ctx.gh
      .getPullDiff(ctx.repo, pr.number)
      .then((d) => setFiles(parseUnifiedDiff(d)))
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, pr.headSha]);

  const reviewProposal = proposals.find(
    (p): p is Extract<Proposal, { type: "review" }> =>
      p.type === "review" && p.prNumber === pr.number && p.status === "pending"
  );

  // existing GitHub comment threads, with inline reply
  const threadInfos = usePrData((s) => s.threads[pr.number] ?? []);
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
            />
          ),
        }))
      : [];
  const anchors = [...threadAnchors, ...proposalAnchors];

  return (
    <div className="workspace">
      <div className="ws-main" ref={mainRef}>
      {/* ── the PR itself: title, state, description ── */}
      <Section>
        <h2 className="viewtitle">
          <a href={pr.url} title="Open on GitHub">
            #{pr.number} {pr.title} <span className="ext">↗</span>
          </a>
        </h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <Badge color="purple">review requested</Badge>
          <PrLabels pr={pr} />
          <span className="subtle">
            by {pr.author} · {pr.headRef} → {pr.baseRef} · {pr.changedFiles} files
          </span>
        </div>
        <PrDescription pr={pr} />
      </Section>

      {/* ── drive the review agent ── */}
      <Section label="Console">
        <Composer pr={pr} modes={["review", "ask"]} reviewKind="teammate" />
        <RunResults pr={pr} />
        {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      </Section>

      {reviewProposal && (
        <Section label="Proposed review">
          <div className="subtle" style={{ marginBottom: 8 }}>
            Proposed comments are anchored on the diff below — tweak, toggle, or rewrite each one, then submit.
          </div>
          <ProposalCard proposal={reviewProposal} />
        </Section>
      )}

      <Section label="Diff">
      {!files && !error && (
        <p className="subtle">
          <Spinner /> loading diff…
        </p>
      )}
      {files && (
        <DiffViewer
          files={files}
          anchors={anchors}
          selectable
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
      </Section>
      </div>
      <PrActivityPanel pr={pr} />
    </div>
  );
}
