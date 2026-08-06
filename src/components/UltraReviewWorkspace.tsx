import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  calculateUltraReviewProgress,
  ultraReviewArtifactKey,
} from "../lib/ultraReview";
import {
  inspectUltraReviewBeatEvidence,
} from "../lib/ultrareview-evidence";
import { startUltraReviewAnalysis } from "../lib/ultrareview-flow";
import { useUltraReviewStore } from "../lib/ultrareview-store";
import { useAgentStore } from "../lib/store";
import { usePrData } from "../lib/events";
import type {
  CheckInfo,
  CommentInfo,
  FileDiff,
  PrSummary,
  UltraReviewArtifact,
  UltraReviewMode,
  UltraReviewSession,
} from "../types";
import {
  ReviewPlanIntro,
  ReviewStoryRail,
  type StoryBeat,
  type StoryChapter,
  type StorySystem,
} from "./ultrareview";
import { BeatWorkspace } from "./ultrareview/BeatWorkspace";
import { ClosingLedger } from "./ultrareview/ClosingLedger";
import {
  allBeats,
  allChapters,
  findBeat,
  findChapter,
  findSystemForChapter,
  firstBeatForChapter,
} from "./ultrareview/navigation";
import { RawDiffWorkspace } from "./ultrareview/RawDiffWorkspace";
import { useFlow } from "./flow";

const NO_CHECKS: CheckInfo[] = [];
const NO_COMMENTS: CommentInfo[] = [];
type UltraReviewSurface =
  | "generation"
  | "intro"
  | "review"
  | "ledger"
  | "raw";

interface UltraReviewWorkspaceProps {
  pr: PrSummary;
  mode: UltraReviewMode;
  files: FileDiff[] | null;
  filesError?: string;
  onRetryFiles?: () => void;
  onLeave: () => void;
  remoteViewed?: {
    map: Record<string, string>;
    toggle?: (path: string, viewed: boolean) => void;
  };
  viewedKey?: string;
  /** Deterministic preview entry; product callers use the dogfood entry. */
  initialSurface?: UltraReviewSurface;
}

function unresolvedConcerns(
  artifact: UltraReviewArtifact,
  session: UltraReviewSession,
  beatId?: string,
): number {
  return artifact.concerns.filter(
    (concern) =>
      (beatId === undefined || concern.beatId === beatId)
      && session.concernDispositions[concern.id] === undefined,
  ).length;
}

function storyState(
  states: Array<"pending" | "reviewed" | "stale">,
  failed = false,
): "pending" | "reviewed" | "stale" | "failed" {
  if (failed) return "failed";
  if (states.some((state) => state === "stale")) return "stale";
  if (
    states.length > 0
    && states.every((state) => state === "reviewed")
  ) {
    return "reviewed";
  }
  return "pending";
}

function storySystems(
  artifact: UltraReviewArtifact,
  session: UltraReviewSession,
): StorySystem[] {
  return [...artifact.galaxy.systems]
    .sort((left, right) => left.order - right.order)
    .map((system) => {
      const chapters: StoryChapter[] = [...system.chapters]
        .sort((left, right) => left.order - right.order)
        .map((chapter) => {
          const chapterFailed =
            artifact.generation.failures.some(
              (failure) => failure.chapterId === chapter.id,
            );
          const beats: StoryBeat[] = [...chapter.beats]
            .sort((left, right) => left.order - right.order)
            .map((beat) => ({
              id: beat.id,
              title: beat.title,
              objective: beat.objective,
              risk: beat.risk,
              state: session.beatStates[beat.id] ?? "pending",
              scope: {
                changedLines: artifact.evidence.filter(
                  (evidence) =>
                    beat.evidenceIds.includes(evidence.id)
                    && evidence.kind === "changed",
                ).length,
              },
              confidence: beat.confidence,
              unresolvedFeedback: unresolvedConcerns(
                artifact,
                session,
                beat.id,
              ),
            }));
          return {
            id: chapter.id,
            title: chapter.title,
            purpose: chapter.purpose,
            before: chapter.before,
            after: chapter.after,
            dependencyChapterIds: chapter.dependencyChapterIds,
            risk: chapter.risk,
            state: storyState(
              chapter.beats.map(
                (beat) =>
                  session.beatStates[beat.id] ?? "pending",
              ),
              chapterFailed,
            ),
            scope: {
              changedLines: beats.reduce(
                (total, beat) =>
                  total + (beat.scope?.changedLines ?? 0),
                0,
              ),
              files: new Set(
                chapter.beats.flatMap((beat) =>
                  artifact.evidence
                    .filter((evidence) =>
                      beat.evidenceIds.includes(evidence.id)
                    )
                    .map((evidence) => evidence.location.path)
                ),
              ).size,
            },
            confidence: chapter.confidence,
            unresolvedFeedback: chapter.beats.reduce(
              (total, beat) =>
                total
                + unresolvedConcerns(artifact, session, beat.id),
              0,
            ),
            beats,
          };
        });
      return {
        id: system.id,
        title: system.title,
        thesis: system.thesis,
        risk: system.risk,
        state: storyState(
          system.chapters.flatMap((chapter) =>
            chapter.beats.map(
              (beat) =>
                session.beatStates[beat.id] ?? "pending",
            )
          ),
          artifact.generation.failures.some(
            (failure) => failure.systemId === system.id,
          ),
        ),
        scope: system.scope,
        confidence: system.confidence,
        unresolvedFeedback: chapters.reduce(
          (total, chapter) =>
            total + (chapter.unresolvedFeedback ?? 0),
          0,
        ),
        chapters,
      };
    });
}

function DiffLoadFailure({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="ultra-diff-load-error" role="alert">
      <div>
        <strong>The pull request diff did not load.</strong>
        <span>{error}</span>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry diff
        </button>
      )}
    </div>
  );
}

export function UltraReviewWorkspace({
  pr,
  mode,
  files,
  filesError = "",
  onRetryFiles,
  onLeave,
  remoteViewed,
  viewedKey,
  initialSurface = "generation",
}: UltraReviewWorkspaceProps) {
  const { ctx } = useFlow();
  const identity = useMemo(() => ({
    repo: ctx.repo,
    prNumber: pr.number,
    baseSha: pr.baseSha,
    headSha: pr.headSha,
  }), [
    ctx.repo,
    pr.number,
    pr.baseSha,
    pr.headSha,
  ]);
  const artifactKey = ultraReviewArtifactKey(identity);
  const artifact = useUltraReviewStore(
    (state) => state.artifacts[artifactKey] ?? null,
  );
  const artifactsLoaded = useUltraReviewStore(
    (state) => state.loaded,
  );
  const rejectedArtifactKeys = useUltraReviewStore(
    (state) => state.rejectedArtifactKeys,
  );
  const [surface, setSurface] =
    useState<UltraReviewSurface>(initialSurface);
  const [runError, setRunError] = useState("");
  const liveChecks = usePrData(
    (state) => state.checks[pr.number] ?? NO_CHECKS,
  );
  const liveComments = usePrData(
    (state) => state.comments[pr.number] ?? NO_COMMENTS,
  );
  const liveThreads = usePrData(
    (state) => state.threads[pr.number],
  );
  const [pendingEvidenceTarget, setPendingEvidenceTarget] =
    useState<{
      path: string;
      side: "LEFT" | "RIGHT";
      line: number;
    } | null>(null);
  const [focusedRetry, setFocusedRetry] = useState<{
    failureId: string;
    runId: string | null;
  } | null>(null);
  const focusedRetryRun = useAgentStore(
    (state) =>
      focusedRetry?.runId
        ? state.runs[focusedRetry.runId] ?? null
        : null,
  );
  const focusedRetryActive = focusedRetry !== null && (
    focusedRetry.runId === null
    || focusedRetryRun?.status === "starting"
    || focusedRetryRun?.status === "running"
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const autoStarted = useRef(false);
  const session = artifact?.sessions[mode] ?? null;
  const readOnly = pr.merged || pr.state === "closed";
  const systems = useMemo(
    () =>
      artifact && session
        ? storySystems(artifact, session)
        : [],
    [artifact, session],
  );
  const beat = artifact
    ? findBeat(artifact, session?.resume.beatId ?? null)
    : null;

  const mutate = useCallback((
    updater: (current: UltraReviewArtifact) => UltraReviewArtifact,
  ) => {
    void useUltraReviewStore.getState()
      .update(artifactKey, updater)
      .catch((error) => setRunError(String(error)));
  }, [artifactKey]);

  const start = async (retry = false) => {
    setRunError("");
    setSurface("generation");
    try {
      await startUltraReviewAnalysis({
        ctx,
        pr,
        mode,
        retry,
      });
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const retryFailure = async (failureId: string) => {
    setRunError("");
    setFocusedRetry({ failureId, runId: null });
    try {
      const runId = await startUltraReviewAnalysis({
        ctx,
        pr,
        mode,
        retryFailureId: failureId,
      });
      setFocusedRetry({ failureId, runId });
    } catch (error) {
      setFocusedRetry(null);
      setRunError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  useEffect(() => {
    if (
      !artifactsLoaded
      || artifact
      || surface !== "generation"
      || autoStarted.current
    ) {
      return;
    }
    autoStarted.current = true;
    void start();
  }, [artifact, artifactsLoaded, surface]);

  useEffect(() => {
    if (!artifact) return;
    const lifecycle = pr.merged
      ? "merged" as const
      : pr.state === "closed"
        ? "closed" as const
        : "active" as const;
    if (artifact.lifecycle === lifecycle) return;
    void useUltraReviewStore.getState().update(
      artifact.artifactKey,
      (current) => ({ ...current, lifecycle }),
    );
  }, [
    artifact?.artifactKey,
    artifact?.lifecycle,
    pr.merged,
    pr.state,
  ]);

  useEffect(() => {
    if (
      surface === "generation"
      && artifact
      && artifact.galaxy.systems.length > 0
    ) {
      setSurface("intro");
    }
  }, [
    artifact,
    artifact?.generation.status,
    artifact?.galaxy.systems.length,
    surface,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }
      if (event.key === "D" && artifact && files) {
        event.preventDefault();
        setSurface((current) => {
          if (current === "raw") return "review";
          return "raw";
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [artifact, files]);

  useEffect(() => {
    if (
      surface === "review"
      && scrollRef.current
      && session
    ) {
      scrollRef.current.scrollTop = session.resume.scrollTop;
    }
  }, [surface, session?.resume.beatId]);

  useEffect(() => {
    if (surface !== "review" || !pendingEvidenceTarget) return;
    const timer = window.setTimeout(() => {
      const file = [...document.querySelectorAll<HTMLElement>(
        ".ultra-workbench-canvas .diff-file",
      )].find(
        (candidate) =>
          candidate.dataset.path === pendingEvidenceTarget.path,
      );
      const line = file
        ? [...file.querySelectorAll<HTMLElement>("[id]")]
            .find((candidate) =>
              candidate.id.endsWith(
                `-${pendingEvidenceTarget.side}-${
                  pendingEvidenceTarget.line
                }`,
              )
            )
        : null;
      (line ?? file)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setPendingEvidenceTarget(null);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [pendingEvidenceTarget, surface, session?.resume.beatId]);

  const persistScroll = () => {
    if (
      surface !== "review"
      || !session
      || !scrollRef.current
    ) {
      return;
    }
    const scrollTop = Math.max(
      0,
      Math.floor(scrollRef.current.scrollTop),
    );
    if (scrollSaveTimer.current) {
      clearTimeout(scrollSaveTimer.current);
    }
    scrollSaveTimer.current = setTimeout(() => {
      mutate((current) => ({
        ...current,
        sessions: {
          ...current.sessions,
          [mode]: {
            ...current.sessions[mode],
            resume: {
              ...current.sessions[mode].resume,
              scrollTop,
            },
          },
        },
      }));
    }, 180);
  };

  useEffect(() => () => {
    if (scrollSaveTimer.current) {
      clearTimeout(scrollSaveTimer.current);
    }
  }, []);

  const selectChapter = (
    systemId: string,
    chapterId: string,
  ) => {
    if (!artifact || !session) return;
    const nextChapter = findChapter(artifact, chapterId);
    const nextBeat = nextChapter
      ? firstBeatForChapter(nextChapter, session)
      : null;
    mutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [mode]: {
          ...current.sessions[mode],
          resume: {
            ...current.sessions[mode].resume,
            systemId,
            chapterId,
            beatId: nextBeat?.id ?? null,
            scrollTop: 0,
          },
        },
      },
    }));
    setSurface("review");
  };

  const selectBeat = (
    systemId: string,
    chapterId: string,
    beatId: string,
  ) => {
    mutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [mode]: {
          ...current.sessions[mode],
          resume: {
            ...current.sessions[mode].resume,
            systemId,
            chapterId,
            beatId,
            scrollTop: 0,
          },
        },
      },
    }));
    setSurface("review");
  };

  const selectSystem = (systemId: string) => {
    if (!artifact) return;
    const system = artifact.galaxy.systems.find(
      (candidate) => candidate.id === systemId,
    );
    const firstChapter = system?.chapters
      .slice()
      .sort((left, right) => left.order - right.order)[0];
    if (system && firstChapter) {
      selectChapter(system.id, firstChapter.id);
    }
  };

  const selectBeatById = (beatId: string) => {
    if (!artifact) return;
    const targetChapter = allChapters(artifact).find(
      (candidate) =>
        candidate.beats.some(
          (candidateBeat) => candidateBeat.id === beatId,
        ),
    );
    const targetSystem = targetChapter
      ? findSystemForChapter(artifact, targetChapter.id)
      : null;
    if (targetChapter && targetSystem) {
      selectBeat(targetSystem.id, targetChapter.id, beatId);
    }
  };

  const selectEvidenceById = (evidenceId: string) => {
    if (!artifact) return;
    const evidence = artifact.evidence.find(
      (candidate) => candidate.id === evidenceId,
    );
    const targetBeat = allBeats(artifact).find(
      (candidate) => candidate.evidenceIds.includes(evidenceId),
    );
    if (
      evidence
      && targetBeat
      && evidence.location.startLine !== null
    ) {
      setPendingEvidenceTarget({
        path: evidence.location.path,
        side: evidence.location.side,
        line: evidence.location.startLine,
      });
      selectBeatById(targetBeat.id);
    }
  };

  const beginReview = () => {
    if (!artifact || !session) return;
    const resumeBeat = allBeats(artifact).find(
      (candidate) => candidate.id === session.resume.beatId,
    );
    const nextBeat = resumeBeat
      ?? allBeats(artifact).find(
        (candidate) =>
          session.beatStates[candidate.id] !== "reviewed",
      )
      ?? allBeats(artifact)[0];
    if (nextBeat) {
      selectBeatById(nextBeat.id);
    }
  };

  const orderedBeats = artifact ? allBeats(artifact) : [];
  const beatIndex = beat
    ? orderedBeats.findIndex(
      (candidate) => candidate.id === beat.id,
    )
    : -1;
  const previousBeat =
    beatIndex > 0 ? orderedBeats[beatIndex - 1] : null;
  const nextBeat =
    beatIndex >= 0 && beatIndex < orderedBeats.length - 1
      ? orderedBeats[beatIndex + 1]
      : null;
  const currentChapter = artifact && beat
    ? allChapters(artifact).find(
      (candidate) =>
        candidate.beats.some(
          (candidateBeat) => candidateBeat.id === beat.id,
        ),
    ) ?? null
    : null;
  const currentSystem = artifact && currentChapter
    ? findSystemForChapter(artifact, currentChapter.id)
    : null;
  const currentBeatEvidence = artifact && beat
    ? artifact.evidence.filter(
      (reference) => beat.evidenceIds.includes(reference.id),
    )
    : [];
  const beatInspection = inspectUltraReviewBeatEvidence(
    files ?? [],
    currentBeatEvidence,
    beat?.removedEvidenceIds ?? [],
    session?.creditedEvidenceIds ?? [],
  );
  const beatReviewable = beatInspection.ready;
  const beatReviewed = beat && session
    ? session.beatStates[beat.id] === "reviewed"
    : false;
  const progress = artifact
    ? calculateUltraReviewProgress(artifact, mode)
    : null;
  const blockingChecks = liveChecks.filter(
    (check) =>
      check.status === "completed"
      && check.conclusion !== null
      && ![
        "success",
        "neutral",
        "skipped",
      ].includes(check.conclusion),
  );
  const pendingChecks = liveChecks.filter(
    (check) => check.status !== "completed",
  );
  const openConcernCount = artifact && session
    ? unresolvedConcerns(artifact, session)
    : 0;
  const unresolvedThreadCount = liveThreads?.filter(
    (thread) => !thread.isResolved,
  ).length ?? 0;
  const workbenchRemoteViewed =
    readOnly && remoteViewed
      ? { map: remoteViewed.map }
      : remoteViewed;

  const markCurrentBeatReviewed = () => {
    if (!beat || !session || readOnly || !beatReviewable) return;
    mutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [mode]: {
          ...current.sessions[mode],
          beatStates: {
            ...current.sessions[mode].beatStates,
            [beat.id]: "reviewed",
          },
        },
      },
    }));
  };
  const creditCurrentBeatEvidence = (evidenceIds: string[]) => {
    if (
      evidenceIds.length === 0
      || !session
      || readOnly
    ) {
      return;
    }
    mutate((current) => ({
      ...current,
      sessions: {
        ...current.sessions,
        [mode]: {
          ...current.sessions[mode],
          creditedEvidenceIds: [
            ...new Set([
              ...current.sessions[mode].creditedEvidenceIds,
              ...evidenceIds,
            ]),
          ],
        },
      },
    }));
  };

  if (!artifactsLoaded) {
    return (
      <div className="workspace ultra-shell ultra-intro-shell">
        <div className="ws-main">
          <DiffLoadFailure
            error={filesError}
            onRetry={onRetryFiles}
          />
          <ReviewPlanIntro
            thesis={{
              title: pr.title,
              summary: "Restoring the local review plan.",
              risk: "none",
            }}
            systems={[]}
            generation={{
              status: "idle",
              stages: [{
                id: "restore",
                label: "Restore local review",
                status: "running",
              }],
            }}
            beginLabel="Restoring…"
            beginDisabled
            onBeginReview={() => undefined}
            onLeave={onLeave}
          />
        </div>
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="workspace ultra-shell ultra-intro-shell">
        <div className="ws-main">
          <DiffLoadFailure
            error={filesError}
            onRetry={onRetryFiles}
          />
          {rejectedArtifactKeys.length > 0 && (
            <div className="ultra-invalid-artifact">
              {rejectedArtifactKeys.length} persisted artifact
              {rejectedArtifactKeys.length === 1 ? "" : "s"}
              {" "}failed validation and stayed quarantined.
            </div>
          )}
          <ReviewPlanIntro
            thesis={{
              title: pr.title,
              summary: "Indexing the change into a causal review path.",
              risk: "none",
            }}
            systems={[]}
            failures={
              runError
                ? [{
                    id: "analysis-start",
                    message: runError,
                    retryable: true,
                  }]
                : []
            }
            generation={{
              status: runError ? "failed" : "running",
              stages: [{
                id: "analysis-start",
                label: "Start local analysis",
                status: runError ? "failed" : "running",
                error: runError || null,
              }],
            }}
            beginLabel="Building plan…"
            beginDisabled
            onBeginReview={() => undefined}
            onOpenRawDiff={
              files ? () => setSurface("raw") : undefined
            }
            onLeave={onLeave}
            onRetryFailure={() => void start(true)}
          />
        </div>
      </div>
    );
  }

  if (
    (surface === "intro" || surface === "generation")
    && session
  ) {
    return (
      <div className="workspace ultra-shell ultra-intro-shell">
        <div className="ws-main">
          <DiffLoadFailure
            error={filesError}
            onRetry={onRetryFiles}
          />
          {rejectedArtifactKeys.length > 0 && (
            <div className="ultra-invalid-artifact">
              {rejectedArtifactKeys.length} persisted artifact
              {rejectedArtifactKeys.length === 1 ? "" : "s"}
              {" "}failed validation and stayed quarantined.
            </div>
          )}
          {readOnly && (
            <div className="ultra-read-only-banner">
              {pr.merged ? "Merged" : "Closed"} implementation story.
              The plan stays navigable. Review state is frozen.
            </div>
          )}
          <ReviewPlanIntro
            thesis={{
              title: pr.title,
              summary: artifact.galaxy.thesis,
              scope: {
                changedLines: artifact.evidence.filter(
                  (evidence) => evidence.kind === "changed",
                ).length,
                files: pr.changedFiles,
              },
              risk: "none",
            }}
            systems={systems}
            coverage={progress
              ? {
                  mapped:
                    progress.totalChangedEvidence
                    - progress.unmappedEvidence,
                  total: progress.totalChangedEvidence,
                  unmapped: progress.unmappedEvidence,
                }
              : undefined}
            generation={
              artifact.generation.status === "complete"
                ? undefined
                : artifact.generation
            }
            failures={artifact.generation.failures.map(
              (failure) => ({
                id: failure.id,
                message: failure.message,
                retryable: failure.retryable,
                systemId: failure.systemId,
                chapterId: failure.chapterId,
              }),
            )}
            beginLabel={
              artifact.generation.status === "running"
                ? beat
                  ? "Review ready chapter"
                  : "Building plan…"
                : readOnly
                ? "Open review"
                : (progress?.reviewedBeats ?? 0) > 0
                  ? "Resume review"
                  : "Begin review"
            }
            beginDisabled={
              !beat
              || !files
            }
            onBeginReview={beginReview}
            onOpenRawDiff={
              files ? () => setSurface("raw") : undefined
            }
            onLeave={onLeave}
            onRetryFailures={
              readOnly ? undefined : () => void start(true)
            }
            retryingFailureId={
              focusedRetryActive
                ? focusedRetry?.failureId
                : undefined
            }
            onRetryFailure={
              readOnly
                ? undefined
                : (failureId) => void retryFailure(failureId)
            }
          />
          {runError && (
            <p className="ultra-form-error">{runError}</p>
          )}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="workspace ultra-shell ultra-intro-shell">
        <div className="ws-main">
          <ReviewPlanIntro
            thesis={{
              title: pr.title,
              summary: artifact.galaxy.thesis,
              risk: "none",
            }}
            systems={[]}
            failures={[{
              id: "missing-session",
              message:
                "The local review session is missing. Rebuild the plan.",
              retryable: true,
            }]}
            generation={{
              status: "failed",
              stages: [{
                id: "restore-session",
                label: "Restore review session",
                status: "failed",
                error: "No valid local session exists.",
              }],
            }}
            beginLabel="Review unavailable"
            beginDisabled
            onBeginReview={() => undefined}
            onLeave={onLeave}
            onRetryFailure={() => void start(true)}
          />
        </div>
      </div>
    );
  }

  const activeMode =
    surface === "raw" || surface === "ledger"
      ? surface
      : "review";

  return (
    <div className="workspace ultra-shell ultra-workbench-shell">
      <div className="ws-main ultra-workbench">
        <header className="ultra-workbench-header">
          <div className="ultra-workbench-identity">
            <div className="ultra-workbench-back">
              <button type="button" onClick={onLeave}>
                ← PR
              </button>
              <button
                type="button"
                onClick={() => setSurface("intro")}
              >
                Review plan
              </button>
            </div>
            <div>
              <span className="u-mark">
                ULTRAREVIEW / PR #{pr.number}
              </span>
              <h1>{pr.title}</h1>
              <p>
                {pr.headRef} → {pr.baseRef}
              </p>
            </div>
          </div>

          <nav
            className="ultra-workbench-modes"
            aria-label="UltraReview modes"
          >
            <button
              type="button"
              data-active={activeMode === "review"}
              aria-current={
                activeMode === "review" ? "page" : undefined
              }
              onClick={() => setSurface("review")}
            >
              Review
            </button>
            <button
              type="button"
              data-active={activeMode === "raw"}
              aria-current={
                activeMode === "raw" ? "page" : undefined
              }
              disabled={!files}
              title="Raw Diff · Shift D"
              onClick={() => setSurface("raw")}
            >
              Raw diff <kbd>⇧D</kbd>
            </button>
            <button
              type="button"
              data-active={activeMode === "ledger"}
              aria-current={
                activeMode === "ledger" ? "page" : undefined
              }
              onClick={() => setSurface("ledger")}
            >
              Closing
            </button>
          </nav>

          <div className="ultra-workbench-status">
            <div className="ultra-workbench-progress">
              <strong>
                {progress?.reviewedBeats ?? 0}/
                {progress?.totalBeats ?? 0}
              </strong>
              <span>beats inspected</span>
              <span
                className="ultra-workbench-progress-track"
                aria-hidden
              >
                <span
                  style={{
                    width: `${
                      progress && progress.totalBeats > 0
                        ? Math.round(
                          progress.reviewedBeats
                          / progress.totalBeats
                          * 100,
                        )
                        : 0
                    }%`,
                  }}
                />
              </span>
            </div>
            <div className="ultra-workbench-signals">
              {blockingChecks.length > 0 && (
                <span data-tone="danger">
                  {blockingChecks.length} CI failing
                </span>
              )}
              {pendingChecks.length > 0 && (
                <span data-tone="pending">
                  {pendingChecks.length} CI pending
                </span>
              )}
              {openConcernCount > 0 && (
                <span data-tone="pending">
                  {openConcernCount} open question
                  {openConcernCount === 1 ? "" : "s"}
                </span>
              )}
              {unresolvedThreadCount > 0 && (
                <span data-tone="danger">
                  {unresolvedThreadCount} unresolved thread
                  {unresolvedThreadCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="ultra-workbench-alerts">
          <DiffLoadFailure
            error={filesError}
            onRetry={onRetryFiles}
          />
          {readOnly && (
            <div className="ultra-read-only-banner">
              {pr.merged ? "Merged" : "Closed"} implementation story.
              Navigation stays live. Review state is frozen.
            </div>
          )}

          {artifact.generation.status === "running" && (
            <div className="ultra-global-feedback">
              <strong>Analysis continues.</strong>
              <span>
                {allChapters(artifact).length} validated chapter
                {allChapters(artifact).length === 1 ? "" : "s"}
                {" "}ready now. Later chapters will join this workbench.
              </span>
            </div>
          )}

          {artifact.generation.failures.length > 0 && (
            <div className="ultra-global-warning">
              <div>
                <strong>
                  Analysis is incomplete.
                </strong>
                <span>
                {artifact.generation.failures.length} analysis region
                {artifact.generation.failures.length === 1 ? "" : "s"}
                {" "}failed. Completed chapters remain usable.
                </span>
              </div>
              <ul>
                {artifact.generation.failures.map((failure) => (
                  <li key={failure.id}>
                    <span>{failure.message}</span>
                    {!readOnly && failure.retryable && (
                      <button
                        type="button"
                        className="small"
                        disabled={focusedRetryActive}
                        onClick={() =>
                          void retryFailure(failure.id)}
                      >
                        {focusedRetryActive
                          && focusedRetry?.failureId === failure.id
                            ? "Retrying…"
                            : "Retry region"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unresolvedThreadCount > 0 && (
            <div className="ultra-global-feedback">
              <strong>
                {unresolvedThreadCount} GitHub review thread
                {unresolvedThreadCount === 1 ? "" : "s"}
                {" "}remain unresolved.
              </strong>
              <span>
                Anchored feedback stays visible in Review and Raw Diff.
              </span>
            </div>
          )}
          {beat && (beat.removedEvidenceIds?.length ?? 0) > 0 && (
            <div className="ultra-global-feedback">
              <strong>Prior diff evidence was removed.</strong>
              <span>
                {currentChapter?.before
                  ?? `${beat.removedEvidenceIds?.length ?? 0} prior evidence regions no longer exist in this diff.`}
              </span>
            </div>
          )}
        </div>

        <div className="ultra-workbench-body">
          <ReviewStoryRail
            systems={systems}
            activeSystemId={
              currentSystem?.id
              ?? session.resume.systemId
              ?? undefined
            }
            activeChapterId={
              currentChapter?.id
              ?? session.resume.chapterId
              ?? undefined
            }
            activeBeatId={beat?.id ?? undefined}
            onSelectSystem={selectSystem}
            onSelectChapter={selectChapter}
            onSelectBeat={selectBeat}
          />

          <div
            className="ultra-workbench-canvas"
            ref={scrollRef}
            onScroll={
              activeMode === "review"
                ? persistScroll
                : undefined
            }
          >
            {activeMode === "raw" && files ? (
              <RawDiffWorkspace
                artifact={artifact}
                session={session}
                files={files}
                comments={liveComments}
                pr={pr}
                remoteViewed={workbenchRemoteViewed}
                viewedKey={viewedKey}
                readOnly={readOnly}
                onMutate={mutate}
              />
            ) : activeMode === "ledger" ? (
              <ClosingLedger
                pr={pr}
                artifact={artifact}
                session={session}
                files={files ?? []}
                checks={liveChecks}
                comments={liveComments}
                unresolvedThreadCount={unresolvedThreadCount}
                readOnly={readOnly}
                onMutate={mutate}
                onNavigateBeat={selectBeatById}
                onNavigateEvidence={selectEvidenceById}
              />
            ) : beat && files ? (
              <BeatWorkspace
                pr={pr}
                artifact={artifact}
                session={session}
                beat={beat}
                files={files}
                comments={liveComments}
                onMutate={mutate}
                remoteViewed={workbenchRemoteViewed}
                viewedKey={viewedKey}
                readOnly={readOnly}
              />
            ) : (
              <main className="ultra-workbench-empty">
                <h2>Evidence is still loading.</h2>
                <p>
                  The review plan remains available.
                  Raw Diff will unlock when the files arrive.
                </p>
              </main>
            )}
          </div>
        </div>

        {beat && (
          <footer className="ultra-review-flowbar">
            <button
              type="button"
              disabled={!previousBeat}
              onClick={() => {
                if (previousBeat) selectBeatById(previousBeat.id);
              }}
            >
              ← Previous
            </button>
            <div className="ultra-review-flowbar-position">
              <span>
                Beat {beatIndex + 1} of {orderedBeats.length}
              </span>
              <strong>{beat.title}</strong>
            </div>
            <div className="ultra-review-flowbar-state">
              <span
                data-state={
                  beatReviewed ? "reviewed" : "pending"
                }
              >
                {beatReviewed
                  ? "Inspected"
                  : beatInspection
                    .outstandingRemovedEvidenceIds.length > 0
                    ? `${beatInspection.outstandingRemovedEvidenceIds.length} removed region${
                      beatInspection.outstandingRemovedEvidenceIds.length === 1
                        ? ""
                        : "s"
                    } need acknowledgement`
                    : beatInspection
                      .outstandingStructuralEvidenceIds.length > 0
                      ? `${beatInspection.outstandingStructuralEvidenceIds.length} file-level change${
                        beatInspection.outstandingStructuralEvidenceIds.length === 1
                          ? ""
                          : "s"
                      } need Raw Diff credit`
                      : !beatInspection.exactChangedEvidence
                        ? "Trusted evidence is unavailable"
                  : activeMode === "review"
                    ? "Inspection required"
                    : `${activeMode === "raw"
                      ? "Raw Diff"
                      : "Closing"} mode`}
              </span>
              {activeMode === "review"
                && beatInspection
                  .outstandingRemovedEvidenceIds.length > 0
                && (
                  <button
                    type="button"
                    className="link"
                    disabled={readOnly}
                    onClick={() =>
                      creditCurrentBeatEvidence(
                        beatInspection
                          .outstandingRemovedEvidenceIds,
                      )}
                  >
                    Acknowledge removal summary
                  </button>
                )}
              {activeMode === "review"
                && beatInspection
                  .outstandingRemovedEvidenceIds.length === 0
                && !beatReviewable && (
                <button
                  type="button"
                  className="link"
                  disabled={!files}
                  onClick={() => setSurface("raw")}
                >
                  Inspect in Raw Diff
                </button>
              )}
            </div>
            <button
              type="button"
              className="primary"
              disabled={
                !readOnly
                && !beatReviewed
                && (
                  (
                    activeMode === "review"
                    && !beatReviewable
                  )
                  || (
                    activeMode === "raw"
                    && beatInspection
                      .outstandingStructuralEvidenceIds.length > 0
                    && !beatInspection.exactChangedEvidence
                  )
                )
              }
              onClick={() => {
                if (
                  activeMode === "raw"
                  && !readOnly
                  && beatInspection
                    .outstandingStructuralEvidenceIds.length > 0
                ) {
                  creditCurrentBeatEvidence(
                    beatInspection
                      .outstandingStructuralEvidenceIds,
                  );
                  return;
                }
                if (
                  activeMode === "raw"
                  && !readOnly
                  && beatInspection
                    .outstandingRemovedEvidenceIds.length > 0
                ) {
                  creditCurrentBeatEvidence(
                    beatInspection
                      .outstandingRemovedEvidenceIds,
                  );
                  return;
                }
                if (activeMode !== "review") {
                  setSurface("review");
                  return;
                }
                if (!readOnly && !beatReviewed) {
                  markCurrentBeatReviewed();
                  return;
                }
                if (nextBeat) {
                  selectBeatById(nextBeat.id);
                } else {
                  setSurface("ledger");
                }
              }}
            >
              {activeMode === "raw"
                && !readOnly
                && beatInspection
                  .outstandingStructuralEvidenceIds.length > 0
                ? "Credit file-level evidence"
                : activeMode === "raw"
                  && !readOnly
                  && beatInspection
                    .outstandingRemovedEvidenceIds.length > 0
                  ? "Acknowledge removed evidence"
                  : activeMode !== "review"
                ? "Return to review →"
                : !readOnly && !beatReviewed
                ? "Mark inspected"
                : nextBeat
                  ? "Next beat →"
                  : "Finish review →"}
            </button>
          </footer>
        )}

        {runError && (
          <p className="ultra-form-error ultra-workbench-error">
            {runError}
          </p>
        )}
      </div>
    </div>
  );
}
