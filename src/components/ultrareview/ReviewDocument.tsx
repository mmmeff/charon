import {
  memo,
  startTransition,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  projectOwnedHunksByBeat,
} from "../../lib/ultrareview-evidence";
import type {
  CommentInfo,
  FileDiff,
  PrSummary,
  UltraReviewArtifact,
  UltraReviewBeat,
  UltraReviewChapter,
  UltraReviewSession,
  UltraReviewSystem,
} from "../../types";
import {
  BeatSummary,
  BeatWorkspace,
} from "./BeatWorkspace";
import { allBeats } from "./navigation";

interface ReviewDocumentProps {
  pr: PrSummary;
  artifact: UltraReviewArtifact;
  session: UltraReviewSession;
  files: FileDiff[];
  comments: CommentInfo[];
  readOnly: boolean;
  forceMaterializedBeatId?: string;
  onMutate: (
    updater: (artifact: UltraReviewArtifact) => UltraReviewArtifact,
  ) => void;
  onDoneReviewing: () => void;
}

const INITIAL_MATERIALIZED_BEAT_COUNT = 2;
const MINIMUM_MATERIALIZATION_AHEAD_PX = 640;

export function reviewDiffUnitCount(files: FileDiff[]): number {
  return files.reduce((total, file) => {
    const hunkCount = file.lines.reduce(
      (count, line) => count + (line.type === "hunk" ? 1 : 0),
      0,
    );
    return total + Math.max(1, hunkCount);
  }, 0);
}

export function reviewProgressPercent(
  currentUnit: number,
  totalUnits: number,
): number {
  if (totalUnits <= 0) return 100;
  const completedUnits = Math.max(
    0,
    Math.min(totalUnits, currentUnit - 1),
  );
  return Math.round(completedUnits / totalUnits * 100);
}

function estimatedDetailsHeight(files: FileDiff[]): number {
  const rows = files.reduce(
    (total, file) => total + file.lines.length,
    0,
  );
  return Math.max(460, 300 + rows * 22 + files.length * 52);
}

function WindowedBeatDetails({
  materialized,
  estimatedHeight,
  children,
}: {
  materialized: boolean;
  estimatedHeight: number;
  children: ReactNode;
}) {
  return (
    <div
      className="ultra-review-document-details"
      data-materialized={materialized ? "true" : "false"}
      style={
        materialized
          ? undefined
          : { minHeight: estimatedHeight }
      }
    >
      {materialized ? children : null}
    </div>
  );
}

function orderedSystems(
  artifact: UltraReviewArtifact,
): UltraReviewSystem[] {
  return [...artifact.galaxy.systems]
    .sort((left, right) => left.order - right.order);
}

function orderedChapters(
  system: UltraReviewSystem,
): UltraReviewChapter[] {
  return [...system.chapters]
    .sort((left, right) => left.order - right.order);
}

function orderedChapterBeats(
  chapter: UltraReviewChapter,
): UltraReviewBeat[] {
  return [...chapter.beats]
    .sort((left, right) => left.order - right.order);
}

export const ReviewDocument = memo(function ReviewDocument({
  pr,
  artifact,
  session,
  files,
  comments,
  readOnly,
  forceMaterializedBeatId,
  onMutate,
  onDoneReviewing,
}: ReviewDocumentProps) {
  const systems = useMemo(
    () => orderedSystems(artifact),
    [artifact.galaxy.systems],
  );
  const beats = useMemo(
    () => allBeats(artifact),
    [artifact.galaxy.systems],
  );
  const documentRef = useRef<HTMLElement>(null);
  const [materializedBeatIds, setMaterializedBeatIds] = useState(
    () => new Set<string>(),
  );
  const beatNumbers = useMemo(
    () => new Map(
      beats.map((beat, index) => [beat.id, index + 1]),
    ),
    [beats],
  );
  const focusedFilesByBeat = useMemo(
    () => projectOwnedHunksByBeat(files, artifact),
    [
      artifact.coverage,
      artifact.evidence,
      artifact.galaxy.systems,
      files,
    ],
  );
  const estimatedHeightByBeat = useMemo(
    () => new Map(
      [...focusedFilesByBeat].map(([beatId, focusedFiles]) => [
        beatId,
        estimatedDetailsHeight(focusedFiles),
      ]),
    ),
    [focusedFilesByBeat],
  );
  const progressLayout = useMemo(() => {
    let nextUnit = 1;
    const byBeat = new Map<
      string,
      { summaryUnit: number; reviewUnitStart: number }
    >();
    beats.forEach((beat) => {
      const summaryUnit = nextUnit;
      const reviewUnitStart = summaryUnit + 1;
      const focusedFiles = focusedFilesByBeat.get(beat.id) ?? [];
      byBeat.set(beat.id, { summaryUnit, reviewUnitStart });
      nextUnit = reviewUnitStart
        + reviewDiffUnitCount(focusedFiles);
    });
    return {
      byBeat,
      totalUnits: Math.max(0, nextUnit - 1),
    };
  }, [beats, focusedFilesByBeat]);
  const showSystems = systems.length > 1;

  useEffect(() => {
    const validBeatIds = new Set(beats.map((beat) => beat.id));
    setMaterializedBeatIds((current) => {
      const next = new Set(
        [...current].filter((beatId) => validBeatIds.has(beatId)),
      );
      if (forceMaterializedBeatId) {
        next.add(forceMaterializedBeatId);
      }
      if (
        next.size === current.size
        && [...next].every((beatId) => current.has(beatId))
      ) {
        return current;
      }
      return next;
    });
  }, [beats, forceMaterializedBeatId]);

  useEffect(() => {
    const documentNode = documentRef.current;
    const root = documentNode?.closest<HTMLElement>(
      ".ultra-workbench-canvas",
    );
    if (
      !documentNode
      || !root
      || typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const sections = [
      ...documentNode.querySelectorAll<HTMLElement>(
        "[data-ultra-beat-id]",
      ),
    ];
    let observer: IntersectionObserver | null = null;
    const materialize = (entries: IntersectionObserverEntry[]) => {
      const beatIds = entries.flatMap((entry) => {
        if (!entry.isIntersecting) return [];
        observer?.unobserve(entry.target);
        const beatId = (entry.target as HTMLElement)
          .dataset.ultraBeatId;
        return beatId ? [beatId] : [];
      });
      if (beatIds.length === 0) return;
      startTransition(() => {
        setMaterializedBeatIds((current) => {
          const next = new Set(current);
          let changed = false;
          beatIds.forEach((beatId) => {
            if (next.has(beatId)) return;
            next.add(beatId);
            changed = true;
          });
          return changed ? next : current;
        });
      });
    };
    const observeSections = () => {
      observer?.disconnect();
      const ahead = Math.max(
        MINIMUM_MATERIALIZATION_AHEAD_PX,
        root.clientHeight,
      );
      observer = new IntersectionObserver(materialize, {
        root,
        rootMargin: `${ahead}px 0px ${ahead}px 0px`,
      });
      sections.forEach((section) => observer?.observe(section));
    };
    observeSections();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(observeSections);
    resizeObserver?.observe(root);
    return () => {
      observer?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [beats]);

  return (
    <main
      ref={documentRef}
      className="ultra-review-document"
      data-ultra-progress-total={progressLayout.totalUnits}
    >
      {systems.map((system, systemIndex) => (
        <section
          key={system.id}
          className="ultra-review-document-system"
        >
          {showSystems && (
            <header className="ultra-review-document-system-head">
              <span>
                System {String(systemIndex + 1).padStart(2, "0")}
              </span>
              <h2>{system.title}</h2>
              <p>{system.thesis}</p>
            </header>
          )}
          {orderedChapters(system).map((chapter) =>
            orderedChapterBeats(chapter).map((beat) => {
              const beatIndex = (beatNumbers.get(beat.id) ?? 1) - 1;
              const focusedFiles =
                focusedFilesByBeat.get(beat.id) ?? [];
              const materialized =
                beatIndex < INITIAL_MATERIALIZED_BEAT_COUNT
                || materializedBeatIds.has(beat.id)
                || beat.id === forceMaterializedBeatId;
              const beatProgress = progressLayout.byBeat.get(beat.id);
              return (
                <section
                  key={beat.id}
                  id={`ultra-beat-${beat.id}`}
                  className="ultra-review-document-beat"
                  data-ultra-beat-id={beat.id}
                >
                  <div
                    className="ultra-review-document-summary"
                    data-ultra-progress-unit={
                      beatProgress?.summaryUnit
                    }
                  >
                    <BeatSummary
                      chapter={chapter}
                      beat={beat}
                      beatNumber={beatNumbers.get(beat.id) ?? 1}
                    />
                  </div>
                  <WindowedBeatDetails
                    materialized={materialized}
                    estimatedHeight={
                      estimatedHeightByBeat.get(beat.id) ?? 460
                    }
                  >
                    <BeatWorkspace
                      pr={pr}
                      artifact={artifact}
                      session={session}
                      chapter={chapter}
                      beat={beat}
                      beatNumber={beatNumbers.get(beat.id) ?? 1}
                      focusedFiles={focusedFiles}
                      showSummary={false}
                      files={files}
                      comments={comments}
                      reviewUnitStart={
                        beatProgress?.reviewUnitStart
                      }
                      onMutate={onMutate}
                      readOnly={readOnly}
                    />
                  </WindowedBeatDetails>
                </section>
              );
            })
          )}
        </section>
      ))}
      {!readOnly ? (
        <footer
          className="ultra-review-document-complete"
          data-ultra-progress-unit={progressLayout.totalUnits + 1}
          data-ultra-progress-end
        >
          <button
            type="button"
            className="primary"
            onClick={onDoneReviewing}
          >
            {session.reviewCompletedAt === undefined
              ? "Done reviewing"
              : "Final review"}
          </button>
        </footer>
      ) : (
        <div
          className="ultra-review-document-end"
          data-ultra-progress-unit={progressLayout.totalUnits + 1}
          data-ultra-progress-end
          aria-hidden
        />
      )}
    </main>
  );
});
