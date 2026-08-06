import type {
  FileDiff,
  UltraReviewEvidence,
} from "../types";
import {
  ultraReviewEvidenceIsInDiff,
} from "./ultrareview-diff-audit.ts";

interface FocusedEvidenceRange {
  path: string;
  side: "LEFT" | "RIGHT";
  startLine: number;
  endLine: number;
}

const pathOf = (file: FileDiff) => file.newPath || file.oldPath;

const lineNumber = (
  line: FileDiff["lines"][number],
  side: FocusedEvidenceRange["side"],
) => side === "RIGHT" ? line.newNum : line.oldNum;

const visibleOnSide = (
  line: FileDiff["lines"][number],
  side: FocusedEvidenceRange["side"],
) => line.type !== "hunk" && lineNumber(line, side) !== null;

/**
 * Project disjoint evidence ranges into ordinary FileDiff objects.
 *
 * DiffViewer remains the renderer.
 * UltraReview chooses which rows enter it.
 */
export function projectFocusedEvidence(
  files: FileDiff[],
  ranges: FocusedEvidenceRange[],
  contextLines = 3,
): FileDiff[] {
  const byPath = new Map<string, FocusedEvidenceRange[]>();
  for (const range of ranges) {
    const current = byPath.get(range.path) ?? [];
    current.push(range);
    byPath.set(range.path, current);
  }

  const projected: FileDiff[] = [];
  for (const file of files) {
    const fileRanges = byPath.get(pathOf(file)) ?? byPath.get(file.oldPath);
    if (!fileRanges?.length) continue;
    if (file.isBinary) {
      projected.push(file);
      continue;
    }

    const selected = new Set<number>();
    for (const side of ["LEFT", "RIGHT"] as const) {
      const sideRanges = fileRanges.filter((range) => range.side === side);
      if (!sideRanges.length) continue;
      const visible = file.lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => visibleOnSide(line, side));

      for (let position = 0; position < visible.length; position++) {
        const { line, index } = visible[position];
        const number = lineNumber(line, side);
        if (
          number === null ||
          !sideRanges.some(
            (range) => number >= range.startLine && number <= range.endLine,
          )
        ) {
          continue;
        }
        const first = Math.max(0, position - contextLines);
        const last = Math.min(visible.length - 1, position + contextLines);
        for (let context = first; context <= last; context++) {
          selected.add(visible[context].index);
        }
      }
    }

    if (!selected.size) continue;
    const includedHunks = new Set<number>();
    let activeHunk = -1;
    for (let index = 0; index < file.lines.length; index++) {
      if (file.lines[index].type === "hunk") {
        activeHunk = index;
      } else if (selected.has(index) && activeHunk >= 0) {
        includedHunks.add(activeHunk);
      }
    }

    projected.push({
      ...file,
      lines: file.lines.filter(
        (line, index) =>
          line.type === "hunk" ? includedHunks.has(index) : selected.has(index),
      ),
    });
  }
  return projected;
}

/** True only when every line in the trusted range exists in the loaded diff. */
export function focusedRangeIsComplete(
  files: FileDiff[],
  range: FocusedEvidenceRange,
): boolean {
  const file = files.find(
    (candidate) =>
      pathOf(candidate) === range.path
      || candidate.oldPath === range.path,
  );
  if (!file || file.isBinary) return false;

  const visibleLines = new Set(
    file.lines.flatMap((line) => {
      if (!visibleOnSide(line, range.side)) return [];
      const number = lineNumber(line, range.side);
      return number === null ? [] : [number];
    }),
  );
  for (
    let line = range.startLine;
    line <= range.endLine;
    line++
  ) {
    if (!visibleLines.has(line)) return false;
  }
  return true;
}

export interface UltraReviewBeatInspection {
  ready: boolean;
  hasReviewEvidence: boolean;
  exactChangedEvidence: boolean;
  outstandingStructuralEvidenceIds: string[];
  outstandingRemovedEvidenceIds: string[];
}

/**
 * Derive the honest completion gate for a beat.
 *
 * Line evidence must match the exact loaded diff. File-level evidence must
 * match too, then receive an explicit Raw Diff credit. Evidence removed by a
 * later push has no current diff rows, so its delta summary needs a separate
 * acknowledgement.
 */
export function inspectUltraReviewBeatEvidence(
  files: FileDiff[],
  evidence: UltraReviewEvidence[],
  removedEvidenceIds: string[],
  creditedEvidenceIds: string[],
): UltraReviewBeatInspection {
  const changed = evidence.filter(
    (reference) => reference.kind === "changed",
  );
  const structural = changed.filter(
    (reference) =>
      reference.location.startLine === null
      && reference.location.endLine === null,
  );
  const credited = new Set(creditedEvidenceIds);
  const exactChangedEvidence = changed.every(
    (reference) =>
      ultraReviewEvidenceIsInDiff(files, reference),
  );
  const outstandingStructuralEvidenceIds = structural
    .filter((reference) => !credited.has(reference.id))
    .map((reference) => reference.id);
  const outstandingRemovedEvidenceIds = removedEvidenceIds
    .filter((id) => !credited.has(id));
  const hasReviewEvidence =
    changed.length > 0 || removedEvidenceIds.length > 0;
  return {
    ready:
      hasReviewEvidence
      && exactChangedEvidence
      && outstandingStructuralEvidenceIds.length === 0
      && outstandingRemovedEvidenceIds.length === 0,
    hasReviewEvidence,
    exactChangedEvidence,
    outstandingStructuralEvidenceIds,
    outstandingRemovedEvidenceIds,
  };
}
