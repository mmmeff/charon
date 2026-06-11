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

/** PR description, rendered as markdown; collapsible when long. */
export function PrDescription({ pr }: { pr: PrSummary }) {
  const long = (pr.body ?? "").length > 700;
  const [open, setOpen] = useState(!long);
  if (!pr.body?.trim()) return null;
  return (
    <div className="card">
      <Markdown text={open ? pr.body : pr.body.slice(0, 700) + "\n\n…"} />
      {long && (
        <button className="link small" onClick={() => setOpen(!open)}>
          {open ? "show less" : "show full description"}
        </button>
      )}
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
              {c.body?.trim() && <Markdown text={c.body} className="compact" />}
            </div>
          );
        }
        return <Thread key={`t${e.root.id}`} pr={pr} root={e.root} replies={e.replies} />;
      })}
      </div>
    </div>
  );
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
      {root.body?.trim() && <Markdown text={root.body} className="compact" />}
      {replies.map((c) => (
        <div key={c.id} className="act-reply">
          <ActHeader author={c.author} isBot={c.authorIsBot} at={Date.parse(c.createdAt) || 0} url={c.url} />
          {c.body?.trim() && <Markdown text={c.body} className="compact" />}
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
