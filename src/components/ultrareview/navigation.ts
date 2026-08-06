import type {
  UltraReviewArtifact,
  UltraReviewBeat,
  UltraReviewChapter,
  UltraReviewSession,
  UltraReviewSystem,
} from "../../types";

export function allChapters(
  artifact: UltraReviewArtifact,
): UltraReviewChapter[] {
  return [...artifact.galaxy.systems]
    .sort((left, right) => left.order - right.order)
    .flatMap((system) =>
      [...system.chapters]
        .sort((left, right) => left.order - right.order)
    );
}

export function allBeats(
  artifact: UltraReviewArtifact,
): UltraReviewBeat[] {
  return allChapters(artifact)
    .flatMap((chapter) =>
      [...chapter.beats]
        .sort((left, right) => left.order - right.order)
    );
}

export function firstBeatForChapter(
  chapter: UltraReviewChapter,
  session: UltraReviewSession,
): UltraReviewBeat | null {
  const beats = [...chapter.beats]
    .sort((left, right) => left.order - right.order);
  return beats.find(
    (beat) => session.beatStates[beat.id] !== "reviewed",
  ) ?? beats[0] ?? null;
}

export function findChapter(
  artifact: UltraReviewArtifact,
  chapterId: string | null,
): UltraReviewChapter | null {
  return allChapters(artifact)
    .find((chapter) => chapter.id === chapterId)
    ?? allChapters(artifact)[0]
    ?? null;
}

export function findSystemForChapter(
  artifact: UltraReviewArtifact,
  chapterId: string,
): UltraReviewSystem | null {
  return artifact.galaxy.systems.find(
    (system) =>
      system.chapters.some((chapter) => chapter.id === chapterId),
  ) ?? null;
}

export function findBeat(
  artifact: UltraReviewArtifact,
  beatId: string | null,
): UltraReviewBeat | null {
  return allBeats(artifact)
    .find((beat) => beat.id === beatId)
    ?? allBeats(artifact)[0]
    ?? null;
}
