import { useEffect, useState } from "react";
import { parseUnifiedDiff } from "../../lib/diff";
import { usePrData } from "../../lib/events";
import { runDraftEdit, runDraftQuestion } from "../../lib/flows";
import { cleanResultText } from "../../lib/agents";
import { useAgentStore } from "../../lib/store";
import type { FileDiff, LineSelection, PrSummary } from "../../types";
import { Badge, Spinner, timeAgo } from "../common";
import { DiffViewer } from "../DiffViewer";
import { ModelPicker } from "../ModelPicker";
import { useFlow } from "../RepoApp";

/**
 * Drafts: the user's own draft PRs. Line-scoped feedback triggers an agent
 * immediately (no approval gate — it's the user's own draft); questions and
 * general feedback run read-only.
 */
export function DraftsView() {
  const drafts = usePrData((s) => s.myDrafts);
  const [selected, setSelected] = useState<number | null>(null);
  const pr = drafts.find((p) => p.number === selected) ?? drafts[0] ?? null;

  if (drafts.length === 0) {
    return (
      <div className="main">
        <div className="empty">
          <h3>No draft PRs</h3>
          <p>Your draft pull requests appear here as a workspace for iterating on the diff.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="main split">
      <div className="sidebar">
        {drafts.map((p) => (
          <div
            key={p.number}
            className={`card selectable ${pr?.number === p.number ? "selected" : ""}`}
            onClick={() => setSelected(p.number)}
          >
            <h4>
              #{p.number} {p.title}
            </h4>
            <div className="meta">
              <Badge color="gray">draft</Badge>
              <span>{p.headRef}</span>
              <span>
                +{p.additions} −{p.deletions}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="content">{pr && <DraftWorkspace key={pr.number} pr={pr} />}</div>
    </div>
  );
}

function DraftWorkspace({ pr }: { pr: PrSummary }) {
  const { ctx } = useFlow();
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [diffErr, setDiffErr] = useState("");
  const [model, setModel] = useState("");
  const [general, setGeneral] = useState("");
  const [generalMode, setGeneralMode] = useState<"edit" | "ask">("ask");
  const [busy, setBusy] = useState(false);
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

  const submitGeneral = async () => {
    if (!general.trim()) return;
    setBusy(true);
    try {
      if (generalMode === "edit") await runDraftEdit(ctx, pr, null, general, model || undefined);
      else await runDraftQuestion(ctx, pr, general, null, model || undefined);
      setGeneral("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="row between">
        <h2 className="viewtitle">
          #{pr.number} {pr.title}{" "}
          <a href={pr.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
            open on GitHub ↗
          </a>
        </h2>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Badge color="gray">
          {pr.headRef} → {pr.baseRef}
        </Badge>
        <span className="subtle">updated {timeAgo(pr.updatedAt)}</span>
      </div>

      <div className="card">
        <div className="subtle" style={{ marginBottom: 6 }}>
          General feedback or a question about the whole diff — or select lines below for a targeted change.
        </div>
        <textarea
          rows={3}
          placeholder={
            generalMode === "edit"
              ? "Describe the change to make across this PR…"
              : "Ask a question or request feedback on the diff (no code changes)…"
          }
          value={general}
          onChange={(e) => setGeneral(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <select value={generalMode} onChange={(e) => setGeneralMode(e.target.value as any)}>
            <option value="ask">Ask / get feedback</option>
            <option value="edit">Make a change</option>
          </select>
          <ModelPicker value={model} onChange={setModel} />
          <button className="primary" disabled={busy || !general.trim()} onClick={() => void submitGeneral()}>
            {busy ? <Spinner /> : null} {generalMode === "edit" ? "Run agent" : "Ask"}
          </button>
        </div>
      </div>

      {myRuns.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {myRuns.slice(0, 6).map((r) => (
            <div className="card" key={r.id}>
              <div className="row between">
                <div className="row">
                  {(r.status === "running" || r.status === "starting") && <Spinner />}
                  <Badge
                    color={
                      r.status === "done" ? "green" : r.status === "error" ? "red" : "blue"
                    }
                  >
                    {r.kind === "draft_edit" ? "edit" : "Q&A"} · {r.status}
                  </Badge>
                  <span className="subtle">{r.relation}</span>
                </div>
                <span className="subtle">{timeAgo(r.startedAt)}</span>
              </div>
              {r.kind === "draft_question" && r.resultText && (
                <div className="markdown-ish" style={{ marginTop: 8 }}>
                  {cleanResultText(r.resultText)}
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
          renderCommentForm={(sel, close) => (
            <LineCommentForm pr={pr} sel={sel} close={close} defaultModel={model} />
          )}
        />
      )}
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
  const [mode, setMode] = useState<"edit" | "ask">("edit");
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
      <textarea
        autoFocus
        rows={3}
        placeholder={mode === "edit" ? "Describe the change for these lines…" : "Ask about these lines…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void submit();
        }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
          <option value="edit">Make this change</option>
          <option value="ask">Ask about this</option>
        </select>
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
