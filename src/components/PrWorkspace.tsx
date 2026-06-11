import { useEffect, useState } from "react";
import { cleanResultText } from "../lib/agents";
import { eventDef } from "../lib/defaults";
import { parseUnifiedDiff } from "../lib/diff";
import { resolveHandler, usePrData } from "../lib/events";
import { runDraftEdit, runDraftQuestion, runFixFlow } from "../lib/flows";
import { interpolate, prVars } from "../lib/template";
import { useAgentStore, useRepoStore } from "../lib/store";
import type { CommentInfo, FileDiff, LineSelection, PrSummary } from "../types";
import { Badge, CiBadge, MergeBadge, Spinner, age, timeAgo } from "./common";
import { DiffViewer, type DiffAnchor } from "./DiffViewer";
import { FindingCard, SelfReviewBar } from "./Findings";
import { Markdown } from "./Markdown";
import { ModelPicker } from "./ModelPicker";
import { PrActivityPanel, PrDescription, PrLabels } from "./PrMeta";
import { PromptInput } from "./PromptInput";
import { ProposalCard } from "./ProposalCard";
import { useFlow } from "./RepoApp";

/**
 * Shared PR workspace: native diff with GitHub-style line selection driving
 * Ask/Change agent runs, existing review comments anchored on the diff, and
 * (babysit variant) status chips, manual fix triggers, and pending proposals.
 * Used by both the Drafts and Babysit views — both operate on the user's own
 * PRs, so Change runs push without an approval gate.
 */
export function PrWorkspace({ pr, variant }: { pr: PrSummary; variant: "draft" | "babysit" }) {
  const { ctx } = useFlow();
  const checks = usePrData((s) => s.checks[pr.number] ?? []);
  const comments = usePrData((s) => s.comments[pr.number] ?? []);
  const reviews = usePrData((s) => s.reviews[pr.number] ?? []);
  const proposals = useRepoStore((s) => s.proposals);
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [diffErr, setDiffErr] = useState("");
  const [model, setModel] = useState("");
  const [general, setGeneral] = useState("");
  const [generalMode, setGeneralMode] = useState<"ask" | "edit">("ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const runs = useAgentStore((s) => s.runs);
  const order = useAgentStore((s) => s.order);

  const loadDiff = async () => {
    setDiffErr("");
    try {
      setFiles(parseUnifiedDiff(await ctx.gh.getPullDiff(ctx.repo, pr.number)));
    } catch (e) {
      setDiffErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void loadDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, pr.headSha]);

  const myRuns = order
    .map((id) => runs[id])
    .filter((r) => r && r.prNumber === pr.number && (r.kind === "draft_edit" || r.kind === "draft_question"));
  const activeRuns = order
    .map((id) => runs[id])
    .filter((r) => r && r.prNumber === pr.number && (r.status === "running" || r.status === "starting"));
  const prProposals = proposals.filter((p) => p.prNumber === pr.number && p.status !== "dismissed");

  const failing = checks.filter((c) => c.conclusion === "failure" || c.conclusion === "error");
  const approvals = new Set(reviews.filter((r) => r.state === "APPROVED").map((r) => r.author)).size;

  const submitGeneral = async () => {
    if (!general.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (generalMode === "edit") await runDraftEdit(ctx, pr, null, general, model || undefined);
      else await runDraftQuestion(ctx, pr, general, null, model || undefined);
      setGeneral("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const manualFix = async (eventId: string, kind: "ci_fix" | "conflict_fix") => {
    setError("");
    try {
      const handler = resolveHandler(ctx.config.events, eventId);
      const extra: Record<string, string> =
        kind === "ci_fix" && failing.length > 0
          ? { "check-name": failing[0].name, "check-url": failing[0].url }
          : {};
      const prompt = interpolate(handler.prompt, { ...prVars(pr), repo: ctx.repo, ...extra });
      await runFixFlow(ctx, pr, prompt, eventDef(eventId)?.label ?? eventId, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // review comments (bug-bots and humans) anchored onto the diff
  const inlineComments = comments.filter((c) => c.kind === "review_comment" && c.path && c.line);
  const findings = useRepoStore((s) => s.findings).filter(
    (f) => f.prNumber === pr.number && f.status !== "dismissed"
  );
  const anchors: DiffAnchor[] = [
    ...inlineComments.map((c) => ({
      path: c.path!,
      line: c.line!,
      side: c.side ?? ("RIGHT" as const),
      node: <ExistingComment comment={c} />,
    })),
    // local-only self-review findings, inline next to the code they're about
    ...findings.map((f) => ({
      path: f.path,
      line: f.line,
      side: f.side,
      node: <FindingCard finding={f} pr={pr} />,
    })),
  ];

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
        {pr.draft && <Badge color="gray">draft</Badge>}
        {variant === "babysit" && (
          <>
            <CiBadge checks={checks} />
            <MergeBadge state={pr.mergeableState} />
            <Badge color={approvals >= ctx.config.requiredApprovals ? "green" : "gray"}>
              {approvals}/{ctx.config.requiredApprovals} approvals
            </Badge>
          </>
        )}
        <Badge color="gray">
          {pr.headRef} → {pr.baseRef}
        </Badge>
        <PrLabels pr={pr} />
        <span className="subtle">
          +{pr.additions} −{pr.deletions} · updated {timeAgo(pr.updatedAt)}
        </span>
      </div>

      <PrDescription pr={pr} />

      <SelfReviewBar pr={pr} />

      {variant === "babysit" && (failing.length > 0 || pr.mergeableState === "dirty" || activeRuns.length > 0) && (
        <div className="card">
          {failing.length > 0 && (
            <div className="subtle" style={{ marginBottom: 6 }}>
              failing: {failing.map((c) => c.name).join(", ")}
            </div>
          )}
          <div className="row">
            {failing.length > 0 && (
              <button className="small" onClick={() => void manualFix("ci_failed", "ci_fix")}>
                Fix CI now
              </button>
            )}
            {pr.mergeableState === "dirty" && (
              <button className="small" onClick={() => void manualFix("merge_conflict_detected", "conflict_fix")}>
                Resolve conflicts now
              </button>
            )}
            {activeRuns.length > 0 && (
              <span className="subtle">
                <Spinner /> {activeRuns.length} agent{activeRuns.length > 1 ? "s" : ""} working — see Activity Feed
              </span>
            )}
          </div>
        </div>
      )}

      {prProposals.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {prProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      )}

      <div className="card">
        <div className="subtle" style={{ marginBottom: 6 }}>
          Feedback or a question about the whole diff — or select lines below for a targeted run. Type{" "}
          <code>/</code> to reference a skill.
        </div>
        <PromptInput
          rows={3}
          placeholder={
            generalMode === "edit"
              ? "Describe the change to make across this PR…"
              : "Ask a question or request feedback on the diff (no code changes)…"
          }
          value={general}
          onChange={setGeneral}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <ModeSelect value={generalMode} onChange={setGeneralMode} />
          <ModelPicker value={model} onChange={setModel} />
          <button className="primary" disabled={busy || !general.trim()} onClick={() => void submitGeneral()}>
            {busy ? <Spinner /> : null} {generalMode === "edit" ? "Run agent" : "Ask"}
          </button>
          {error && <span style={{ color: "var(--red)" }}>{error}</span>}
        </div>
      </div>

      {myRuns.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {myRuns.slice(0, 6).map((r) => (
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
                  Pushed to <code>{pr.headRef}</code>.{" "}
                  <button className="link small" onClick={() => void loadDiff()}>
                    reload diff
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {diffErr && <p style={{ color: "var(--red)" }}>{diffErr}</p>}
      {!files && !diffErr && (
        <p className="subtle">
          <Spinner /> loading diff…
        </p>
      )}
      {files && (
        <DiffViewer
          files={files}
          selectable
          anchors={anchors}
          renderCommentForm={(sel, close) => (
            <LineCommentForm pr={pr} sel={sel} close={close} defaultModel={model} />
          )}
        />
      )}
      </div>
      <PrActivityPanel pr={pr} />
    </div>
  );
}

/** Mode picker mirroring Cursor's modes: Ask (read-only) / Change (agent edits). */
function ModeSelect({
  value,
  onChange,
}: {
  value: "ask" | "edit";
  onChange: (v: "ask" | "edit") => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as "ask" | "edit")} title="Agent mode">
      <option value="ask">Ask</option>
      <option value="edit">Change</option>
    </select>
  );
}

/** A review comment that already exists on GitHub, shown in place on the diff. */
function ExistingComment({ comment }: { comment: CommentInfo }) {
  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <strong>{comment.author}</strong>
        {comment.authorIsBot && <Badge color="purple">bot</Badge>}
        <span className="subtle">{age(comment.createdAt)}</span>
        <a href={comment.url} target="_blank" rel="noreferrer" className="subtle">
          view ↗
        </a>
      </div>
      <Markdown text={comment.body} className="compact" />
    </div>
  );
}

/** GitHub-style comment box attached to a line selection. */
function LineCommentForm({
  pr,
  sel,
  close,
  defaultModel,
}: {
  pr: PrSummary;
  sel: LineSelection;
  close: () => void;
  defaultModel: string;
}) {
  const { ctx } = useFlow();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"ask" | "edit">("edit");
  const [model, setModel] = useState(defaultModel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (mode === "edit") await runDraftEdit(ctx, pr, sel, text, model || undefined);
      else await runDraftQuestion(ctx, pr, text, sel, model || undefined);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="subtle" style={{ marginBottom: 6 }}>
        {sel.path}: lines {sel.startLine}
        {sel.endLine !== sel.startLine ? `–${sel.endLine}` : ""} ({sel.side === "RIGHT" ? "new" : "old"} side)
      </div>
      <PromptInput
        autoFocus
        rows={3}
        placeholder={mode === "edit" ? "Describe the change for these lines…" : "Ask about these lines…"}
        value={text}
        onChange={setText}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void submit();
        }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <ModeSelect value={mode} onChange={setMode} />
        <ModelPicker value={model} onChange={setModel} />
        <button className="primary" disabled={busy || !text.trim()} onClick={() => void submit()}>
          {busy ? <Spinner /> : null} {mode === "edit" ? "Run agent" : "Ask"}
        </button>
        <button onClick={close}>Cancel</button>
        {error && <span style={{ color: "var(--red)" }}>{error}</span>}
      </div>
    </div>
  );
}
