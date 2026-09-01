import type {
  StorySignal,
  StorySystem,
} from "../../types";

export function storyConfidence(
  confidence: number | undefined,
): number | undefined {
  if (confidence === undefined || Number.isNaN(confidence)) {
    return undefined;
  }

  return Math.min(100, Math.max(0, Math.round(confidence)));
}

export function storyScopeLabel(
  signal: StorySignal,
): string | undefined {
  const scope = signal.scope;
  if (scope === undefined) {
    return undefined;
  }

  const lines = `${scope.changedLines} changed line${
    scope.changedLines === 1 ? "" : "s"
  }`;
  if (scope.files === undefined) {
    return lines;
  }

  return `${lines} in ${scope.files} file${scope.files === 1 ? "" : "s"}`;
}

export function storySignalSummary(signal: StorySignal): string {
  const risk = signal.risk ?? "none";
  const confidence = storyConfidence(signal.confidence);
  const feedback = signal.unresolvedFeedback ?? 0;

  return [
    risk === "none" ? "No elevated risk" : `${risk} risk`,
    storyScopeLabel(signal),
    confidence === undefined
      ? undefined
      : `${confidence} percent model confidence`,
    feedback === 0
      ? undefined
      : `${feedback} unresolved note${feedback === 1 ? "" : "s"}`,
  ]
    .filter((item): item is string => item !== undefined)
    .join(", ");
}

export function allStoryBeatTargets(
  systems: readonly StorySystem[],
): Array<{
  systemId: string;
  chapterId: string;
  beatId: string;
}> {
  return systems.flatMap((system) =>
    system.chapters.flatMap((chapter) =>
      chapter.beats.map((beat) => ({
        systemId: system.id,
        chapterId: chapter.id,
        beatId: beat.id,
      }))
    )
  );
}
