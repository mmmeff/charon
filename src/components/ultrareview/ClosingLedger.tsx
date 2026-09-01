import { useEffect, useRef, useState } from "react";
import {
  auditUltraReviewCoverage,
  calculateUltraReviewProgress,
} from "../../lib/ultraReview";
import { projectFocusedEvidence } from "../../lib/ultrareview-evidence";
import { startUltraReviewClosingDraft } from "../../lib/ultrareview-flow";
import {
  buildUltraReviewSubmission,
  submitUltraReviewWithReceipt,
} from "../../lib/ultrareview-submission";
import {
  buildUltraReviewSubmissionSnapshot,
  recordUltraReviewSubmissionSnapshot,
  ultraReviewNotesFingerprint,
  updateUltraReviewNote,
} from "../../lib/ultrareview-session";
import { recordUltraReviewDiagnostic } from "../../lib/ultrareview-diagnostics-store";
import { useUltraReviewStore } from "../../lib/ultrareview-store";
import { applyFindings } from "../../lib/flows";
import { useAgentStore, useRepoStore } from "../../lib/store";
import { uid } from "../../lib/template";
import type {
  CheckInfo,
  CommentInfo,
  FileDiff,
  PrSummary,
  ProposedInlineComment,
  ReviewFinding,
  UltraReviewArtifact,
  UltraReviewDraftInlineComment,
  UltraReviewNote,
  UltraReviewNoteKind,
  UltraReviewSession,
  UltraReviewSubmissionSnapshot,
} from "../../types";
import { DiffViewer, type DiffAnchor } from "../DiffViewer";
import { useFlow } from "../flow";
import { allBeats, allChapters } from "./navigation";
import {
  GitHubCommentBody,
  ULTRA_REVIEW_NOTE_KIND_OPTIONS,
} from "./review-shared";

function ClosingNoteEditor({
  note,
  readOnly,
  mode,
  fixSelected,
  onFixSelected,
  onSave,
  onSubmitAsComment,
}: {
  note: UltraReviewNote;
  readOnly: boolean;
  mode: UltraReviewSession["mode"];
  fixSelected: boolean;
  onFixSelected: (selected: boolean) => void;
  onSave: (body: string, kind: UltraReviewNoteKind) => void;
  onSubmitAsComment: (selected: boolean) => void;
}) {
  const [body, setBody] = useState(note.body);
  const [kind, setKind] = useState(note.kind);
  useEffect(() => {
    setBody(note.body);
    setKind(note.kind);
  }, [note.body, note.kind]);
  const changed = body.trim() !== note.body
    || kind !== note.kind;
  const anchorLabel = note.anchor.kind === "beat"
    ? "section"
    : `${note.anchor.path}:${note.anchor.startLine}–${note.anchor.endLine}`;
  return (
    <article
      id={`ultra-ledger-note-${note.id}`}
      className="ultra-closing-note"
      data-kind={note.kind}
      data-stale={note.stale}
    >
      <header>
        <select
          aria-label={`Note type for ${anchorLabel}`}
          disabled={readOnly}
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as UltraReviewNoteKind)
          }
        >
          {ULTRA_REVIEW_NOTE_KIND_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <span>
          {note.anchor.kind === "beat" ? "Section note" : anchorLabel}
          {note.stale ? " · prior head" : ""}
        </span>
      </header>
      <textarea
        className="input-prose"
        aria-label={`Note for ${anchorLabel}`}
        rows={Math.max(3, body.split("\n").length)}
        readOnly={readOnly}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <footer>
        <div className="row">
          <button
            type="button"
            className="small"
            disabled={readOnly || !changed || !body.trim()}
            onClick={() => onSave(body.trim(), kind)}
          >
            Save note
          </button>
          {mode === "teammate" && note.anchor.kind === "line" && (
            <label>
              <input
                type="checkbox"
                disabled={readOnly || note.stale}
                checked={note.submitAsComment && !note.stale}
                onChange={(event) =>
                  onSubmitAsComment(event.target.checked)
                }
              />
              Submit as inline comment
            </label>
          )}
          {mode === "author" && (
            <label>
              <input
                type="checkbox"
                disabled={readOnly || note.stale}
                checked={fixSelected}
                onChange={(event) =>
                  onFixSelected(event.target.checked)
                }
              />
              Fix agent
            </label>
          )}
        </div>
      </footer>
    </article>
  );
}

export function ClosingLedger({
  pr,
  artifact,
  session,
  files,
  checks,
  comments,
  unresolvedThreadCount,
  onMutate,
  onNavigateBeat,
  onNavigateEvidence,
  readOnly,
}: {
  pr: PrSummary;
  artifact: UltraReviewArtifact;
  session: UltraReviewSession;
  files: FileDiff[];
  checks: CheckInfo[];
  comments: CommentInfo[];
  unresolvedThreadCount: number;
  onMutate: (
    updater: (artifact: UltraReviewArtifact) => UltraReviewArtifact,
  ) => void;
  onNavigateBeat: (beatId: string) => void;
  onNavigateEvidence: (evidenceId: string) => void;
  readOnly: boolean;
}) {
  const { ctx, poller } = useFlow();
  const progress = calculateUltraReviewProgress(
    artifact,
    session.mode,
  );
  const audit = auditUltraReviewCoverage(artifact);
  const beats = allBeats(artifact);
  const chapters = allChapters(artifact);
  const [verdict, setVerdict] = useState<
    "COMMENT" | "APPROVE" | "REQUEST_CHANGES" | null
  >(null);
  const [acknowledgeIncomplete, setAcknowledgeIncomplete] =
    useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState("");
  const [pendingSubmissionReceipt, setPendingSubmissionReceipt] =
    useState<{
      url: string;
      snapshot: UltraReviewSubmissionSnapshot;
    } | null>(null);
  const submissionInFlight = useRef(false);
  const [authorOutcome, setAuthorOutcome] = useState<
    "ready" | "continue" | null
  >(session.authorOutcome ?? null);
  const [postSelfReview, setPostSelfReview] = useState(false);
  const [selectedFixNoteIds, setSelectedFixNoteIds] = useState<
    string[]
  >([]);
  const [fixRunId, setFixRunId] = useState<string | null>(null);
  const [draftRunId, setDraftRunId] = useState<string | null>(
    null,
  );
  const [draftStarting, setDraftStarting] = useState(false);
  const draftStartInFlight = useRef(false);
  const autoDraftFingerprint = useRef<string | null>(null);
  const [expandedProvenanceId, setExpandedProvenanceId] =
    useState<string | null>(null);
  const draftRun = useAgentStore(
    (state) =>
      draftRunId ? state.runs[draftRunId] ?? null : null,
  );
  const fixRun = useAgentStore(
    (state) =>
      fixRunId ? state.runs[fixRunId] ?? null : null,
  );
  const drafting = draftStarting
    || draftRun?.status === "starting"
    || draftRun?.status === "running";
  const missing = [...new Set([
    ...(session.reviewCompletedAt === undefined
      ? ["review-document"]
      : []),
    ...artifact.mechanicalChanges
      .filter((change) =>
        !session.acknowledgedMechanicalChangeIds.includes(
          change.id,
        )
      )
      .map((change) => change.id),
    ...audit.missingEvidenceIds,
    ...audit.unmappedEvidenceIds,
    ...audit.failedRegionIds,
    ...audit.incompleteStageIds,
    ...audit.duplicateEvidenceIds,
    ...audit.unknownEvidenceIds,
    ...audit.mismatchedEvidenceIds,
    ...audit.invalidBeatIds,
    ...audit.invalidMechanicalChangeIds,
    ...audit.overlaps.map(
      (overlap) =>
        `overlap:${overlap.path}:${overlap.side}:${overlap.line}`,
    ),
  ])];
  const missingKey = [...missing].sort().join("\u0000");
  useEffect(() => {
    setAcknowledgeIncomplete(false);
  }, [missingKey]);
  const missingItems = missing.map((id) => {
    if (id === "review-document") {
      return "Review document is not marked done";
    }
    const beat = beats.find(
      (candidate) => candidate.id === id,
    );
    if (beat) return `Review section unresolved: ${beat.title}`;
    const mechanical = artifact.mechanicalChanges.find(
      (candidate) => candidate.id === id,
    );
    if (mechanical) {
      return `Mechanical group not acknowledged: ${mechanical.title}`;
    }
    const evidence = artifact.evidence.find(
      (candidate) => candidate.id === id,
    );
    if (evidence) {
      return `Evidence unresolved: ${evidence.location.path}:${
        evidence.location.startLine ?? "file"
      }`;
    }
    const stage = artifact.generation.stages.find(
      (candidate) => candidate.id === id,
    );
    if (stage) return `Analysis stage incomplete: ${stage.label}`;
    if (id.startsWith("overlap:")) {
      return `Coverage overlaps at ${id.slice("overlap:".length)}`;
    }
    return `Coverage blocker: ${id}`;
  });
  const notesFingerprint = ultraReviewNotesFingerprint(session.notes);
  const draft = session.draft;
  const draftIsCurrent = draft !== null && (
    draft.sourceNotesFingerprint === notesFingerprint
    || draft.sourceNotesFingerprint === "legacy"
  );
  const expandedProvenance = draft?.sections.find(
    (section) => section.id === expandedProvenanceId,
  ) ?? null;
  const draftError =
    draftRun?.status === "error"
      ? draftRun.error ?? "Draft synthesis failed."
      : "";
  const fixing =
    fixRun?.status === "starting" || fixRun?.status === "running";
  const testPathPattern =
    /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i;
  const testEvidence = artifact.evidence.filter(
    (evidence) => testPathPattern.test(evidence.location.path),
  );
  const testPaths = [...new Set(
    testEvidence.map((evidence) => evidence.location.path),
  )];
  const testEvidenceIds = new Set(
    testEvidence.map((evidence) => evidence.id),
  );
  const chaptersWithoutVisibleTest = chapters.filter(
    (chapter) =>
      chapter.kind !== "mechanical"
      && chapter.beats.every(
        (beat) =>
          !beat.evidenceIds.some(
            (evidenceId) => testEvidenceIds.has(evidenceId),
          ),
      ),
  );
  const feedbackClaims = artifact.sourceClaims.filter(
    (claim) => claim.kind === "existing_feedback",
  );

  const setDraft = (
    next: UltraReviewSession["draft"],
  ) => {
    onMutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [session.mode]: {
          ...current.sessions[session.mode],
          draft: next,
        },
      },
    }));
  };

  const saveNote = (
    note: UltraReviewNote,
    body: string,
    kind: UltraReviewNoteKind,
  ) => {
    onMutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [session.mode]: updateUltraReviewNote(
          current.sessions[session.mode],
          note.id,
          {
            body,
            kind,
            submitAsComment: note.submitAsComment,
          },
        ),
      },
    }));
  };

  const setNoteSubmission = (
    note: UltraReviewNote,
    submitAsComment: boolean,
  ) => {
    onMutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [session.mode]: updateUltraReviewNote(
          current.sessions[session.mode],
          note.id,
          {
            body: note.body,
            kind: note.kind,
            submitAsComment,
          },
        ),
      },
    }));
  };

  const setFixNoteSelected = (
    noteId: string,
    selected: boolean,
  ) => {
    setSelectedFixNoteIds((current) =>
      selected
        ? [...new Set([...current, noteId])]
        : current.filter((id) => id !== noteId)
    );
  };

  const lineNotes = session.notes.filter(
    (note) => note.anchor.kind === "line",
  );
  const lineNoteFiles = projectFocusedEvidence(
    files,
    lineNotes.flatMap((note) => {
      const anchor = note.anchor;
      return anchor.kind === "line"
        ? [{
            path: anchor.path,
            side: anchor.side,
            startLine: anchor.startLine,
            endLine: anchor.endLine,
          }]
        : [];
    }),
  );
  const closingNoteAnchors: DiffAnchor[] = lineNotes.map((note) => {
    const anchor = note.anchor;
    if (anchor.kind !== "line") {
      throw new Error("line note lost its line anchor");
    }
    return {
      path: anchor.path,
      line: anchor.endLine,
      side: anchor.side,
      tone: "local" as const,
      node: (
        <ClosingNoteEditor
          note={note}
          readOnly={readOnly}
          mode={session.mode}
          fixSelected={selectedFixNoteIds.includes(note.id)}
          onFixSelected={(selected) =>
            setFixNoteSelected(note.id, selected)}
          onSave={(body, kind) => saveNote(note, body, kind)}
          onSubmitAsComment={(selected) =>
            setNoteSubmission(note, selected)}
        />
      ),
    };
  });

  const selectedInlineComments: UltraReviewDraftInlineComment[] =
    session.notes.flatMap((note) => {
      if (
        note.anchor.kind !== "line"
        || note.stale
        || !note.submitAsComment
      ) {
        return [];
      }
      const anchor = note.anchor;
      const beatIds = beats
        .filter((beat) => anchor.evidenceIds.some(
          (evidenceId) => beat.evidenceIds.includes(evidenceId),
        ))
        .map((beat) => beat.id);
      return [{
        id: note.id,
        path: anchor.path,
        side: anchor.side,
        line: anchor.endLine,
        ...(anchor.startLine === anchor.endLine
          ? {}
          : { startLine: anchor.startLine }),
        body: note.body,
        included: true,
        provenance: {
          noteIds: [note.id],
          beatIds,
          evidenceIds: anchor.evidenceIds,
          concernIds: [],
        },
      }];
    });

  const proposedComments: ProposedInlineComment[] =
    selectedInlineComments.map((comment) => ({
      key: comment.id,
      path: comment.path,
      line: comment.line,
      startLine: comment.startLine,
      side: comment.side,
      body: comment.body,
      severity: "major",
      confidence: 100,
      included: comment.included,
    }));

  const startDraft = () => {
    if (
      readOnly
      || drafting
      || draftStartInFlight.current
      || session.notes.length === 0
    ) {
      return;
    }
    draftStartInFlight.current = true;
    setDraftStarting(true);
    setSubmissionError("");
    void startUltraReviewClosingDraft({
      ctx,
      pr,
      artifactKey: artifact.artifactKey,
      mode: session.mode,
    })
      .then((runId) => {
        setDraftRunId(runId);
        setDraftStarting(false);
        draftStartInFlight.current = false;
      })
      .catch((error) => {
        setDraftStarting(false);
        draftStartInFlight.current = false;
        setSubmissionError(
          error instanceof Error ? error.message : String(error),
        );
      });
  };

  useEffect(() => {
    if (
      readOnly
      || session.notes.length === 0
      || drafting
      || draftIsCurrent
      || autoDraftFingerprint.current === notesFingerprint
    ) {
      return;
    }
    autoDraftFingerprint.current = notesFingerprint;
    startDraft();
  }, [
    draftIsCurrent,
    drafting,
    notesFingerprint,
    readOnly,
    session.notes.length,
  ]);

  useEffect(() => {
    if (draft) setVerdict(draft.recommendedVerdict);
  }, [draft?.id]);

  const persistSubmissionSnapshot = async (
    snapshot: UltraReviewSubmissionSnapshot,
  ): Promise<void> => {
    await useUltraReviewStore.getState().update(
      artifact.artifactKey,
      (current) => ({
        ...current,
        sessions: {
          ...current.sessions,
          [session.mode]: recordUltraReviewSubmissionSnapshot(
            current.sessions[session.mode],
            snapshot,
          ),
        },
      }),
    );
  };

  const submit = async () => {
    if (
      readOnly
      || !draft
      || !draftIsCurrent
      || !verdict
      || submissionInFlight.current
      || pendingSubmissionReceipt
      || submittedUrl
    ) {
      return;
    }
    const submissionStartedAt = Date.now();
    submissionInFlight.current = true;
    setSubmissionError("");
    setSubmitting(true);
    try {
      const payload = buildUltraReviewSubmission({
        draft: {
          body: draft.body,
          sections: draft.sections.map((section) => ({
            id: section.id,
            body: section.body,
            sourceNoteIds: section.provenance.noteIds,
          })),
          comments: proposedComments,
        },
        verdict,
        knownNoteIds: new Set(
          session.notes.map((note) => note.id),
        ),
        missingCoverageIds: missing,
        incompleteAcknowledged: acknowledgeIncomplete,
      });
      const snapshot = buildUltraReviewSubmissionSnapshot({
        id: uid("ultra-snapshot-"),
        submittedAt: Date.now(),
        headSha: artifact.identity.headSha,
        verdict,
        draft: {
          ...draft,
          inlineComments: selectedInlineComments,
        },
        progress,
      });
      const outcome = await submitUltraReviewWithReceipt({
        snapshot,
        submit: () => ctx.gh.submitReview(
          ctx.repo,
          artifact.identity.prNumber,
          payload,
        ),
        persist: persistSubmissionSnapshot,
      });
      void poller.refreshPr(artifact.identity.prNumber);
      if (outcome.status === "persistence_failed") {
        setPendingSubmissionReceipt({
          url: outcome.url,
          snapshot: outcome.snapshot,
        });
        setSubmissionError(
          "The review is already on GitHub. "
          + "Its local submission receipt was not saved. "
          + outcome.error,
        );
        void recordUltraReviewDiagnostic(ctx.repo, {
          stageId: "submission.persist",
          elapsedMs: Date.now() - submissionStartedAt,
          retryCount: 0,
          outcome: "failure",
          failureCategory: "persistence",
        });
        return;
      }
      setSubmittedUrl(outcome.url);
      void recordUltraReviewDiagnostic(ctx.repo, {
        stageId: "submission",
        elapsedMs: Date.now() - submissionStartedAt,
        retryCount: 0,
        outcome: "success",
        failureCategory: null,
      });
    } catch (error) {
      void recordUltraReviewDiagnostic(ctx.repo, {
        stageId: "submission",
        elapsedMs: Date.now() - submissionStartedAt,
        retryCount: 0,
        outcome: "failure",
        failureCategory: "submission",
      });
      setSubmissionError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };

  const retrySubmissionReceipt = async () => {
    const pending = pendingSubmissionReceipt;
    if (!pending || submissionInFlight.current) return;
    const retryStartedAt = Date.now();
    submissionInFlight.current = true;
    setSubmissionError("");
    setSubmitting(true);
    try {
      await persistSubmissionSnapshot(pending.snapshot);
      setPendingSubmissionReceipt(null);
      setSubmittedUrl(pending.url);
      void recordUltraReviewDiagnostic(ctx.repo, {
        stageId: "submission.persist",
        elapsedMs: Date.now() - retryStartedAt,
        retryCount: 1,
        outcome: "success",
        failureCategory: null,
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : String(error);
      setSubmissionError(
        "The review is already on GitHub. "
        + "Its local submission receipt still was not saved. "
        + detail,
      );
      void recordUltraReviewDiagnostic(ctx.repo, {
        stageId: "submission.persist",
        elapsedMs: Date.now() - retryStartedAt,
        retryCount: 1,
        outcome: "failure",
        failureCategory: "persistence",
      });
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };

  const finishAuthorMode = async (
    outcome: "ready" | "continue",
  ) => {
    if (readOnly) return;
    setAuthorOutcome(outcome);
    onMutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        author: {
          ...current.sessions.author,
          authorOutcome: outcome,
          authorCompletedAt: Date.now(),
        },
      },
    }));
    if (
      outcome === "ready"
      && postSelfReview
      && draft?.body.trim()
    ) {
      try {
        await ctx.gh.createIssueComment(
          ctx.repo,
          artifact.identity.prNumber,
          draft.body,
        );
        void poller.refreshPr(artifact.identity.prNumber);
      } catch (error) {
        setSubmissionError(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };

  const startSelectedFix = async () => {
    if (readOnly) return;
    const selected = session.notes.filter(
      (note) =>
        selectedFixNoteIds.includes(note.id) && !note.stale,
    );
    const findings = selected.flatMap(
      (note): ReviewFinding[] => {
        const anchor = note.anchor;
        const evidence = anchor.kind === "line"
          ? artifact.evidence.find(
              (item) => item.id === anchor.evidenceIds[0],
            )
          : artifact.evidence.find((item) =>
              beats
                .find(
                  (beat) => beat.id === anchor.beatId,
                )
                ?.evidenceIds.includes(item.id)
              && item.kind === "changed"
            );
        if (
          !evidence
          || evidence.location.startLine === null
          || evidence.location.endLine === null
        ) {
          return [];
        }
        const startLine = anchor.kind === "line"
          ? anchor.startLine
          : evidence.location.startLine;
        const line = anchor.kind === "line"
          ? anchor.endLine
          : evidence.location.endLine;
        return [{
          key: uid("find-"),
          prNumber: pr.number,
          headSha: pr.headSha,
          path: evidence.location.path,
          line,
          ...(startLine === line ? {} : { startLine }),
          side: evidence.location.side,
          severity: "major",
          confidence: 100,
          body: note.body,
          status: "open",
          createdAt: Date.now(),
        }];
      },
    );
    if (findings.length === 0) {
      setSubmissionError(
        "Selected notes have no current changed-line anchor for a fix agent.",
      );
      return;
    }
    setSubmissionError("");
    try {
      await useRepoStore.getState().mergeFindings(
        pr.number,
        findings,
      );
      const runId = await applyFindings(ctx, pr, findings);
      setFixRunId(runId);
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const submissionControls = session.mode === "teammate" ? (
    <div className="ultra-submit-controls">
      <div
        className="ultra-verdict-picker"
        role="group"
        aria-label="GitHub review verdict"
      >
        {([
          ["COMMENT", "Comment"],
          ["APPROVE", "Approve"],
          ["REQUEST_CHANGES", "Request changes"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            data-selected={verdict === value}
            aria-pressed={verdict === value}
            disabled={
              readOnly
              || !draftIsCurrent
              || submitting
              || pendingSubmissionReceipt !== null
              || submittedUrl !== ""
            }
            onClick={() => setVerdict(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {draft && draftIsCurrent && (
        <p className="ultra-verdict-recommendation">
          Assessment recommendation: {draft.recommendedVerdict === "REQUEST_CHANGES"
            ? "Request changes"
            : draft.recommendedVerdict === "APPROVE"
              ? "Approve"
              : "Comment"}. You can override it.
        </p>
      )}
      {missing.length > 0 && (
        <label className="ultra-incomplete-ack">
          <input
            type="checkbox"
            checked={acknowledgeIncomplete}
            disabled={
              readOnly
              || submitting
              || pendingSubmissionReceipt !== null
              || submittedUrl !== ""
            }
            onChange={(event) =>
              setAcknowledgeIncomplete(event.target.checked)}
          />
          Submit with {missing.length} explicit coverage gap
          {missing.length === 1 ? "" : "s"}.
          This session remains incomplete.
        </label>
      )}
      {!pendingSubmissionReceipt && !submittedUrl && (
        <button
          type="button"
          className="primary ultra-submit-button"
          disabled={
            !draft
            || !draftIsCurrent
            || readOnly
            || !verdict
            || submitting
            || (
              missing.length > 0
              && !acknowledgeIncomplete
            )
          }
          onClick={() => void submit()}
        >
          {submitting ? "Submitting…" : "Submit Review"}
        </button>
      )}
      {pendingSubmissionReceipt && (
        <section className="ultra-incomplete-ledger" role="alert">
          <h2>Review posted. Local receipt missing.</h2>
          <p>
            GitHub already accepted this review.
            Retry saves the local receipt only.
            It will not post the review again.
          </p>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={submitting}
              onClick={() => void retrySubmissionReceipt()}
            >
              {submitting ? "Saving receipt…" : "Retry local save"}
            </button>
            <a href={pendingSubmissionReceipt.url}>
              Open posted review ↗
            </a>
          </div>
        </section>
      )}
      {submissionError && (
        <p className="ultra-form-error">{submissionError}</p>
      )}
      {submittedUrl && (
        <p className="ultra-success">
          Review submitted. Local receipt saved.
          {" "}
          <a href={submittedUrl}>Open on GitHub ↗</a>
        </p>
      )}
    </div>
  ) : null;

  return (
    <main className="ultra-ledger">
      <header className="ultra-ledger-hero">
        <div>
          <h1>Final Review</h1>
          <p>
            {progress.documentReviewed
              ? "Review document complete. "
              : "Review document still open. "}
            {progress.coveredChangedEvidence}/
            {progress.totalChangedEvidence} evidence units covered.
          </p>
        </div>
        <div
          className="ultra-coverage-seal"
          data-complete={progress.fullyReviewed}
        >
          <strong>
            {progress.fullyReviewed ? "FULL" : "OPEN"}
          </strong>
          <span>coverage</span>
        </div>
      </header>

      {!progress.fullyReviewed && (
        <section className="ultra-incomplete-ledger">
          <h2>Incomplete work is explicit.</h2>
          <ul>
            {missingItems.map((item, index) => (
              <li key={`${missing[index]}:${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {(checks.length > 0
        || feedbackClaims.length > 0
        || comments.length > 0) && (
        <section className="ultra-live-context-ledger">
          <header>
            <span className="u-mark">LIVE PULL REQUEST STATE</span>
            <h2>Remote context stays in the verdict.</h2>
          </header>
          {checks.length > 0 && (
            <div>
              <h3>Continuous integration</h3>
              <ul>
                {checks.map((check) => (
                  <li
                    key={`${check.name}:${check.url}`}
                    data-status={
                      check.conclusion ?? check.status
                    }
                  >
                    <a className="ultra-live-name" href={check.url}>
                      {check.name}
                    </a>
                    <span className="ultra-live-status">
                      {check.conclusion ?? check.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {feedbackClaims.length > 0 && (
            <div>
              <h3>Existing feedback represented in the story</h3>
              <ul>
                {feedbackClaims.map((claim) => (
                  <li key={claim.id}>
                    <span className="ultra-live-copy">
                      {claim.claim}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {comments.length > 0 && (
            <div>
              <h3>
                Live feedback
                {unresolvedThreadCount > 0
                  ? ` · ${unresolvedThreadCount} unresolved`
                  : ""}
              </h3>
              <ul>
                {comments.map((comment) => (
                  <li key={comment.id}>
                    <a
                      className="ultra-live-author"
                      href={comment.url}
                    >
                      @{comment.author}
                    </a>
                    <GitHubCommentBody
                      comment={comment}
                      className="ultra-live-copy"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {artifact.mechanicalChanges.length > 0 && (
        <section className="ultra-mechanical-ledger">
          <header>
            <span className="u-mark">MECHANICAL CHANGE</span>
            <h2>Classified, never hidden.</h2>
          </header>
          {artifact.mechanicalChanges.map((change) => {
            const acknowledged =
              session.acknowledgedMechanicalChangeIds.includes(
                change.id,
              );
            const evidence = artifact.evidence.filter(
              (item) => change.evidenceIds.includes(item.id),
            );
            const ranges = evidence.flatMap((item) => {
              if (
                item.location.startLine === null
                || item.location.endLine === null
              ) {
                return [];
              }
              return [{
                path: item.location.path,
                side: item.location.side,
                startLine: item.location.startLine,
                endLine: item.location.endLine,
              }];
            });
            const focused = projectFocusedEvidence(files, ranges);
            return (
              <article key={change.id}>
                <div>
                  <h3>{change.title}</h3>
                  <p>{change.reason}</p>
                  <span>
                    {change.evidenceIds.length} evidence unit
                    {change.evidenceIds.length === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  type="button"
                  className={acknowledged ? "small" : "primary small"}
                  disabled={readOnly}
                  onClick={() => onMutate((current) => {
                    const existing = current.sessions[session.mode]
                      .acknowledgedMechanicalChangeIds;
                    return {
                      ...current,
                      sessions: {
                        ...current.sessions,
                        [session.mode]: {
                          ...current.sessions[session.mode],
                          acknowledgedMechanicalChangeIds:
                            acknowledged
                              ? existing.filter(
                                  (id) => id !== change.id,
                                )
                              : [...existing, change.id],
                        },
                      },
                    };
                  })}
                >
                  {acknowledged ? "Acknowledged ✓" : "Acknowledge"}
                </button>
                <details>
                  <summary>
                    Inspect exact evidence
                    <span>
                      {evidence.length} unit
                      {evidence.length === 1 ? "" : "s"}
                    </span>
                  </summary>
                  <ul className="ultra-mechanical-evidence-list">
                    {evidence.map((item) => (
                      <li key={item.id}>
                        <code>
                          {item.location.path}
                          {item.location.startLine === null
                            ? ""
                            : `:${item.location.startLine}-${
                              item.location.endLine
                            }`}
                        </code>
                        <span>{item.change}</span>
                      </li>
                    ))}
                  </ul>
                  {focused.length > 0 && (
                    <DiffViewer
                      files={focused}
                      disablePatternAutoCollapse
                      loadFileText={(path, side) =>
                        ctx.gh.getFileText(
                          side === "RIGHT"
                            ? pr.headRepoFullName || ctx.repo
                            : ctx.repo,
                          path,
                          side === "RIGHT"
                            ? pr.headSha
                            : pr.baseSha,
                        )}
                    />
                  )}
                </details>
              </article>
            );
          })}
        </section>
      )}

      <section className="ultra-test-ledger">
        <header>
          <span className="u-mark">TEST INVENTORY</span>
          <h2>Visible proof and missing proof.</h2>
          <p>
            UltraReview identifies test evidence from repository paths.
            It does not treat a green check as behavioral proof.
          </p>
        </header>
        <div className="ultra-test-ledger-grid">
          <div>
            <h3>Visible test evidence</h3>
            {testPaths.length === 0 ? (
              <p>No test file appears in the reviewed evidence.</p>
            ) : (
              <ul>
                {testPaths.map((path) => (
                  <li key={path}><code>{path}</code></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>Behavior without visible test evidence</h3>
            {chaptersWithoutVisibleTest.length === 0 ? (
              <p>Every narrative chapter links to visible test evidence.</p>
            ) : (
              <ul>
                {chaptersWithoutVisibleTest.map((chapter) => (
                  <li key={chapter.id}>{chapter.title}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="ultra-note-ledger">
        <header>
          <div>
            <span className="u-mark">ALL HUMAN NOTES</span>
            <h2>
              {session.notes.length} source
              {session.notes.length === 1 ? "" : "s"}
            </h2>
          </div>
        </header>
        {session.notes.length === 0 ? (
          <p className="subtle">
            No human notes yet. A clean review can still close.
          </p>
        ) : (
          <>
            {lineNotes.length > 0 && lineNoteFiles.length > 0 && (
              <DiffViewer
                files={lineNoteFiles}
                anchors={closingNoteAnchors}
                disablePatternAutoCollapse
                loadFileText={(path, side) =>
                  ctx.gh.getFileText(
                    side === "RIGHT"
                      ? pr.headRepoFullName || ctx.repo
                      : ctx.repo,
                    path,
                    side === "RIGHT" ? pr.headSha : pr.baseSha,
                  )}
              />
            )}
            {lineNotes.length > 0 && lineNoteFiles.length === 0 && (
              <div className="ultra-closing-note-list">
                {lineNotes.map((note) => (
                  <ClosingNoteEditor
                    key={note.id}
                    note={note}
                    readOnly={readOnly}
                    mode={session.mode}
                    fixSelected={selectedFixNoteIds.includes(note.id)}
                    onFixSelected={(selected) =>
                      setFixNoteSelected(note.id, selected)}
                    onSave={(body, kind) => saveNote(note, body, kind)}
                    onSubmitAsComment={(selected) =>
                      setNoteSubmission(note, selected)}
                  />
                ))}
              </div>
            )}
            <div className="ultra-closing-note-list">
              {session.notes
                .filter((note) => note.anchor.kind === "beat")
                .map((note) => (
                  <div
                    key={note.id}
                  >
                    <ClosingNoteEditor
                      note={note}
                      readOnly={readOnly}
                      mode={session.mode}
                      fixSelected={selectedFixNoteIds.includes(note.id)}
                      onFixSelected={(selected) =>
                        setFixNoteSelected(note.id, selected)}
                      onSave={(body, kind) => saveNote(note, body, kind)}
                      onSubmitAsComment={(selected) =>
                        setNoteSubmission(note, selected)}
                    />
                  </div>
                ))}
            </div>
          </>
        )}
      </section>

      <section className="ultra-draft-studio">
        <header>
          <div>
            {session.mode === "author" ? (
              <>
                <span className="u-mark">REVIEW DRAFT</span>
                <h2>Review draft</h2>
              </>
            ) : (
              <h2>Submit Review</h2>
            )}
          </div>
          <button
            type="button"
            className="primary"
            disabled={
              readOnly
              || drafting
              || session.notes.length === 0
            }
            onClick={startDraft}
          >
            {drafting
              ? "Building assessment…"
              : draft
                ? "Regenerate assessment"
                : "Build assessment"}
          </button>
        </header>
        {session.notes.length === 0 && !draft && (
          <button
            type="button"
            onClick={() => setDraft({
              id: uid("ultra-draft-"),
              body: "",
              recommendedVerdict: "APPROVE",
              sourceNotesFingerprint: notesFingerprint,
              sections: [],
              inlineComments: [],
              incorporatedNoteIds: [],
              combinedNoteIds: [],
              omittedNoteIds: [],
            })}
            disabled={readOnly}
          >
            Start an empty clean-review draft
          </button>
        )}
        {draftError && (
          <p className="ultra-form-error">{draftError}</p>
        )}
        {draft && draftIsCurrent && (
          <>
            <label>
              <span>GitHub review body</span>
              <textarea
                className="input-prose"
                rows={10}
                readOnly={readOnly}
                value={draft.body}
                onChange={(event) => setDraft({
                  ...draft,
                  body: event.target.value,
                })}
              />
            </label>
            <div className="ultra-draft-provenance">
              {draft.sections.map((section) => (
                <button
                  type="button"
                  key={section.id}
                  title={section.provenance.noteIds.join(", ")}
                  aria-expanded={
                    expandedProvenanceId === section.id
                  }
                  onClick={() => setExpandedProvenanceId(
                    expandedProvenanceId === section.id
                      ? null
                      : section.id,
                  )}
                >
                  {section.body.slice(0, 80)}
                  <span>
                    {section.provenance.noteIds.length} source
                    {section.provenance.noteIds.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
            <div className="ultra-draft-accounting">
              <span>
                {draft.incorporatedNoteIds.length} incorporated
              </span>
              <span>
                {draft.combinedNoteIds.length} combined
              </span>
              <span>
                {draft.omittedNoteIds.length} omitted
              </span>
            </div>
            {draft.omittedNoteIds.length > 0 && (
              <details className="ultra-draft-omissions">
                <summary>Inspect omitted notes</summary>
                <ul>
                  {draft.omittedNoteIds.map((id) => {
                    const note = session.notes.find(
                      (candidate) => candidate.id === id,
                    );
                    return (
                      <li key={id}>{note?.body ?? id}</li>
                    );
                  })}
                </ul>
              </details>
            )}
            {expandedProvenance && (
              <aside className="ultra-provenance-inspector">
                <header>
                  <span className="u-mark">SOURCE TRACE</span>
                  <h3>{expandedProvenance.body}</h3>
                </header>
                <dl>
                  <div>
                    <dt>Human notes</dt>
                    <dd>
                      {expandedProvenance.provenance.noteIds.length === 0
                        ? "None"
                        : expandedProvenance.provenance.noteIds.map(
                            (id) => (
                              <button
                                type="button"
                                key={id}
                                onClick={() =>
                                  document.getElementById(
                                    `ultra-ledger-note-${id}`,
                                  )?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "center",
                                  })}
                              >
                                {session.notes.find(
                                  (note) => note.id === id,
                                )?.body ?? id}
                              </button>
                            ),
                          )}
                    </dd>
                  </div>
                  <div>
                    <dt>Review beats</dt>
                    <dd>
                      {expandedProvenance.provenance.beatIds.length === 0
                        ? "None"
                        : expandedProvenance.provenance.beatIds.map(
                            (id) => (
                              <button
                                type="button"
                                key={id}
                                onClick={() => onNavigateBeat(id)}
                              >
                                {beats.find(
                                  (candidate) => candidate.id === id,
                                )?.title ?? id}
                              </button>
                            ),
                          )}
                    </dd>
                  </div>
                  <div>
                    <dt>Code evidence</dt>
                    <dd>
                      {expandedProvenance.provenance.evidenceIds.length === 0
                        ? "None"
                        : expandedProvenance.provenance.evidenceIds.map(
                            (id) => {
                              const evidence = artifact.evidence.find(
                                (candidate) => candidate.id === id,
                              );
                              const targetBeat = beats.find(
                                (candidate) =>
                                  candidate.evidenceIds.includes(id),
                              );
                              return (
                                <button
                                  type="button"
                                  key={id}
                                  disabled={!targetBeat}
                                  onClick={() => {
                                    if (targetBeat) {
                                      onNavigateEvidence(id);
                                    }
                                  }}
                                >
                                  {evidence
                                    ? `${evidence.location.path}:${
                                        evidence.location.startLine ?? "file"
                                      }`
                                    : id}
                                </button>
                              );
                            },
                          )}
                    </dd>
                  </div>
                </dl>
              </aside>
            )}
            {draft.inlineComments.map((comment) => (
              <article
                key={comment.id}
                className="ultra-inline-draft"
              >
                <label>
                  <input
                    type="checkbox"
                    checked={comment.included}
                    disabled={readOnly}
                    onChange={(event) => setDraft({
                      ...draft,
                      inlineComments: draft.inlineComments.map(
                        (candidate) =>
                          candidate.id === comment.id
                            ? {
                                ...candidate,
                                included: event.target.checked,
                              }
                            : candidate,
                      ),
                    })}
                  />
                  {comment.path}:{comment.line}
                </label>
                <textarea
                  className="input-prose"
                  rows={4}
                  readOnly={readOnly}
                  value={comment.body}
                  onChange={(event) => setDraft({
                    ...draft,
                    inlineComments: draft.inlineComments.map(
                      (candidate) =>
                        candidate.id === comment.id
                          ? {
                              ...candidate,
                              body: event.target.value,
                            }
                          : candidate,
                    ),
                  })}
                />
              </article>
            ))}
          </>
        )}
        {submissionControls}
      </section>

      {session.mode === "author" && (
        <section className="ultra-author-close">
          <span className="u-mark">AUTHOR DECISION</span>
          <h2>The branch stays yours.</h2>
          <p>
            Ready closes the local readiness ledger.
            Continue working changes nothing remotely.
          </p>
          <button
            type="button"
            disabled={
              selectedFixNoteIds.length === 0 || fixing
              || readOnly
            }
            onClick={() => void startSelectedFix()}
          >
            {fixing
              ? "Fix agent working…"
              : `Send ${selectedFixNoteIds.length || ""} selected note${
                  selectedFixNoteIds.length === 1 ? "" : "s"
                } to fix agent`}
          </button>
          <label>
            <input
              type="checkbox"
              checked={postSelfReview}
              disabled={readOnly}
              onChange={(event) =>
                setPostSelfReview(event.target.checked)}
            />
            Post the final readiness body as a GitHub self-review comment
          </label>
          <div className="row">
            <button
              type="button"
              disabled={readOnly}
              onClick={() => void finishAuthorMode("continue")}
            >
              Continue working
            </button>
            <button
              type="button"
              className="primary"
              disabled={readOnly}
              onClick={() => void finishAuthorMode("ready")}
            >
              Ready for review
            </button>
          </div>
          {authorOutcome && (
            <p className="ultra-success">
              {authorOutcome === "ready"
                ? "Readiness recorded."
                : "Review remains local and open."}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
