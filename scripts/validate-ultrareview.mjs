#!/usr/bin/env node

import { readFileSync } from "node:fs";

const RISK_VALUES = [
 "none",
 "low",
 "medium",
 "high",
];
const SOURCE_KIND_VALUES = [
 "author_stated",
 "code_observed",
 "ci_observed",
 "existing_feedback",
 "commit_history",
 "timeline_event",
 "model_inference",
 "predicted_behavior",
];
const EVIDENCE_KIND_VALUES = [
 "changed",
 "supporting",
];
const EVIDENCE_CHANGE_VALUES = [
 "addition",
 "deletion",
 "modification",
 "rename",
 "binary",
 "whitespace",
 "context",
];
const EVIDENCE_SIDE_VALUES = [
 "LEFT",
 "RIGHT",
];
const GENERATION_STATUS_VALUES = [
 "running",
 "partial",
 "complete",
 "failed",
];
const GENERATION_STAGE_STATUS_VALUES = [
 "pending",
 "running",
 "complete",
 "failed",
];
const FAILURE_SCOPE_VALUES = [
 "artifact",
 "system",
 "chapter",
];
const SEVERITY_VALUES = [
 "blocker",
 "major",
 "minor",
 "nit",
];

function invalid(path, expected) {
 throw new Error(`${path} must be ${expected}`);
}

function objectValue(value, path) {
 if (
  value === null
  || typeof value !== "object"
  || Array.isArray(value)
 ) {
  invalid(path, "an object");
 }
 return value;
}

function arrayValue(value, path) {
 if (!Array.isArray(value)) {
  invalid(path, "an array");
 }
 return value;
}

function stringValue(value, path) {
 if (typeof value !== "string" || value.length === 0) {
  invalid(path, "a non-empty string");
 }
 return value;
}

function optionalStringValue(value, path) {
 if (value === undefined) return undefined;
 return stringValue(value, path);
}

function nullableStringValue(value, path) {
 if (value === null) return null;
 return stringValue(value, path);
}

function integerValue(value, path, minimum = 0) {
 if (
  !Number.isInteger(value)
  || value < minimum
 ) {
  invalid(path, `an integer no less than ${minimum}`);
 }
 return value;
}

function booleanValue(value, path) {
 if (typeof value !== "boolean") {
  invalid(path, "a boolean");
 }
 return value;
}

function enumValue(value, path, values) {
 if (
  typeof value !== "string"
  || !values.includes(value)
 ) {
  invalid(path, `one of ${values.join(", ")}`);
 }
 return value;
}

function stringArrayValue(value, path) {
 return arrayValue(value, path).map(
  (entry, index) =>
   stringValue(entry, `${path}[${index}]`),
 );
}

function nullableLineValue(value, path) {
 if (value === null) return null;
 return integerValue(value, path, 1);
}

function confidenceValue(value, path) {
 if (value === undefined) return;
 if (
  typeof value !== "number"
  || !Number.isFinite(value)
  || value < 0
  || value > 100
 ) {
  invalid(path, "a number from 0 through 100");
 }
}

function stableHash(value) {
 let hash = 0xcbf29ce484222325n;
 const prime = 0x100000001b3n;
 for (const character of value) {
  hash ^= BigInt(character.codePointAt(0) ?? 0);
  hash = BigInt.asUintN(64, hash * prime);
 }
 return hash.toString(16).padStart(16, "0");
}

function stableEvidenceId(evidence) {
 const location = evidence.location;
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
 return `evidence:${stableHash(JSON.stringify(parts))}`;
}

function parseLocation(value, path) {
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
  ),
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

function evidenceIdentity(value, path) {
 const evidence = objectValue(value, path);
 return {
  id: stringValue(evidence.id, `${path}.id`),
  kind: enumValue(
   evidence.kind,
   `${path}.kind`,
   EVIDENCE_KIND_VALUES,
  ),
  change: enumValue(
   evidence.change,
   `${path}.change`,
   EVIDENCE_CHANGE_VALUES,
  ),
  location: parseLocation(
   evidence.location,
   `${path}.location`,
  ),
  fingerprint: stringValue(
   evidence.fingerprint,
   `${path}.fingerprint`,
  ),
 };
}

function sameEvidenceIdentity(left, right) {
 return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueIds(values, path) {
 const ids = new Set();
 for (
  let index = 0;
  index < values.length;
  index += 1
 ) {
  const id = stringValue(
   values[index].id,
   `${path}[${index}].id`,
  );
  if (ids.has(id)) {
   throw new Error(
    `${path}[${index}].id duplicates ${id}`,
   );
  }
  ids.add(id);
 }
 return ids;
}

function requireReference(ids, id, path) {
 if (ids.has(id)) return;
 throw new Error(`${path} references unknown ${id}`);
}

function validateAnalysis(
 rawAnalysis,
 trustedEvidence,
) {
 const analysis = objectValue(
  rawAnalysis,
  "analysis",
 );
 if (analysis.version !== 1) {
  throw new Error(
   `analysis.version ${String(analysis.version)} is unsupported`,
  );
 }
 stringValue(analysis.thesis, "analysis.thesis");
 const analysisSourceClaimIds = stringArrayValue(
  analysis.sourceClaimIds,
  "analysis.sourceClaimIds",
 );
 const systems = arrayValue(
  analysis.systems,
  "analysis.systems",
 );
 const evidence = arrayValue(
  analysis.evidence,
  "analysis.evidence",
 );
 const coverage = arrayValue(
  analysis.coverage,
  "analysis.coverage",
 );
 const mechanicalChanges = arrayValue(
  analysis.mechanicalChanges,
  "analysis.mechanicalChanges",
 );
 const sourceClaims = arrayValue(
  analysis.sourceClaims,
  "analysis.sourceClaims",
 );
 const concerns = arrayValue(
  analysis.concerns,
  "analysis.concerns",
 );
 const generation = objectValue(
  analysis.generation,
  "analysis.generation",
 );

 const trustedById = new Map(
  trustedEvidence.map(
   (entry, index) => {
    const identity = evidenceIdentity(
     entry,
     `context.evidenceInventory[${index}]`,
    );
    return [identity.id, identity];
   },
  ),
 );
 for (
  let index = 0;
  index < evidence.length;
  index += 1
 ) {
  const path = `analysis.evidence[${index}]`;
  const raw = objectValue(evidence[index], path);
  const identity = evidenceIdentity(raw, path);
  const trusted = trustedById.get(identity.id);
  if (
   trusted !== undefined
   && !sameEvidenceIdentity(identity, trusted)
  ) {
   throw new Error(`${path} must match trusted evidence`);
  }
  if (
   identity.kind === "changed"
   && trusted === undefined
  ) {
   throw new Error(
    `${path}.id references unknown trusted evidence ${identity.id}`,
   );
  }
  const sourceIds = stringArrayValue(
   raw.sourceClaimIds,
   `${path}.sourceClaimIds`,
  );
  const supportingReason = optionalStringValue(
   raw.supportingReason,
   `${path}.supportingReason`,
  );
  const lineFree =
   identity.change === "binary"
   || identity.change === "rename";
  if (
   lineFree
   && (
    identity.location.startLine !== null
    || identity.location.endLine !== null
   )
  ) {
   invalid(`${path}.location`, "line-free");
  }
  if (
   !lineFree
   && (
    identity.location.startLine === null
    || identity.location.endLine === null
   )
  ) {
   invalid(`${path}.location`, "a complete line range");
  }
  if (
   identity.location.startLine !== null
   && identity.location.endLine !== null
   && identity.location.startLine >
    identity.location.endLine
  ) {
   invalid(
    `${path}.location`,
    "a range whose startLine is not after endLine",
   );
  }
  if (
   identity.change === "rename"
   && identity.location.oldPath === undefined
  ) {
   invalid(
    `${path}.location.oldPath`,
    "present for rename evidence",
   );
  }
  if (
   identity.kind === "supporting"
   && (
    identity.change !== "context"
    || supportingReason === undefined
   )
  ) {
   invalid(path, "context evidence with a supportingReason");
  }
  if (
   identity.kind === "changed"
   && identity.change === "context"
  ) {
   invalid(path, "changed rather than context evidence");
  }
  const expectedId = stableEvidenceId(identity);
  if (identity.id !== expectedId) {
   throw new Error(
    `${path}.id must equal ${expectedId}`,
   );
  }
  evidence[index] = {
   ...identity,
   sourceClaimIds: sourceIds,
  };
 }

 const chapters = [];
 const beats = [];
 for (
  let systemIndex = 0;
  systemIndex < systems.length;
  systemIndex += 1
 ) {
  const systemPath = `analysis.systems[${systemIndex}]`;
  const system = objectValue(
   systems[systemIndex],
   systemPath,
  );
  stringValue(system.id, `${systemPath}.id`);
  stringValue(system.title, `${systemPath}.title`);
  stringValue(system.thesis, `${systemPath}.thesis`);
  integerValue(system.order, `${systemPath}.order`);
  enumValue(system.risk, `${systemPath}.risk`, RISK_VALUES);
  confidenceValue(
   system.confidence,
   `${systemPath}.confidence`,
  );
  stringArrayValue(
   system.sourceClaimIds,
   `${systemPath}.sourceClaimIds`,
  );
  const scope = objectValue(
   system.scope,
   `${systemPath}.scope`,
  );
  integerValue(
   scope.changedLines,
   `${systemPath}.scope.changedLines`,
  );
  integerValue(
   scope.files,
   `${systemPath}.scope.files`,
  );
  const systemChapters = arrayValue(
   system.chapters,
   `${systemPath}.chapters`,
  );
  for (
   let chapterIndex = 0;
   chapterIndex < systemChapters.length;
   chapterIndex += 1
  ) {
   const chapterPath =
    `${systemPath}.chapters[${chapterIndex}]`;
   const chapter = objectValue(
    systemChapters[chapterIndex],
    chapterPath,
   );
   stringValue(chapter.id, `${chapterPath}.id`);
   stringValue(chapter.title, `${chapterPath}.title`);
   stringValue(chapter.purpose, `${chapterPath}.purpose`);
   stringValue(chapter.before, `${chapterPath}.before`);
   stringValue(chapter.after, `${chapterPath}.after`);
   integerValue(chapter.order, `${chapterPath}.order`);
   enumValue(
    chapter.risk,
    `${chapterPath}.risk`,
    RISK_VALUES,
   );
   confidenceValue(
    chapter.confidence,
    `${chapterPath}.confidence`,
   );
   stringArrayValue(
    chapter.sourceClaimIds,
    `${chapterPath}.sourceClaimIds`,
   );
   stringArrayValue(
    chapter.dependencyChapterIds,
    `${chapterPath}.dependencyChapterIds`,
   );
   if (chapter.kind !== undefined) {
    enumValue(
     chapter.kind,
     `${chapterPath}.kind`,
     [
      "narrative",
      "mechanical",
      "delta",
      "unmapped",
     ],
    );
   }
   const chapterBeats = arrayValue(
    chapter.beats,
    `${chapterPath}.beats`,
   );
   for (
    let beatIndex = 0;
    beatIndex < chapterBeats.length;
    beatIndex += 1
   ) {
    const beatPath =
     `${chapterPath}.beats[${beatIndex}]`;
    const beat = objectValue(
     chapterBeats[beatIndex],
     beatPath,
    );
    stringValue(beat.id, `${beatPath}.id`);
    stringValue(beat.title, `${beatPath}.title`);
    stringValue(beat.claim, `${beatPath}.claim`);
    stringValue(beat.objective, `${beatPath}.objective`);
    nullableStringValue(
     beat.question,
     `${beatPath}.question`,
    );
    integerValue(beat.order, `${beatPath}.order`);
    enumValue(
     beat.risk,
     `${beatPath}.risk`,
     RISK_VALUES,
    );
    confidenceValue(
     beat.confidence,
     `${beatPath}.confidence`,
    );
    stringArrayValue(
     beat.evidenceIds,
     `${beatPath}.evidenceIds`,
    );
    stringArrayValue(
     beat.sourceClaimIds,
     `${beatPath}.sourceClaimIds`,
    );
    if (beat.removedEvidenceIds !== undefined) {
     stringArrayValue(
      beat.removedEvidenceIds,
      `${beatPath}.removedEvidenceIds`,
     );
    }
    beats.push(beat);
   }
   chapters.push({
    ...chapter,
    systemId: system.id,
   });
  }
 }

 for (
  let index = 0;
  index < mechanicalChanges.length;
  index += 1
 ) {
  const path = `analysis.mechanicalChanges[${index}]`;
  const mechanical = objectValue(
   mechanicalChanges[index],
   path,
  );
  stringValue(mechanical.id, `${path}.id`);
  stringValue(mechanical.title, `${path}.title`);
  stringValue(mechanical.reason, `${path}.reason`);
  stringArrayValue(
   mechanical.evidenceIds,
   `${path}.evidenceIds`,
  );
 }

 for (
  let index = 0;
  index < sourceClaims.length;
  index += 1
 ) {
  const path = `analysis.sourceClaims[${index}]`;
  const source = objectValue(sourceClaims[index], path);
  stringValue(source.id, `${path}.id`);
  enumValue(
   source.kind,
   `${path}.kind`,
   SOURCE_KIND_VALUES,
  );
  stringValue(source.claim, `${path}.claim`);
  stringArrayValue(
   source.evidenceIds,
   `${path}.evidenceIds`,
  );
 }

 for (
  let index = 0;
  index < concerns.length;
  index += 1
 ) {
  const path = `analysis.concerns[${index}]`;
  const concern = objectValue(concerns[index], path);
  stringValue(concern.id, `${path}.id`);
  stringValue(concern.beatId, `${path}.beatId`);
  stringValue(concern.question, `${path}.question`);
  stringArrayValue(
   concern.evidenceIds,
   `${path}.evidenceIds`,
  );
  stringArrayValue(
   concern.sourceClaimIds,
   `${path}.sourceClaimIds`,
  );
  enumValue(
   concern.severity,
   `${path}.severity`,
   SEVERITY_VALUES,
  );
 }

 for (
  let index = 0;
  index < coverage.length;
  index += 1
 ) {
  const path = `analysis.coverage[${index}]`;
  const entry = objectValue(coverage[index], path);
  stringValue(entry.evidenceId, `${path}.evidenceId`);
  const assignment = objectValue(
   entry.assignment,
   `${path}.assignment`,
  );
  const kind = enumValue(
   assignment.kind,
   `${path}.assignment.kind`,
   [
    "beat",
    "mechanical",
    "unmapped",
   ],
  );
  if (kind === "beat") {
   stringValue(
    assignment.beatId,
    `${path}.assignment.beatId`,
   );
  } else if (kind === "mechanical") {
   stringValue(
    assignment.mechanicalChangeId,
    `${path}.assignment.mechanicalChangeId`,
   );
  } else {
   stringValue(
    assignment.reason,
    `${path}.assignment.reason`,
   );
  }
 }

 const generationStatus = enumValue(
  generation.status,
  "analysis.generation.status",
  GENERATION_STATUS_VALUES,
 );
 const stages = arrayValue(
  generation.stages,
  "analysis.generation.stages",
 );
 const failures = arrayValue(
  generation.failures,
  "analysis.generation.failures",
 );
 for (
  let index = 0;
  index < stages.length;
  index += 1
 ) {
  const path = `analysis.generation.stages[${index}]`;
  const stage = objectValue(stages[index], path);
  stringValue(stage.id, `${path}.id`);
  stringValue(stage.label, `${path}.label`);
  enumValue(
   stage.status,
   `${path}.status`,
   GENERATION_STAGE_STATUS_VALUES,
  );
  nullableStringValue(stage.systemId, `${path}.systemId`);
  nullableStringValue(stage.error, `${path}.error`);
 }
 for (
  let index = 0;
  index < failures.length;
  index += 1
 ) {
  const path = `analysis.generation.failures[${index}]`;
  const failure = objectValue(failures[index], path);
  stringValue(failure.id, `${path}.id`);
  stringValue(failure.stageId, `${path}.stageId`);
  const scope = enumValue(
   failure.scope,
   `${path}.scope`,
   FAILURE_SCOPE_VALUES,
  );
  const systemId = nullableStringValue(
   failure.systemId,
   `${path}.systemId`,
  );
  const chapterId = nullableStringValue(
   failure.chapterId,
   `${path}.chapterId`,
  );
  stringValue(failure.message, `${path}.message`);
  booleanValue(failure.retryable, `${path}.retryable`);
  stringArrayValue(
   failure.evidenceIds,
   `${path}.evidenceIds`,
  );
  if (
   scope === "artifact"
   && (systemId !== null || chapterId !== null)
  ) {
   invalid(
    path,
    "an artifact failure without system or chapter ids",
   );
  }
  if (scope === "system" && systemId === null) {
   invalid(`${path}.systemId`, "present");
  }
  if (scope === "system" && chapterId !== null) {
   invalid(`${path}.chapterId`, "null");
  }
  if (
   scope === "chapter"
   && (systemId === null || chapterId === null)
  ) {
   invalid(
    path,
    "a chapter failure with system and chapter ids",
   );
  }
 }

 const systemIds = uniqueIds(
  systems,
  "analysis.systems",
 );
 const chapterIds = uniqueIds(
  chapters,
  "analysis.chapters",
 );
 const beatIds = uniqueIds(
  beats,
  "analysis.beats",
 );
 const evidenceIds = uniqueIds(
  evidence,
  "analysis.evidence",
 );
 const sourceClaimIds = uniqueIds(
  sourceClaims,
  "analysis.sourceClaims",
 );
 const mechanicalChangeIds = uniqueIds(
  mechanicalChanges,
  "analysis.mechanicalChanges",
 );
 uniqueIds(concerns, "analysis.concerns");
 const stageIds = uniqueIds(
  stages,
  "analysis.generation.stages",
 );
 uniqueIds(
  failures,
  "analysis.generation.failures",
 );
 const stageById = new Map(
  stages.map((stage) => [stage.id, stage]),
 );
 const chapterById = new Map(
  chapters.map(
   (chapter) => [chapter.id, chapter],
  ),
 );

 if (
  analysisSourceClaimIds.length === 0
  && !(
   systems.length === 0
   && generationStatus !== "complete"
  )
 ) {
  invalid(
   "analysis.sourceClaimIds",
   "non-empty for the pull request thesis",
  );
 }
 analysisSourceClaimIds.forEach(
  (id, index) =>
   requireReference(
    sourceClaimIds,
    id,
    `analysis.sourceClaimIds[${index}]`,
   ),
 );

 systems.forEach((system, systemIndex) => {
  const systemPath = `analysis.systems[${systemIndex}]`;
  if (system.sourceClaimIds.length === 0) {
   invalid(
    `${systemPath}.sourceClaimIds`,
    "non-empty for the system thesis",
   );
  }
  system.sourceClaimIds.forEach(
   (id, index) =>
    requireReference(
     sourceClaimIds,
     id,
     `${systemPath}.sourceClaimIds[${index}]`,
    ),
  );
  system.chapters.forEach((chapter, chapterIndex) => {
   const chapterPath =
    `${systemPath}.chapters[${chapterIndex}]`;
   if (chapter.sourceClaimIds.length === 0) {
    invalid(
     `${chapterPath}.sourceClaimIds`,
     "non-empty for chapter assertions",
    );
   }
   chapter.sourceClaimIds.forEach(
    (id, index) =>
     requireReference(
      sourceClaimIds,
      id,
      `${chapterPath}.sourceClaimIds[${index}]`,
     ),
   );
   chapter.dependencyChapterIds.forEach(
    (id, index) =>
     requireReference(
      chapterIds,
      id,
      `${chapterPath}.dependencyChapterIds[${index}]`,
     ),
   );
   chapter.beats.forEach((beat, beatIndex) => {
    const beatPath =
     `${chapterPath}.beats[${beatIndex}]`;
    beat.evidenceIds.forEach(
     (id, index) =>
      requireReference(
       evidenceIds,
       id,
       `${beatPath}.evidenceIds[${index}]`,
      ),
    );
    beat.sourceClaimIds.forEach(
     (id, index) =>
      requireReference(
       sourceClaimIds,
       id,
       `${beatPath}.sourceClaimIds[${index}]`,
      ),
    );
   });
  });
 });

 evidence.forEach((entry, evidenceIndex) => {
  entry.sourceClaimIds.forEach(
   (id, index) =>
    requireReference(
     sourceClaimIds,
     id,
     `analysis.evidence[${evidenceIndex}].sourceClaimIds[${index}]`,
    ),
  );
 });
 sourceClaims.forEach((source, sourceIndex) => {
  if (
   (
    source.kind === "code_observed"
    || source.kind === "predicted_behavior"
   )
   && source.evidenceIds.length === 0
  ) {
   invalid(
    `analysis.sourceClaims[${sourceIndex}].evidenceIds`,
    "non-empty for code-derived claims",
   );
  }
  source.evidenceIds.forEach(
   (id, index) =>
    requireReference(
     evidenceIds,
     id,
     `analysis.sourceClaims[${sourceIndex}].evidenceIds[${index}]`,
    ),
  );
 });
 coverage.forEach((entry, coverageIndex) => {
  const path = `analysis.coverage[${coverageIndex}]`;
  requireReference(
   evidenceIds,
   entry.evidenceId,
   `${path}.evidenceId`,
  );
  if (entry.assignment.kind === "beat") {
   requireReference(
    beatIds,
    entry.assignment.beatId,
    `${path}.assignment.beatId`,
   );
  }
  if (entry.assignment.kind === "mechanical") {
   requireReference(
    mechanicalChangeIds,
    entry.assignment.mechanicalChangeId,
    `${path}.assignment.mechanicalChangeId`,
   );
  }
 });
 mechanicalChanges.forEach((entry, mechanicalIndex) => {
  entry.evidenceIds.forEach(
   (id, index) =>
    requireReference(
     evidenceIds,
     id,
     `analysis.mechanicalChanges[${mechanicalIndex}].evidenceIds[${index}]`,
    ),
  );
 });
 concerns.forEach((concern, concernIndex) => {
  requireReference(
   beatIds,
   concern.beatId,
   `analysis.concerns[${concernIndex}].beatId`,
  );
  concern.evidenceIds.forEach(
   (id, index) =>
    requireReference(
     evidenceIds,
     id,
     `analysis.concerns[${concernIndex}].evidenceIds[${index}]`,
    ),
  );
  concern.sourceClaimIds.forEach(
   (id, index) =>
    requireReference(
     sourceClaimIds,
     id,
     `analysis.concerns[${concernIndex}].sourceClaimIds[${index}]`,
    ),
  );
 });
 stages.forEach((stage, stageIndex) => {
  if (stage.systemId === null) return;
  requireReference(
   systemIds,
   stage.systemId,
   `analysis.generation.stages[${stageIndex}].systemId`,
  );
 });
 failures.forEach((failure, failureIndex) => {
  const path = `analysis.generation.failures[${failureIndex}]`;
  requireReference(
   stageIds,
   failure.stageId,
   `${path}.stageId`,
  );
  const stage = stageById.get(failure.stageId);
  if (failure.systemId !== null) {
   requireReference(
    systemIds,
    failure.systemId,
    `${path}.systemId`,
   );
   if (stage.systemId !== failure.systemId) {
    throw new Error(
     `${path}.stageId must belong to ${failure.systemId}`,
    );
   }
  }
  if (failure.chapterId !== null) {
   requireReference(
    chapterIds,
    failure.chapterId,
    `${path}.chapterId`,
   );
   if (
    chapterById.get(failure.chapterId).systemId
    !== failure.systemId
   ) {
    throw new Error(
     `${path}.chapterId must belong to ${failure.systemId}`,
    );
   }
  } else if (
   failure.scope === "artifact"
   && stage.systemId !== null
  ) {
   throw new Error(
    `${path}.stageId must belong to the artifact`,
   );
  }
  failure.evidenceIds.forEach(
   (id, index) =>
    requireReference(
     evidenceIds,
     id,
     `${path}.evidenceIds[${index}]`,
    ),
  );
 });
}

function argument(name) {
 const index = process.argv.indexOf(name);
 if (index < 0 || index + 1 >= process.argv.length) {
  throw new Error(`Missing ${name} path.`);
 }
 return process.argv[index + 1];
}

try {
 const candidatePath = argument("--candidate");
 const contextPath = argument("--context");
 const context = objectValue(
  JSON.parse(readFileSync(contextPath, "utf8")),
  "context",
 );
 if (context.version !== 1) {
  throw new Error(
   `context.version ${String(context.version)} is unsupported`,
  );
 }
 const trustedEvidence = arrayValue(
  context.evidenceInventory,
  "context.evidenceInventory",
 );
 const candidate = JSON.parse(
  readFileSync(candidatePath, "utf8"),
 );
 validateAnalysis(candidate, trustedEvidence);
 process.stdout.write(
  "UltraReview artifact is valid.\n",
 );
} catch (error) {
 const message = error instanceof Error
  ? error.message
  : String(error);
 process.stderr.write(`UltraReview validation failed: ${message}\n`);
 process.exitCode = 1;
}
