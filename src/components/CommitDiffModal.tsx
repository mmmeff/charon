import { useEffect, useState } from "react";
import { parseUnifiedDiff } from "../lib/diff";
import { useUiStore } from "../lib/store";
import { age } from "../lib/ui";
import type { CommitInfo, FileDiff } from "../types";
import { LoadingField } from "./common";
import { DiffViewer } from "./DiffViewer";
import { useFlow } from "./flow";

const firstLine = (s: string) => {
  const l = (s ?? "").split("\n").find((x) => x.trim()) ?? "";
  return l.length > 110 ? l.slice(0, 110) + "…" : l;
};

/**
 * Full-screen modal that renders a single commit's diff by sha. Opened from
 * agent-run cards (the commit an agent pushed) and from the activity feed's
 * "{user} pushed {hash}" events. Diff + metadata come straight from the GitHub
 * API, so the commit must be on the remote (every agent push and timeline
 * commit is). One repo per window, so the active flow's client is the right one.
 */
export function CommitDiffModal() {
  const view = useUiStore((s) => s.commitView);
  const close = useUiStore((s) => s.closeCommit);
  const { ctx } = useFlow();
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [meta, setMeta] = useState<CommitInfo | null>(null);
  const [err, setErr] = useState("");

  const repo = view?.repo;
  const sha = view?.sha;

  useEffect(() => {
    if (!repo || !sha) return;
    setFiles(null);
    setMeta(null);
    setErr("");
    let cancelled = false;
    void (async () => {
      try {
        const [diff, info] = await Promise.all([
          ctx.gh.getCommitDiff(repo, sha),
          ctx.gh.getCommit(repo, sha).catch(() => null),
        ]);
        if (cancelled) return;
        setFiles(parseUnifiedDiff(diff));
        if (info) setMeta(info);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, sha, ctx.gh]);

  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, close]);

  if (!view) return null;

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal-card commit-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <code className="commit-sha">{view.sha.slice(0, 10)}</code>
          {meta?.message && <span className="commit-modal-msg">{firstLine(meta.message)}</span>}
          <span style={{ flex: 1 }} />
          {meta?.url && (
            <a href={meta.url} className="subtle" title="Open commit on GitHub">
              ↗
            </a>
          )}
          <button className="small" onClick={close}>
            ✕ close
          </button>
        </div>
        {meta && (
          <div className="commit-modal-sub subtle">
            {meta.author && <strong>{meta.author}</strong>}
            {meta.date ? ` committed ${age(meta.date)}` : ""}
            {" · "}
            <span className="add">+{meta.additions}</span> <span className="del">−{meta.deletions}</span>
            {" · "}
            {meta.filesChanged} file{meta.filesChanged === 1 ? "" : "s"}
          </div>
        )}
        <div className="modal-body">
          {err && <p style={{ color: "var(--red)" }}>{err}</p>}
          {!files && !err && <LoadingField label="loading commit diff…" />}
          {files && files.length === 0 && !err && (
            <p className="subtle">No file changes in this commit (it may be empty or a merge commit).</p>
          )}
          {files && files.length > 0 && <DiffViewer files={files} />}
        </div>
      </div>
    </div>
  );
}
