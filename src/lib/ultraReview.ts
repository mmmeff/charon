import {
 ULTRA_REVIEW_ARTIFACT_VERSION,
} from "../types.ts";
import type {
 DiffViewerViewState,
 Severity,
 UltraReviewAnalysisEvidence,
 UltraReviewAnswer,
 UltraReviewArtifact,
 UltraReviewArtifactIdentity,
 UltraReviewBeat,
 UltraReviewChapter,
 UltraReviewConcern,
 UltraReviewConcernDisposition,
 UltraReviewContinuation,
 UltraReviewCoverageAssignment,
 UltraReviewCoverageAudit,
 UltraReviewCoverageEntry,
 UltraReviewCoverageOverlap,
 UltraReviewDraft,
 UltraReviewDraftInlineComment,
 UltraReviewDraftProvenance,
 UltraReviewDraftSection,
 UltraReviewDelta,
 UltraReviewEvidence,
 UltraReviewEvidenceChange,
 UltraReviewEvidenceKind,
 UltraReviewEvidenceLocation,
 UltraReviewEvidenceSide,
 UltraReviewFailureScope,
 UltraReviewGeneration,
 UltraReviewGenerationFailure,
 UltraReviewGenerationStage,
 UltraReviewGenerationStageStatus,
 UltraReviewGenerationStatus,
 UltraReviewLifecycle,
 UltraReviewMechanicalChange,
 UltraReviewNote,
 UltraReviewNoteAnchor,
 UltraReviewProgress,
 UltraReviewRisk,
 UltraReviewSession,
 UltraReviewSourceClaim,
 UltraReviewSourceKind,
 UltraReviewSubmissionSnapshot,
 UltraReviewSystem,
} from "../types";

const RISK_VALUES = [
 "none",
 "low",
 "medium",
 "high",
] as const;

const SOURCE_KIND_VALUES = [
 "author_stated",
 "code_observed",
 "ci_observed",
 "existing_feedback",
 "commit_history",
 "timeline_event",
 "model_inference",
 "predicted_behavior",
] as const;

const EVIDENCE_KIND_VALUES = [
 "changed",
 "supporting",
] as const;

const EVIDENCE_CHANGE_VALUES = [
 "addition",
 "deletion",
 "modification",
 "rename",
 "binary",
 "whitespace",
 "context",
] as const;

const EVIDENCE_SIDE_VALUES = [
 "LEFT",
 "RIGHT",
] as const;

const GENERATION_STATUS_VALUES = [
 "idle",
 "running",
 "partial",
 "complete",
 "failed",
] as const;

const GENERATION_STAGE_STATUS_VALUES = [
 "pending",
 "running",
 "complete",
 "failed",
] as const;

const FAILURE_SCOPE_VALUES = [
 "artifact",
 "system",
 "chapter",
] as const;

const SEVERITY_VALUES = [
 "blocker",
 "major",
 "minor",
 "nit",
] as const;

const CONCERN_DISPOSITION_VALUES = [
 "dismissed",
 "verified",
 "promoted",
] as const;

const LIFECYCLE_VALUES = [
 "active",
 "closed",
 "merged",
] as const;

const VERDICT_VALUES = [
 "COMMENT",
 "APPROVE",
 "REQUEST_CHANGES",
] as const;

const ANSWER_ACTION_VALUES = [
 "trace_callers",
 "explain_dependency",
 "find_relevant_tests",
 "question",
] as const;

const ANSWER_STATUS_VALUES = [
 "complete",
 "failed",
] as const;

type JsonObject = Record<string, unknown>;

interface ParsedAnalysis {
 thesis: string;
 sourceClaimIds: string[];
 systems: UltraReviewSystem[];
 evidence: UltraReviewEvidence[];
 coverage: UltraReviewCoverageEntry[];
 mechanicalChanges: UltraReviewMechanicalChange[];
 sourceClaims: UltraReviewSourceClaim[];
 concerns: UltraReviewConcern[];
 generation: UltraReviewGeneration;
}

export class UltraReviewValidationError extends Error {
 constructor(message: string) {
  super(message);
  this.name = "UltraReviewValidationError";
 }
}

function invalid(path: string, expected: string): never {
 throw new UltraReviewValidationError(
  `${path} must be ${expected}`,
 );
}

function objectValue(
 value: unknown,
 path: string,
): JsonObject {
 if (
  value === null ||
  typeof value !== "object" ||
  Array.isArray(value)
 ) {
  return invalid(path, "an object");
 }
 return value as JsonObject;
}

function arrayValue(
 value: unknown,
 path: string,
): unknown[] {
 if (!Array.isArray(value)) return invalid(path, "an array");
 return value;
}

function stringValue(
 value: unknown,
 path: string,
): string {
 if (typeof value !== "string" || value.trim() === "") {
  return invalid(path, "a non-empty string");
 }
 return value;
}

function textValue(
 value: unknown,
 path: string,
): string {
 if (typeof value !== "string") {
  return invalid(path, "a string");
 }
 return value;
}

function nullableStringValue(
 value: unknown,
 path: string,
): string | null {
 if (value === null) return null;
 return stringValue(value, path);
}

function stringArrayValue(
 value: unknown,
 path: string,
): string[] {
 return arrayValue(value, path).map(
  (item, index) => stringValue(item, `${path}[${index}]`),
 );
}

function integerValue(
 value: unknown,
 path: string,
 options: {
  minimum?: number;
 } = {},
): number {
 if (!Number.isInteger(value)) return invalid(path, "an integer");
 const result = value as number;
 if (
  options.minimum !== undefined &&
  result < options.minimum
 ) {
  return invalid(
   path,
   `an integer greater than or equal to ${options.minimum}`,
  );
 }
 return result;
}

function booleanValue(
 value: unknown,
 path: string,
): boolean {
 if (typeof value !== "boolean") return invalid(path, "a boolean");
 return value;
}

function enumValue<const Values extends readonly string[]>(
 value: unknown,
 path: string,
 values: Values,
): Values[number] {
 if (
  typeof value !== "string" ||
  !values.includes(value)
 ) {
  return invalid(
   path,
   `one of ${values.join(", ")}`,
  );
 }
 return value as Values[number];
}

function nullableLineValue(
 value: unknown,
 path: string,
): number | null {
 if (value === null) return null;
 return integerValue(value, path, { minimum: 1 });
}

function optionalStringValue(
 value: unknown,
 path: string,
): string | undefined {
 if (value === undefined) return undefined;
 return stringValue(value, path);
}

function optionalConfidenceValue(
 value: unknown,
 path: string,
): number | undefined {
 if (value === undefined) return undefined;
 if (
  typeof value !== "number" ||
  !Number.isFinite(value) ||
  value < 0 ||
  value > 100
 ) {
  return invalid(
   path,
   "a number from 0 through 100",
  );
 }
 return value;
}

function parseIdentity(
 value: UltraReviewArtifactIdentity,
): UltraReviewArtifactIdentity {
 const identity = objectValue(
  value,
  "identity",
 );
 return {
  repo: stringValue(identity.repo, "identity.repo"),
  prNumber: integerValue(
   identity.prNumber,
   "identity.prNumber",
   { minimum: 1 },
  ),
  baseSha: stringValue(
   identity.baseSha,
   "identity.baseSha",
  ),
  headSha: stringValue(
   identity.headSha,
   "identity.headSha",
  ),
 };
}

function parseSourceClaim(
 value: unknown,
 path: string,
): UltraReviewSourceClaim {
 const source = objectValue(value, path);
 return {
  id: stringValue(source.id, `${path}.id`),
  kind: enumValue(
   source.kind,
   `${path}.kind`,
   SOURCE_KIND_VALUES,
  ) as UltraReviewSourceKind,
  claim: stringValue(source.claim, `${path}.claim`),
  evidenceIds: stringArrayValue(
   source.evidenceIds,
   `${path}.evidenceIds`,
  ),
 };
}

function parseLocation(
 value: unknown,
 path: string,
): UltraReviewEvidenceLocation {
 const location = objectValue(value, path);
 return {
  path: stringValue(location.path, `${path}.path`),
  oldPath: optionalStringValue(
   location.oldPath,
   `${path}.oldPath`,
  ),
  side: enumValue(
   location.side,
   `${path}.side`,
   EVIDENCE_SIDE_VALUES,
  ) as UltraReviewEvidenceSide,
  startLine: nullableLineValue(
   location.startLine,
   `${path}.startLine`,
  ),
  endLine: nullableLineValue(
   location.endLine,
   `${path}.endLine`,
  ),
 };
}

export function stableUltraReviewHash(value: string): string {
 let hash = 0xcbf29ce484222325n;
 const prime = 0x100000001b3n;
 for (const character of value) {
  hash ^= BigInt(character.codePointAt(0) ?? 0);
  hash = BigInt.asUintN(64, hash * prime);
 }
 return hash.toString(16).padStart(16, "0");
}

export function stableUltraReviewEvidenceId(
 evidence: Pick<
  UltraReviewEvidence,
  "kind" | "change" | "location" | "fingerprint"
 >,
): string {
 const { location } = evidence;
 const parts = [
  evidence.kind,
  evidence.change,
  location.path,
  location.oldPath ?? "",
  location.side,
  location.startLine?.toString() ?? "",
  location.endLine?.toString() ?? "",
  evidence.fingerprint,
 ];
 return `evidence:${stableUltraReviewHash(JSON.stringify(parts))}`;
}

function parseEvidence(
 value: unknown,
 path: string,
 trustedEvidenceById: ReadonlyMap<
  string,
  UltraReviewAnalysisEvidence
 >,
): UltraReviewEvidence {
 const raw = objectValue(value, path);
 const id = stringValue(raw.id, `${path}.id`);
 // Known ids select machine-owned diff identity. The model still owns
 // source claims and supporting context.
 const trusted = trustedEvidenceById.get(id);
 const kind = trusted?.kind ?? (
  enumValue(
   raw.kind,
   `${path}.kind`,
   EVIDENCE_KIND_VALUES,
  ) as UltraReviewEvidenceKind
 );
 const change = trusted?.change ?? (
  enumValue(
   raw.change,
   `${path}.change`,
   EVIDENCE_CHANGE_VALUES,
  ) as UltraReviewEvidenceChange
 );
 const location = trusted
  ? { ...trusted.location }
  : parseLocation(
    raw.location,
    `${path}.location`,
   );
 const fingerprint = trusted?.fingerprint ?? (
  stringValue(
   raw.fingerprint,
   `${path}.fingerprint`,
  )
 );
 const supportingReason = optionalStringValue(
  raw.supportingReason,
  `${path}.supportingReason`,
 );
 const evidence: UltraReviewEvidence = {
  id,
  kind,
  change,
  location,
  fingerprint,
  sourceClaimIds: stringArrayValue(
   raw.sourceClaimIds,
   `${path}.sourceClaimIds`,
  ),
  supportingReason,
 };

 const lineFreeChange =
  change === "binary" ||
  change === "rename";
 if (
  lineFreeChange &&
  (
   location.startLine !== null ||
   location.endLine !== null
  )
 ) {
  invalid(
   `${path}.location`,
   "line-free for binary and rename evidence",
  );
 }
 if (
  change === "rename" &&
  location.oldPath === undefined
 ) {
  invalid(
   `${path}.location.oldPath`,
   "present for rename evidence",
  );
 }
 if (
  !lineFreeChange &&
  (
   location.startLine === null ||
   location.endLine === null
  )
 ) {
  invalid(
   `${path}.location`,
   "a complete line range",
  );
 }
 if (
  location.startLine !== null &&
  location.endLine !== null &&
  location.startLine > location.endLine
 ) {
  invalid(
   `${path}.location`,
   "a range whose startLine is not after endLine",
  );
 }
 if (
  kind === "supporting" &&
  (
   change !== "context" ||
   supportingReason === undefined
  )
 ) {
  invalid(
   path,
   "context evidence with a supportingReason",
  );
 }
 if (kind === "changed" && change === "context") {
  invalid(path, "changed rather than context evidence");
 }

 const expectedId = stableUltraReviewEvidenceId(evidence);
 if (evidence.id !== expectedId) {
  throw new UltraReviewValidationError(
   `${path}.id must equal ${expectedId}`,
  );
 }
 return evidence;
}

function parseCoverageAssignment(
 value: unknown,
 path: string,
): UltraReviewCoverageAssignment {
 const assignment = objectValue(value, path);
 const kind = enumValue(
  assignment.kind,
  `${path}.kind`,
  ["beat", "mechanical", "unmapped"] as const,
 );
 if (kind === "beat") {
  return {
   kind,
   beatId: stringValue(
    assignment.beatId,
    `${path}.beatId`,
   ),
  };
 }
 if (kind === "mechanical") {
  return {
   kind,
   mechanicalChangeId: stringValue(
    assignment.mechanicalChangeId,
    `${path}.mechanicalChangeId`,
   ),
  };
 }
 return {
  kind,
  reason: stringValue(
   assignment.reason,
   `${path}.reason`,
  ),
 };
}

function parseCoverageEntry(
 value: unknown,
 path: string,
): UltraReviewCoverageEntry {
 const coverage = objectValue(value, path);
 return {
  evidenceId: stringValue(
   coverage.evidenceId,
   `${path}.evidenceId`,
  ),
  assignment: parseCoverageAssignment(
   coverage.assignment,
   `${path}.assignment`,
  ),
 };
}

function parseMechanicalChange(
 value: unknown,
 path: string,
): UltraReviewMechanicalChange {
 const mechanical = objectValue(value, path);
 return {
  id: stringValue(mechanical.id, `${path}.id`),
  title: stringValue(
   mechanical.title,
   `${path}.title`,
  ),
  reason: stringValue(
   mechanical.reason,
   `${path}.reason`,
  ),
  evidenceIds: stringArrayValue(
   mechanical.evidenceIds,
   `${path}.evidenceIds`,
  ),
 };
}

function parseBeat(
 value: unknown,
 path: string,
): UltraReviewBeat {
 const beat = objectValue(value, path);
 return {
  id: stringValue(beat.id, `${path}.id`),
  title: stringValue(beat.title, `${path}.title`),
  claim: stringValue(beat.claim, `${path}.claim`),
  objective: stringValue(
   beat.objective,
   `${path}.objective`,
  ),
  question: nullableStringValue(
   beat.question,
   `${path}.question`,
  ),
  order: integerValue(
   beat.order,
   `${path}.order`,
   { minimum: 0 },
  ),
  risk: enumValue(
   beat.risk,
   `${path}.risk`,
   RISK_VALUES,
  ) as UltraReviewRisk,
  confidence: optionalConfidenceValue(
   beat.confidence,
   `${path}.confidence`,
  ),
  evidenceIds: stringArrayValue(
   beat.evidenceIds,
   `${path}.evidenceIds`,
  ),
  ...(beat.removedEvidenceIds === undefined
   ? {}
   : {
      removedEvidenceIds: stringArrayValue(
       beat.removedEvidenceIds,
       `${path}.removedEvidenceIds`,
      ),
     }),
  sourceClaimIds: stringArrayValue(
   beat.sourceClaimIds,
   `${path}.sourceClaimIds`,
  ),
 };
}

function parseChapter(
 value: unknown,
 path: string,
): UltraReviewChapter {
 const chapter = objectValue(value, path);
 const kind = chapter.kind === undefined
  ? undefined
  : enumValue(
    chapter.kind,
    `${path}.kind`,
    [
     "narrative",
     "mechanical",
     "delta",
     "unmapped",
    ] as const,
   );
 return {
  id: stringValue(chapter.id, `${path}.id`),
  title: stringValue(chapter.title, `${path}.title`),
  purpose: stringValue(
   chapter.purpose,
   `${path}.purpose`,
  ),
  before: stringValue(
   chapter.before,
   `${path}.before`,
  ),
  after: stringValue(
   chapter.after,
   `${path}.after`,
  ),
  order: integerValue(
   chapter.order,
   `${path}.order`,
   { minimum: 0 },
  ),
  risk: enumValue(
   chapter.risk,
   `${path}.risk`,
   RISK_VALUES,
  ) as UltraReviewRisk,
  confidence: optionalConfidenceValue(
   chapter.confidence,
   `${path}.confidence`,
  ),
  sourceClaimIds: stringArrayValue(
   chapter.sourceClaimIds,
   `${path}.sourceClaimIds`,
  ),
  dependencyChapterIds: stringArrayValue(
   chapter.dependencyChapterIds,
   `${path}.dependencyChapterIds`,
  ),
  beats: arrayValue(
   chapter.beats,
   `${path}.beats`,
  ).map(
   (beat, index) =>
    parseBeat(beat, `${path}.beats[${index}]`),
  ),
  kind,
 };
}

function parseSystem(
 value: unknown,
 path: string,
): UltraReviewSystem {
 const system = objectValue(value, path);
 const scope = objectValue(
  system.scope,
  `${path}.scope`,
 );
 return {
  id: stringValue(system.id, `${path}.id`),
  title: stringValue(system.title, `${path}.title`),
  thesis: stringValue(
   system.thesis,
   `${path}.thesis`,
  ),
  order: integerValue(
   system.order,
   `${path}.order`,
   { minimum: 0 },
  ),
  risk: enumValue(
   system.risk,
   `${path}.risk`,
   RISK_VALUES,
  ) as UltraReviewRisk,
  confidence: optionalConfidenceValue(
   system.confidence,
   `${path}.confidence`,
  ),
  sourceClaimIds: stringArrayValue(
   system.sourceClaimIds,
   `${path}.sourceClaimIds`,
  ),
  scope: {
   changedLines: integerValue(
    scope.changedLines,
    `${path}.scope.changedLines`,
    { minimum: 0 },
   ),
   files: integerValue(
    scope.files,
    `${path}.scope.files`,
    { minimum: 0 },
   ),
  },
  chapters: arrayValue(
   system.chapters,
   `${path}.chapters`,
  ).map(
   (chapter, index) =>
    parseChapter(
     chapter,
     `${path}.chapters[${index}]`,
    ),
  ),
 };
}

function parseConcern(
 value: unknown,
 path: string,
): UltraReviewConcern {
 const concern = objectValue(value, path);
 return {
  id: stringValue(concern.id, `${path}.id`),
  beatId: stringValue(
   concern.beatId,
   `${path}.beatId`,
  ),
  question: stringValue(
   concern.question,
   `${path}.question`,
  ),
  evidenceIds: stringArrayValue(
   concern.evidenceIds,
   `${path}.evidenceIds`,
  ),
  sourceClaimIds: stringArrayValue(
   concern.sourceClaimIds,
   `${path}.sourceClaimIds`,
  ),
  severity: enumValue(
   concern.severity,
   `${path}.severity`,
   SEVERITY_VALUES,
  ) as Severity,
 };
}

function parseGenerationStage(
 value: unknown,
 path: string,
): UltraReviewGenerationStage {
 const stage = objectValue(value, path);
 return {
  id: stringValue(stage.id, `${path}.id`),
  label: stringValue(stage.label, `${path}.label`),
  status: enumValue(
   stage.status,
   `${path}.status`,
   GENERATION_STAGE_STATUS_VALUES,
  ) as UltraReviewGenerationStageStatus,
  systemId: nullableStringValue(
   stage.systemId,
   `${path}.systemId`,
  ),
  error: nullableStringValue(
   stage.error,
   `${path}.error`,
  ),
 };
}

function parseGenerationFailure(
 value: unknown,
 path: string,
): UltraReviewGenerationFailure {
 const failure = objectValue(value, path);
 const scope = enumValue(
  failure.scope,
  `${path}.scope`,
  FAILURE_SCOPE_VALUES,
 ) as UltraReviewFailureScope;
 const systemId = nullableStringValue(
  failure.systemId,
  `${path}.systemId`,
 );
 const chapterId = nullableStringValue(
  failure.chapterId,
  `${path}.chapterId`,
 );
 const base = {
  id: stringValue(failure.id, `${path}.id`),
  stageId: stringValue(
   failure.stageId,
   `${path}.stageId`,
  ),
  message: stringValue(
   failure.message,
   `${path}.message`,
  ),
  retryable: booleanValue(
   failure.retryable,
   `${path}.retryable`,
  ),
  evidenceIds: stringArrayValue(
   failure.evidenceIds,
   `${path}.evidenceIds`,
  ),
 };
 if (scope === "artifact") {
  if (systemId !== null) {
   invalid(
    `${path}.systemId`,
    "null for an artifact failure",
   );
  }
  if (chapterId !== null) {
   invalid(
    `${path}.chapterId`,
    "null for an artifact failure",
   );
  }
  return {
   ...base,
   scope,
   systemId: null,
   chapterId: null,
  };
 }
 if (systemId === null) {
  invalid(
   `${path}.systemId`,
   `present for a ${scope} failure`,
  );
 }
 if (scope === "system") {
  if (chapterId !== null) {
   invalid(
    `${path}.chapterId`,
    "null for a system failure",
   );
  }
  return {
   ...base,
   scope,
   systemId,
   chapterId: null,
  };
 }
 if (chapterId === null) {
  invalid(
   `${path}.chapterId`,
   "present for a chapter failure",
  );
 }
 return {
  ...base,
  scope,
  systemId,
  chapterId,
 };
}

function parseGeneration(
 value: unknown,
 path: string,
): UltraReviewGeneration {
 const generation = objectValue(value, path);
 return {
  status: enumValue(
   generation.status,
   `${path}.status`,
   GENERATION_STATUS_VALUES,
  ) as UltraReviewGenerationStatus,
  stages: arrayValue(
   generation.stages,
   `${path}.stages`,
  ).map(
   (stage, index) =>
    parseGenerationStage(
     stage,
     `${path}.stages[${index}]`,
    ),
  ),
  failures: arrayValue(
   generation.failures,
   `${path}.failures`,
  ).map(
   (failure, index) =>
    parseGenerationFailure(
     failure,
     `${path}.failures[${index}]`,
    ),
  ),
 };
}

function parseNoteAnchor(
 value: unknown,
 path: string,
): UltraReviewNoteAnchor {
 const anchor = objectValue(value, path);
 const kind = enumValue(
  anchor.kind,
  `${path}.kind`,
  ["beat", "line"] as const,
 );
 if (kind === "beat") {
  return {
   kind,
   beatId: stringValue(
    anchor.beatId,
    `${path}.beatId`,
   ),
  };
 }
 const startLine = integerValue(
  anchor.startLine,
  `${path}.startLine`,
  { minimum: 1 },
 );
 const endLine = integerValue(
  anchor.endLine,
  `${path}.endLine`,
  { minimum: 1 },
 );
 if (startLine > endLine) {
  invalid(
   path,
   "a line anchor whose startLine is not after endLine",
  );
 }
 return {
  kind,
  evidenceIds: (() => {
   const ids = anchor.evidenceIds === undefined
    ? [stringValue(
      anchor.evidenceId,
      `${path}.evidenceId`,
     )]
    : stringArrayValue(
      anchor.evidenceIds,
      `${path}.evidenceIds`,
     );
   if (ids.length === 0) {
    invalid(`${path}.evidenceIds`, "at least one evidence id");
   }
   return [...new Set(ids)];
  })(),
  path: stringValue(anchor.path, `${path}.path`),
  side: enumValue(
   anchor.side,
   `${path}.side`,
   EVIDENCE_SIDE_VALUES,
  ) as UltraReviewEvidenceSide,
  startLine,
  endLine,
  headSha: stringValue(
   anchor.headSha,
   `${path}.headSha`,
  ),
 };
}

function parseNote(
 value: unknown,
 path: string,
): UltraReviewNote {
 const note = objectValue(value, path);
 return {
  id: stringValue(note.id, `${path}.id`),
  body: stringValue(note.body, `${path}.body`),
  kind: note.kind === undefined
   ? "note"
   : enumValue(
     note.kind,
     `${path}.kind`,
     [
      "note",
      "nitpick",
      "request",
      "suggestion",
      "praise",
     ] as const,
    ),
  submitAsComment: note.submitAsComment === undefined
   ? false
   : booleanValue(
     note.submitAsComment,
     `${path}.submitAsComment`,
    ),
  anchor: parseNoteAnchor(
   note.anchor,
   `${path}.anchor`,
  ),
  createdAt: integerValue(
   note.createdAt,
   `${path}.createdAt`,
   { minimum: 0 },
  ),
  stale: booleanValue(note.stale, `${path}.stale`),
 };
}

function parseAnswer(
 value: unknown,
 path: string,
): UltraReviewAnswer {
 const answer = objectValue(value, path);
 const status = enumValue(
  answer.status,
  `${path}.status`,
  ANSWER_STATUS_VALUES,
 );
 const text = status === "complete"
  ? stringValue(answer.text, `${path}.text`)
  : textValue(answer.text, `${path}.text`);
 const error = optionalStringValue(
  answer.error,
  `${path}.error`,
 );
 if (status === "failed" && error === undefined) {
  invalid(
   `${path}.error`,
   "present for a failed answer",
  );
 }
 if (status === "complete" && error !== undefined) {
  invalid(
   `${path}.error`,
   "absent for a complete answer",
  );
 }
 const citationIds = stringArrayValue(
  answer.citationIds,
  `${path}.citationIds`,
 );
 const insufficientEvidence = booleanValue(
  answer.insufficientEvidence,
  `${path}.insufficientEvidence`,
 );
 if (
  status === "complete" &&
  !insufficientEvidence &&
  citationIds.length === 0
 ) {
  invalid(
   `${path}.citationIds`,
   "non-empty when evidence is sufficient",
  );
 }
 const result: UltraReviewAnswer = {
  id: stringValue(answer.id, `${path}.id`),
  beatId: stringValue(
   answer.beatId,
   `${path}.beatId`,
  ),
  action: enumValue(
   answer.action,
   `${path}.action`,
   ANSWER_ACTION_VALUES,
  ),
  question: stringValue(
   answer.question,
   `${path}.question`,
  ),
  text,
  citationIds,
  insufficientEvidence,
  status,
  headSha: stringValue(
   answer.headSha,
   `${path}.headSha`,
  ),
  createdAt: integerValue(
   answer.createdAt,
   `${path}.createdAt`,
   { minimum: 0 },
  ),
  stale: booleanValue(
   answer.stale,
   `${path}.stale`,
  ),
 };
 if (error !== undefined) result.error = error;
 return result;
}

function parseDraftProvenance(
 value: unknown,
 path: string,
): UltraReviewDraftProvenance {
 const provenance = objectValue(value, path);
 return {
  noteIds: stringArrayValue(
   provenance.noteIds,
   `${path}.noteIds`,
  ),
  beatIds: stringArrayValue(
   provenance.beatIds,
   `${path}.beatIds`,
  ),
  evidenceIds: stringArrayValue(
   provenance.evidenceIds,
   `${path}.evidenceIds`,
  ),
  concernIds: stringArrayValue(
   provenance.concernIds,
   `${path}.concernIds`,
  ),
 };
}

function parseDraftSection(
 value: unknown,
 path: string,
): UltraReviewDraftSection {
 const section = objectValue(value, path);
 return {
  id: stringValue(section.id, `${path}.id`),
  body: stringValue(section.body, `${path}.body`),
  provenance: parseDraftProvenance(
   section.provenance,
   `${path}.provenance`,
  ),
 };
}

function parseDraftInlineComment(
 value: unknown,
 path: string,
): UltraReviewDraftInlineComment {
 const comment = objectValue(value, path);
 const startLine = comment.startLine === undefined
  ? undefined
  : integerValue(
    comment.startLine,
    `${path}.startLine`,
    { minimum: 1 },
   );
 return {
  id: stringValue(comment.id, `${path}.id`),
  path: stringValue(comment.path, `${path}.path`),
  side: enumValue(
   comment.side,
   `${path}.side`,
   EVIDENCE_SIDE_VALUES,
  ) as UltraReviewEvidenceSide,
  line: integerValue(
   comment.line,
   `${path}.line`,
   { minimum: 1 },
  ),
  startLine,
  body: stringValue(comment.body, `${path}.body`),
  included: booleanValue(
   comment.included,
   `${path}.included`,
  ),
  provenance: parseDraftProvenance(
   comment.provenance,
   `${path}.provenance`,
  ),
 };
}

function parseDraft(
 value: unknown,
 path: string,
): UltraReviewDraft | null {
 if (value === null) return null;
 const draft = objectValue(value, path);
 return {
  id: stringValue(draft.id, `${path}.id`),
  body: stringValue(draft.body, `${path}.body`),
  recommendedVerdict: draft.recommendedVerdict === undefined
   ? "COMMENT"
   : enumValue(
     draft.recommendedVerdict,
     `${path}.recommendedVerdict`,
     ["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const,
    ),
  sourceNotesFingerprint:
   draft.sourceNotesFingerprint === undefined
    ? "legacy"
    : stringValue(
      draft.sourceNotesFingerprint,
      `${path}.sourceNotesFingerprint`,
     ),
  sections: arrayValue(
   draft.sections,
   `${path}.sections`,
  ).map(
   (section, index) =>
    parseDraftSection(
     section,
     `${path}.sections[${index}]`,
    ),
  ),
  inlineComments: arrayValue(
   draft.inlineComments,
   `${path}.inlineComments`,
  ).map(
   (comment, index) =>
    parseDraftInlineComment(
     comment,
     `${path}.inlineComments[${index}]`,
    ),
  ),
  incorporatedNoteIds: stringArrayValue(
   draft.incorporatedNoteIds,
   `${path}.incorporatedNoteIds`,
  ),
  combinedNoteIds: stringArrayValue(
   draft.combinedNoteIds,
   `${path}.combinedNoteIds`,
  ),
  omittedNoteIds: stringArrayValue(
   draft.omittedNoteIds,
   `${path}.omittedNoteIds`,
  ),
 };
}

function parseProgress(
 value: unknown,
 path: string,
): UltraReviewProgress {
 const progress = objectValue(value, path);
 return {
  documentReviewed: booleanValue(
   progress.documentReviewed,
   `${path}.documentReviewed`,
  ),
  acknowledgedMechanicalChanges: integerValue(
   progress.acknowledgedMechanicalChanges,
   `${path}.acknowledgedMechanicalChanges`,
   { minimum: 0 },
  ),
  totalMechanicalChanges: integerValue(
   progress.totalMechanicalChanges,
   `${path}.totalMechanicalChanges`,
   { minimum: 0 },
  ),
  coveredChangedEvidence: integerValue(
   progress.coveredChangedEvidence,
   `${path}.coveredChangedEvidence`,
   { minimum: 0 },
  ),
  totalChangedEvidence: integerValue(
   progress.totalChangedEvidence,
   `${path}.totalChangedEvidence`,
   { minimum: 0 },
  ),
  failedRegions: integerValue(
   progress.failedRegions,
   `${path}.failedRegions`,
   { minimum: 0 },
  ),
  unmappedEvidence: integerValue(
   progress.unmappedEvidence,
   `${path}.unmappedEvidence`,
   { minimum: 0 },
  ),
  fullyReviewed: booleanValue(
   progress.fullyReviewed,
   `${path}.fullyReviewed`,
  ),
 };
}

function parseSubmissionSnapshot(
 value: unknown,
 path: string,
): UltraReviewSubmissionSnapshot {
 const snapshot = objectValue(value, path);
 return {
  id: stringValue(snapshot.id, `${path}.id`),
  submittedAt: integerValue(
   snapshot.submittedAt,
   `${path}.submittedAt`,
   { minimum: 0 },
  ),
  headSha: stringValue(
   snapshot.headSha,
   `${path}.headSha`,
  ),
  verdict: enumValue(
   snapshot.verdict,
   `${path}.verdict`,
   VERDICT_VALUES,
  ),
  body: textValue(snapshot.body, `${path}.body`),
  inlineComments: arrayValue(
   snapshot.inlineComments,
   `${path}.inlineComments`,
  ).map(
   (comment, index) =>
    parseDraftInlineComment(
     comment,
     `${path}.inlineComments[${index}]`,
    ),
  ),
  noteIds: stringArrayValue(
   snapshot.noteIds,
   `${path}.noteIds`,
  ),
  progress: parseProgress(
   snapshot.progress,
   `${path}.progress`,
  ),
 };
}

function parseStringEnumRecord<
 const Values extends readonly string[],
>(
 value: unknown,
 path: string,
 values: Values,
): Record<string, Values[number]> {
 const record = objectValue(value, path);
 return Object.fromEntries(
  Object.entries(record).map(
   ([key, entry]) => [
    key,
    enumValue(entry, `${path}.${key}`, values),
   ],
  ),
 );
}

function parseDiffViewState(
 value: unknown,
 path: string,
): DiffViewerViewState {
 const state = objectValue(value, path);
 const collapsed = objectValue(
  state.collapsed,
  `${path}.collapsed`,
 );
 const expandedContext = objectValue(
  state.expandedContext,
  `${path}.expandedContext`,
 );
 const viewed = state.viewed === undefined
  ? undefined
  : objectValue(state.viewed, `${path}.viewed`);
 return {
  collapsed: Object.fromEntries(
   Object.entries(collapsed).map(([key, entry]) => [
    key,
    booleanValue(entry, `${path}.collapsed.${key}`),
   ]),
  ),
  expandedContext: Object.fromEntries(
   Object.entries(expandedContext).map(([key, entry]) => {
    const expansion = objectValue(
     entry,
     `${path}.expandedContext.${key}`,
    );
    return [
     key,
     {
      head: integerValue(
       expansion.head,
       `${path}.expandedContext.${key}.head`,
       { minimum: 0 },
      ),
      tail: integerValue(
       expansion.tail,
       `${path}.expandedContext.${key}.tail`,
       { minimum: 0 },
      ),
     },
    ];
   }),
  ),
  ...(viewed === undefined
   ? {}
   : {
     viewed: Object.fromEntries(
      Object.entries(viewed).map(([key, entry]) => [
       key,
       stringValue(entry, `${path}.viewed.${key}`),
      ]),
     ),
    }),
 };
}

function parseDiffViewStates(
 value: unknown,
 path: string,
): NonNullable<
 UltraReviewSession["resume"]["diffViewStates"]
> {
 const states = objectValue(value, path);
 return {
  ...(states.beats === undefined
   ? {}
   : {
     beats: Object.fromEntries(
      Object.entries(
       objectValue(states.beats, `${path}.beats`),
      ).map(([beatId, state]) => [
       beatId,
       parseDiffViewState(state, `${path}.beats.${beatId}`),
      ]),
     ),
    }),
  ...(states.raw === undefined
   ? {}
   : {
     raw: parseDiffViewState(
      states.raw,
      `${path}.raw`,
     ),
    }),
 };
}

function parseResume(
 value: unknown,
 path: string,
): UltraReviewSession["resume"] {
 const resume = objectValue(value, path);
 const diffViewStates = resume.diffViewStates === undefined
  ? undefined
  : parseDiffViewStates(
    resume.diffViewStates,
    `${path}.diffViewStates`,
   );
 return {
  systemId: nullableStringValue(
   resume.systemId,
   `${path}.systemId`,
  ),
  chapterId: nullableStringValue(
   resume.chapterId,
   `${path}.chapterId`,
  ),
  beatId: nullableStringValue(
   resume.beatId,
   `${path}.beatId`,
  ),
  scrollTop: integerValue(
   resume.scrollTop,
   `${path}.scrollTop`,
   { minimum: 0 },
  ),
  expandedEvidenceIds: stringArrayValue(
   resume.expandedEvidenceIds,
   `${path}.expandedEvidenceIds`,
  ),
  ...(diffViewStates === undefined
   ? {}
   : { diffViewStates }),
 };
}

function parseSession(
 value: unknown,
 path: string,
 mode: UltraReviewSession["mode"],
): UltraReviewSession {
 const session = objectValue(value, path);
 if (session.mode !== mode) {
  throw new UltraReviewValidationError(
   `${path}.mode must equal ${mode}`,
  );
 }
 const hasAuthorOutcome = session.authorOutcome !== undefined;
 const hasAuthorCompletedAt =
  session.authorCompletedAt !== undefined;
 if (hasAuthorOutcome !== hasAuthorCompletedAt) {
  invalid(
   path,
   "authorOutcome and authorCompletedAt together",
  );
 }
 return {
  mode,
  ...(session.reviewCompletedAt === undefined
   ? {}
   : {
      reviewCompletedAt: integerValue(
       session.reviewCompletedAt,
       `${path}.reviewCompletedAt`,
       { minimum: 0 },
      ),
     }),
  acknowledgedMechanicalChangeIds: stringArrayValue(
   session.acknowledgedMechanicalChangeIds,
   `${path}.acknowledgedMechanicalChangeIds`,
  ),
  concernDispositions: parseStringEnumRecord(
   session.concernDispositions,
   `${path}.concernDispositions`,
   CONCERN_DISPOSITION_VALUES,
  ) as Record<string, UltraReviewConcernDisposition>,
  notes: arrayValue(
   session.notes,
   `${path}.notes`,
  ).map(
   (note, index) =>
     parseNote(note, `${path}.notes[${index}]`),
  ),
  answers: arrayValue(
   session.answers,
   `${path}.answers`,
  ).map(
   (answer, index) =>
    parseAnswer(
     answer,
     `${path}.answers[${index}]`,
    ),
  ),
  draft: parseDraft(
   session.draft,
   `${path}.draft`,
  ),
  snapshots: arrayValue(
   session.snapshots,
   `${path}.snapshots`,
  ).map(
   (snapshot, index) =>
    parseSubmissionSnapshot(
     snapshot,
     `${path}.snapshots[${index}]`,
    ),
   ),
  ...(hasAuthorOutcome
   ? {
      authorOutcome: enumValue(
       session.authorOutcome,
       `${path}.authorOutcome`,
       ["ready", "continue"] as const,
      ),
      authorCompletedAt: integerValue(
       session.authorCompletedAt,
       `${path}.authorCompletedAt`,
       { minimum: 0 },
      ),
     }
   : {}),
  resume: parseResume(
   session.resume,
   `${path}.resume`,
  ),
 };
}

function parseAnalysis(
 value: unknown,
 trustedEvidence: readonly UltraReviewAnalysisEvidence[] = [],
): ParsedAnalysis {
 const analysis = objectValue(value, "analysis");
 const trustedEvidenceById = new Map(
  trustedEvidence.map(
   (evidence) => [evidence.id, evidence],
  ),
 );
 if (
  analysis.version !==
  ULTRA_REVIEW_ARTIFACT_VERSION
 ) {
  throw new UltraReviewValidationError(
   `analysis.version ${String(analysis.version)} is unsupported`,
  );
 }
 const result = {
  thesis: stringValue(analysis.thesis, "analysis.thesis"),
  sourceClaimIds: stringArrayValue(
   analysis.sourceClaimIds,
   "analysis.sourceClaimIds",
  ),
  systems: arrayValue(
   analysis.systems,
   "analysis.systems",
  ).map(
   (system, index) =>
    parseSystem(
     system,
     `analysis.systems[${index}]`,
    ),
  ),
  evidence: arrayValue(
   analysis.evidence,
   "analysis.evidence",
  ).map(
   (evidence, index) =>
    parseEvidence(
     evidence,
     `analysis.evidence[${index}]`,
     trustedEvidenceById,
    ),
  ),
  coverage: arrayValue(
   analysis.coverage,
   "analysis.coverage",
  ).map(
   (coverage, index) =>
    parseCoverageEntry(
     coverage,
     `analysis.coverage[${index}]`,
    ),
  ),
  mechanicalChanges: arrayValue(
   analysis.mechanicalChanges,
   "analysis.mechanicalChanges",
  ).map(
   (mechanical, index) =>
    parseMechanicalChange(
     mechanical,
     `analysis.mechanicalChanges[${index}]`,
    ),
  ),
  sourceClaims: arrayValue(
   analysis.sourceClaims,
   "analysis.sourceClaims",
  ).map(
   (source, index) =>
    parseSourceClaim(
     source,
     `analysis.sourceClaims[${index}]`,
    ),
  ),
  concerns: arrayValue(
   analysis.concerns,
   "analysis.concerns",
  ).map(
   (concern, index) =>
    parseConcern(
     concern,
     `analysis.concerns[${index}]`,
    ),
  ),
  generation: parseGeneration(
   analysis.generation,
   "analysis.generation",
  ),
 };
 validateAnalysisReferences(result);
 return result;
}

function beats(
 systems: UltraReviewSystem[],
): UltraReviewBeat[] {
 return systems.flatMap(
  (system) =>
   system.chapters.flatMap(
    (chapter) => chapter.beats,
   ),
 );
}

function uniqueIds(
 values: { id: string }[],
 path: string,
): Set<string> {
 const ids = new Set<string>();
 for (
  let index = 0;
  index < values.length;
  index += 1
 ) {
  const id = values[index].id;
  if (ids.has(id)) {
   throw new UltraReviewValidationError(
    `${path}[${index}].id duplicates ${id}`,
   );
  }
  ids.add(id);
 }
 return ids;
}

function requireReference(
 ids: Set<string>,
 id: string,
 path: string,
): void {
 if (ids.has(id)) return;
 throw new UltraReviewValidationError(
  `${path} references unknown ${id}`,
 );
}

function validateAnalysisReferences(
 analysis: ParsedAnalysis,
): void {
 const chapters = analysis.systems.flatMap(
  (system) => system.chapters,
 );
 const allBeats = chapters.flatMap(
  (chapter) => chapter.beats,
 );
 const systemIds = uniqueIds(
  analysis.systems,
  "analysis.systems",
 );
 const chapterIds = uniqueIds(
  chapters,
  "analysis.chapters",
 );
 const beatIds = uniqueIds(
  allBeats,
  "analysis.beats",
 );
 const evidenceIds = uniqueIds(
  analysis.evidence,
  "analysis.evidence",
 );
 const sourceClaimIds = uniqueIds(
  analysis.sourceClaims,
  "analysis.sourceClaims",
 );
 const mechanicalChangeIds = uniqueIds(
  analysis.mechanicalChanges,
  "analysis.mechanicalChanges",
 );
 uniqueIds(analysis.concerns, "analysis.concerns");
 const stageIds = uniqueIds(
  analysis.generation.stages,
  "analysis.generation.stages",
 );
 const stageById = new Map(
  analysis.generation.stages.map(
   (stage) => [stage.id, stage],
  ),
 );
 const chapterSystemById = new Map(
  analysis.systems.flatMap(
   (system) =>
    system.chapters.map(
     (chapter) => [chapter.id, system.id] as const,
    ),
  ),
 );
 uniqueIds(
  analysis.generation.failures,
  "analysis.generation.failures",
 );

 const provenanceMayBeIncomplete =
  analysis.systems.length === 0
  && analysis.generation.status !== "complete";
 if (
  analysis.sourceClaimIds.length === 0 &&
  !provenanceMayBeIncomplete
 ) {
  invalid(
   "analysis.sourceClaimIds",
   "non-empty for the pull request thesis",
  );
 }
 for (
  let index = 0;
  index < analysis.sourceClaimIds.length;
  index += 1
 ) {
  requireReference(
   sourceClaimIds,
   analysis.sourceClaimIds[index],
   `analysis.sourceClaimIds[${index}]`,
  );
 }

 for (
  let systemIndex = 0;
  systemIndex < analysis.systems.length;
  systemIndex += 1
 ) {
  const system = analysis.systems[systemIndex];
  if (system.sourceClaimIds.length === 0) {
   invalid(
    `analysis.systems[${systemIndex}].sourceClaimIds`,
    "non-empty for the system thesis",
   );
  }
  for (
   let sourceIndex = 0;
   sourceIndex < system.sourceClaimIds.length;
   sourceIndex += 1
  ) {
   requireReference(
    sourceClaimIds,
    system.sourceClaimIds[sourceIndex],
    `analysis.systems[${systemIndex}]` +
     `.sourceClaimIds[${sourceIndex}]`,
   );
  }
  for (
   let chapterIndex = 0;
   chapterIndex < system.chapters.length;
   chapterIndex += 1
  ) {
   const chapter = system.chapters[chapterIndex];
   const chapterPath =
    `analysis.systems[${systemIndex}]` +
    `.chapters[${chapterIndex}]`;
   if (chapter.sourceClaimIds.length === 0) {
    invalid(
     `${chapterPath}.sourceClaimIds`,
     "non-empty for chapter assertions",
    );
   }
   for (
    let sourceIndex = 0;
    sourceIndex < chapter.sourceClaimIds.length;
    sourceIndex += 1
   ) {
    requireReference(
     sourceClaimIds,
     chapter.sourceClaimIds[sourceIndex],
     `${chapterPath}.sourceClaimIds[${sourceIndex}]`,
    );
   }
   for (
    let dependencyIndex = 0;
    dependencyIndex <
     chapter.dependencyChapterIds.length;
    dependencyIndex += 1
   ) {
    requireReference(
     chapterIds,
     chapter.dependencyChapterIds[dependencyIndex],
     `${chapterPath}.dependencyChapterIds` +
      `[${dependencyIndex}]`,
    );
   }
   for (
    let beatIndex = 0;
    beatIndex < chapter.beats.length;
    beatIndex += 1
   ) {
    const beat = chapter.beats[beatIndex];
    const beatPath =
     `${chapterPath}.beats[${beatIndex}]`;
    for (
     let evidenceIndex = 0;
     evidenceIndex < beat.evidenceIds.length;
     evidenceIndex += 1
    ) {
     requireReference(
      evidenceIds,
      beat.evidenceIds[evidenceIndex],
      `${beatPath}.evidenceIds[${evidenceIndex}]`,
     );
    }
    for (
     let sourceIndex = 0;
     sourceIndex < beat.sourceClaimIds.length;
     sourceIndex += 1
    ) {
     requireReference(
      sourceClaimIds,
      beat.sourceClaimIds[sourceIndex],
      `${beatPath}.sourceClaimIds[${sourceIndex}]`,
     );
    }
   }
  }
 }

 for (
  let index = 0;
  index < analysis.evidence.length;
  index += 1
 ) {
  const evidence = analysis.evidence[index];
  for (
   let sourceIndex = 0;
   sourceIndex < evidence.sourceClaimIds.length;
   sourceIndex += 1
  ) {
   requireReference(
    sourceClaimIds,
    evidence.sourceClaimIds[sourceIndex],
    `analysis.evidence[${index}]` +
     `.sourceClaimIds[${sourceIndex}]`,
   );
  }
 }

 for (
  let index = 0;
  index < analysis.sourceClaims.length;
  index += 1
 ) {
  const source = analysis.sourceClaims[index];
  if (
   (
    source.kind === "code_observed" ||
    source.kind === "predicted_behavior"
   ) &&
   source.evidenceIds.length === 0
  ) {
   invalid(
    `analysis.sourceClaims[${index}].evidenceIds`,
    "non-empty for code-derived claims",
   );
  }
  for (
   let evidenceIndex = 0;
   evidenceIndex < source.evidenceIds.length;
   evidenceIndex += 1
  ) {
   requireReference(
    evidenceIds,
    source.evidenceIds[evidenceIndex],
    `analysis.sourceClaims[${index}]` +
     `.evidenceIds[${evidenceIndex}]`,
   );
  }
 }

 for (
  let index = 0;
  index < analysis.coverage.length;
  index += 1
 ) {
  const coverage = analysis.coverage[index];
  requireReference(
   evidenceIds,
   coverage.evidenceId,
   `analysis.coverage[${index}].evidenceId`,
  );
  if (coverage.assignment.kind === "beat") {
   requireReference(
    beatIds,
    coverage.assignment.beatId,
    `analysis.coverage[${index}]` +
     ".assignment.beatId",
   );
  }
  if (coverage.assignment.kind === "mechanical") {
   requireReference(
    mechanicalChangeIds,
    coverage.assignment.mechanicalChangeId,
    `analysis.coverage[${index}]` +
     ".assignment.mechanicalChangeId",
   );
  }
 }

 for (
  let index = 0;
  index < analysis.mechanicalChanges.length;
  index += 1
 ) {
  const mechanical = analysis.mechanicalChanges[index];
  for (
   let evidenceIndex = 0;
   evidenceIndex < mechanical.evidenceIds.length;
   evidenceIndex += 1
  ) {
   requireReference(
    evidenceIds,
    mechanical.evidenceIds[evidenceIndex],
    `analysis.mechanicalChanges[${index}]` +
     `.evidenceIds[${evidenceIndex}]`,
   );
  }
 }

 for (
  let index = 0;
  index < analysis.concerns.length;
  index += 1
 ) {
  const concern = analysis.concerns[index];
  requireReference(
   beatIds,
   concern.beatId,
   `analysis.concerns[${index}].beatId`,
  );
  for (
   let evidenceIndex = 0;
   evidenceIndex < concern.evidenceIds.length;
   evidenceIndex += 1
  ) {
   requireReference(
    evidenceIds,
    concern.evidenceIds[evidenceIndex],
    `analysis.concerns[${index}]` +
     `.evidenceIds[${evidenceIndex}]`,
   );
  }
  for (
   let sourceIndex = 0;
   sourceIndex < concern.sourceClaimIds.length;
   sourceIndex += 1
  ) {
   requireReference(
    sourceClaimIds,
    concern.sourceClaimIds[sourceIndex],
    `analysis.concerns[${index}]` +
     `.sourceClaimIds[${sourceIndex}]`,
   );
  }
 }

 for (
  let index = 0;
  index < analysis.generation.stages.length;
  index += 1
 ) {
  const stage = analysis.generation.stages[index];
  if (stage.systemId !== null) {
   requireReference(
    systemIds,
    stage.systemId,
    `analysis.generation.stages[${index}].systemId`,
   );
  }
 }

 for (
  let index = 0;
  index < analysis.generation.failures.length;
  index += 1
 ) {
  const failure = analysis.generation.failures[index];
  requireReference(
   stageIds,
   failure.stageId,
   `analysis.generation.failures[${index}].stageId`,
  );
  const stage = stageById.get(failure.stageId);
  if (failure.systemId !== null) {
   requireReference(
    systemIds,
    failure.systemId,
    `analysis.generation.failures[${index}].systemId`,
   );
   if (stage?.systemId !== failure.systemId) {
    throw new UltraReviewValidationError(
     `analysis.generation.failures[${index}].stageId ` +
      `must belong to ${failure.systemId}`,
    );
   }
  }
  if (failure.chapterId !== null) {
   requireReference(
    chapterIds,
    failure.chapterId,
    `analysis.generation.failures[${index}].chapterId`,
   );
   if (
    chapterSystemById.get(failure.chapterId) !==
    failure.systemId
   ) {
    throw new UltraReviewValidationError(
     `analysis.generation.failures[${index}].chapterId ` +
      `must belong to ${failure.systemId}`,
    );
   }
  } else if (
   failure.scope === "artifact" &&
   stage?.systemId !== null
  ) {
   throw new UltraReviewValidationError(
    `analysis.generation.failures[${index}].stageId ` +
     "must belong to the artifact",
   );
  }
  for (
   let evidenceIndex = 0;
   evidenceIndex < failure.evidenceIds.length;
   evidenceIndex += 1
  ) {
   requireReference(
    evidenceIds,
    failure.evidenceIds[evidenceIndex],
    `analysis.generation.failures[${index}]` +
     `.evidenceIds[${evidenceIndex}]`,
   );
  }
 }
}

function initialResume(
 systems: UltraReviewSystem[],
): UltraReviewSession["resume"] {
 const system = [...systems].sort(
  (left, right) => left.order - right.order,
 )[0];
 const chapter = system
  ? [...system.chapters].sort(
     (left, right) => left.order - right.order,
    )[0]
  : undefined;
 const beat = chapter
  ? [...chapter.beats].sort(
     (left, right) => left.order - right.order,
    )[0]
  : undefined;
 return {
  systemId: system?.id ?? null,
  chapterId: chapter?.id ?? null,
  beatId: beat?.id ?? null,
  scrollTop: 0,
  expandedEvidenceIds: [],
 };
}

function createSession(
 mode: UltraReviewSession["mode"],
 systems: UltraReviewSystem[],
): UltraReviewSession {
 return {
  mode,
  acknowledgedMechanicalChangeIds: [],
  concernDispositions: {},
  notes: [],
  answers: [],
  draft: null,
  snapshots: [],
  resume: initialResume(systems),
 };
}

export function ultraReviewArtifactKey(
 identityValue: UltraReviewArtifactIdentity,
): string {
 const identity = parseIdentity(identityValue);
 return [
  `ultrareview:v${ULTRA_REVIEW_ARTIFACT_VERSION}`,
  encodeURIComponent(identity.repo),
  identity.prNumber,
  `${identity.baseSha}..${identity.headSha}`,
 ].join(":");
}

export function createUltraReviewArtifact(
 identityValue: UltraReviewArtifactIdentity,
): UltraReviewArtifact {
 const identity = parseIdentity(identityValue);
 const systems: UltraReviewSystem[] = [];
 return {
  version: ULTRA_REVIEW_ARTIFACT_VERSION,
  identity,
  artifactKey: ultraReviewArtifactKey(identity),
  galaxy: {
   id: "galaxy:root",
   thesis: "Analysis in progress",
   sourceClaimIds: [],
   systems,
  },
  evidence: [],
  coverage: [],
  mechanicalChanges: [],
  sourceClaims: [],
  concerns: [],
  generation: {
   status: "running",
   stages: [],
   failures: [],
  },
  sessions: {
   teammate: createSession("teammate", systems),
   author: createSession("author", systems),
  },
  lifecycle: "active",
 };
}

function artifactFromAnalysis(
 analysis: ParsedAnalysis,
 identityValue: UltraReviewArtifactIdentity,
): UltraReviewArtifact {
 const identity = parseIdentity(identityValue);
 return {
  version: ULTRA_REVIEW_ARTIFACT_VERSION,
  identity,
  artifactKey: ultraReviewArtifactKey(identity),
  galaxy: {
   id: "galaxy:root",
   thesis: analysis.thesis,
   sourceClaimIds: analysis.sourceClaimIds,
   systems: analysis.systems,
  },
  evidence: analysis.evidence,
  coverage: analysis.coverage,
  mechanicalChanges: analysis.mechanicalChanges,
  sourceClaims: analysis.sourceClaims,
  concerns: analysis.concerns,
  generation: analysis.generation,
  sessions: {
   teammate: createSession(
    "teammate",
    analysis.systems,
   ),
   author: createSession(
    "author",
    analysis.systems,
   ),
  },
  lifecycle: "active",
 };
}

export function parseUltraReviewAnalysisJson(
 raw: string,
 identity: UltraReviewArtifactIdentity,
 trustedEvidence: readonly UltraReviewAnalysisEvidence[] = [],
): UltraReviewArtifact {
 let value: unknown;
 try {
  value = JSON.parse(raw);
 } catch {
  throw new UltraReviewValidationError(
   "analysis must be valid JSON",
  );
 }
 return artifactFromAnalysis(
  parseAnalysis(value, trustedEvidence),
  identity,
 );
}

function validateSessionReferences(
 artifact: UltraReviewArtifact,
 mode: UltraReviewSession["mode"],
): void {
 const session = artifact.sessions[mode];
 const systemIds = new Set(
  artifact.galaxy.systems.map((system) => system.id),
 );
 const chapters = artifact.galaxy.systems.flatMap(
  (system) => system.chapters,
 );
 const chapterIds = new Set(
  chapters.map((chapter) => chapter.id),
 );
 const beatIds = new Set(
  chapters.flatMap(
   (chapter) => chapter.beats.map((beat) => beat.id),
  ),
 );
 const evidenceIds = new Set(
  artifact.evidence.map((evidence) => evidence.id),
 );
 const removedEvidenceIds = new Set(
  chapters.flatMap(
   (chapter) =>
    chapter.beats.flatMap(
     (beat) => beat.removedEvidenceIds ?? [],
    ),
  ),
 );
 const mechanicalChangeIds = new Set(
  artifact.mechanicalChanges.map(
   (mechanical) => mechanical.id,
  ),
 );
 const concernIds = new Set(
  artifact.concerns.map((concern) => concern.id),
 );
 const path = `artifact.sessions.${mode}`;

 for (
  let index = 0;
  index < session.acknowledgedMechanicalChangeIds.length;
  index += 1
 ) {
  requireReference(
   mechanicalChangeIds,
   session.acknowledgedMechanicalChangeIds[index],
   `${path}.acknowledgedMechanicalChangeIds[${index}]`,
  );
 }
 for (
  const concernId of
  Object.keys(session.concernDispositions)
 ) {
  requireReference(
   concernIds,
   concernId,
   `${path}.concernDispositions.${concernId}`,
  );
 }
 uniqueIds(session.notes, `${path}.notes`);
 uniqueIds(session.answers, `${path}.answers`);
 uniqueIds(session.snapshots, `${path}.snapshots`);
 for (
  let index = 0;
  index < session.notes.length;
  index += 1
 ) {
  const note = session.notes[index];
  if (note.stale) continue;
  if (note.anchor.kind === "beat") {
   requireReference(
    beatIds,
    note.anchor.beatId,
    `${path}.notes[${index}].anchor.beatId`,
   );
  } else {
   for (
    let evidenceIndex = 0;
    evidenceIndex < note.anchor.evidenceIds.length;
    evidenceIndex += 1
   ) {
    requireReference(
     evidenceIds,
     note.anchor.evidenceIds[evidenceIndex],
     `${path}.notes[${index}].anchor.evidenceIds[${evidenceIndex}]`,
    );
   }
  }
 }
 for (
  let index = 0;
  index < session.answers.length;
  index += 1
 ) {
  const answer = session.answers[index];
  if (answer.stale) continue;
  requireReference(
   beatIds,
   answer.beatId,
   `${path}.answers[${index}].beatId`,
  );
  for (
   let citationIndex = 0;
   citationIndex < answer.citationIds.length;
   citationIndex += 1
  ) {
   requireReference(
    evidenceIds,
    answer.citationIds[citationIndex],
    `${path}.answers[${index}]` +
     `.citationIds[${citationIndex}]`,
   );
  }
 }
 if (session.resume.systemId !== null) {
  requireReference(
   systemIds,
   session.resume.systemId,
   `${path}.resume.systemId`,
  );
 }
 if (session.resume.chapterId !== null) {
  requireReference(
   chapterIds,
   session.resume.chapterId,
   `${path}.resume.chapterId`,
  );
 }
 if (session.resume.beatId !== null) {
  requireReference(
   beatIds,
   session.resume.beatId,
   `${path}.resume.beatId`,
  );
 }
 for (
  let index = 0;
  index < session.resume.expandedEvidenceIds.length;
  index += 1
 ) {
  requireReference(
   evidenceIds,
   session.resume.expandedEvidenceIds[index],
   `${path}.resume.expandedEvidenceIds[${index}]`,
  );
 }
}

export function parseUltraReviewArtifact(
 value: unknown,
): UltraReviewArtifact {
 const raw = objectValue(value, "artifact");
 if (
  raw.version !==
  ULTRA_REVIEW_ARTIFACT_VERSION
 ) {
  throw new UltraReviewValidationError(
   `artifact.version ${String(raw.version)} is unsupported`,
  );
 }
 const identity = parseIdentity(
  raw.identity as UltraReviewArtifactIdentity,
 );
 const expectedKey = ultraReviewArtifactKey(identity);
 if (raw.artifactKey !== expectedKey) {
  throw new UltraReviewValidationError(
   `artifact.artifactKey must equal ${expectedKey}`,
  );
 }
 const galaxy = objectValue(raw.galaxy, "artifact.galaxy");
 const analysis = parseAnalysis({
  version: raw.version,
  thesis: galaxy.thesis,
  sourceClaimIds: galaxy.sourceClaimIds,
  systems: galaxy.systems,
  evidence: raw.evidence,
  coverage: raw.coverage,
  mechanicalChanges: raw.mechanicalChanges,
  sourceClaims: raw.sourceClaims,
  concerns: raw.concerns,
  generation: raw.generation,
 });
 const sessions = objectValue(
  raw.sessions,
  "artifact.sessions",
 );
 const artifact: UltraReviewArtifact = {
  version: ULTRA_REVIEW_ARTIFACT_VERSION,
  identity,
  artifactKey: expectedKey,
  galaxy: {
   id: stringValue(
    galaxy.id,
    "artifact.galaxy.id",
   ),
   thesis: analysis.thesis,
   sourceClaimIds: analysis.sourceClaimIds,
   systems: analysis.systems,
  },
  evidence: analysis.evidence,
  coverage: analysis.coverage,
  mechanicalChanges: analysis.mechanicalChanges,
  sourceClaims: analysis.sourceClaims,
  concerns: analysis.concerns,
  generation: analysis.generation,
  sessions: {
   teammate: parseSession(
    sessions.teammate,
    "artifact.sessions.teammate",
    "teammate",
   ),
   author: parseSession(
    sessions.author,
    "artifact.sessions.author",
    "author",
   ),
  },
  lifecycle: enumValue(
   raw.lifecycle,
   "artifact.lifecycle",
   LIFECYCLE_VALUES,
  ) as UltraReviewLifecycle,
 };
 validateSessionReferences(artifact, "teammate");
 validateSessionReferences(artifact, "author");
 return artifact;
}

function uniqueStrings(values: string[]): string[] {
 return [...new Set(values)];
}

function coverageOverlaps(
 evidence: UltraReviewEvidence[],
): UltraReviewCoverageOverlap[] {
 const lines = new Map<
  string,
  {
   path: string;
   side: UltraReviewEvidenceSide;
   line: number;
   evidenceIds: string[];
  }
 >();
 for (const reference of evidence) {
  if (
   reference.kind !== "changed" ||
   reference.location.startLine === null ||
   reference.location.endLine === null
  ) {
   continue;
  }
  for (
   let line = reference.location.startLine;
   line <= reference.location.endLine;
   line += 1
  ) {
   const key = [
    reference.location.path,
    reference.location.side,
    line,
   ].join("\0");
   const entry = lines.get(key) ?? {
    path: reference.location.path,
    side: reference.location.side,
    line,
    evidenceIds: [],
   };
   entry.evidenceIds.push(reference.id);
   lines.set(key, entry);
  }
 }
 return [...lines.values()]
  .filter((entry) => entry.evidenceIds.length > 1)
  .map((entry) => ({
   ...entry,
   evidenceIds: uniqueStrings(entry.evidenceIds),
  }));
}

export function auditUltraReviewCoverage(
 artifact: UltraReviewArtifact,
): UltraReviewCoverageAudit {
 const changedEvidence = artifact.evidence.filter(
  (evidence) => evidence.kind === "changed",
 );
 const evidenceById = new Map(
  artifact.evidence.map(
   (evidence) => [evidence.id, evidence],
  ),
 );
 const allBeats = beats(artifact.galaxy.systems);
 const beatById = new Map(
  allBeats.map((beat) => [beat.id, beat]),
 );
 const mechanicalById = new Map(
  artifact.mechanicalChanges.map(
   (mechanical) => [mechanical.id, mechanical],
  ),
 );
 const coverageByEvidence = new Map<
  string,
  UltraReviewCoverageEntry[]
 >();
 for (const entry of artifact.coverage) {
  const entries =
   coverageByEvidence.get(entry.evidenceId) ?? [];
  entries.push(entry);
  coverageByEvidence.set(entry.evidenceId, entries);
 }

 const missingEvidenceIds = changedEvidence
  .filter(
   (evidence) =>
    !coverageByEvidence.has(evidence.id),
  )
  .map((evidence) => evidence.id);
 const duplicateEvidenceIds = changedEvidence
  .filter(
   (evidence) =>
    (coverageByEvidence.get(evidence.id)?.length ?? 0) > 1,
  )
  .map((evidence) => evidence.id);
 const unknownEvidenceIds: string[] = [];
 const unmappedEvidenceIds: string[] = [];
 const mismatchedEvidenceIds: string[] = [];
 const invalidBeatIds: string[] = [];
 const invalidMechanicalChangeIds: string[] = [];
 const supportingEvidenceIds: string[] = [];

 for (const entry of artifact.coverage) {
  const evidence = evidenceById.get(entry.evidenceId);
  if (!evidence) {
   unknownEvidenceIds.push(entry.evidenceId);
  } else if (evidence.kind === "supporting") {
   supportingEvidenceIds.push(entry.evidenceId);
  }
  if (entry.assignment.kind === "unmapped") {
   unmappedEvidenceIds.push(entry.evidenceId);
   continue;
  }
  if (entry.assignment.kind === "beat") {
   const beat = beatById.get(entry.assignment.beatId);
   if (!beat) {
    invalidBeatIds.push(entry.assignment.beatId);
   } else if (!beat.evidenceIds.includes(entry.evidenceId)) {
    mismatchedEvidenceIds.push(entry.evidenceId);
   }
   continue;
  }
  const mechanical = mechanicalById.get(
   entry.assignment.mechanicalChangeId,
  );
  if (!mechanical) {
   invalidMechanicalChangeIds.push(
    entry.assignment.mechanicalChangeId,
   );
  } else if (
   !mechanical.evidenceIds.includes(entry.evidenceId)
  ) {
   mismatchedEvidenceIds.push(entry.evidenceId);
  }
 }

 const failedStageIds = new Set(
  artifact.generation.failures.map(
   (failure) => failure.stageId,
  ),
 );
 const failedRegionIds = uniqueStrings([
  ...artifact.generation.failures.map(
   (failure) => failure.id,
  ),
  ...artifact.generation.stages
   .filter(
    (stage) =>
     stage.status === "failed" &&
     !failedStageIds.has(stage.id),
   )
   .map((stage) => stage.id),
 ]);
 const incompleteStageIds = artifact.generation.stages
  .filter((stage) => stage.status !== "complete")
  .map((stage) => stage.id);
 const generationComplete =
  artifact.generation.status === "complete" &&
  failedRegionIds.length === 0 &&
  incompleteStageIds.length === 0;
 const result = {
  missingEvidenceIds,
  duplicateEvidenceIds,
  unknownEvidenceIds: uniqueStrings(unknownEvidenceIds),
  unmappedEvidenceIds: uniqueStrings(unmappedEvidenceIds),
  mismatchedEvidenceIds:
   uniqueStrings(mismatchedEvidenceIds),
  invalidBeatIds: uniqueStrings(invalidBeatIds),
  invalidMechanicalChangeIds:
   uniqueStrings(invalidMechanicalChangeIds),
  supportingEvidenceIds:
   uniqueStrings(supportingEvidenceIds),
  overlaps: coverageOverlaps(changedEvidence),
  failedRegionIds,
  incompleteStageIds,
  generationComplete,
 };
 const complete = Object.entries(result).every(
  ([key, value]) =>
   key === "generationComplete"
    ? value === true
    : key === "supportingEvidenceIds"
      ? true
    : Array.isArray(value) && value.length === 0,
 );
 return {
  ...result,
  complete,
 };
}

export function calculateUltraReviewProgress(
 artifact: UltraReviewArtifact,
 mode: UltraReviewSession["mode"],
): UltraReviewProgress {
 const session = artifact.sessions[mode];
 const documentReviewed = session.reviewCompletedAt !== undefined;
 const acknowledgedMechanicalChangeIds = new Set(
  session.acknowledgedMechanicalChangeIds.filter(
   (id) =>
    artifact.mechanicalChanges.some(
     (mechanical) => mechanical.id === id,
    ),
  ),
 );
 const coverage = new Map(
  artifact.coverage.map(
   (entry) => [entry.evidenceId, entry],
  ),
 );
 const changedEvidence = artifact.evidence.filter(
  (evidence) => evidence.kind === "changed",
 );
 const coveredChangedEvidence = changedEvidence.filter(
  (evidence) => {
   const entry = coverage.get(evidence.id);
   if (!entry) return false;
   if (entry.assignment.kind === "beat") {
    return documentReviewed;
   }
   if (entry.assignment.kind === "mechanical") {
    return acknowledgedMechanicalChangeIds.has(
     entry.assignment.mechanicalChangeId,
    );
   }
   return false;
  },
 ).length;
 const audit = auditUltraReviewCoverage(artifact);
 const progress = {
  documentReviewed,
  acknowledgedMechanicalChanges:
   acknowledgedMechanicalChangeIds.size,
  totalMechanicalChanges:
   artifact.mechanicalChanges.length,
  coveredChangedEvidence,
  totalChangedEvidence: changedEvidence.length,
  failedRegions: audit.failedRegionIds.length,
  unmappedEvidence: audit.unmappedEvidenceIds.length,
 };
 return {
  ...progress,
  fullyReviewed:
   audit.complete &&
   progress.documentReviewed &&
   progress.acknowledgedMechanicalChanges ===
    progress.totalMechanicalChanges &&
   progress.coveredChangedEvidence ===
    progress.totalChangedEvidence,
 };
}

function sameEvidenceLocation(
 before: UltraReviewEvidence,
 after: UltraReviewEvidence,
): boolean {
 const pathMatches =
  before.location.path === after.location.path ||
  before.location.path === after.location.oldPath ||
  before.location.oldPath === after.location.path;
 return (
  before.kind === after.kind &&
  pathMatches &&
  before.location.side === after.location.side &&
  before.location.startLine === after.location.startLine &&
  before.location.endLine === after.location.endLine
 );
}

function sameEvidenceContent(
 before: UltraReviewEvidence,
 after: UltraReviewEvidence,
): boolean {
 const pathMatches =
  before.location.path === after.location.path ||
  before.location.path === after.location.oldPath ||
  before.location.oldPath === after.location.path;
 return (
  before.kind === after.kind &&
  before.change === after.change &&
  pathMatches &&
  before.location.side === after.location.side &&
  before.fingerprint === after.fingerprint
 );
}

function sameStringSet(
 left: string[],
 right: string[],
): boolean {
 if (left.length !== right.length) return false;
 const rightSet = new Set(right);
 return left.every((value) => rightSet.has(value));
}

export function calculateUltraReviewDelta(
 before: UltraReviewArtifact,
 after: UltraReviewArtifact,
): UltraReviewDelta {
 if (
  before.identity.repo !== after.identity.repo ||
  before.identity.prNumber !== after.identity.prNumber
 ) {
  throw new UltraReviewValidationError(
   "UltraReview continuation requires the same repository and pull request",
  );
 }
 const beforeById = new Map(
  before.evidence.map(
   (evidence) => [evidence.id, evidence],
  ),
 );
 const afterById = new Map(
  after.evidence.map(
   (evidence) => [evidence.id, evidence],
  ),
 );
 const exactUnchangedEvidenceIds = after.evidence
  .filter((evidence) => beforeById.has(evidence.id))
  .map((evidence) => evidence.id);
 const unchanged = new Set(exactUnchangedEvidenceIds);
 const unmatchedBefore = before.evidence.filter(
  (evidence) => !unchanged.has(evidence.id),
 );
 const unmatchedAfter = after.evidence.filter(
  (evidence) => !unchanged.has(evidence.id),
 );
 const reanchoredBeforeIds = new Set<string>();
 const reanchoredAfterIds = new Set<string>();
 const reanchoredEvidence:
  UltraReviewDelta["reanchoredEvidence"] = [];
 for (const beforeEvidence of unmatchedBefore) {
  const candidates = unmatchedAfter.filter(
   (candidate) =>
    !reanchoredAfterIds.has(candidate.id) &&
    sameEvidenceContent(beforeEvidence, candidate),
  );
  if (candidates.length !== 1) continue;
  const candidate = candidates[0];
  const reverseCandidates = unmatchedBefore.filter(
   (possibleBefore) =>
    !reanchoredBeforeIds.has(possibleBefore.id) &&
    sameEvidenceContent(possibleBefore, candidate),
  );
  if (reverseCandidates.length !== 1) continue;
  reanchoredBeforeIds.add(beforeEvidence.id);
  reanchoredAfterIds.add(candidate.id);
  reanchoredEvidence.push({
   beforeEvidenceId: beforeEvidence.id,
   afterEvidenceId: candidate.id,
  });
 }
 const matchedAfter = new Set<string>();
 const changedEvidence: UltraReviewDelta["changedEvidence"] =
  [];
 for (const beforeEvidence of unmatchedBefore) {
  if (reanchoredBeforeIds.has(beforeEvidence.id)) {
   continue;
  }
  const afterEvidence = unmatchedAfter.find(
   (candidate) =>
    !reanchoredAfterIds.has(candidate.id) &&
    !matchedAfter.has(candidate.id) &&
    sameEvidenceLocation(beforeEvidence, candidate),
  );
  if (!afterEvidence) continue;
  matchedAfter.add(afterEvidence.id);
  changedEvidence.push({
   beforeEvidenceId: beforeEvidence.id,
   afterEvidenceId: afterEvidence.id,
  });
 }
 const changedBeforeIds = new Set(
  changedEvidence.map(
   (pair) => pair.beforeEvidenceId,
  ),
 );
 const changedAfterIds = new Set(
  changedEvidence.map(
   (pair) => pair.afterEvidenceId,
  ),
 );
 const removedEvidenceIds = unmatchedBefore
  .filter(
   (evidence) =>
    !changedBeforeIds.has(evidence.id) &&
    !reanchoredBeforeIds.has(evidence.id),
  )
  .map((evidence) => evidence.id);
 const addedEvidenceIds = unmatchedAfter
  .filter(
   (evidence) =>
    !changedAfterIds.has(evidence.id) &&
    !reanchoredAfterIds.has(evidence.id),
  )
  .map((evidence) => evidence.id);
 const unchangedEvidenceIds = [
  ...exactUnchangedEvidenceIds,
  ...reanchoredEvidence.map(
   (pair) => pair.afterEvidenceId,
  ),
 ];
 const reanchoredId = new Map(
  reanchoredEvidence.map(
   (pair) => [
    pair.beforeEvidenceId,
    pair.afterEvidenceId,
   ],
  ),
 );
 const baseChanged =
  before.identity.baseSha !== after.identity.baseSha;
 const affectedBeforeEvidenceIds = new Set(
  baseChanged
   ? before.evidence.map((evidence) => evidence.id)
   : [
      ...removedEvidenceIds,
      ...changedBeforeIds,
     ],
 );
 const afterBeatById = new Map(
  beats(after.galaxy.systems).map(
   (beat) => [beat.id, beat],
  ),
 );
 const invalidatedBeatIds = beats(before.galaxy.systems)
  .filter((beat) => {
   if (baseChanged) return true;
   if (
    beat.evidenceIds.some(
     (id) => affectedBeforeEvidenceIds.has(id),
   )
   ) {
    return true;
   }
   const afterBeat = afterBeatById.get(beat.id);
   return (
    afterBeat === undefined ||
    !sameStringSet(
     beat.evidenceIds.map(
      (id) => reanchoredId.get(id) ?? id,
     ),
     afterBeat.evidenceIds,
    )
   );
  })
  .map((beat) => beat.id);
 const invalidatedBeats = new Set(invalidatedBeatIds);
 const staleNoteIds = uniqueStrings(
  (
   [
    ...before.sessions.teammate.notes,
    ...before.sessions.author.notes,
   ]
  )
   .filter((note) => {
    if (note.anchor.kind === "beat") {
     return invalidatedBeats.has(note.anchor.beatId);
    }
    return note.anchor.evidenceIds.some((evidenceId) =>
     affectedBeforeEvidenceIds.has(evidenceId)
    );
   })
   .map((note) => note.id),
 );
 return {
  fromBaseSha: before.identity.baseSha,
  fromHeadSha: before.identity.headSha,
  toBaseSha: after.identity.baseSha,
  toHeadSha: after.identity.headSha,
  baseChanged,
  addedEvidenceIds,
  removedEvidenceIds,
  changedEvidence,
  reanchoredEvidence,
  unchangedEvidenceIds,
  invalidatedBeatIds,
  staleNoteIds,
 };
}

function cloned<Value>(value: Value): Value {
 return structuredClone(value);
}

function mergedById<Value extends { id: string }>(
 first: Value[],
 second: Value[],
): Value[] {
 const values = new Map<string, Value>();
 for (const value of first) {
  values.set(value.id, cloned(value));
 }
 for (const value of second) {
  if (!values.has(value.id)) {
   values.set(value.id, cloned(value));
  }
 }
 return [...values.values()];
}

export function continueUltraReviewArtifact(
 before: UltraReviewArtifact,
 after: UltraReviewArtifact,
): UltraReviewContinuation {
 const delta = calculateUltraReviewDelta(before, after);
 const artifact = cloned(after);
 const invalidatedBeatIds = new Set(
  delta.invalidatedBeatIds,
 );
 const unchangedEvidenceIds = new Set(
  delta.baseChanged
   ? []
   : delta.unchangedEvidenceIds,
 );
 const reanchoredEvidenceIds = new Map(
  delta.baseChanged
   ? []
   : delta.reanchoredEvidence.map(
      (pair) => [
       pair.beforeEvidenceId,
       pair.afterEvidenceId,
      ],
     ),
 );
 const translatedEvidenceId = (id: string): string =>
  reanchoredEvidenceIds.get(id) ?? id;
 const currentEvidenceById = new Map(
  artifact.evidence.map(
   (evidence) => [evidence.id, evidence],
  ),
 );
 const previousEvidenceById = new Map(
  before.evidence.map(
   (evidence) => [evidence.id, evidence],
  ),
 );
 const staleNoteIds = new Set(delta.staleNoteIds);
 const currentBeats = beats(artifact.galaxy.systems);
 const currentBeatById = new Map(
  currentBeats.map((beat) => [beat.id, beat]),
 );
 const currentMechanicalById = new Map(
  artifact.mechanicalChanges.map(
   (mechanical) => [mechanical.id, mechanical],
  ),
 );
 const previousMechanicalById = new Map(
  before.mechanicalChanges.map(
   (mechanical) => [mechanical.id, mechanical],
  ),
 );
 const currentConcernIds = new Set(
  artifact.concerns.map((concern) => concern.id),
 );

 for (
  const mode of ["teammate", "author"] as const
 ) {
  const previousSession = before.sessions[mode];
  const session = artifact.sessions[mode];
  delete session.reviewCompletedAt;
  session.acknowledgedMechanicalChangeIds =
   previousSession.acknowledgedMechanicalChangeIds
    .filter((id) => {
     const previousMechanical =
      previousMechanicalById.get(id);
     const currentMechanical =
      currentMechanicalById.get(id);
     return (
      previousMechanical !== undefined &&
      currentMechanical !== undefined &&
      sameStringSet(
       previousMechanical.evidenceIds.map(
        translatedEvidenceId,
       ),
       currentMechanical.evidenceIds,
      ) &&
      currentMechanical.evidenceIds.every(
       (evidenceId) =>
        unchangedEvidenceIds.has(evidenceId),
      )
     );
    });
  session.concernDispositions = Object.fromEntries(
   Object.entries(
    previousSession.concernDispositions,
   ).filter(
    ([concernId]) =>
     currentConcernIds.has(concernId),
   ),
  );
  session.notes = mergedById(
   previousSession.notes.map((note) => {
    if (note.anchor.kind === "beat") {
     return {
      ...note,
      stale:
       note.stale ||
       staleNoteIds.has(note.id),
     };
    }
    const anchor = note.anchor;
    const evidenceIds = anchor.evidenceIds.map(
     translatedEvidenceId,
    );
    const reanchored = evidenceIds.some(
     (id, index) => id !== anchor.evidenceIds[index],
    );
    if (!reanchored) {
     return {
      ...note,
      stale: note.stale || staleNoteIds.has(note.id),
     };
    }
    const pairs = anchor.evidenceIds.map(
     (previousId, index) => ({
      previous: previousEvidenceById.get(previousId),
      current: currentEvidenceById.get(evidenceIds[index]),
     }),
    );
    const offsets = pairs.map(({ previous, current }) =>
     previous?.location.startLine === null
     || previous?.location.startLine === undefined
     || current?.location.startLine === null
     || current?.location.startLine === undefined
      ? null
      : current.location.startLine - previous.location.startLine
    );
    const offset = offsets[0];
    if (
     offset === null
     || !pairs.every(({ previous, current }, index) =>
      previous !== undefined
      && current !== undefined
      && previous.location.startLine !== null
      && previous.location.endLine !== null
      && current.location.startLine !== null
      && current.location.endLine !== null
      && previous.location.path === anchor.path
      && previous.location.side === anchor.side
      && current.location.path === anchor.path
      && current.location.side === anchor.side
      && previous.location.endLine - previous.location.startLine
       === current.location.endLine - current.location.startLine
      && offsets[index] === offset
     )
    ) {
     return {
      ...note,
      stale: true,
     };
    }
    return {
     ...note,
     stale: note.stale,
     anchor: {
      kind: "line" as const,
      evidenceIds,
      path: anchor.path,
      side: anchor.side,
      startLine: anchor.startLine + offset,
      endLine: anchor.endLine + offset,
      headSha: artifact.identity.headSha,
     },
    };
   }),
   session.notes,
  );
  session.answers = mergedById(
   previousSession.answers.map((answer) => {
    const citationIds = answer.citationIds.map(
     translatedEvidenceId,
    );
    const reanchored = citationIds.some(
     (id, index) => id !== answer.citationIds[index],
    );
    return {
     ...answer,
     citationIds,
     headSha: reanchored
      ? artifact.identity.headSha
      : answer.headSha,
     stale:
      answer.stale ||
      delta.baseChanged ||
      invalidatedBeatIds.has(answer.beatId) ||
      citationIds.some(
       (id) => !unchangedEvidenceIds.has(id),
      ),
    };
   }),
   session.answers,
  );
  session.draft =
   before.identity.headSha === after.identity.headSha
    ? cloned(previousSession.draft)
    : null;
  session.snapshots = mergedById(
   previousSession.snapshots,
   session.snapshots,
  );
  if (
   before.identity.headSha === after.identity.headSha &&
   previousSession.authorOutcome !== undefined &&
   previousSession.authorCompletedAt !== undefined
  ) {
   session.authorOutcome = previousSession.authorOutcome;
   session.authorCompletedAt =
    previousSession.authorCompletedAt;
  } else {
   delete session.authorOutcome;
   delete session.authorCompletedAt;
  }

  const previousResumeBeatId =
   previousSession.resume.beatId;
  if (
   previousResumeBeatId !== null &&
   currentBeatById.has(previousResumeBeatId) &&
   !invalidatedBeatIds.has(previousResumeBeatId)
  ) {
   session.resume = {
    ...cloned(previousSession.resume),
    expandedEvidenceIds:
     previousSession.resume.expandedEvidenceIds
      .map(translatedEvidenceId)
      .filter(
       (id) => unchangedEvidenceIds.has(id),
      ),
   };
  }
 }
 return {
  artifact,
  delta,
 };
}
