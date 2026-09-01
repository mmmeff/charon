import { useReducedMotion } from "motion/react";
import { useEffect, useId, useRef } from "react";
import type {
  StorySelectionHandlers,
  StorySystem,
} from "../../types";

export type ReviewOutlineProps = Pick<
  StorySelectionHandlers,
  "onSelectChapter" | "onSelectBeat"
> & {
  systems: readonly StorySystem[];
  activeBeatId?: string;
};

export function ReviewOutline({
  systems,
  activeBeatId,
  onSelectChapter,
  onSelectBeat,
}: ReviewOutlineProps) {
  const headingId = useId();
  const showSystems = systems.length > 1;
  const outlineRef = useRef<HTMLElement>(null);
  const activeButtonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const outline = outlineRef.current;
    const active = activeButtonRef.current;
    if (!outline || !active) return;
    const outlineRect = outline.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const inset = 20;
    if (
      activeRect.top >= outlineRect.top + inset
      && activeRect.bottom <= outlineRect.bottom - inset
    ) {
      return;
    }
    outline.scrollTo({
      top:
        outline.scrollTop
        + activeRect.top
        - outlineRect.top
        - outline.clientHeight / 2
        + activeRect.height / 2,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [activeBeatId, reduceMotion]);

  return (
    <nav
      ref={outlineRef}
      className="ultra-review-outline"
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>Outline</h2>
      <ol className="ultra-review-outline-systems">
        {systems.map((system, systemIndex) => (
          <li key={system.id}>
            {showSystems && (
              <div className="ultra-review-outline-system">
                <span>
                  System {String(systemIndex + 1).padStart(2, "0")}
                </span>
                <strong>{system.title}</strong>
              </div>
            )}
            <ol className="ultra-review-outline-chapters">
              {system.chapters.map((chapter, chapterIndex) => (
                <li key={chapter.id}>
                  <button
                    type="button"
                    className="ultra-review-outline-chapter"
                    data-active={
                      chapter.beats.some(
                        (beat) => beat.id === activeBeatId,
                      )
                        ? "true"
                        : "false"
                    }
                    onClick={() => onSelectChapter?.(
                      system.id,
                      chapter.id,
                    )}
                  >
                    <span>{chapterIndex + 1}</span>
                    <strong>{chapter.title}</strong>
                  </button>
                  <ol className="ultra-review-outline-beats">
                    {chapter.beats.map((beat) => {
                      const active = beat.id === activeBeatId;
                      return (
                        <li key={beat.id}>
                          <button
                            ref={active ? activeButtonRef : undefined}
                            type="button"
                            data-active={active ? "true" : "false"}
                            aria-current={
                              active ? "location" : undefined
                            }
                            onClick={() => onSelectBeat?.(
                              system.id,
                              chapter.id,
                              beat.id,
                            )}
                          >
                            {beat.title}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  );
}
