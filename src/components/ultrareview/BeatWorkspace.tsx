import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { projectFocusedEvidence } from "../../lib/ultrareview-evidence";
import { startUltraReviewFollowUp } from "../../lib/ultrareview-flow";
import { ultraReviewSourceLabel } from "../../lib/ultrareview-analysis";
import {
  addUltraReviewBeatNote,
  addUltraReviewLineNote,
  dismissUltraReviewConcern,
  promoteUltraReviewConcern,
  verifyUltraReviewConcern,
} from "../../lib/ultrareview-session";
import { uid } from "../../lib/template";
import { useAgentStore } from "../../lib/store";
import type {
  CommentInfo,
  DiffViewerViewState,
  FileDiff,
  LineSelection,
  PrSummary,
  UltraReviewAnswer,
  UltraReviewArtifact,
  UltraReviewBeat,
  UltraReviewFollowUpAction,
  UltraReviewSession,
} from "../../types";
import { Badge, LoadingField } from "../common";
import {
  DiffViewer,
  type DiffAnchor,
  type RemoteViewedState,
} from "../DiffViewer";
import { useFlow } from "../flow";
import { findChapter } from "./navigation";
import {
  EMPTY_DIFF_VIEW_STATE,
  NoteComposer,
  lineNoteEvidenceId,
} from "./review-shared";

function EvidenceSourceRail({
  artifact,
  beat,
}: {
  artifact: UltraReviewArtifact;
  beat: UltraReviewBeat;
}) {
  const claims = artifact.sourceClaims.filter(
    (claim) => beat.sourceClaimIds.includes(claim.id),
  );
  const paths = [...new Set(
    artifact.evidence
      .filter((evidence) =>
        beat.evidenceIds.includes(evidence.id)
      )
      .map((evidence) => evidence.location.path),
  )];
  return (
    <section className="ultra-beat-brief">
      <div>
        <span className="u-mark">CHANGE CLAIM</span>
        <p>{beat.claim}</p>
      </div>
      {beat.question && (
        <div className="ultra-beat-question">
          <span className="u-mark">RISK QUESTION</span>
          <p>{beat.question}</p>
        </div>
      )}
      <details>
        <summary>
          Grounding and affected files
          <span>
            {claims.length} claim{claims.length === 1 ? "" : "s"}
            {" / "}
            {paths.length} file{paths.length === 1 ? "" : "s"}
          </span>
        </summary>
        <div className="ultra-beat-grounding">
          <div>
            <h3>Grounding</h3>
            {claims.length === 0 ? (
              <p className="subtle">
                No source claim survived validation.
              </p>
            ) : (
              <ul className="ultra-source-claims">
                {claims.map((claim) => (
                  <li key={claim.id}>
                    <span>{ultraReviewSourceLabel(claim.kind)}</span>
                    <p>{claim.claim}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>Affected files</h3>
            <ul className="ultra-path-list">
              {paths.map((path) => <li key={path}>{path}</li>)}
            </ul>
          </div>
        </div>
      </details>
    </section>
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
    Record<string, string>
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
        try {
          const repository = item.location.side === "RIGHT"
            ? pr.headRepoFullName || ctx.repo
            : ctx.repo;
          const ref = item.location.side === "RIGHT"
            ? pr.headSha
            : pr.baseSha;
          const file = await ctx.gh.getFileText(
            repository,
            item.location.path,
            ref,
          );
          if (cancelled) return;
          setContent((current) => ({
            ...current,
            [item.id]: file
              .split(/\r?\n/)
              .slice(start - 1, end)
              .join("\n"),
          }));
        } catch (error) {
          if (cancelled) return;
          setFailures((current) => ({
            ...current,
            [item.id]:
              error instanceof Error
                ? error.message
                : String(error),
          }));
        }
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
        <p>
          Supporting code explains behavior.
          It never counts toward changed-line coverage.
        </p>
      </header>
      {supporting.map((item) => (
        <article
          key={item.id}
          id={`ultra-support-${item.id}`}
          data-ultra-evidence-id={item.id}
        >
          <div>
            <strong>
              {item.location.path}:
              {item.location.startLine}–
              {item.location.endLine}
            </strong>
            <span>{item.supportingReason}</span>
          </div>
          {content[item.id] !== undefined ? (
            <pre><code>{content[item.id]}</code></pre>
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

function EvidenceRelationshipDiagram({
  evidence,
}: {
  evidence: UltraReviewArtifact["evidence"];
}) {
  const nodes = [...new Map(
    evidence.map((item) => [item.location.path, item]),
  ).values()];
  if (nodes.length < 3) return null;

  const reveal = (
    item: UltraReviewArtifact["evidence"][number],
  ) => {
    const supporting = document.getElementById(
      `ultra-support-${item.id}`,
    );
    const changed = [...document.querySelectorAll<HTMLElement>(
      ".ultra-evidence-canvas .diff-file",
    )].find(
      (element) =>
        element.dataset.path === item.location.path,
    );
    (supporting ?? changed)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  return (
    <section
      className="ultra-relationship-diagram"
      aria-label="Source-linked component relationship"
    >
      <header>
        <span className="u-mark">RELATIONSHIP</span>
        <h2>{nodes.length} components move together.</h2>
      </header>
      <div>
        {nodes.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => reveal(item)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{item.location.path}</strong>
            <small>
              {item.kind === "supporting"
                ? "unchanged support"
                : "changed evidence"}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

const followUpLabels: Record<
  UltraReviewFollowUpAction,
  { label: string; question: string }
> = {
  trace_callers: {
    label: "Trace callers",
    question:
      "Trace the callers and describe the runtime path through this change.",
  },
  explain_dependency: {
    label: "Explain this dependency",
    question:
      "Explain why this dependency exists and what contract it creates.",
  },
  find_relevant_tests: {
    label: "Find relevant tests",
    question:
      "Find the tests that prove this behavior and name any visible proof gap.",
  },
  question: {
    label: "Ask",
    question: "",
  },
};

function FollowUpPanel({
  pr,
  artifact,
  session,
  beat,
  onMutate,
  readOnly,
}: {
  pr: PrSummary;
  artifact: UltraReviewArtifact;
  session: UltraReviewSession;
  beat: UltraReviewBeat;
  onMutate: (
    updater: (artifact: UltraReviewArtifact) => UltraReviewArtifact,
  ) => void;
  readOnly: boolean;
}) {
  const { ctx } = useFlow();
  const [question, setQuestion] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const run = useAgentStore(
    (state) => runId ? state.runs[runId] ?? null : null,
  );
  const asking =
    run?.status === "starting" || run?.status === "running";
  const answers = session.answers.filter(
    (answer) => answer.beatId === beat.id,
  );

  const ask = async (
    action: UltraReviewFollowUpAction,
    nextQuestion: string,
  ) => {
    setError("");
    try {
      const nextRunId = await startUltraReviewFollowUp({
        ctx,
        pr,
        artifactKey: artifact.artifactKey,
        mode: session.mode,
        beatId: beat.id,
        action,
        question: nextQuestion,
      });
      setRunId(nextRunId);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : String(nextError),
      );
    }
  };

  const addAnswerNote = (answer: UltraReviewAnswer) => {
    onMutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [session.mode]: addUltraReviewBeatNote(
          current.sessions[session.mode],
          current,
          {
            id: `answer:${answer.id}`,
            beatId: beat.id,
            body: answer.text,
            createdAt: Date.now(),
          },
        ),
      },
    }));
  };

  return (
    <section className="ultra-investigation-tools">
      <div>
        <span className="u-mark">INVESTIGATE</span>
        <h2>Question the evidence.</h2>
      </div>
      <div className="row">
        {([
          "trace_callers",
          "explain_dependency",
          "find_relevant_tests",
        ] as const).map((action) => (
          <button
            key={action}
            type="button"
            className="small"
            disabled={asking || readOnly}
            onClick={() =>
              readOnly
                ? undefined
                : void ask(
                    action,
                    followUpLabels[action].question,
                  )}
          >
            {followUpLabels[action].label}
          </button>
        ))}
      </div>
      <label>
        <span>Ask this beat</span>
        <div className="row">
          <input
            type="text"
            disabled={readOnly}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What happens when this path retries?"
          />
          <button
            type="button"
            disabled={readOnly || asking || !question.trim()}
            onClick={() => {
              if (readOnly) return;
              const next = question.trim();
              setQuestion("");
              void ask("question", next);
            }}
          >
            {asking ? "Asking…" : "Ask"}
          </button>
        </div>
      </label>
      {error && <p className="ultra-form-error">{error}</p>}
      {answers.length > 0 && (
        <div className="ultra-follow-up-answers">
          {answers.map((answer) => {
            const added = session.notes.some(
              (note) => note.id === `answer:${answer.id}`,
            );
            return (
              <article
                key={answer.id}
                data-status={answer.status}
              >
                <header>
                  <strong>
                    {followUpLabels[answer.action].label}
                  </strong>
                  <span>
                    {answer.stale
                      ? "Prior head · stale"
                      : answer.status}
                  </span>
                </header>
                <p>
                  {answer.status === "failed"
                    ? answer.error
                    : answer.text}
                </p>
                {answer.citationIds.length > 0 && (
                  <ul>
                    {answer.citationIds.map((id) => {
                      const cited = artifact.evidence.find(
                        (item) => item.id === id,
                      );
                      return (
                        <li key={id}>
                          {cited
                            ? `${cited.location.path}:${cited.location.startLine}–${cited.location.endLine}`
                            : id}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="row">
                  {answer.status === "complete" && (
                    <button
                      type="button"
                      className="small"
                      disabled={readOnly || added || answer.stale}
                      onClick={() => addAnswerNote(answer)}
                    >
                      {added ? "Added to ledger" : "Add as human note"}
                    </button>
                  )}
                  {answer.status === "failed" && (
                    <button
                      type="button"
                      className="small"
                      disabled={readOnly || asking}
                      onClick={() =>
                        readOnly
                          ? undefined
                          : void ask(
                              answer.action,
                              answer.question,
                            )}
                    >
                      Retry this question
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function BeatWorkspace({
  pr,
  artifact,
  session,
  beat,
  files,
  comments,
  onMutate,
  remoteViewed,
  viewedKey,
  readOnly,
}: {
  pr: PrSummary;
  artifact: UltraReviewArtifact;
  session: UltraReviewSession;
  beat: UltraReviewBeat;
  files: FileDiff[];
  comments: CommentInfo[];
  onMutate: (
    updater: (artifact: UltraReviewArtifact) => UltraReviewArtifact,
  ) => void;
  remoteViewed?: RemoteViewedState;
  viewedKey?: string;
  readOnly: boolean;
}) {
  const { ctx } = useFlow();
  const chapter = findChapter(
    artifact,
    artifact.sessions[session.mode].resume.chapterId,
  );
  const [noteError, setNoteError] = useState("");
  const evidence = artifact.evidence.filter(
    (reference) => beat.evidenceIds.includes(reference.id),
  );
  const ranges = evidence
    .filter(
      (reference) =>
        reference.location.startLine !== null
        && reference.location.endLine !== null,
    )
    .map((reference) => ({
      path: reference.location.path,
      side: reference.location.side,
      startLine: reference.location.startLine!,
      endLine: reference.location.endLine!,
    }));
  const focused = projectFocusedEvidence(files, ranges);
  const beatNotes = session.notes.filter(
    (note) =>
      note.anchor.kind === "beat"
        ? note.anchor.beatId === beat.id
        : beat.evidenceIds.includes(note.anchor.evidenceId),
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
          <span>Human note · local</span>
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
            <p>{comment.body}</p>
          </article>
        ),
      }];
    },
  );
  const anchors = [...noteAnchors, ...commentAnchors];

  const addBeatNote = (body: string): boolean => {
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
  ): boolean => {
    const evidenceId = lineNoteEvidenceId(
      artifact,
      selection,
    );
    if (!evidenceId) {
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
              review: state,
            },
          },
        },
      },
    }));
    },
    [onMutate, session.mode],
  );

  const concerns = artifact.concerns.filter(
    (concern) => concern.beatId === beat.id,
  );
  return (
    <main className="ultra-beat-workspace">
      <div className="ultra-beat-grid">
        <div className="ultra-evidence-canvas">
          <header className="ultra-evidence-head">
            <div>
              <span className="u-mark">
                {chapter?.title ?? "REVIEW CHAPTER"}
                {" / "}
                {focused.length} FOCUSED FILE
                {focused.length === 1 ? "" : "S"}
              </span>
              <h1>{beat.title}</h1>
              <p>{beat.objective}</p>
            </div>
          </header>
          <EvidenceSourceRail
            artifact={artifact}
            beat={beat}
          />

          {focused.length === 0 ? (
            <div className="ultra-unmapped-evidence">
              <h2>No focal evidence survived projection.</h2>
              <p>
                This beat cannot count as covered.
                Open Raw Diff and inspect the unmapped region.
              </p>
            </div>
          ) : (
            <DiffViewer
              key={beat.id}
              files={focused}
              anchors={anchors}
              selectable={!readOnly}
              initialViewState={
                session.resume.diffViewStates?.review
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
              renderCommentForm={
                readOnly
                  ? undefined
                  : (selection, close) => (
                      <NoteComposer
                        label={`${selection.path}:${selection.startLine}–${selection.endLine}`}
                        onSave={(body) =>
                          addLineNote(selection, body)}
                        onSaved={close}
                        onCancel={close}
                      />
                    )
              }
            />
          )}

          <SupportingEvidencePanel
            pr={pr}
            evidence={evidence}
          />
          <EvidenceRelationshipDiagram evidence={evidence} />

          {noteError && (
            <p className="ultra-form-error">{noteError}</p>
          )}

          <FollowUpPanel
            key={beat.id}
            pr={pr}
            artifact={artifact}
            session={session}
            beat={beat}
            onMutate={onMutate}
            readOnly={readOnly}
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
                  {note.anchor.kind === "line"
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
    </main>
  );
}
