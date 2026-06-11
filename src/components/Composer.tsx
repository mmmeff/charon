import { useState } from "react";
import { cleanResultText } from "../lib/agents";
import { resolveHandler } from "../lib/events";
import { runDraftEdit, runDraftQuestion, runReviewFlow, runSelfReviewFlow } from "../lib/flows";
import { interpolate, prVars } from "../lib/template";
import { useAgentStore, useUiStore } from "../lib/store";
import type { LineSelection, PrSummary } from "../types";
import { Badge, Spinner, timeAgo } from "./common";
import { Markdown } from "./Markdown";
import { ModelPicker } from "./ModelPicker";
import { PromptInput } from "./PromptInput";
import { useFlow } from "./RepoApp";

export type ComposerMode = "ask" | "edit" | "comment" | "review";

const MODE_META: Record<
  ComposerMode,
  { label: string; submit: string; placeholder: string; hint: (own: boolean, scoped: boolean) => string }
> = {
  ask: {
    label: "Ask",
    submit: "Ask",
    placeholder: "Ask anything…  ( / for skills )",
    hint: () => "Read-only — the answer appears below; nothing changes.",
  },
  edit: {
    label: "Edit",
    submit: "Run edit",
    placeholder: "Describe the change to make…  ( / for skills )",
    hint: () => "An agent implements it and pushes to your branch.",
  },
  comment: {
    label: "Comment",
    submit: "Comment",
    placeholder: "Write a comment for these lines…",
    hint: () => "Your text, posted to GitHub on these lines immediately — no agent involved.",
  },
  review: {
    label: "Review",
    submit: "Review",
    placeholder: "Optional: anything the review should focus on?",
    hint: (own, scoped) =>
      own
        ? scoped
          ? "Agent reviews just the selected lines — findings stay local until you act on them."
          : "Agent review with local-only inline findings — apply or dismiss each; nothing is posted."
        : "Findings become a draft review you edit and approve before anything is sent.",
  },
};

/**
 * The one prompt surface for every agent flow on a PR. Mode picks the flow
 * (Ask = read-only Q&A, Change = edit + push, Review = inline findings);
 * everything shares one input, one model choice, one hint line. The compact
 * variant is the line-selection comment box.
 */
export function Composer({
  pr,
  modes,
  reviewKind = "self",
  selection = null,
  compact = false,
  onClose,
}: {
  pr: PrSummary;
  modes: ComposerMode[];
  /** self = local findings (own PR); teammate = review proposal */
  reviewKind?: "self" | "teammate";
  selection?: LineSelection | null;
  compact?: boolean;
  onClose?: () => void;
}) {
  const { ctx, poller } = useFlow();
  const [mode, setMode] = useState<ComposerMode>(modes[0]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const model = useUiStore((s) => s.composerModel);
  const setModel = useUiStore((s) => s.setComposerModel);
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);

  const reviewing = order
    .map((id) => runs[id])
    .some(
      (r) =>
        r &&
        r.prNumber === pr.number &&
        r.kind === "review" &&
        (r.status === "running" || r.status === "starting")
    );

  const meta = MODE_META[mode];
  const canSubmit = mode === "review" ? !reviewing : text.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const m = model || undefined;
      if (mode === "ask") {
        await runDraftQuestion(ctx, pr, text, selection, m);
      } else if (mode === "edit") {
        await runDraftEdit(ctx, pr, selection, text, m);
      } else if (mode === "comment") {
        if (!selection) throw new Error("select lines to comment on");
        await ctx.gh.createReviewComment(
          ctx.repo,
          pr.number,
          pr.headSha,
          selection.path,
          selection.endLine,
          selection.side,
          selection.startLine,
          text
        );
        poller.refresh();
      } else if (reviewKind === "self") {
        await runSelfReviewFlow(ctx, pr, m, text, selection);
      } else {
        const handler = resolveHandler(ctx.config.events, "review_requested");
        let task = interpolate(handler.prompt, { ...prVars(pr), repo: ctx.repo });
        if (text.trim()) task += `\n\nPay particular attention to: ${text.trim()}`;
        await runReviewFlow(ctx, pr, task, m);
      }
      setText("");
      onClose?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "" : "card composer"}>
      {selection && (
        <div className="subtle" style={{ marginBottom: 6 }}>
          {selection.path}: lines {selection.startLine}
          {selection.endLine !== selection.startLine ? `–${selection.endLine}` : ""} (
          {selection.side === "RIGHT" ? "new" : "old"} side)
        </div>
      )}
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="seg">
          {modes.map((m) => (
            <button
              key={m}
              className={`small ${mode === m ? "primary" : ""}`}
              onClick={() => setMode(m)}
            >
              {MODE_META[m].label}
            </button>
          ))}
        </div>
        <span className="subtle" style={{ fontSize: 12 }}>
          {meta.hint(reviewKind === "self", !!selection)}
        </span>
      </div>
      <PromptInput
        autoFocus={compact}
        rows={compact ? 2 : 3}
        placeholder={meta.placeholder}
        value={text}
        onChange={setText}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit && !busy) void submit();
        }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" disabled={busy || !canSubmit} onClick={() => void submit()}>
          {busy || (mode === "review" && reviewing) ? <Spinner /> : null}{" "}
          {mode === "review" && reviewing ? "reviewing…" : meta.submit}
        </button>
        {mode !== "comment" && <ModelPicker value={model} onChange={setModel} />}
        {onClose && <button onClick={onClose}>Cancel</button>}
        {error && <span style={{ color: "var(--red)" }}>{error}</span>}
      </div>
    </div>
  );
}

/** Recent Ask/Change runs for a PR — answers and push confirmations. */
export function RunResults({ pr, onReloadDiff }: { pr: PrSummary; onReloadDiff?: () => void }) {
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);
  const myRuns = order
    .map((id) => runs[id])
    .filter(
      (r) => r && r.prNumber === pr.number && (r.kind === "draft_edit" || r.kind === "draft_question")
    )
    .slice(0, 6);
  if (myRuns.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      {myRuns.map((r) => (
        <div className="card" key={r.id}>
          <div className="row between">
            <div className="row">
              {(r.status === "running" || r.status === "starting") && <Spinner />}
              <Badge color={r.status === "done" ? "green" : r.status === "error" ? "red" : "blue"}>
                {r.kind === "draft_edit" ? "change" : "ask"} · {r.status}
              </Badge>
              <span className="subtle">{r.relation}</span>
            </div>
            <span className="subtle">{timeAgo(r.startedAt)}</span>
          </div>
          {r.kind === "draft_question" && r.resultText && (
            <div style={{ marginTop: 8 }}>
              <Markdown text={cleanResultText(r.resultText)} />
            </div>
          )}
          {r.kind === "draft_edit" && r.status === "done" && (
            <div className="subtle" style={{ marginTop: 6 }}>
              Pushed to <code>{pr.headRef}</code>.
              {onReloadDiff && (
                <>
                  {" "}
                  <button className="link small" onClick={onReloadDiff}>
                    reload diff
                  </button>
                </>
              )}
            </div>
          )}
          {r.error && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 6 }}>{r.error}</div>}
        </div>
      ))}
    </div>
  );
}
