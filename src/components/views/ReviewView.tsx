import { useEffect, useState } from "react";
import { parseUnifiedDiff } from "../../lib/diff";
import { usePrData } from "../../lib/events";
import { resolveHandler } from "../../lib/events";
import { runReviewFlow } from "../../lib/flows";
import { interpolate, prVars } from "../../lib/template";
import { useAgentStore, useRepoStore, useUiStore } from "../../lib/store";
import type { FileDiff, Proposal, PrSummary } from "../../types";
import { Badge, SortPicker, Spinner, age, sortPrs, type SortKey } from "../common";
import { DiffViewer, type DiffAnchor } from "../DiffViewer";
import { ModelPicker } from "../ModelPicker";
import { PrActivityPanel, PrDescription, PrLabels } from "../PrMeta";
import { InlineCommentEditor, ProposalCard } from "../ProposalCard";
import { useFlow } from "../RepoApp";

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
        <div className="empty">
          <h3>No reviews waiting</h3>
          <p>PRs where your review is requested (directly or via a team) appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="main split">
      <div className="sidebar">
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
      </div>
      <div className="content">{pr && <ReviewWorkspace key={pr.number} pr={pr} />}</div>
    </div>
  );
}

function ReviewWorkspace({ pr }: { pr: PrSummary }) {
  const { ctx } = useFlow();
  const proposals = useRepoStore((s) => s.proposals);
  const upsert = useRepoStore((s) => s.upsertProposal);
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [model, setModel] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);

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
  const runningReview = order
    .map((id) => runs[id])
    .find(
      (r) =>
        r && r.prNumber === pr.number && r.kind === "review" && (r.status === "running" || r.status === "starting")
    );

  const startReview = async () => {
    setStarting(true);
    setError("");
    try {
      const handler = resolveHandler(ctx.config.events, "review_requested");
      const task = interpolate(handler.prompt, { ...prVars(pr), repo: ctx.repo });
      await runReviewFlow(ctx, pr, task, model || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  // anchor proposed comments onto the diff
  const anchors: DiffAnchor[] =
    reviewProposal && files
      ? reviewProposal.comments.map((c) => ({
          path: c.path,
          line: c.line,
          side: c.side,
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
            />
          ),
        }))
      : [];

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
        <Badge color="purple">review requested</Badge>
        <PrLabels pr={pr} />
        <span className="subtle">
          by {pr.author} · {pr.headRef} → {pr.baseRef} · {pr.changedFiles} files
        </span>
      </div>

      <PrDescription pr={pr} />

      {!reviewProposal && (
        <div className="card">
          <div className="row">
            <ModelPicker value={model} onChange={setModel} />
            <button
              className="primary"
              disabled={starting || !!runningReview}
              onClick={() => void startReview()}
            >
              {runningReview ? (
                <>
                  <Spinner /> review in progress — watch in Activity Feed
                </>
              ) : (
                "Run automated self-review"
              )}
            </button>
          </div>
          <div className="subtle" style={{ marginTop: 6 }}>
            Runs the configured review skill (default: thermonuclear code quality review) over the diff and
            proposes inline comments with severity and confidence. Nothing is sent until you approve.
          </div>
          {error && <p style={{ color: "var(--red)" }}>{error}</p>}
        </div>
      )}

      {reviewProposal && (
        <>
          <div className="subtle" style={{ margin: "8px 0" }}>
            Proposed comments are anchored on the diff below — tweak, toggle, or rewrite each one, then submit.
          </div>
          <ProposalCard proposal={reviewProposal} />
        </>
      )}

      {!files && !error && (
        <p className="subtle">
          <Spinner /> loading diff…
        </p>
      )}
      {files && <DiffViewer files={files} anchors={anchors} />}
      </div>
      <PrActivityPanel pr={pr} />
    </div>
  );
}
