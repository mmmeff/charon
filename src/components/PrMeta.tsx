import { useEffect, useRef, useState } from "react";
import { usePrData } from "../lib/events";
import { runAddressComment, runDescriptionDraft, runTitleDraft } from "../lib/flows";
import type { ReviewThreadInfo } from "../lib/github";
import { useAgentStore, useUiStore } from "../lib/store";
import type { CommentInfo, PrSummary, ReviewInfo, TimelineEventInfo } from "../types";
import { AgentCard } from "./AgentCard";
import { AgentLaunchForm } from "./AgentLaunchForm";
import { ControlCenter } from "./ControlCenter";
import { age } from "../lib/ui";
import { Badge, Spinner } from "./common";
import { IconDrafts, IconExpand } from "./icons";
import { Markdown } from "./Markdown";
import { useResizablePanel } from "./useResizablePanel";
import { useFlow } from "./flow";

/**
 * "Address with agent" on a GitHub comment thread — own PRs only (agents push
 * exclusively to the user's own branch). Spins off a fix agent that implements
 * the feedback and drafts a reply to the thread as a pending proposal.
 */
function AddressWithAgent({
  pr,
  root,
  replies,
}: {
  pr: PrSummary;
  root: CommentInfo;
  replies: CommentInfo[];
}) {
  const { ctx } = useFlow();
  const [open, setOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const run = useAgentStore((s) => (runId ? s.runs[runId] : undefined));
  if (pr.author !== ctx.gh.login) return null;
  return (
    <>
      <button
        className="link small"
        title="Spin off a fix agent for this feedback — its reply is proposed for your approval, never auto-posted"
        onClick={() => setOpen(!open)}
      >
        ⚙ address with agent
      </button>
      {open && (
        <AgentLaunchForm
          label="Address with agent"
          flowKind="feedback_fix"
          onRun={async (model, guidance) =>
            setRunId(await runAddressComment(ctx, pr, root, replies, model, guidance))
          }
          onClose={() => setOpen(false)}
        />
      )}
      {run && <AgentCard run={run} embedded defaultOpen />}
    </>
  );
}

/** The review thread (resolution state) containing a given comment. */
function useThread(prNumber: number, commentId: number): ReviewThreadInfo | undefined {
  return usePrData((s) => (s.threads[prNumber] ?? []).find((t) => t.commentIds.includes(commentId)));
}

/** Resolve/unresolve a thread as the user — optimistic, reconciled on next poll. */
function ResolveButton({ pr, thread }: { pr: PrSummary; thread: ReviewThreadInfo }) {
  const { ctx } = useFlow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const toggle = async () => {
    setBusy(true);
    setError(false);
    try {
      await ctx.gh.setThreadResolved(thread.id, !thread.isResolved);
      const d = usePrData.getState();
      d.patch({
        threads: {
          ...d.threads,
          [pr.number]: (d.threads[pr.number] ?? []).map((t) =>
            t.id === thread.id ? { ...t, isResolved: !thread.isResolved } : t
          ),
        },
      });
    } catch (e) {
      console.error("resolve toggle failed", e);
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      className="link small"
      disabled={busy}
      title={error ? "failed — try again" : thread.isResolved ? "Reopen this thread" : "Mark this thread resolved"}
      style={error ? { color: "var(--red)" } : undefined}
      onClick={() => void toggle()}
    >
      {busy ? <Spinner /> : thread.isResolved ? "unresolve" : "✓ resolve"}
    </button>
  );
}

/**
 * The workspace PR title: a link to GitHub, and on the user's own PRs a
 * rename control with an AI suggestion that follows the repo's title
 * conventions. Saving PATCHes the title directly as the user.
 */
export function PrTitle({ pr }: { pr: PrSummary }) {
  const { ctx } = useFlow();
  const mine = pr.author === ctx.gh.login;
  const [editing, setEditing] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startEdit = (withAi = false) => {
    setDraft(pr.title);
    setError("");
    setAiOpen(withAi);
    setEditing(true);
  };

  const save = async () => {
    const title = draft.trim();
    if (!title || title === pr.title) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await ctx.gh.updatePullTitle(ctx.repo, pr.number, title);
      // optimistic: rename everywhere it appears; the next poll reconciles
      const d = usePrData.getState();
      const fix = (l: PrSummary[]) => l.map((p) => (p.number === pr.number ? { ...p, title } : p));
      d.patch({ myDrafts: fix(d.myDrafts), myOpen: fix(d.myOpen), reviewQueue: fix(d.reviewQueue) });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <h2 className="viewtitle">
        <a href={pr.url} title="Open on GitHub">
          #{pr.number} {pr.title} <span className="ext">↗</span>
        </a>
        {mine && (
          <button className="link small title-edit" title="Rename PR" onClick={() => startEdit()}>
            ✎
          </button>
        )}
      </h2>
    );
  }

  return (
    <div className="card" style={{ padding: 10, marginBottom: 10 }}>
      <input
        type="text"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy) void save();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="PR title"
        style={{ width: "100%", fontWeight: 600 }}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <button className="small primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Spinner /> : null} Save title
        </button>
        <button className="small" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {!aiOpen && (
          <button className="link small" onClick={() => setAiOpen(true)}>
            ✦ suggest with AI
          </button>
        )}
        <span className="subtle">⏎ to save — renames on GitHub directly, as you</span>
        {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
      </div>
      {aiOpen && (
        <AgentLaunchForm
          label="Suggest title"
          flowKind="rewrite"
          placeholder="Optional: guidance, e.g. 'conventional-commits style', 'mention the ticket'  ( / for skills )"
          onRun={async (model, instruction) => {
            // suggestion lands in the input — the user reviews, then saves
            setDraft(await runTitleDraft(ctx, pr, instruction, model));
          }}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  );
}

export function PrLabels({ pr }: { pr: PrSummary }) {
  if (pr.labels.length === 0) return null;
  return (
    <>
      {pr.labels.map((l) => (
        <Badge key={l} color="blue">
          {l}
        </Badge>
      ))}
    </>
  );
}

/**
 * PR description: capped height with inner scroll, plus an expand control
 * that floats it over the full main column (between the side panels).
 * On the user's own PRs (draft or open) it toggles into an edit mode that
 * writes straight to GitHub — the user's own words, no approval gate.
 */
export function PrDescription({ pr }: { pr: PrSummary }) {
  const { ctx } = useFlow();
  const mine = pr.author === ctx.gh.login;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null
  );
  const [editing, setEditing] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const measure = () => {
    const main = wrapRef.current?.closest(".ws-main");
    if (!main) return null;
    const r = main.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };

  // keep the overlay glued to the main column through window/panel resizes
  useEffect(() => {
    if (!rect) return;
    const sync = () => setRect(measure());
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRect(null);
    };
    window.addEventListener("resize", sync);
    document.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("resize", sync);
      document.removeEventListener("keydown", esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect !== null]);

  const startEdit = (withAi = false) => {
    setDraft(pr.body ?? "");
    setError("");
    setRect(null);
    setAiOpen(withAi);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await ctx.gh.updatePullBody(ctx.repo, pr.number, draft);
      // optimistic: patch the PR everywhere it appears; the next poll brings
      // back the GitHub-rendered bodyHtml (local markdown renders meanwhile)
      const d = usePrData.getState();
      const fix = (l: PrSummary[]) =>
        l.map((p) => (p.number === pr.number ? { ...p, body: draft, bodyHtml: undefined } : p));
      d.patch({ myDrafts: fix(d.myDrafts), myOpen: fix(d.myOpen), reviewQueue: fix(d.reviewQueue) });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="card" style={{ padding: 10 }}>
        <textarea
          rows={12}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) void save();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="PR description (markdown)"
        />
        <div className="row" style={{ marginTop: 6 }}>
          <button className="small primary" disabled={busy} onClick={() => void save()}>
            {busy ? <Spinner /> : null} Save description
          </button>
          <button className="small" onClick={() => setEditing(false)}>
            Cancel
          </button>
          {!aiOpen && (
            <button className="link small" onClick={() => setAiOpen(true)}>
              ✦ draft with AI
            </button>
          )}
          <span className="subtle">⌘⏎ to save — updates GitHub directly, as you</span>
          {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
        </div>
        {aiOpen && (
          <AgentLaunchForm
            label="Generate draft"
            flowKind="rewrite"
            placeholder="How should the description change? e.g. reflect the latest commits, add a test plan  ( / for skills )"
            onRun={async (model, instruction) => {
              // result lands in the editor — the user reviews, then saves
              setDraft(await runDescriptionDraft(ctx, pr, instruction, model));
            }}
            onClose={() => setAiOpen(false)}
          />
        )}
      </div>
    );
  }

  if (!pr.body?.trim()) {
    if (!mine) return null;
    return (
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="link small" onClick={() => startEdit()}>
          + add description
        </button>
        <button className="link small" onClick={() => startEdit(true)}>
          ✦ draft with AI
        </button>
      </div>
    );
  }

  return (
    <div className="pr-description-wrap" ref={wrapRef}>
      {mine && (
        <>
          <button
            className="desc-expand desc-ai"
            data-tip="Draft description with AI"
            onClick={() => startEdit(true)}
          >
            ✦
          </button>
          <button className="desc-expand desc-edit" data-tip="Edit description" onClick={() => startEdit()}>
            <IconDrafts />
          </button>
        </>
      )}
      <button
        className="desc-expand"
        data-tip="Expand description"
        onClick={() => setRect(measure())}
      >
        <IconExpand />
      </button>
      <div className="card pr-description">
        <Markdown text={pr.body} html={pr.bodyHtml} />
      </div>

      {rect && (
        <div className="desc-overlay" style={rect}>
          <div className="desc-overlay-head">
            <span className="subtle" style={{ fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Description — #{pr.number} {pr.title}
            </span>
            <span style={{ flex: 1 }} />
            <button className="small" onClick={() => setRect(null)}>
              ✕ close
            </button>
          </div>
          <div className="desc-overlay-body">
            <Markdown text={pr.body} html={pr.bodyHtml} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

type ActivityEntry =
  | { kind: "thread"; at: number; root: CommentInfo; replies: CommentInfo[] }
  | { kind: "issue_comment"; at: number; comment: CommentInfo }
  | { kind: "review"; at: number; review: ReviewInfo }
  | { kind: "timeline"; at: number; ev: TimelineEventInfo };

/**
 * Right-hand column: the PR's GitHub-derived activity. Inline diff comments
 * are grouped into threads with their replies; the user can reply to threads
 * and post PR comments directly (user-authored — no approval gate needed).
 */
export function PrActivityPanel({ pr }: { pr: PrSummary }) {
  const open = useUiStore((s) => s.activityPanelOpen);
  const comments = usePrData((s) => s.comments[pr.number] ?? []);
  const reviews = usePrData((s) => s.reviews[pr.number] ?? []);
  const timeline = usePrData((s) => s.timeline[pr.number] ?? []);
  const { width, handle } = useResizablePanel("prc-w-activity", 320, 230, 640, "left");

  const reviewComments = comments.filter((c) => c.kind === "review_comment");
  const ids = new Set(reviewComments.map((c) => c.id));
  const roots = reviewComments.filter((c) => !c.inReplyTo || !ids.has(c.inReplyTo));
  const threads: ActivityEntry[] = roots.map((root) => {
    const replies = reviewComments
      .filter((c) => c.inReplyTo === root.id)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const at = Math.max(
      Date.parse(root.createdAt) || 0,
      ...replies.map((r) => Date.parse(r.createdAt) || 0)
    );
    return { kind: "thread", at, root, replies };
  });

  const entries: ActivityEntry[] = [
    ...threads,
    ...comments
      .filter((c) => c.kind === "issue")
      .map((c): ActivityEntry => ({ kind: "issue_comment", at: Date.parse(c.createdAt) || 0, comment: c })),
    ...reviews
      .filter((r) => r.state && r.state !== "PENDING")
      .map((r): ActivityEntry => ({ kind: "review", at: Date.parse(r.submittedAt) || 0, review: r })),
    ...timeline.map((ev): ActivityEntry => ({ kind: "timeline", at: ev.at, ev })),
  ].sort((a, b) => b.at - a.at);

  const count = entries.reduce(
    (n, e) => n + (e.kind === "thread" ? 1 + e.replies.length : 1),
    0
  );

  if (!open) return null; // hidden via the topstrip toggle — ws-main reclaims the width

  return (
    <div className="ws-activity" style={{ width }}>
      {handle}
      <div className="ws-activity-inner">
      <ControlCenter pr={pr} />
      <div className="subtle" style={{ marginBottom: 8, fontWeight: 600 }}>
        Activity ({count})
      </div>
      <SendBox
        pr={pr}
        placeholder="Comment on this PR…"
        send={(ctx, text) => ctx.gh.createIssueComment(ctx.repo, pr.number, text)}
      />
      {entries.length === 0 && <div className="subtle">No comments or reviews yet.</div>}
      {entries.map((e, i) => {
        if (e.kind === "timeline") {
          const ev = e.ev;
          return (
            <div key={ev.id} className="act-event">
              <div className="row act-top">
                <Badge color={ev.color}>{ev.verb}</Badge>
                <span style={{ flex: 1 }} />
                <span className="subtle">{age(ev.at)}</span>
              </div>
              <div className="act-sentence">
                <strong>{ev.actor}</strong> {ev.text}
              </div>
              {ev.sub &&
                (ev.url ? (
                  <a href={ev.url} target="_blank" rel="noreferrer" className="act-event-detail">
                    {ev.sub}
                  </a>
                ) : (
                  <div className="act-event-detail subtle">{ev.sub}</div>
                ))}
            </div>
          );
        }
        if (e.kind === "review") {
          const r = e.review;
          return (
            <div key={`r${r.id}`} className="act-item">
              <ActHeader author={r.author} isBot={r.authorIsBot} at={e.at}>
                <Badge
                  color={r.state === "APPROVED" ? "green" : r.state === "CHANGES_REQUESTED" ? "red" : "gray"}
                >
                  {reviewLabel(r.state)}
                </Badge>
              </ActHeader>
              {r.body?.trim() && <Markdown text={r.body} html={r.bodyHtml} className="compact" />}
            </div>
          );
        }
        if (e.kind === "issue_comment") {
          const c = e.comment;
          return (
            <div key={`c${c.id}`} className="act-item">
              <ActHeader author={c.author} isBot={c.authorIsBot} at={e.at} url={c.url}>
                <Badge color="gray">commented</Badge>
              </ActHeader>
              <CommentBody pr={pr} comment={c} />
              <div className="row" style={{ marginTop: 4 }}>
                <AddressWithAgent pr={pr} root={c} replies={[]} />
              </div>
            </div>
          );
        }
        return <Thread key={`t${e.root.id}`} pr={pr} root={e.root} replies={e.replies} />;
      })}
      </div>
    </div>
  );
}

/**
 * A GitHub comment body. When it belongs to the signed-in user it gains
 * edit/delete controls (direct user-authored writes — no approval gate).
 * Edits update local state optimistically; the next poll reconciles.
 */
export function CommentBody({ pr, comment }: { pr: PrSummary; comment: CommentInfo }) {
  const { ctx } = useFlow();
  const mine = comment.author === ctx.gh.login;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState("");

  const patchLocal = (body: string | null) => {
    const data = usePrData.getState();
    const list = data.comments[pr.number] ?? [];
    data.patch({
      comments: {
        ...data.comments,
        [pr.number]:
          body === null
            ? list.filter((c) => c.id !== comment.id)
            : // bodyHtml is now stale — drop it so the edited text shows until re-poll
              list.map((c) => (c.id === comment.id ? { ...c, body, bodyHtml: undefined } : c)),
      },
    });
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await ctx.gh.updateComment(ctx.repo, comment.kind, comment.id, draft);
      patchLocal(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    setError("");
    try {
      await ctx.gh.deleteComment(ctx.repo, comment.kind, comment.id);
      patchLocal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setConfirmDel(false);
    }
  };

  if (editing) {
    return (
      <div>
        <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
        <div className="row" style={{ marginTop: 4 }}>
          <button className="small primary" disabled={busy || !draft.trim()} onClick={() => void save()}>
            {busy ? <Spinner /> : null} Save
          </button>
          <button
            className="small"
            onClick={() => {
              setEditing(false);
              setDraft(comment.body);
            }}
          >
            Cancel
          </button>
          {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="comment-body">
      {comment.body?.trim() && (
        <Markdown text={comment.body} html={comment.bodyHtml} className="compact" />
      )}
      {mine && (
        <div className="row comment-controls">
          <button className="link small" onClick={() => setEditing(true)}>
            edit
          </button>
          {confirmDel ? (
            <>
              <button className="link small danger-link" disabled={busy} onClick={() => void del()}>
                {busy ? <Spinner /> : null} really delete?
              </button>
              <button className="link small" onClick={() => setConfirmDel(false)}>
                keep
              </button>
            </>
          ) : (
            <button className="link small danger-link" onClick={() => setConfirmDel(true)}>
              delete
            </button>
          )}
          {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * A GitHub inline-comment thread rendered in place on the diff: root comment,
 * nested replies, and a reply box that posts to the thread as the user.
 * Used by both the own-PR workspace and the teammate Review diff.
 */
export function DiffCommentThread({
  pr,
  root,
  replies,
}: {
  pr: PrSummary;
  root: CommentInfo;
  replies: CommentInfo[];
}) {
  const [replying, setReplying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const thread = useThread(pr.number, root.id);

  // resolved threads collapse to a single quiet line
  if (thread?.isResolved && !expanded) {
    return (
      <div className="row resolved-line">
        <span className="origin-chip github">GitHub</span>
        <Badge color="green">resolved</Badge>
        <span className="subtle">
          {root.author}: {firstLine(root.body)}
        </span>
        <button className="link small" onClick={() => setExpanded(true)}>
          show
        </button>
        <ResolveButton pr={pr} thread={thread} />
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="origin-chip github" title="This comment is on GitHub — everyone can see it">
          GitHub
        </span>
        {thread?.isResolved && <Badge color="green">resolved</Badge>}
        <strong>{root.author}</strong>
        {root.authorIsBot && <Badge color="purple">bot</Badge>}
        <span className="subtle">{age(root.createdAt)}</span>
        <a href={root.url} target="_blank" rel="noreferrer" className="subtle">
          view ↗
        </a>
      </div>
      <CommentBody pr={pr} comment={root} />
      {replies.map((c) => (
        <div key={c.id} className="act-reply">
          <ActHeader author={c.author} isBot={c.authorIsBot} at={Date.parse(c.createdAt) || 0} url={c.url} />
          <CommentBody pr={pr} comment={c} />
        </div>
      ))}
      <div className="row" style={{ marginTop: 4 }}>
        {replying ? (
          <SendBox
            pr={pr}
            placeholder="Reply to this thread…"
            autoFocus
            onSent={() => setReplying(false)}
            send={(ctx, text) => ctx.gh.replyToReviewComment(ctx.repo, pr.number, root.id, text)}
          />
        ) : (
          <button className="link small" onClick={() => setReplying(true)}>
            ↳ reply
          </button>
        )}
        {!replying && <AddressWithAgent pr={pr} root={root} replies={replies} />}
        {thread && !replying && <ResolveButton pr={pr} thread={thread} />}
        {thread?.isResolved && expanded && (
          <button className="link small" onClick={() => setExpanded(false)}>
            collapse
          </button>
        )}
      </div>
    </div>
  );
}

const firstLine = (s: string) => {
  const l = (s ?? "").split("\n").find((x) => x.trim()) ?? "";
  return l.length > 72 ? l.slice(0, 72) + "…" : l;
};

/** Two-line activity header: type + age on top, author beneath. */
function ActHeader({
  author,
  isBot,
  at,
  url,
  children,
}: {
  author: string;
  isBot: boolean;
  at: number;
  url?: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="row act-top">
        {children}
        <span style={{ flex: 1 }} />
        <span className="subtle">{age(at)}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="subtle">
            ↗
          </a>
        )}
      </div>
      <div className="row" style={{ marginBottom: 3 }}>
        <strong>{author}</strong>
        {isBot && <Badge color="purple">bot</Badge>}
      </div>
    </>
  );
}

/** An inline-comment thread: root + nested replies + reply box. */
function Thread({ pr, root, replies }: { pr: PrSummary; root: CommentInfo; replies: CommentInfo[] }) {
  const requestDiffScroll = useUiStore((s) => s.requestDiffScroll);
  const [replying, setReplying] = useState(false);
  const thread = useThread(pr.number, root.id);

  const lineLink = root.path && root.line && (
    <button
      className="link small"
      title={`Jump to ${root.path}:${root.line} in the diff`}
      onClick={() => requestDiffScroll(root.path!, root.side ?? "RIGHT", root.line!)}
    >
      on {shortPath(root.path)}:{root.line}
    </button>
  );

  return (
    <div className="act-item" style={thread?.isResolved ? { opacity: 0.55 } : undefined}>
      <ActHeader author={root.author} isBot={root.authorIsBot} at={Date.parse(root.createdAt) || 0} url={root.url}>
        {lineLink || <Badge color="purple">on diff</Badge>}
        {thread?.isResolved && <Badge color="green">resolved</Badge>}
      </ActHeader>
      <CommentBody pr={pr} comment={root} />
      {replies.map((c) => (
        <div key={c.id} className="act-reply">
          <ActHeader author={c.author} isBot={c.authorIsBot} at={Date.parse(c.createdAt) || 0} url={c.url} />
          <CommentBody pr={pr} comment={c} />
        </div>
      ))}
      <div className="row" style={{ marginTop: 4 }}>
        {replying ? (
          <SendBox
            pr={pr}
            placeholder="Reply to this thread…"
            autoFocus
            onSent={() => setReplying(false)}
            send={(ctx, text) => ctx.gh.replyToReviewComment(ctx.repo, pr.number, root.id, text)}
          />
        ) : (
          <button className="link small" onClick={() => setReplying(true)}>
            ↳ reply
          </button>
        )}
        {thread && !replying && <ResolveButton pr={pr} thread={thread} />}
      </div>
    </div>
  );
}

/** Direct user-authored GitHub write: typed by the human, sent on click. */
function SendBox({
  pr,
  placeholder,
  autoFocus,
  send,
  onSent,
}: {
  pr: PrSummary;
  placeholder: string;
  autoFocus?: boolean;
  send: (ctx: ReturnType<typeof useFlow>["ctx"], text: string) => Promise<string>;
  onSent?: () => void;
}) {
  const { ctx, poller } = useFlow();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await send(ctx, text);
      setText("");
      poller.refreshPr(pr.number);
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 10, flex: 1, minWidth: 0, width: "100%" }}>
      <textarea
        rows={2}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
        }}
      />
      <div className="row" style={{ marginTop: 4 }}>
        <button className="small primary" disabled={busy || !text.trim()} onClick={() => void submit()}>
          {busy ? <Spinner /> : null} Send
        </button>
        {onSent && (
          <button className="small" onClick={onSent}>
            Cancel
          </button>
        )}
        {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}

const shortPath = (p?: string) => {
  if (!p) return "diff";
  const parts = p.split("/");
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
};

const reviewLabel = (state: string) =>
  state === "APPROVED"
    ? "approved"
    : state === "CHANGES_REQUESTED"
      ? "requested changes"
      : state === "DISMISSED"
        ? "review dismissed"
        : "reviewed";
