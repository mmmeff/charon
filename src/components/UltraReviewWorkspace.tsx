import {
  type RefObject,
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
import { startUltraReviewAnalysis } from "../lib/ultrareview-flow";
import { completeUltraReviewDocument } from "../lib/ultrareview-session";
import { useUltraReviewStore } from "../lib/ultrareview-store";
import { useAgentStore } from "../lib/store";
import { usePrData } from "../lib/events";
import type {
  AgentRun,
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
  ReviewOutline,
  type StoryBeat,
  type StoryChapter,
  type StorySystem,
} from "./ultrareview";
import { ClosingLedger } from "./ultrareview/ClosingLedger";
import {
  allBeats,
  allChapters,
  findBeat,
  findChapter,
  findSystemForChapter,
} from "./ultrareview/navigation";
import { RawDiffWorkspace } from "./ultrareview/RawDiffWorkspace";
import {
  ReviewDocument,
  reviewProgressPercent,
} from "./ultrareview/ReviewDocument";
import { useFlow } from "./flow";

const NO_CHECKS: CheckInfo[] = [];
const NO_COMMENTS: CommentInfo[] = [];
const SCROLL_PERSIST_IDLE_MS = 600;
type UltraReviewSurface =
  | "generation"
  | "intro"
  | "review"
  | "ledger"
  | "raw";

function latestUltraReviewReasoning(
  run: AgentRun | null,
): string | undefined {
  if (run === null) return undefined;
  for (let index = run.entries.length - 1; index >= 0; index -= 1) {
    const entry = run.entries[index];
    if (entry.type === "thought") return entry.text;
  }
  return undefined;
}

function ReviewScrollProgress({
  scrollRef,
}: {
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const canvas = scrollRef.current;
    if (
      !canvas
      || typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    let totalUnits = 0;
    let furthestUnit = 1;
    let observer: IntersectionObserver | null = null;
    let endObserver: IntersectionObserver | null = null;
    let observedMarkers = new WeakSet<Element>();
    const pendingMarkers = new Set<HTMLElement>();
    let progressFrame = 0;

    const readTotal = () => {
      const documentNode = canvas.querySelector<HTMLElement>(
        "[data-ultra-progress-total]",
      );
      const candidate = Number.parseInt(
        documentNode?.dataset.ultraProgressTotal ?? "",
        10,
      );
      totalUnits = Number.isFinite(candidate)
        ? Math.max(0, candidate)
        : 0;
    };

    const publish = () => {
      if (totalUnits === 0) return;
      const next = reviewProgressPercent(
        furthestUnit,
        totalUnits,
      );
      setPercent((current) => Math.max(current, next));
    };

    const observeMarker = (marker: Element) => {
      if (observedMarkers.has(marker)) return;
      observedMarkers.add(marker);
      if (marker.matches("[data-ultra-progress-end]")) {
        endObserver?.observe(marker);
      } else {
        observer?.observe(marker);
      }
    };

    const observeWithin = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches("[data-ultra-progress-unit]")) {
        observeMarker(node);
      }
      node.querySelectorAll("[data-ultra-progress-unit]")
        .forEach(observeMarker);
    };

    const updateProgress = (
      entries: IntersectionObserverEntry[],
    ) => {
      entries.forEach((entry) => {
        pendingMarkers.add(entry.target as HTMLElement);
      });
      if (progressFrame !== 0) return;
      progressFrame = window.requestAnimationFrame(() => {
        progressFrame = 0;
        const readingLine = canvas.getBoundingClientRect().top
          + Math.min(160, canvas.clientHeight * 0.24);
        pendingMarkers.forEach((marker) => {
          if (!marker.isConnected) return;
          const unit = Number.parseInt(
            marker.dataset.ultraProgressUnit ?? "",
            10,
          );
          if (
            Number.isFinite(unit)
            && marker.getBoundingClientRect().top <= readingLine
          ) {
            furthestUnit = Math.max(furthestUnit, unit);
          }
        });
        pendingMarkers.clear();
        publish();
      });
    };

    const updateEndProgress = (
      entries: IntersectionObserverEntry[],
    ) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const marker = entry.target as HTMLElement;
        const unit = Number.parseInt(
          marker.dataset.ultraProgressUnit ?? "",
          10,
        );
        if (Number.isFinite(unit)) {
          furthestUnit = Math.max(furthestUnit, unit);
        }
      });
      publish();
    };

    const observeProgress = () => {
      observer?.disconnect();
      endObserver?.disconnect();
      observedMarkers = new WeakSet<Element>();
      const readingOffset = Math.min(
        160,
        canvas.clientHeight * 0.24,
      );
      const remainingHeight = Math.max(
        0,
        canvas.clientHeight - readingOffset - 1,
      );
      observer = new IntersectionObserver(updateProgress, {
        root: canvas,
        rootMargin: `0px 0px -${remainingHeight}px 0px`,
      });
      endObserver = new IntersectionObserver(updateEndProgress, {
        root: canvas,
      });
      readTotal();
      observeWithin(canvas);
      publish();
    };

    observeProgress();
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver((records) => {
        readTotal();
        records.forEach((record) => {
          record.addedNodes.forEach(observeWithin);
        });
        publish();
      });
    mutationObserver?.observe(canvas, {
      childList: true,
      subtree: true,
    });
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(observeProgress);
    resizeObserver?.observe(canvas);
    return () => {
      window.cancelAnimationFrame(progressFrame);
      observer?.disconnect();
      endObserver?.disconnect();
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [scrollRef]);

  return (
    <div
      className="ultra-workbench-progress"
      role="progressbar"
      aria-label="Review document scrolled"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <strong>{percent}%</strong>
      <span>scrolled</span>
      <span className="ultra-workbench-progress-track" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

interface UltraReviewWorkspaceProps {
  pr: PrSummary;
  mode: UltraReviewMode;
  files: FileDiff[] | null;
  filesError?: string;
  onRetryFiles?: () => void;
  onLeave: () => void;
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
          const beats: StoryBeat[] = [...chapter.beats]
            .sort((left, right) => left.order - right.order)
            .map((beat) => ({
              id: beat.id,
              title: beat.title,
              risk: beat.risk,
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
  const [surface, setSurface] =
    useState<UltraReviewSurface>(initialSurface);
  const [runError, setRunError] = useState("");
  const [analysisRunId, setAnalysisRunId] =
    useState<string | null>(null);
  const analysisRun = useAgentStore((state) => {
    if (analysisRunId) {
      return state.runs[analysisRunId] ?? null;
    }
    const activeRunId = state.order.find((runId) => {
      const run = state.runs[runId];
      return run?.repo === ctx.repo
        && run.prNumber === pr.number
        && (
          run.relation === "build UltraReview"
          || run.relation === "retry UltraReview analysis"
        )
        && (
          run.status === "starting"
          || run.status === "running"
        );
    });
    return activeRunId
      ? state.runs[activeRunId] ?? null
      : null;
  });
  const reasoningActivity = latestUltraReviewReasoning(analysisRun);
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
      beatId: string;
      path: string;
      side: "LEFT" | "RIGHT";
      line: number;
    } | null>(null);
  const [pendingBeatTargetId, setPendingBeatTargetId] =
    useState<string | null>(null);
  const [activeDocumentBeatId, setActiveDocumentBeatId] =
    useState<string | null>(null);
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
  const activeDocumentBeatIdRef = useRef<string | null>(null);
  const scrollSaveTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const autoStarted = useRef(false);
  const session = artifact?.sessions[mode] ?? null;
  // Resume writes replace artifact objects. Keep the document stable unless
  // data that it renders has changed.
  const reviewDocumentArtifact = useMemo(
    () => artifact,
    [
      artifact?.concerns,
      artifact?.coverage,
      artifact?.evidence,
      artifact?.galaxy,
    ],
  );
  const reviewDocumentSession = useMemo(
    () => session,
    [
      session?.concernDispositions,
      session?.mode,
      session?.notes,
      session?.resume.diffViewStates,
      session?.reviewCompletedAt,
    ],
  );
  const readOnly = pr.merged || pr.state === "closed";
  const systems = useMemo(
    () =>
      artifact && session
        ? storySystems(artifact, session)
        : [],
    [
      artifact?.concerns,
      artifact?.evidence,
      artifact?.galaxy.systems,
      session?.concernDispositions,
    ],
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
      const runId = await startUltraReviewAnalysis({
        ctx,
        pr,
        mode,
        retry,
      });
      setAnalysisRunId(runId);
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
    if (surface !== "review" || !scrollRef.current || !session) {
      return;
    }
    scrollRef.current.scrollTop = session.resume.scrollTop;
  }, [artifactKey, session?.resume.scrollTop, surface]);

  useEffect(() => {
    if (!artifact || !session) return;
    const fallback = findBeat(artifact, session.resume.beatId);
    if (
      activeDocumentBeatId === null
      || !allBeats(artifact).some(
        (candidate) => candidate.id === activeDocumentBeatId,
      )
    ) {
      setActiveDocumentBeatId(fallback?.id ?? null);
    }
  }, [artifact, activeDocumentBeatId, session]);

  useEffect(() => {
    activeDocumentBeatIdRef.current = activeDocumentBeatId;
  }, [activeDocumentBeatId]);

  useEffect(() => {
    const canvas = scrollRef.current;
    if (
      surface !== "review"
      || !canvas
      || typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const sections = canvas.querySelectorAll<HTMLElement>(
      "[data-ultra-beat-id]",
    );
    let observer: IntersectionObserver | null = null;
    const updateActiveBeat = (
      entries: IntersectionObserverEntry[],
    ) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort(
          (left, right) =>
            Math.abs(left.boundingClientRect.top)
            - Math.abs(right.boundingClientRect.top),
        )[0];
      const beatId = (
        visible?.target as HTMLElement | undefined
      )?.dataset.ultraBeatId;
      if (!beatId) return;
      activeDocumentBeatIdRef.current = beatId;
      setActiveDocumentBeatId((current) =>
        current === beatId ? current : beatId,
      );
    };
    const observeSections = () => {
      observer?.disconnect();
      const readingOffset = Math.min(
        160,
        canvas.clientHeight * 0.24,
      );
      const remainingHeight = Math.max(
        0,
        canvas.clientHeight - readingOffset - 1,
      );
      observer = new IntersectionObserver(updateActiveBeat, {
        root: canvas,
        rootMargin:
          `-${readingOffset}px 0px -${remainingHeight}px 0px`,
      });
      sections.forEach((section) => observer?.observe(section));
    };
    observeSections();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(observeSections);
    resizeObserver?.observe(canvas);
    return () => {
      observer?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [artifact?.galaxy.systems, surface]);

  useEffect(() => {
    if (surface !== "review" || pendingBeatTargetId === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      const target = [
        ...scrollRef.current?.querySelectorAll<HTMLElement>(
          "[data-ultra-beat-id]",
        ) ?? [],
      ].find(
        (candidate) =>
          candidate.dataset.ultraBeatId === pendingBeatTargetId,
      );
      const canvas = scrollRef.current;
      if (target && canvas) {
        const distance = Math.abs(
          target.getBoundingClientRect().top
          - canvas.getBoundingClientRect().top,
        );
        canvas.scrollTo({
          top:
            canvas.scrollTop
            + target.getBoundingClientRect().top
            - canvas.getBoundingClientRect().top,
          behavior:
            distance > canvas.clientHeight * 2
              ? "auto"
              : "smooth",
        });
      }
      setPendingBeatTargetId(null);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [pendingBeatTargetId, surface]);

  useEffect(() => {
    if (surface !== "review" || !pendingEvidenceTarget) return;
    const timer = window.setTimeout(() => {
      const section = [
        ...scrollRef.current?.querySelectorAll<HTMLElement>(
          "[data-ultra-beat-id]",
        ) ?? [],
      ].find(
        (candidate) =>
          candidate.dataset.ultraBeatId
          === pendingEvidenceTarget.beatId,
      );
      const file = [...section?.querySelectorAll<HTMLElement>(
        ".diff-file",
      ) ?? []].find(
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
      const target = line ?? file;
      const canvas = scrollRef.current;
      if (target && canvas) {
        canvas.scrollTo({
          top:
            canvas.scrollTop
            + target.getBoundingClientRect().top
            - canvas.getBoundingClientRect().top
            - canvas.clientHeight / 2,
          behavior: "smooth",
        });
      }
      setPendingEvidenceTarget(null);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [pendingEvidenceTarget, surface]);

  const persistScroll = () => {
    if (
      surface !== "review"
      || !session
      || !scrollRef.current
    ) {
      return;
    }
    if (scrollSaveTimer.current) {
      clearTimeout(scrollSaveTimer.current);
    }
    scrollSaveTimer.current = setTimeout(() => {
      const canvas = scrollRef.current;
      if (!canvas) return;
      const scrollTop = Math.max(0, Math.floor(canvas.scrollTop));
      const visibleBeatId = activeDocumentBeatIdRef.current;
      mutate((current) => {
        const nextBeat = visibleBeatId
          ? findBeat(current, visibleBeatId)
          : null;
        const nextChapter = nextBeat
          ? allChapters(current).find((candidate) =>
              candidate.beats.some(
                (candidateBeat) => candidateBeat.id === nextBeat.id,
              )
            ) ?? null
          : null;
        const nextSystem = nextChapter
          ? findSystemForChapter(current, nextChapter.id)
          : null;
        return {
          ...current,
          sessions: {
            ...current.sessions,
            [mode]: {
              ...current.sessions[mode],
              resume: {
                ...current.sessions[mode].resume,
                systemId:
                  nextSystem?.id
                  ?? current.sessions[mode].resume.systemId,
                chapterId:
                  nextChapter?.id
                  ?? current.sessions[mode].resume.chapterId,
                beatId:
                  nextBeat?.id
                  ?? current.sessions[mode].resume.beatId,
                scrollTop,
              },
            },
          },
        };
      });
    }, SCROLL_PERSIST_IDLE_MS);
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
    if (!artifact) return;
    const nextChapter = findChapter(artifact, chapterId);
    const nextBeat = nextChapter?.beats
      .slice()
      .sort((left, right) => left.order - right.order)[0];
    if (nextBeat) {
      selectBeat(systemId, chapterId, nextBeat.id);
    }
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
    setActiveDocumentBeatId(beatId);
    setPendingBeatTargetId(beatId);
    setSurface("review");
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
        beatId: targetBeat.id,
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
      ?? allBeats(artifact)[0];
    if (nextBeat) {
      selectBeatById(nextBeat.id);
    }
  };

  const finishReview = useCallback(() => {
    if (readOnly) return;
    const currentSession = useUltraReviewStore.getState()
      .artifacts[artifactKey]?.sessions[mode];
    if (!currentSession) return;
    if (currentSession.reviewCompletedAt === undefined) {
      mutate((current) => ({
        ...current,
        sessions: {
          ...current.sessions,
          [mode]: completeUltraReviewDocument(
            current.sessions[mode],
            Date.now(),
          ),
        },
      }));
    }
    setSurface("ledger");
  }, [artifactKey, mode, mutate, readOnly]);

  const activeBeat = artifact
    ? findBeat(
        artifact,
        activeDocumentBeatId ?? session?.resume.beatId ?? null,
      )
    : null;
  const progress = useMemo(
    () =>
      artifact
        ? calculateUltraReviewProgress(artifact, mode)
        : null,
    [artifact, mode],
  );
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
          <ReviewPlanIntro
            thesis={{
              title: pr.title,
              summary: runError
                ? "UltraReview could not build this review plan."
                : "Indexing the change into a causal review path.",
              risk: "none",
            }}
            systems={[]}
            failures={
              runError
                ? [{
                    id: "analysis-start",
                    message:
                      "UltraReview could not build this review plan.",
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
                error: null,
              }],
            }}
            reasoningActivity={
              !runError
                ? reasoningActivity
                : undefined
            }
            beginLabel={
              runError
                ? "Plan unavailable"
                : "Building plan…"
            }
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
          {readOnly && (
            <div className="ultra-read-only-banner">
              {pr.merged ? "Merged" : "Closed"} implementation story.
              Read only.
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
            reasoningActivity={
              artifact.generation.status === "running"
                ? reasoningActivity
                : undefined
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
              artifact.generation.status === "failed"
                ? "Plan unavailable"
                : artifact.generation.status === "running"
                ? beat
                  ? "Review ready chapter"
                  : "Building plan…"
                : readOnly
                ? "Open review"
                : session.resume.scrollTop > 0
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
                : (failureId) => {
                    const failure =
                      artifact.generation.failures.find(
                        (candidate) =>
                          candidate.id === failureId,
                      );
                    if (failure?.scope === "artifact") {
                      void start(true);
                    } else {
                      void retryFailure(failureId);
                    }
                  }
            }
          />
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
            {activeMode === "review" && (
              <ReviewScrollProgress
                key={artifact.artifactKey}
                scrollRef={scrollRef}
              />
            )}
            {activeMode === "review" && !readOnly && (
              <button
                type="button"
                className="primary small"
                onClick={finishReview}
              >
                {session.reviewCompletedAt === undefined
                  ? "Done reviewing"
                  : "Final review"}
              </button>
            )}
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
                {" "}ready now. Later chapters will join this document.
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
          {allBeats(artifact).some(
            (candidate) =>
              (candidate.removedEvidenceIds?.length ?? 0) > 0,
          ) && (
            <div className="ultra-global-feedback">
              <strong>Prior diff evidence was removed.</strong>
              <span>
                The affected section carries the saved summary and
                explicit acknowledgement.
              </span>
            </div>
          )}
        </div>

        <div className="ultra-workbench-body">
          <ReviewOutline
            systems={systems}
            activeBeatId={activeBeat?.id ?? undefined}
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
            ) : files ? (
              <ReviewDocument
                pr={pr}
                artifact={reviewDocumentArtifact ?? artifact}
                session={reviewDocumentSession ?? session}
                files={files}
                comments={liveComments}
                onMutate={mutate}
                readOnly={readOnly}
                forceMaterializedBeatId={
                  pendingEvidenceTarget?.beatId
                  ?? pendingBeatTargetId
                  ?? undefined
                }
                onDoneReviewing={finishReview}
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

        {runError && (
          <p className="ultra-form-error ultra-workbench-error">
            {runError}
          </p>
        )}
      </div>
    </div>
  );
}
