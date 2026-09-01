import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { projectOwnedBeatHunks } from "../../lib/ultrareview-evidence";
import {
  addUltraReviewBeatNote,
  addUltraReviewLineNote,
  dismissUltraReviewConcern,
  promoteUltraReviewConcern,
  verifyUltraReviewConcern,
} from "../../lib/ultrareview-session";
import { uid } from "../../lib/template";
import type {
  CommentInfo,
  DiffViewerViewState,
  FileDiff,
  LineSelection,
  PrSummary,
  UltraReviewArtifact,
  UltraReviewBeat,
  UltraReviewChapter,
  UltraReviewNoteKind,
  UltraReviewSession,
} from "../../types";
import { Badge, LoadingField } from "../common";
import {
  DiffViewer,
  type DiffAnchor,
} from "../DiffViewer";
import { useFlow } from "../flow";
import {
  EMPTY_DIFF_VIEW_STATE,
  GitHubCommentBody,
  NoteComposer,
  lineNoteEvidenceIds,
} from "./review-shared";

function BeatContext({
  beat,
  chapter,
}: {
  beat: UltraReviewBeat;
  chapter: UltraReviewChapter;
}) {
  return (
    <section className="ultra-beat-brief">
      <div className="ultra-beat-context-lead">
        <span className="u-mark">WHY THIS BEAT EXISTS</span>
        <p>{chapter.purpose}</p>
      </div>
      <div>
        <span className="u-mark">WHAT CHANGES</span>
        <p>{beat.claim}</p>
      </div>
      <div className="ultra-beat-pr-connection">
        <span className="u-mark">PR CONNECTION</span>
        <p>{beat.objective}</p>
      </div>
    </section>
  );
}

export function BeatSummary({
  beat,
  chapter,
  beatNumber,
}: {
  beat: UltraReviewBeat;
  chapter: UltraReviewChapter;
  beatNumber: number;
}) {
  return (
    <>
      <header className="ultra-evidence-head">
        <div>
          <span className="u-mark">
            Section {beatNumber} · {chapter.title}
          </span>
          <h2>{beat.title}</h2>
        </div>
      </header>
      <BeatContext
        beat={beat}
        chapter={chapter}
      />
    </>
  );
}

function SupportingEvidencePanel({
  pr,
  evidence,
}: {
  pr: PrSummary;
  evidence: UltraReviewArtifact["evidence"];
}) {
  const { ctx } = useFlow();
  const supporting = evidence.filter(
    (item) => item.kind === "supporting",
  );
  const [content, setContent] = useState<
    Record<string, { path: string; text: string }>
  >({});
  const [failures, setFailures] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      supporting.map(async (item) => {
        const start = item.location.startLine;
        const end = item.location.endLine;
        if (start === null || end === null) return;
        const repository = item.location.side === "RIGHT"
          ? pr.headRepoFullName || ctx.repo
          : ctx.repo;
        const ref = item.location.side === "RIGHT"
          ? pr.headSha
          : pr.baseSha;
        const firstSegment = item.location.path.split("/")[0];
        const marker = `/${firstSegment}/`;
        const candidates = [...new Set([
          item.location.path,
          ...evidence.flatMap((candidate) => {
            const markerIndex =
              candidate.location.path.indexOf(marker);
            if (markerIndex < 0) return [];
            return [
              candidate.location.path.slice(0, markerIndex + 1)
              + item.location.path,
            ];
          }),
        ])];
        for (const candidate of candidates) {
          try {
            const file = await ctx.gh.getFileText(
              repository,
              candidate,
              ref,
            );
            if (cancelled) return;
            setContent((current) => ({
              ...current,
              [item.id]: {
                path: candidate,
                text: file
                  .split(/\r?\n/)
                  .slice(start - 1, end)
                  .join("\n"),
              },
            }));
            return;
          } catch {
            // Try a repository subroot inferred from this beat's changed files.
          }
        }
        if (cancelled) return;
        setFailures((current) => ({
          ...current,
          [item.id]:
            "This source range is not present at the review head.",
        }));
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [
    ctx.gh,
    ctx.repo,
    pr.baseSha,
    pr.headRepoFullName,
    pr.headSha,
    evidence.map((item) => item.location.path).join("\0"),
    supporting.map((item) => item.id).join("\0"),
  ]);

  if (supporting.length === 0) return null;
  return (
    <section className="ultra-supporting-evidence">
      <header>
        <span className="u-mark">
          UNCHANGED SUPPORTING CODE
        </span>
        <h2>Impact beyond the diff.</h2>
      </header>
      {supporting.map((item) => (
        <article
          key={item.id}
          id={`ultra-support-${item.id}`}
          data-ultra-evidence-id={item.id}
        >
          <div>
            <strong>
              {content[item.id]?.path ?? item.location.path}
            </strong>
            <small>
              Lines {item.location.startLine}–{item.location.endLine}
            </small>
            <span>{item.supportingReason}</span>
          </div>
          {content[item.id] !== undefined ? (
            <pre><code>{content[item.id].text}</code></pre>
          ) : failures[item.id] ? (
            <p className="ultra-form-error">
              Supporting source unavailable: {failures[item.id]}
            </p>
          ) : (
            <LoadingField label="loading unchanged source…" />
          )}
        </article>
      ))}
    </section>
  );
}

export function BeatWorkspace({
  pr,
  artifact,
  session,
  chapter,
  beat,
  beatNumber,
  focusedFiles,
  reviewUnitStart,
  showSummary = true,
  files,
  comments,
  onMutate,
  readOnly,
}: {
  pr: PrSummary;
  artifact: UltraReviewArtifact;
  session: UltraReviewSession;
  chapter: UltraReviewChapter;
  beat: UltraReviewBeat;
  beatNumber: number;
  focusedFiles?: FileDiff[];
  reviewUnitStart?: number;
  showSummary?: boolean;
  files: FileDiff[];
  comments: CommentInfo[];
  onMutate: (
    updater: (artifact: UltraReviewArtifact) => UltraReviewArtifact,
  ) => void;
  readOnly: boolean;
}) {
  const { ctx } = useFlow();
  const [noteError, setNoteError] = useState("");
  const evidence = artifact.evidence.filter(
    (reference) => beat.evidenceIds.includes(reference.id),
  );
  const focused = useMemo(
    () => focusedFiles ?? projectOwnedBeatHunks(
      files,
      artifact,
      beat.id,
    ),
    [artifact, beat.id, files, focusedFiles],
  );
  const beatNotes = session.notes.filter(
    (note) =>
      note.anchor.kind === "beat"
        ? note.anchor.beatId === beat.id
        : note.anchor.evidenceIds.some((evidenceId) =>
            beat.evidenceIds.includes(evidenceId)
          ),
  );
  const noteAnchors: DiffAnchor[] = beatNotes.flatMap((note) => {
    if (note.anchor.kind !== "line") return [];
    return [{
      path: note.anchor.path,
      line: note.anchor.endLine,
      side: note.anchor.side,
      tone: "local" as const,
      node: (
        <article className="ultra-inline-note">
          <span>{note.kind} · local</span>
          <p>{note.body}</p>
        </article>
      ),
    }];
  });
  const commentAnchors: DiffAnchor[] = comments.flatMap(
    (comment) => {
      if (
        !comment.path
        || comment.line === undefined
        || comment.side === undefined
        || !evidence.some(
          (item) =>
            item.location.path === comment.path
            && item.location.side === comment.side
            && item.location.startLine !== null
            && item.location.endLine !== null
            && comment.line! >= item.location.startLine
            && comment.line! <= item.location.endLine,
        )
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
            <GitHubCommentBody comment={comment} />
          </article>
        ),
      }];
    },
  );
  const anchors = [...noteAnchors, ...commentAnchors];

  const addBeatNote = (
    body: string,
    kind: UltraReviewNoteKind,
  ): boolean => {
    onMutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [session.mode]: addUltraReviewBeatNote(
          current.sessions[session.mode],
          current,
          {
            id: uid("ultra-note-"),
            beatId: beat.id,
            body,
            kind,
            createdAt: Date.now(),
          },
        ),
      },
    }));
    return true;
  };

  const addLineNote = (
    selection: LineSelection,
    body: string,
    kind: UltraReviewNoteKind,
  ): boolean => {
    const evidenceIds = lineNoteEvidenceIds(
      artifact,
      selection,
    );
    if (!evidenceIds) {
      setNoteError(
        "That range is context, not changed evidence. Anchor the note to a changed line.",
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
            evidenceIds,
            body,
            kind,
            startLine: selection.startLine,
            endLine: selection.endLine,
            createdAt: Date.now(),
          },
        ),
      },
    }));
    return true;
  };

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
                beats: {
                  ...current.sessions[session.mode].resume
                    .diffViewStates?.beats,
                  [beat.id]: state,
                },
              },
            },
          },
        },
      }));
    },
    [beat.id, onMutate, session.mode],
  );

  const concerns = artifact.concerns.filter(
    (concern) => concern.beatId === beat.id,
  );
  return (
    <div className="ultra-beat-workspace">
      <div className="ultra-beat-grid">
        <div className="ultra-evidence-canvas">
          {showSummary && (
            <BeatSummary
              beat={beat}
              chapter={chapter}
              beatNumber={beatNumber}
            />
          )}

          {focused.length === 0 ? (
            <div className="ultra-context-only-evidence">
              <h2>Code already appeared in an earlier beat.</h2>
              <p>
                Its diff hunk belongs to an earlier causal beat,
                so Charon keeps the context here without repeating code.
              </p>
            </div>
          ) : (
            <DiffViewer
              key={`diff:${beat.id}`}
              files={focused}
              reviewUnitStart={reviewUnitStart}
              anchors={anchors}
              selectable={!readOnly}
              initialViewState={
                session.resume.diffViewStates?.beats?.[beat.id]
                ?? EMPTY_DIFF_VIEW_STATE
              }
              onViewStateChange={persistViewState}
              trackViewed
              disablePatternAutoCollapse
              loadFileText={(path, side) =>
                ctx.gh.getFileText(
                  side === "RIGHT"
                    ? pr.headRepoFullName || ctx.repo
                    : ctx.repo,
                  path,
                  side === "RIGHT" ? pr.headSha : pr.baseSha,
                )}
              renderCommentForm={
                readOnly
                  ? undefined
                  : (selection, close) => (
                      <NoteComposer
                        label={`${selection.path}:${selection.startLine}–${selection.endLine}`}
                        onSave={(body, kind) =>
                          addLineNote(selection, body, kind)}
                        onSaved={close}
                        onCancel={() => {
                          setNoteError("");
                          close();
                        }}
                        error={noteError}
                      />
                    )
              }
            />
          )}

          <SupportingEvidencePanel
            pr={pr}
            evidence={evidence}
          />

          {concerns.length > 0 && (
            <section className="ultra-concerns">
              <header>
                <span className="u-mark">MODEL QUESTIONS</span>
                <h2>Questions, not findings.</h2>
              </header>
              {concerns.map((concern) => {
                const disposition =
                  session.concernDispositions[concern.id];
                return (
                  <article
                    key={concern.id}
                    data-disposition={disposition ?? "open"}
                  >
                    <div>
                      <Badge color={
                        concern.severity === "blocker"
                        || concern.severity === "major"
                          ? "red"
                          : "yellow"
                      }>
                        {concern.severity}
                      </Badge>
                      <p>{concern.question}</p>
                    </div>
                    <div className="row">
                      {(["dismissed", "verified", "promoted"] as const)
                        .map((next) => (
                          <button
                            key={next}
                            type="button"
                            className="small"
                            disabled={
                              readOnly || disposition === next
                            }
                            onClick={() => onMutate((current) => {
                              if (readOnly) return current;
                              const active =
                                current.sessions[session.mode];
                              const updated =
                                next === "dismissed"
                                  ? dismissUltraReviewConcern(
                                      active,
                                      concern.id,
                                    )
                                  : next === "verified"
                                    ? verifyUltraReviewConcern(
                                        active,
                                        concern.id,
                                      )
                                    : promoteUltraReviewConcern(
                                        active,
                                        concern,
                                        {
                                          createdAt: Date.now(),
                                        },
                                      );
                              return {
                                ...current,
                                sessions: {
                                  ...current.sessions,
                                  [session.mode]: updated,
                                },
                              };
                            })}
                          >
                            {next === "dismissed"
                              ? "Dismiss"
                              : next === "verified"
                                ? "Verify"
                                : "Promote to note"}
                          </button>
                        ))}
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          <section className="ultra-beat-notes">
            <header>
              <div>
                <span className="u-mark">HUMAN LEDGER</span>
                <h2>
                  {beatNotes.length} note
                  {beatNotes.length === 1 ? "" : "s"} here
                </h2>
              </div>
            </header>
            {beatNotes.map((note) => (
              <article key={note.id}>
                <span>
                  {note.kind} · {note.anchor.kind === "line"
                    ? `${note.anchor.path}:${note.anchor.startLine}`
                    : "Beat note"}
                  {note.stale ? " · prior head" : ""}
                </span>
                <p>{note.body}</p>
              </article>
            ))}
            {!readOnly && (
              <NoteComposer
                label="Beat note"
                onSave={addBeatNote}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
