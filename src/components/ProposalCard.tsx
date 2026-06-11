import { useState } from "react";
import { runRewrite, sendProposal } from "../lib/flows";
import { useRepoStore } from "../lib/store";
import type { Proposal, ProposedInlineComment, Severity } from "../types";
import { Badge, ConfidenceBadge, SeverityBadge, Spinner, timeAgo } from "./common";
import { PromptInput } from "./PromptInput";
import { useFlow } from "./RepoApp";

const SEVERITIES: Severity[] = ["blocker", "major", "minor", "nit"];

/**
 * One pending GitHub-facing action. The user edits, regenerates (custom
 * prompt or humanize skill), and explicitly approves before anything is sent.
 */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const { ctx, poller } = useFlow();
  const upsert = useRepoStore((s) => s.upsertProposal);
  const remove = useRepoStore((s) => s.removeProposal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentUrl, setSentUrl] = useState("");

  const patch = (p: Partial<Proposal>) => upsert({ ...proposal, ...p } as Proposal);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const url = await sendProposal(ctx, proposal);
      setSentUrl(url);
      poller.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const typeLabel =
    proposal.type === "issue_comment"
      ? "PR comment"
      : proposal.type === "comment_reply"
        ? `reply to #${proposal.inReplyToCommentId}`
        : "review";

  if (proposal.status === "sent") {
    return (
      <div className="proposal sent">
        <div className="proposal-header">
          <Badge color="green">sent</Badge>
          <strong>{typeLabel}</strong>
          <span className="subtle">
            PR #{proposal.prNumber} · {timeAgo(proposal.createdAt)}
          </span>
          {sentUrl && <a href={sentUrl} target="_blank" rel="noreferrer">view on GitHub</a>}
          <span className="spacer" style={{ flex: 1 }} />
          <button className="small" onClick={() => void remove(proposal.id)}>
            clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="proposal">
      <div className="proposal-header">
        <Badge color="yellow">needs approval</Badge>
        <strong>{typeLabel}</strong>
        <span className="subtle">
          PR #{proposal.prNumber} · {proposal.context} · {timeAgo(proposal.createdAt)}
        </span>
        {proposal.type === "review" && (
          <select
            value={proposal.verdict}
            onChange={(e) => void patch({ verdict: e.target.value as any })}
            title="Review verdict"
          >
            <option value="COMMENT">Comment</option>
            <option value="APPROVE">Approve</option>
            <option value="REQUEST_CHANGES">Request changes</option>
          </select>
        )}
      </div>

      <div className="proposal-body">
        <EditableText
          label={proposal.type === "review" ? "Review summary" : "Comment"}
          value={proposal.body}
          onChange={(body) => void patch({ body })}
          prNumber={proposal.prNumber}
          prTitle={proposal.prTitle}
        />

        {proposal.type === "review" &&
          proposal.comments.map((c) => (
            <InlineCommentEditor
              key={c.key}
              comment={c}
              prNumber={proposal.prNumber}
              prTitle={proposal.prTitle}
              onChange={(next) =>
                void patch({
                  comments: proposal.comments.map((x) => (x.key === c.key ? next : x)),
                })
              }
            />
          ))}
      </div>

      <div className="proposal-actions">
        <button className="primary" disabled={busy} onClick={() => void send()}>
          {busy ? <Spinner /> : null} Approve &amp; send
        </button>
        <button className="danger" disabled={busy} onClick={() => void remove(proposal.id)}>
          Dismiss
        </button>
        {proposal.type === "review" && (
          <span className="subtle">
            {proposal.comments.filter((c) => c.included).length}/{proposal.comments.length} comments included
          </span>
        )}
        {error && <span style={{ color: "var(--red)" }}>{error}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Textarea with the regenerate-by-prompt and humanize affordances. */
export function EditableText({
  label,
  value,
  onChange,
  prNumber,
  prTitle,
  rows = 5,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  prNumber: number;
  prTitle: string;
  rows?: number;
}) {
  const { ctx } = useFlow();
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [busy, setBusy] = useState<"" | "regen" | "humanize">("");
  const [error, setError] = useState("");

  const rewrite = async (instruction: string, useHumanize: boolean) => {
    setBusy(useHumanize ? "humanize" : "regen");
    setError("");
    try {
      const next = await runRewrite(ctx, value, instruction, { useHumanize, prNumber, prTitle });
      onChange(next);
      setRegenOpen(false);
      setRegenPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={{ marginBottom: 10 }}>
      {label && <div className="subtle" style={{ marginBottom: 4 }}>{label}</div>}
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="row" style={{ marginTop: 6 }}>
        <button className="small" disabled={!!busy} onClick={() => setRegenOpen(!regenOpen)}>
          Regenerate…
        </button>
        <button className="small" disabled={!!busy} onClick={() => void rewrite("", true)}>
          {busy === "humanize" ? <Spinner /> : null} Humanize
        </button>
        {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
      </div>
      {regenOpen && (
        <div className="row" style={{ marginTop: 6 }}>
          <PromptInput
            as="input"
            placeholder="How should it be rewritten? e.g. 'shorter, lead with the fix' — / for skills"
            value={regenPrompt}
            onChange={setRegenPrompt}
            onKeyDown={(e) => {
              if (e.key === "Enter" && regenPrompt) void rewrite(regenPrompt, false);
            }}
          />
          <button className="small primary" disabled={!!busy || !regenPrompt} onClick={() => void rewrite(regenPrompt, false)}>
            {busy === "regen" ? <Spinner /> : null} Go
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function InlineCommentEditor({
  comment,
  onChange,
  prNumber,
  prTitle,
  compact = false,
}: {
  comment: ProposedInlineComment;
  onChange: (c: ProposedInlineComment) => void;
  prNumber: number;
  prTitle: string;
  compact?: boolean;
}) {
  return (
    <div
      className="event-row"
      style={{ opacity: comment.included ? 1 : 0.45, marginTop: 8 }}
    >
      <div className="row between">
        <div className="row">
          <label className="switch" title="Include this comment in the submitted review">
            <input
              type="checkbox"
              checked={comment.included}
              onChange={(e) => onChange({ ...comment, included: e.target.checked })}
            />
          </label>
          <code>
            {comment.path}:{comment.startLine ? `${comment.startLine}–` : ""}
            {comment.line}
          </code>
          {!compact && <SeverityBadge severity={comment.severity} />}
          <ConfidenceBadge confidence={comment.confidence} />
        </div>
        <div className="row">
          <select
            value={comment.severity}
            onChange={(e) => onChange({ ...comment, severity: e.target.value as Severity })}
            title="Severity"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 6 }}>
        <EditableText
          value={comment.body}
          onChange={(body) => onChange({ ...comment, body })}
          prNumber={prNumber}
          prTitle={prTitle}
          rows={3}
        />
      </div>
    </div>
  );
}
