import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { cleanResultText } from "../lib/agents";
import { DEFAULT_REVIEW_PROMPT } from "../lib/defaults";
import { runDraftEdit, runDraftQuestion, runReviewFlow, runSelfReviewFlow } from "../lib/flows";import { interpolate, prVars, uid } from "../lib/template";
import { startSwarm } from "../lib/swarm";
import { useAgentStore, useRepoStore, useSwarmStore } from "../lib/store";
import type { AgentRun, LineSelection, PrSummary, SwarmContenderSpec } from "../types";
import { timeAgo } from "../lib/ui";
import { AgentCard } from "./AgentCard";
import { Badge, Spinner } from "./common";
import { Markdown } from "./Markdown";
import { ModelPicker, ReasoningPicker } from "./ModelPicker";
import { PromptInput } from "./PromptInput";
import { SwarmHost } from "./SwarmHost";
import { useFlow } from "./flow";

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
    placeholder: "Review instructions…",
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
  // configurable per-repo default review instructions (Settings → Agent)
  const reviewPrompt = ctx.config.reviewPrompt?.trim() || DEFAULT_REVIEW_PROMPT;
  const [mode, setModeState] = useState<ComposerMode>(modes[0]);
  const [text, setText] = useState(modes[0] === "review" ? reviewPrompt : "");
  const [busy, setBusy] = useState(false);

  // picking Review prefills the configured prompt; leaving it untouched and
  // switching away clears it back out
  const setMode = (next: ComposerMode) => {
    if (next === "review" && !text.trim()) setText(reviewPrompt);
    else if (mode === "review" && next !== "review" && text === reviewPrompt) setText("");
    setModeState(next);
  };
  const [error, setError] = useState("");
  // one-shot model pick: local to this composer instance, no cross-form memory
  const [model, setModel] = useState("");
  // Swarm opt-in (Q4: default off — single-run path is byte-identical when off).
  // Only for edit/ask modes (v1-wired flow kinds). Contenders differ by model;
  // reasoning is shared via the footer ReasoningPicker (v1: no per-contender
  // reasoning — the spec field exists for forward-compat).
  const swarmSupported = mode === "edit" || mode === "ask";
  const [swarm, setSwarm] = useState(false);
  const [contenders, setContenders] = useState<SwarmContenderSpec[]>([]);
  const toggleSwarm = () => {
    if (!swarm) {
      // carry the current single-pick into the first contender row
      setContenders([{ id: uid("c-"), model }]);
    } else {
      // collapsing back: carry contender[0]'s model back to the single picker
      if (contenders[0]) setModel(contenders[0].model);
      setContenders([]);
    }
    setSwarm(!swarm);
  };
  const addContender = () => {
    if (contenders.length >= 3) return;
    setContenders([...contenders, { id: uid("c-"), model: "" }]);
  };
  const removeContender = (id: string) => {
    if (contenders.length <= 1) return;
    setContenders(contenders.filter((c) => c.id !== id));
  };
  const setContenderModel = (id: string, m: string) => {
    setContenders(contenders.map((c) => (c.id === id ? { ...c, model: m } : c)));
  };
  // Slice to just the run we care about (a review on this PR still
  // starting/running). Returns a single AgentRun ref; default `Object.is`
  // equality means we re-render only when the matching review run updates —
  // chunks to other agents don't even loop past first match.
  const activeReview = useAgentStore((s) => {
    for (const id of s.order) {
      const r = s.runs[id];
      if (
        r &&
        r.prNumber === pr.number &&
        r.kind === "review" &&
        (r.status === "running" || r.status === "starting")
      ) {
        return r;
      }
    }
    return undefined;
  });
  const reviewing = !!activeReview;

  const meta = MODE_META[mode];
  const canSubmit = mode === "review" ? !reviewing : text.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const flowKind = mode === "ask" ? "draft_question" : mode === "edit" ? "draft_edit" : null;
      if (swarm && swarmSupported && flowKind) {
        await startSwarm({
          ctx,
          flowKind,
          trigger: {
            repo: ctx.repo,
            prNumber: pr.number,
            prTitle: pr.title,
            prompt: text,
            selection: selection ?? null,
          },
          contenders,
        });
      } else {
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
      } else {
        // the input IS the review task (prefilled from the configured prompt)
        const task = interpolate(text.trim() || reviewPrompt, { ...prVars(pr), repo: ctx.repo });
        if (reviewKind === "self") await runSelfReviewFlow(ctx, pr, m, task, selection);
        else await runReviewFlow(ctx, pr, task, m, selection);
      }
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
    <div className={compact ? "compact-composer" : "card composer"}>
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
      {mode === "review" && activeReview ? (
        // a review is underway — the input collapses and the live run takes
        // its place; switching mode tabs still works above
        <AgentCard run={activeReview} defaultOpen embedded />
      ) : (
        <>
          <PromptInput
            autoFocus={compact}
            rows={compact ? 2 : 3}
            placeholder={meta.placeholder}
            value={text}
            onChange={setText}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit && !busy) void submit();
              if (e.key === "Escape" && onClose) onClose();
            }}
          />
          <div className="composer-footer">
            <div className="composer-controls">
              {mode !== "comment" && !swarm && (
                <>
                  <ModelPicker
                    value={model}
                    onChange={setModel}
                    flowKind={mode === "review" ? "review" : mode === "edit" ? "draft_edit" : "draft_question"}
                  />
                  <ReasoningPicker
                    flowKind={mode === "review" ? "review" : mode === "edit" ? "draft_edit" : "draft_question"}
                  />
                </>
              )}
              {mode !== "comment" && swarm && swarmSupported && (
                <>
                  <ReasoningPicker
                    flowKind={mode === "edit" ? "draft_edit" : "draft_question"}
                  />
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
                    {contenders.map((c, i) => (
                      <div key={c.id} className="row" style={{ alignItems: "center", gap: 4 }}>
                        <span className="subtle" style={{ fontSize: 11, minWidth: 18 }}>#{i + 1}</span>
                        <ModelPicker
                          value={c.model}
                          onChange={(m) => setContenderModel(c.id, m)}
                          flowKind={mode === "edit" ? "draft_edit" : "draft_question"}
                        />
                        {contenders.length > 1 && (
                          <button className="small" onClick={() => removeContender(c.id)}>−</button>
                        )}
                      </div>
                    ))}
                    {contenders.length < 3 && (
                      <button className="small" onClick={addContender}>+ contender</button>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="composer-actions">
              {swarmSupported && (
                <button
                  className={`small ${swarm ? "primary" : ""}`}
                  onClick={toggleSwarm}
                  title={swarm ? "back to single run" : "fan out to N parallel contenders"}
                >
                  Swarm
                </button>
              )}
              {onClose && <button onClick={onClose}>Cancel</button>}
              <button className="primary composer-submit" disabled={busy || !canSubmit} onClick={() => void submit()}>
                {busy ? <Spinner /> : null}
                <span>{meta.submit}</span>
              </button>
            </div>
            {error && <div className="composer-error">{error}</div>}
          </div>
        </>
      )}
    </div>
  );
}

/** Recent Ask/Change runs for a PR — answers and push confirmations.
 *  When an active Swarm exists for this PR, mounts SwarmHost instead (Q4: the
 *  no-swarm path below is byte-identical to before — the swarm check is the
 *  only additive branch, and it short-circuits before the existing feed). */
export function RunResults({ pr, onReloadDiff }: { pr: PrSummary; onReloadDiff?: () => void }) {
  // Active swarm? Mount the comparison host instead of the single-run feed.
  const repo = useRepoStore((s) => s.repo);
  const swarmActive = useSwarmStore((s) => {
    for (const id of s.order) {
      const sw = s.swarms[id];
      if (sw && sw.trigger.repo === repo && sw.trigger.prNumber === pr.number && sw.status === "running") return true;
    }
    return false;
  });
  if (swarmActive) return <SwarmHost pr={pr} onReloadDiff={onReloadDiff} />;

  // All of this PR's draft_edit / draft_question runs (most recent first).
  // No cap: followup Ask runs are newer than their root, so a small slice risked
  // orphaning them — fetch everything and slice roots for display below.
  const myRuns = useAgentStore(
    useShallow((s) =>
      s.order
        .map((id) => s.runs[id])
        .filter(
          (r): r is AgentRun =>
            !!r && r.prNumber === pr.number && (r.kind === "draft_edit" || r.kind === "draft_question")
        )
    )
  );
  // Ask findings the user has cleared stay cleared (persisted per repo).
  const dismissAskRun = useRepoStore((s) => s.dismissAskRun);
  const dismissed = useRepoStore((s) => s.dismissedAskRuns);
  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);

  // Roots = change runs and top-level Ask runs (Ask runs with a followUpToRunId
  // are threaded under their root rather than shown standalone).
  const roots = useMemo(
    () => myRuns.filter((r) => r.kind === "draft_edit" || !r.followUpToRunId).slice(0, 6),
    [myRuns]
  );
  const isRootVisible = (r: AgentRun) =>
    !(r.kind === "draft_question" && dismissedSet.has(r.id));
  const visibleRoots = roots.filter(isRootVisible);
  if (visibleRoots.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      {visibleRoots.map((r) => (
        <AskOrChangeCard
          key={r.id}
          pr={pr}
          root={r}
          allRuns={myRuns}
          dismissedSet={dismissedSet}
          dismissAskRun={dismissAskRun}
          onReloadDiff={onReloadDiff}
        />
      ))}
    </div>
  );
}

function AskOrChangeCard({
  pr,
  root,
  allRuns,
  dismissedSet,
  dismissAskRun,
  onReloadDiff,
}: {
  pr: PrSummary;
  root: AgentRun;
  allRuns: AgentRun[];
  dismissedSet: Set<string>;
  dismissAskRun: (id: string) => void;
  onReloadDiff?: () => void;
}) {
  // Followups (incl. in-flight) append under their root, delineated.
  const followups = useMemo(
    () =>
      allRuns
        .filter((r) => r.kind === "draft_question" && r.followUpToRunId === root.id)
        .sort((a, b) => a.startedAt - b.startedAt),
    [allRuns, root.id]
  );
  return (
    <div className="card">
      <div className="row between">
        <div className="row">
          {(root.status === "running" || root.status === "starting") && <Spinner />}
          <Badge color={root.status === "done" ? "green" : root.status === "error" ? "red" : "blue"}>
            {root.kind === "draft_edit" ? "change" : "ask"} · {root.status}
          </Badge>
          <span className="subtle">{root.relation}</span>
        </div>
        <span className="subtle">{timeAgo(root.startedAt)}</span>
      </div>
      {root.kind === "draft_question" && root.resultText && (
        <div style={{ marginTop: 8 }}>
          <Markdown text={cleanResultText(root.resultText)} />
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="link small"
              title="Clear this answer from the feed"
              onClick={() => void dismissAskRun(root.id)}
            >
              dismiss
            </button>
          </div>
        </div>
      )}
      {root.kind === "draft_edit" && root.status === "done" && (
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
      {root.error && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 6 }}>{root.error}</div>}

      {followups.map((f) => (
        <FollowupAnswer key={f.id} run={f} onDismiss={() => void dismissAskRun(f.id)} dismissed={dismissedSet.has(f.id)} />
      ))}

      {root.kind === "draft_question" && root.status === "done" && (
        <FollowUpForm pr={pr} rootRunId={root.id} />
      )}
    </div>
  );
}

/** An appended followup answer, delineated from the one above it. */
function FollowupAnswer({ run, onDismiss, dismissed }: { run: AgentRun; onDismiss: () => void; dismissed: boolean }) {
  if (dismissed) return null;
  const running = run.status === "running" || run.status === "starting";
  return (
    <div className="ask-followup">
      <div className="row between">
        <span className="subtle">↳ followup</span>
        <span className="subtle">{timeAgo(run.startedAt)}</span>
      </div>
      {run.userQuestion && <div className="ask-followup-q subtle">{run.userQuestion}</div>}
      {run.error ? (
        <div style={{ color: "var(--red)", fontSize: 12.5 }}>{run.error}</div>
      ) : run.resultText ? (
        <Markdown text={cleanResultText(run.resultText)} />
      ) : running ? (
        <div className="row">
          <Spinner /> <span className="subtle">thinking…</span>
        </div>
      ) : null}
      {run.resultText && run.status === "done" && (
        <div className="row" style={{ marginTop: 4 }}>
          <button className="link small" onClick={onDismiss}>
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}

/** Inline followup Ask prompt beneath an existing Ask answer. */
function FollowUpForm({ pr, rootRunId }: { pr: PrSummary; rootRunId: string }) {
  const { ctx } = useFlow();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // one-shot model pick, same as the main Composer above
  const [model, setModel] = useState("");
  const canSubmit = text.trim().length > 0 && !busy;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      // The followup appends as a new threaded entry beneath the root answer —
      // the root stays as the thread anchor (only a manual dismiss hides it).
      await runDraftQuestion(ctx, pr, text.trim(), null, model || undefined, rootRunId);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ask-followup-form">
      <PromptInput
        as="textarea"
        rows={2}
        value={text}
        onChange={setText}
        placeholder="Follow up on this answer…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-footer">
        <div className="composer-controls">
          <ModelPicker value={model} onChange={setModel} flowKind="draft_question" />
          <ReasoningPicker flowKind="draft_question" />
        </div>
        <div className="composer-actions">
          <button className="small primary" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? <Spinner /> : null} Follow up
          </button>
        </div>
        {error && <div className="composer-error">{error}</div>}
      </div>
    </div>
  );
}
