import type {
  FileDiff,
  UltraReviewArtifact,
  UltraReviewEvidence,
  UltraReviewEvidenceChange,
  UltraReviewEvidenceLocation,
} from "../types";
import {
  stableUltraReviewEvidenceId,
  stableUltraReviewHash,
} from "./ultraReview.ts";

export interface UltraReviewDiffChange {
  id: string;
  change: UltraReviewEvidenceChange;
  location: UltraReviewEvidenceLocation;
  fingerprint: string;
  text: string | null;
}

export type UltraReviewDiffEvidenceFailureReason =
  | "outside-diff"
  | "change-mismatch"
  | "fingerprint-mismatch";

export interface UltraReviewDiffEvidenceFailure {
  evidenceId: string;
  reason: UltraReviewDiffEvidenceFailureReason;
}

export interface UltraReviewDuplicatePrimaryCoverage {
  changeId: string;
  evidenceIds: string[];
  assignmentCount: number;
}

export interface UltraReviewDiffAudit {
  changes: UltraReviewDiffChange[];
  invalidEvidence: UltraReviewDiffEvidenceFailure[];
  uncoveredChangeIds: string[];
  duplicatePrimaryCoverage: UltraReviewDuplicatePrimaryCoverage[];
  unassignedEvidenceIds: string[];
  supportingCoverageEvidenceIds: string[];
  unknownCoverageEvidenceIds: string[];
  complete: boolean;
}

const evidenceId = (
  change: UltraReviewEvidenceChange,
  location: UltraReviewEvidenceLocation,
  fingerprint: string,
): string =>
  stableUltraReviewEvidenceId({
    kind: "changed",
    change,
    location,
    fingerprint,
  });

const currentPath = (file: FileDiff): string =>
  file.newPath || file.oldPath;

const oldPath = (file: FileDiff): string | undefined =>
  file.isRename && file.oldPath !== file.newPath
    ? file.oldPath
    : undefined;

interface WhitespacePair {
  before: string;
  after: string;
}

const whitespacePairs = (
  file: FileDiff,
): Map<FileDiff["lines"][number], WhitespacePair> => {
  const result = new Map<
    FileDiff["lines"][number],
    WhitespacePair
  >();
  let index = 0;
  while (index < file.lines.length) {
    if (file.lines[index].type !== "del") {
      index += 1;
      continue;
    }
    const deletions: FileDiff["lines"] = [];
    while (
      index < file.lines.length &&
      file.lines[index].type === "del"
    ) {
      deletions.push(file.lines[index]);
      index += 1;
    }
    const additions: FileDiff["lines"] = [];
    while (
      index < file.lines.length &&
      file.lines[index].type === "add"
    ) {
      additions.push(file.lines[index]);
      index += 1;
    }
    const whitespaceOnly =
      deletions.length === additions.length &&
      deletions.length > 0 &&
      deletions.every((deletion, pairIndex) => {
        const addition = additions[pairIndex];
        return (
          deletion.text !== addition.text &&
          deletion.text.replace(/\s+/g, "") ===
            addition.text.replace(/\s+/g, "")
        );
      });
    if (!whitespaceOnly) continue;
    for (
      let pairIndex = 0;
      pairIndex < deletions.length;
      pairIndex += 1
    ) {
      const pair = {
        before: deletions[pairIndex].text,
        after: additions[pairIndex].text,
      };
      result.set(deletions[pairIndex], pair);
      result.set(additions[pairIndex], pair);
    }
  }
  return result;
};

const lineChange = (
  file: FileDiff,
  line: FileDiff["lines"][number],
  whitespacePair?: WhitespacePair,
): UltraReviewDiffChange | null => {
  if (line.type !== "add" && line.type !== "del") return null;
  const change: UltraReviewEvidenceChange = whitespacePair
    ? "whitespace"
    : line.type === "add"
      ? "addition"
      : "deletion";
  const side = line.type === "add" ? "RIGHT" : "LEFT";
  const number = line.type === "add" ? line.newNum : line.oldNum;
  if (number === null) return null;
  const location = {
    path: currentPath(file),
    oldPath: oldPath(file),
    side,
    startLine: number,
    endLine: number,
  } satisfies UltraReviewEvidenceLocation;
  const fingerprint = stableUltraReviewHash(
    JSON.stringify(
      whitespacePair
        ? [
            change,
            side,
            whitespacePair.before,
            whitespacePair.after,
          ]
        : [change, side, line.text],
    ),
  );
  return {
    id: evidenceId(change, location, fingerprint),
    change,
    location,
    fingerprint,
    text: line.text,
  };
};

const structuralChange = (
  file: FileDiff,
  change: "rename" | "binary",
): UltraReviewDiffChange => {
  const location = {
    path: currentPath(file),
    oldPath: oldPath(file),
    side:
      change === "binary" && file.isDeleted
        ? "LEFT"
        : "RIGHT",
    startLine: null,
    endLine: null,
  } satisfies UltraReviewEvidenceLocation;
  const fingerprint = stableUltraReviewHash(
    JSON.stringify([
      change,
      file.oldPath,
      file.newPath,
      file.isNew,
      file.isDeleted,
    ]),
  );
  return {
    id: evidenceId(change, location, fingerprint),
    change,
    location,
    fingerprint,
    text: null,
  };
};

export function enumerateUltraReviewDiffChanges(
  files: FileDiff[],
): UltraReviewDiffChange[] {
  return files.flatMap((file) => {
    const pairs = whitespacePairs(file);
    const structural: UltraReviewDiffChange[] = [];
    if (file.isRename) {
      structural.push(structuralChange(file, "rename"));
    }
    if (file.isBinary) {
      structural.push(structuralChange(file, "binary"));
    }
    const lines = file.lines.flatMap((line) => {
      const change = lineChange(
        file,
        line,
        pairs.get(line),
      );
      return change ? [change] : [];
    });
    return [...structural, ...lines];
  });
}

export function fingerprintUltraReviewDiffRange(
  changes: UltraReviewDiffChange[],
): string {
  if (changes.length === 0) {
    throw new Error(
      "Cannot fingerprint an empty UltraReview diff range",
    );
  }
  if (changes.length === 1) return changes[0].fingerprint;
  return stableUltraReviewHash(
    JSON.stringify(
      changes.map((change) => change.fingerprint),
    ),
  );
}

const sameFileAndSide = (
  left: UltraReviewEvidenceLocation,
  right: UltraReviewEvidenceLocation,
): boolean =>
  left.path === right.path &&
  left.oldPath === right.oldPath &&
  left.side === right.side;

const matchesEvidenceChange = (
  evidence: UltraReviewEvidence,
  change: UltraReviewDiffChange,
): boolean =>
  evidence.change === change.change ||
  (
    evidence.change === "modification" &&
    (
      change.change === "addition" ||
      change.change === "deletion" ||
      change.change === "whitespace"
    )
  );

const changesInEvidenceRange = (
  evidence: UltraReviewEvidence,
  changes: UltraReviewDiffChange[],
):
  | { changes: UltraReviewDiffChange[]; failure: null }
  | {
      changes: [];
      failure: UltraReviewDiffEvidenceFailureReason;
    } => {
  const { location } = evidence;
  if (
    (location.startLine === null) !==
    (location.endLine === null)
  ) {
    return { changes: [], failure: "outside-diff" };
  }
  if (
    location.startLine === null ||
    location.endLine === null
  ) {
    const located = changes.filter(
      (change) =>
        sameFileAndSide(location, change.location) &&
        change.location.startLine === null &&
        change.location.endLine === null,
    );
    const matching = located.filter((change) =>
      matchesEvidenceChange(evidence, change),
    );
    if (matching.length === 0) {
      return {
        changes: [],
        failure:
          located.length === 0
            ? "outside-diff"
            : "change-mismatch",
      };
    }
    const match = matching[0];
    if (evidence.fingerprint !== match.fingerprint) {
      return {
        changes: [],
        failure: "fingerprint-mismatch",
      };
    }
    return { changes: [match], failure: null };
  }
  if (
    location.startLine > location.endLine
  ) {
    return { changes: [], failure: "outside-diff" };
  }
  const located = changes
    .filter(
      (change) => {
        const line = change.location.startLine;
        return (
          line !== null &&
          sameFileAndSide(location, change.location) &&
          line >= location.startLine! &&
          line <= location.endLine!
        );
      },
    )
    .sort(
      (left, right) =>
        left.location.startLine! -
        right.location.startLine!,
    );
  const expectedLength =
    location.endLine - location.startLine + 1;
  if (
    located.length !== expectedLength ||
    located.some(
      (change, index) =>
        change.location.startLine !==
        location.startLine! + index,
    )
  ) {
    return { changes: [], failure: "outside-diff" };
  }
  if (
    located.some(
      (change) => !matchesEvidenceChange(evidence, change),
    )
  ) {
    return { changes: [], failure: "change-mismatch" };
  }
  if (
    evidence.fingerprint !==
    fingerprintUltraReviewDiffRange(located)
  ) {
    return {
      changes: [],
      failure: "fingerprint-mismatch",
    };
  }
  return { changes: located, failure: null };
};

/**
 * Prove that one changed-evidence reference still names the exact loaded diff
 * content. This handles both line ranges and file-level rename/binary markers.
 */
export function ultraReviewEvidenceIsInDiff(
  files: FileDiff[],
  evidence: UltraReviewEvidence,
): boolean {
  if (evidence.kind !== "changed") return false;
  return changesInEvidenceRange(
    evidence,
    enumerateUltraReviewDiffChanges(files),
  ).failure === null;
}

export function auditUltraReviewDiff(
  files: FileDiff[],
  artifact: UltraReviewArtifact,
): UltraReviewDiffAudit {
  const changes = enumerateUltraReviewDiffChanges(files);
  const invalidEvidence: UltraReviewDiffEvidenceFailure[] = [];
  const validByEvidenceId = new Map<
    string,
    UltraReviewDiffChange[]
  >();

  for (const evidence of artifact.evidence) {
    if (evidence.kind !== "changed") continue;
    const match = changesInEvidenceRange(
      evidence,
      changes,
    );
    if (match.failure) {
      invalidEvidence.push({
        evidenceId: evidence.id,
        reason: match.failure,
      });
      continue;
    }
    validByEvidenceId.set(evidence.id, match.changes);
  }

  const evidenceById = new Map(
    artifact.evidence.map((evidence) => [
      evidence.id,
      evidence,
    ]),
  );
  const assignmentsByEvidenceId = new Map<string, number>();
  const supportingCoverageEvidenceIds = new Set<string>();
  const unknownCoverageEvidenceIds = new Set<string>();
  for (const entry of artifact.coverage) {
    const evidence = evidenceById.get(entry.evidenceId);
    if (!evidence) {
      unknownCoverageEvidenceIds.add(entry.evidenceId);
      continue;
    }
    if (evidence.kind === "supporting") {
      supportingCoverageEvidenceIds.add(evidence.id);
      continue;
    }
    assignmentsByEvidenceId.set(
      evidence.id,
      (assignmentsByEvidenceId.get(evidence.id) ?? 0) + 1,
    );
  }

  const claimsByChangeId = new Map<
    string,
    { evidenceIds: string[]; assignmentCount: number }
  >();
  const unassignedEvidenceIds: string[] = [];
  for (const [id, claimedChanges] of validByEvidenceId) {
    const assignmentCount =
      assignmentsByEvidenceId.get(id) ?? 0;
    if (assignmentCount === 0) {
      unassignedEvidenceIds.push(id);
      continue;
    }
    for (const change of claimedChanges) {
      const claims = claimsByChangeId.get(change.id) ?? {
        evidenceIds: [],
        assignmentCount: 0,
      };
      claims.evidenceIds.push(id);
      claims.assignmentCount += assignmentCount;
      claimsByChangeId.set(change.id, claims);
    }
  }

  const uncoveredChangeIds = changes
    .filter((change) => !claimsByChangeId.has(change.id))
    .map((change) => change.id);
  const duplicatePrimaryCoverage = changes.flatMap(
    (change) => {
      const claims = claimsByChangeId.get(change.id);
      if (!claims || claims.assignmentCount < 2) return [];
      return [{
        changeId: change.id,
        evidenceIds: [...new Set(claims.evidenceIds)],
        assignmentCount: claims.assignmentCount,
      }];
    },
  );
  const result = {
    changes,
    invalidEvidence,
    uncoveredChangeIds,
    duplicatePrimaryCoverage,
    unassignedEvidenceIds,
    supportingCoverageEvidenceIds: [
      ...supportingCoverageEvidenceIds,
    ],
    unknownCoverageEvidenceIds: [
      ...unknownCoverageEvidenceIds,
    ],
  };
  return {
    ...result,
    complete:
      result.invalidEvidence.length === 0 &&
      result.uncoveredChangeIds.length === 0 &&
      result.duplicatePrimaryCoverage.length === 0 &&
      result.unassignedEvidenceIds.length === 0 &&
      result.supportingCoverageEvidenceIds.length === 0 &&
      result.unknownCoverageEvidenceIds.length === 0,
  };
}
