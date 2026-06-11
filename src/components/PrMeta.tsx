import { useState } from "react";
import { usePrData } from "../lib/events";
import { useUiStore } from "../lib/store";
import type { CommentInfo, PrSummary, ReviewInfo } from "../types";
import { Badge, Spinner, age } from "./common";
import { Markdown } from "./Markdown";
import { useResizablePanel } from "./Panels";
import { useFlow } from "./RepoApp";

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

/** PR description, rendered as markdown; capped height, scrolls inside. */
export function PrDescription({ pr }: { pr: PrSummary }) {
  if (!pr.body?.trim()) return null;
  return (
    <div className="card pr-description">
      <Markdown text={pr.body} />
    </div>
  );
}

// ---------------------------------------------------------------------------

type ActivityEntry =
  | { kind: "thread"; at: number; root: CommentInfo; replies: CommentInfo[] }
  | { kind: "issue_comment"; at: number; comment: CommentInfo }
  | { kind: "review"; at: number; review: ReviewInfo };

/**
 * Right-hand column: the PR's GitHub-derived activity. Inline diff comments
 * are grouped into threads with their replies; the user can reply to threads
 * and post PR comments directly (user-authored — no approval gate needed).
 */
export function PrActivityPanel({ pr }: { pr: PrSummary }) {
  const comments = usePrData((s) => s.comments[pr.number] ?? []);
  const reviews = usePrData((s) => s.reviews[pr.number] ?? []);
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
  ].sort((a, b) => b.at - a.at);

  const count = entries.reduce(
    (n, e) => n + (e.kind === "thread" ? 1 + e.replies.length : 1),
    0
  );

  return (
    <div className="ws-activity" style={{ width }}>
      {handle}
      <div className="ws-activity-inner">
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
              {r.body?.trim() && <Markdown text={r.body} className="compact" />}
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
            : list.map((c) => (c.id === comment.id ? { ...c, body } : c)),
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
      {comment.body?.trim() && <Markdown text={comment.body} className="compact" />}
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
  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="origin-chip github" title="This comment is on GitHub — everyone can see it">
          GitHub
        </span>
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
      <div style={{ marginTop: 4 }}>
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
      </div>
    </div>
  );
}

/** Group inline review comments into (root, replies) threads. */
export function groupCommentThreads(
  comments: CommentInfo[]
): { root: CommentInfo; replies: CommentInfo[] }[] {
  const inline = comments.filter((c) => c.kind === "review_comment" && c.path && c.line);
  const ids = new Set(inline.map((c) => c.id));
  return inline
    .filter((c) => !c.inReplyTo || !ids.has(c.inReplyTo))
    .map((root) => ({
      root,
      replies: inline
        .filter((c) => c.inReplyTo === root.id)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    }));
}

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
    <div className="row" style={{ marginBottom: 3 }}>
      <strong>{author}</strong>
      {isBot && <Badge color="purple">bot</Badge>}
      {children}
      <span className="subtle">{age(at)}</span>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="subtle">
          ↗
        </a>
      )}
    </div>
  );
}

/** An inline-comment thread: root + nested replies + reply box. */
function Thread({ pr, root, replies }: { pr: PrSummary; root: CommentInfo; replies: CommentInfo[] }) {
  const requestDiffScroll = useUiStore((s) => s.requestDiffScroll);
  const [replying, setReplying] = useState(false);

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
    <div className="act-item">
      <ActHeader author={root.author} isBot={root.authorIsBot} at={Date.parse(root.createdAt) || 0} url={root.url}>
        {lineLink || <Badge color="purple">on diff</Badge>}
      </ActHeader>
      <CommentBody pr={pr} comment={root} />
      {replies.map((c) => (
        <div key={c.id} className="act-reply">
          <ActHeader author={c.author} isBot={c.authorIsBot} at={Date.parse(c.createdAt) || 0} url={c.url} />
          <CommentBody pr={pr} comment={c} />
        </div>
      ))}
      <div style={{ marginTop: 4 }}>
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
      poller.refresh();
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 10 }}>
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
