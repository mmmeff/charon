import { type KeyboardEvent, useId } from "react";
import {
  storyProgressForChapter,
  storyProgressForSystems,
  storyStateLabel,
} from "./story-state";
import type {
  StoryChapter,
  StoryReviewState,
  StorySelectionHandlers,
  StorySystem,
} from "../../types";

export type ReviewStoryRailProps = StorySelectionHandlers & {
  systems: readonly StorySystem[];
  activeSystemId?: string;
  activeChapterId?: string;
  activeBeatId?: string;
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
};

const STATE_MARKS: Record<StoryReviewState, string> = {
  pending: "○",
  active: "●",
  reviewed: "✓",
  stale: "↺",
  failed: "!",
};

function selectedSystem(
  systems: readonly StorySystem[],
  activeSystemId: string | undefined,
): StorySystem | undefined {
  return systems.find((system) => system.id === activeSystemId)
    ?? systems.at(0);
}

function selectedChapter(
  system: StorySystem,
  activeChapterId: string | undefined,
): StoryChapter | undefined {
  return system.chapters.find(
    (chapter) => chapter.id === activeChapterId,
  );
}

function handleRailKeyboard(event: KeyboardEvent<HTMLElement>) {
  if (
    event.key !== "ArrowDown"
    && event.key !== "ArrowRight"
    && event.key !== "ArrowUp"
    && event.key !== "ArrowLeft"
    && event.key !== "Home"
    && event.key !== "End"
  ) {
    return;
  }

  const targets = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button[data-ultra-rail-target]",
    ),
  );
  if (targets.length === 0) {
    return;
  }

  const current = event.target instanceof HTMLElement
    ? event.target.closest<HTMLButtonElement>(
        "button[data-ultra-rail-target]",
      )
    : null;
  const currentIndex = current === null ? -1 : targets.indexOf(current);
  const forward =
    event.key === "ArrowDown" || event.key === "ArrowRight";
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? targets.length - 1
      : forward
        ? Math.min(targets.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);

  event.preventDefault();
  targets[nextIndex]?.focus();
}

function signalText(
  state: StoryReviewState,
  risk: StoryChapter["risk"],
  unresolvedFeedback: number,
): string {
  return [
    storyStateLabel(state),
    risk === undefined || risk === "none"
      ? undefined
      : `${risk} risk`,
    unresolvedFeedback > 0
      ? `${unresolvedFeedback} unresolved`
      : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(", ");
}

export function ReviewStoryRail({
  systems,
  activeSystemId,
  activeChapterId,
  activeBeatId,
  compact = false,
  className,
  ariaLabel,
  onSelectSystem,
  onSelectChapter,
  onSelectBeat,
}: ReviewStoryRailProps) {
  const headingId = useId();
  const progress = storyProgressForSystems(systems);
  const showSystemGroups = systems.length > 1;
  const currentSystem = selectedSystem(systems, activeSystemId);
  const currentChapter = currentSystem === undefined
    ? undefined
    : selectedChapter(currentSystem, activeChapterId);
  const classes = ["ultra-story-rail", className]
    .filter((value): value is string => value !== undefined)
    .join(" ");

  return (
    <nav
      className={classes}
      data-compact={compact ? "true" : "false"}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel === undefined ? headingId : undefined}
      onKeyDown={handleRailKeyboard}
    >
      <header className="ultra-story-rail-head">
        <div>
          <span>UltraReview</span>
          <h2 id={headingId}>Review outline</h2>
        </div>
        <span className="ultra-story-rail-progress">
          <strong>{progress.reviewed}/{progress.total}</strong>
          <span>inspected</span>
        </span>
      </header>

      {systems.length === 0 ? (
        <div className="ultra-story-rail-empty" role="status">
          Analysis in progress.
        </div>
      ) : (
        <ol
          className="ultra-story-rail-systems"
          data-grouped={showSystemGroups ? "true" : "false"}
        >
          {systems.map((system, systemIndex) => {
            const systemActive = system.id === currentSystem?.id;
            return (
              <li
                key={system.id}
                className="ultra-story-rail-system"
                data-active={systemActive ? "true" : "false"}
              >
                {showSystemGroups && (
                  <div className="ultra-story-rail-system-head">
                    <span>
                      System {String(systemIndex + 1).padStart(2, "0")}
                    </span>
                    {onSelectSystem === undefined ? (
                      <h3>{system.title}</h3>
                    ) : (
                      <h3>
                        <button
                          type="button"
                          data-ultra-rail-target={`system:${system.id}`}
                          aria-current={
                            systemActive
                              && activeChapterId === undefined
                              ? "step"
                              : undefined
                          }
                          onClick={() => onSelectSystem(system.id)}
                        >
                          {system.title}
                        </button>
                      </h3>
                    )}
                    {system.thesis !== undefined && (
                      <p>{system.thesis}</p>
                    )}
                  </div>
                )}

                <ol className="ultra-story-rail-chapters">
                  {system.chapters.map((chapter, chapterIndex) => {
                    const chapterProgress =
                      storyProgressForChapter(chapter);
                    const chapterActive =
                      systemActive
                      && chapter.id === currentChapter?.id;
                    const chapterState = chapter.state ?? "pending";
                    const unresolved =
                      chapter.unresolvedFeedback ?? 0;
                    return (
                      <li
                        key={chapter.id}
                        data-active={chapterActive ? "true" : "false"}
                        data-state={chapterState}
                      >
                        <button
                          type="button"
                          className="ultra-story-rail-chapter"
                          data-ultra-rail-target={
                            `chapter:${chapter.id}`
                          }
                          data-active={
                            chapterActive
                            && activeBeatId === undefined
                              ? "true"
                              : "false"
                          }
                          aria-current={
                            chapterActive
                            && activeBeatId === undefined
                              ? "step"
                              : undefined
                          }
                          aria-label={
                            `Chapter ${chapterIndex + 1}, `
                            + `${chapter.title}. `
                            + `${chapterProgress.reviewed} of `
                            + `${chapterProgress.total} inspected. `
                            + signalText(
                              chapterState,
                              chapter.risk,
                              unresolved,
                            )
                          }
                          onClick={() =>
                            onSelectChapter?.(
                              system.id,
                              chapter.id,
                            )}
                        >
                          <span
                            className="ultra-story-rail-number"
                            aria-hidden
                          >
                            {chapterIndex + 1}
                          </span>
                          <span className="ultra-story-rail-chapter-copy">
                            <strong>{chapter.title}</strong>
                            <span>
                              {chapterProgress.reviewed}/
                              {chapterProgress.total} inspected
                            </span>
                          </span>
                          <span
                            className="ultra-story-rail-state"
                            data-state={chapterState}
                            aria-hidden
                          >
                            {STATE_MARKS[chapterState]}
                          </span>
                        </button>

                        <ol className="ultra-story-rail-beats">
                          {chapter.beats.map((beat) => {
                            const beatActive =
                              chapterActive
                              && beat.id === activeBeatId;
                            const beatState = beat.state ?? "pending";
                            const beatUnresolved =
                              beat.unresolvedFeedback ?? 0;
                            return (
                              <li key={beat.id}>
                                <button
                                  type="button"
                                  data-ultra-rail-target={
                                    `beat:${beat.id}`
                                  }
                                  data-active={
                                    beatActive ? "true" : "false"
                                  }
                                  data-state={beatState}
                                  aria-current={
                                    beatActive ? "step" : undefined
                                  }
                                  aria-label={
                                    `${beat.title}. `
                                    + signalText(
                                      beatState,
                                      beat.risk,
                                      beatUnresolved,
                                    )
                                  }
                                  onClick={() =>
                                    onSelectBeat?.(
                                      system.id,
                                      chapter.id,
                                      beat.id,
                                    )}
                                >
                                  <span
                                    className="ultra-story-rail-state"
                                    data-state={beatState}
                                    aria-hidden
                                  >
                                    {STATE_MARKS[beatState]}
                                  </span>
                                  <span className="ultra-story-rail-beat-copy">
                                    <strong>{beat.title}</strong>
                                    {beat.objective !== undefined && (
                                      <span>{beat.objective}</span>
                                    )}
                                  </span>
                                  {(beat.risk === "high"
                                    || beat.risk === "medium") && (
                                    <span
                                      className="ultra-story-rail-risk"
                                      data-risk={beat.risk}
                                    >
                                      {beat.risk}
                                    </span>
                                  )}
                                  {beatUnresolved > 0 && (
                                    <span className="ultra-story-rail-open">
                                      {beatUnresolved}
                                    </span>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}
