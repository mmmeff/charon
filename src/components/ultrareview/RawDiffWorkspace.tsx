import { useCallback, useState } from "react";
import { addUltraReviewLineNote } from "../../lib/ultrareview-session";
import { uid } from "../../lib/template";
import type {
  CommentInfo,
  DiffViewerViewState,
  FileDiff,
  LineSelection,
  PrSummary,
  UltraReviewArtifact,
  UltraReviewSession,
} from "../../types";
import {
  DiffViewer,
  type DiffAnchor,
  type RemoteViewedState,
} from "../DiffViewer";
import { useFlow } from "../flow";
import {
  EMPTY_DIFF_VIEW_STATE,
  NoteComposer,
  lineNoteEvidenceId,
} from "./review-shared";

export function RawDiffWorkspace({
  artifact,
  session,
  files,
  comments,
  onMutate,
  pr,
  remoteViewed,
  viewedKey,
  readOnly,
}: {
  artifact: UltraReviewArtifact;
  session: UltraReviewSession;
  files: FileDiff[];
  comments: CommentInfo[];
  onMutate: (
    updater: (artifact: UltraReviewArtifact) => UltraReviewArtifact,
  ) => void;
  pr: PrSummary;
  remoteViewed?: RemoteViewedState;
  viewedKey?: string;
  readOnly: boolean;
}) {
  const { ctx } = useFlow();
  const [noteError, setNoteError] = useState("");
  const persistViewState = useCallback(
    (state: DiffViewerViewState) => {
      onMutate((current) => ({
        ...current,
        sessions: {
          ...current.sessions,
          [session.mode]: {
            ...current.sessions[session.mode],
            resume: {
              ...current.sessions[session.mode].resume,
              diffViewStates: {
                ...current.sessions[session.mode].resume.diffViewStates,
                raw: state,
              },
            },
          },
        },
      }));
    },
    [onMutate, session.mode],
  );
  const noteAnchors: DiffAnchor[] = session.notes.flatMap((note) => {
    if (note.anchor.kind !== "line") return [];
    return [{
      path: note.anchor.path,
      line: note.anchor.endLine,
      side: note.anchor.side,
      tone: "local" as const,
      node: (
        <article className="ultra-inline-note">
          <span>
            Human note · {note.stale ? "prior head" : "local"}
          </span>
          <p>{note.body}</p>
        </article>
      ),
    }];
  });
  const commentAnchors: DiffAnchor[] = comments.flatMap((comment) => {
    if (
      !comment.path
      || comment.line === undefined
      || comment.side === undefined
    ) {
      return [];
    }
    return [{
      path: comment.path,
      line: comment.line,
      side: comment.side,
      tone: "github" as const,
      node: (
        <article className="ultra-inline-thread">
          <span>
            Existing GitHub feedback · @{comment.author}
          </span>
          <p>{comment.body}</p>
        </article>
      ),
    }];
  });
  const anchors = [...noteAnchors, ...commentAnchors];
  const credit = (evidenceId: string) => {
    if (!evidenceId) return;
    onMutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [session.mode]: {
          ...current.sessions[session.mode],
          creditedEvidenceIds: [
            ...new Set([
              ...current.sessions[session.mode].creditedEvidenceIds,
              evidenceId,
            ]),
          ],
        },
      },
    }));
  };
  const addLineNote = (
    selection: LineSelection,
    body: string,
  ) => {
    const evidenceId = lineNoteEvidenceId(
      artifact,
      selection,
    );
    if (!evidenceId) {
      setNoteError(
        "That range is not mapped changed evidence. It cannot receive a durable UltraReview line note.",
      );
      return false;
    }
    setNoteError("");
    onMutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [session.mode]: addUltraReviewLineNote(
          current.sessions[session.mode],
          current,
          {
            id: uid("ultra-note-"),
            evidenceId,
            body,
            startLine: selection.startLine,
            endLine: selection.endLine,
            createdAt: Date.now(),
          },
        ),
      },
    }));
    return true;
  };
  return (
    <main className="ultra-raw-diff">
      <header>
        <div>
          <span className="u-mark">RAW DIFF / SAME LEDGER</span>
          <h1>File order is evidence, not the story.</h1>
        </div>
      </header>
      <DiffViewer
        files={files}
        anchors={anchors}
        selectable={!readOnly}
        initialViewState={
          session.resume.diffViewStates?.raw
          ?? EMPTY_DIFF_VIEW_STATE
        }
        onViewStateChange={persistViewState}
        remoteViewed={remoteViewed}
        viewedKey={viewedKey}
        loadFileText={(path, side) =>
          ctx.gh.getFileText(
            side === "RIGHT"
              ? pr.headRepoFullName || ctx.repo
              : ctx.repo,
            path,
            side === "RIGHT" ? pr.headSha : pr.baseSha,
          )}
        renderCommentForm={readOnly ? undefined : (next, close) => (
          <div className="ultra-raw-credit">
            <p>
              {lineNoteEvidenceId(artifact, next)
                ? "Explicitly credit this mapped evidence after inspection."
                : "Select a changed line to credit mapped evidence."}
            </p>
            <div className="row">
              <button
                type="button"
                className="primary small"
                disabled={!lineNoteEvidenceId(artifact, next)}
                onClick={() => {
                  const evidenceId =
                    lineNoteEvidenceId(artifact, next);
                  if (evidenceId) credit(evidenceId);
                  close();
                }}
              >
                Credit inspected evidence
              </button>
              <button
                type="button"
                className="small"
                onClick={close}
              >
                Cancel
              </button>
            </div>
            <NoteComposer
              label={`Shared ledger note · ${next.path}:${next.startLine}–${next.endLine}`}
              onSave={(body) => addLineNote(next, body)}
              onSaved={close}
            />
            {noteError && (
              <p className="ultra-form-error">{noteError}</p>
            )}
          </div>
        )}
      />
    </main>
  );
}
