import type {
  FileDiff,
  UltraReviewArtifact,
  UltraReviewEvidence,
} from "../types";

interface FocusedEvidenceRange {
  path: string;
  side: "LEFT" | "RIGHT";
  startLine: number;
  endLine: number;
}

interface BeatEvidenceAssignment {
 beatId: string;
 evidence: UltraReviewEvidence;
}

const pathOf = (file: FileDiff) => file.newPath || file.oldPath;

function indexAssignmentsByPath(
 assignments: BeatEvidenceAssignment[],
): Map<string, BeatEvidenceAssignment[]> {
 const indexed = new Map<string, BeatEvidenceAssignment[]>();
 for (const assignment of assignments) {
  const paths = new Set([
   assignment.evidence.location.path,
   assignment.evidence.location.oldPath,
  ]);
  for (const path of paths) {
   if (!path) continue;
   indexed.set(path, [
    ...(indexed.get(path) ?? []),
    assignment,
   ]);
  }
 }
 return indexed;
}

function assignmentsForFile(
 indexed: Map<string, BeatEvidenceAssignment[]>,
 file: FileDiff,
): BeatEvidenceAssignment[] {
 return [...new Set([
  ...(indexed.get(pathOf(file)) ?? []),
  ...(indexed.get(file.oldPath) ?? []),
 ])];
}

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

function evidenceIntersectsLines(
 evidence: UltraReviewEvidence,
 lines: FileDiff["lines"],
): boolean {
 const start = evidence.location.startLine;
 const end = evidence.location.endLine;
 if (start === null || end === null) return true;
 return lines.some((line) => {
  if (!visibleOnSide(line, evidence.location.side)) return false;
  const number = lineNumber(line, evidence.location.side);
  return number !== null && number >= start && number <= end;
 });
}

function orderedBeatIds(
 artifact: UltraReviewArtifact,
): string[] {
 return [...artifact.galaxy.systems]
  .sort((left, right) => left.order - right.order)
  .flatMap((system) =>
   [...system.chapters]
    .sort((left, right) => left.order - right.order)
    .flatMap((chapter) =>
     [...chapter.beats]
      .sort((left, right) => left.order - right.order)
      .map((beat) => beat.id)
    )
  );
}

/**
 * Give each physical diff hunk one causal owner.
 *
 * Coverage remains the source of truth for changed evidence. When generated
 * beats overlap one hunk, the earliest beat owns the complete hunk and later
 * beats retain only their narrative context. DiffViewer therefore never
 * renders the same hunk twice across Review mode.
 */
export function projectOwnedBeatHunks(
 files: FileDiff[],
 artifact: UltraReviewArtifact,
 beatId: string,
): FileDiff[] {
 const order = new Map(
  orderedBeatIds(artifact).map((id, index) => [id, index]),
 );
 const evidence = new Map(
  artifact.evidence
   .filter((item) => item.kind === "changed")
   .map((item) => [item.id, item]),
 );
 const assignments: BeatEvidenceAssignment[] =
  artifact.coverage.flatMap((entry) => {
  if (entry.assignment.kind !== "beat") return [];
  const item = evidence.get(entry.evidenceId);
  return item
   ? [{ beatId: entry.assignment.beatId, evidence: item }]
   : [];
 });
 const assignmentsByPath = indexAssignmentsByPath(assignments);
 const earliestOwner = (
  candidates: typeof assignments,
 ): string | null => candidates
  .map((candidate) => candidate.beatId)
  .filter((id, index, ids) => ids.indexOf(id) === index)
  .sort(
   (left, right) =>
    (order.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  )[0] ?? null;

 const projected: FileDiff[] = [];
 for (const file of files) {
  const fileAssignments = assignmentsForFile(
   assignmentsByPath,
   file,
  );
  if (fileAssignments.length === 0) continue;
  if (file.isBinary || file.lines.length === 0) {
   if (earliestOwner(fileAssignments) === beatId) {
    projected.push(file);
   }
   continue;
  }

  const hunks: FileDiff["lines"][] = [];
  for (const line of file.lines) {
   if (line.type === "hunk") {
    hunks.push([line]);
   } else {
    hunks.at(-1)?.push(line);
   }
  }
  const owned = hunks.flatMap((hunk) => {
   const candidates = fileAssignments.filter(
    (assignment) =>
     evidenceIntersectsLines(assignment.evidence, hunk),
   );
   return earliestOwner(candidates) === beatId ? hunk : [];
  });
  if (owned.length > 0) {
   projected.push({ ...file, lines: owned });
  }
 }
 return projected;
}

/** Project every beat in one pass for the long-form review document. */
export function projectOwnedHunksByBeat(
 files: FileDiff[],
 artifact: UltraReviewArtifact,
): Map<string, FileDiff[]> {
 const beatIds = orderedBeatIds(artifact);
 const order = new Map(
  beatIds.map((id, index) => [id, index]),
 );
 const evidence = new Map(
  artifact.evidence
   .filter((item) => item.kind === "changed")
   .map((item) => [item.id, item]),
 );
 const assignments: BeatEvidenceAssignment[] =
  artifact.coverage.flatMap((entry) => {
  if (entry.assignment.kind !== "beat") return [];
  const item = evidence.get(entry.evidenceId);
  return item
   ? [{ beatId: entry.assignment.beatId, evidence: item }]
   : [];
 });
 const assignmentsByPath = indexAssignmentsByPath(assignments);
 const ownerFor = (
  candidates: typeof assignments,
 ): string | null => {
  let owner: string | null = null;
  let ownerOrder = Number.MAX_SAFE_INTEGER;
  for (const candidate of candidates) {
   const candidateOrder =
    order.get(candidate.beatId) ?? Number.MAX_SAFE_INTEGER;
   if (candidateOrder < ownerOrder) {
    owner = candidate.beatId;
    ownerOrder = candidateOrder;
   }
  }
  return owner;
 };
 const projected = new Map<
  string,
  Map<string, { file: FileDiff; lines: FileDiff["lines"] }>
 >();
 const append = (
  beatId: string,
  file: FileDiff,
  lines: FileDiff["lines"],
 ) => {
  const filesForBeat = projected.get(beatId) ?? new Map();
  const fileKey = pathOf(file);
  const current = filesForBeat.get(fileKey);
  filesForBeat.set(fileKey, {
   file,
   lines: current ? [...current.lines, ...lines] : [...lines],
  });
  projected.set(beatId, filesForBeat);
 };

 for (const file of files) {
  const fileAssignments = assignmentsForFile(
   assignmentsByPath,
   file,
  );
  if (fileAssignments.length === 0) continue;
  if (file.isBinary || file.lines.length === 0) {
   const owner = ownerFor(fileAssignments);
   if (owner) append(owner, file, file.lines);
   continue;
  }

  const hunks: FileDiff["lines"][] = [];
  for (const line of file.lines) {
   if (line.type === "hunk") {
    hunks.push([line]);
   } else {
    hunks.at(-1)?.push(line);
   }
  }
  for (const hunk of hunks) {
   const owner = ownerFor(
    fileAssignments.filter(
     (assignment) =>
      evidenceIntersectsLines(assignment.evidence, hunk),
    ),
   );
   if (owner) append(owner, file, hunk);
  }
 }

 return new Map(
  beatIds.map((beatId) => [
   beatId,
   [...(projected.get(beatId)?.values() ?? [])]
    .map(({ file, lines }) => ({ ...file, lines })),
  ]),
 );
}
