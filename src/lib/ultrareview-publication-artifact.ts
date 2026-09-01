import type {
 UltraReviewAnalysisEvidence,
 UltraReviewArtifact,
 UltraReviewArtifactIdentity,
 UltraReviewConcern,
 UltraReviewCoverageEntry,
 UltraReviewEvidence,
 UltraReviewGeneration,
 UltraReviewGenerationFailure,
 UltraReviewMechanicalChange,
 UltraReviewSourceClaim,
 UltraReviewSystem,
} from "../types";
import {
 parseUltraReviewPublicationInput,
 UltraReviewPublicationInputError,
 ultraReviewPublicationPayloadLimit,
 type UltraReviewCompletionPublicationInput,
 type UltraReviewContextRangeInput,
 type UltraReviewPlanPublicationInput,
 type UltraReviewPublicationIssue,
 type UltraReviewPublicationToolName,
} from "./ultrareview-publication-contract";
import {
 parseUltraReviewAnalysisJson,
 stableUltraReviewEvidenceId,
 stableUltraReviewHash,
} from "./ultraReview";

type JsonObject = Record<string, unknown>;

export type UltraReviewHeadFileReader = (
 path: string,
) => Promise<string>;

export interface UltraReviewPlanPublicationReceipt {
 kind: "plan";
 systemIds: Record<string, string>;
 chapterIds: Record<string, string>;
}

export interface UltraReviewChapterPublicationReceipt {
 kind: "chapter";
 chapterKey: string;
 chapterId: string;
 beatIds: string[];
 supportingEvidenceIds: string[];
 sourceClaimIds: string[];
 concernIds: string[];
 mechanicalChangeIds: string[];
}

export interface UltraReviewCompletionPublicationReceipt {
 kind: "complete";
 status: "complete" | "partial";
}

export type UltraReviewPublicationReceipt =
 | UltraReviewPlanPublicationReceipt
 | UltraReviewChapterPublicationReceipt
 | UltraReviewCompletionPublicationReceipt;

export interface UltraReviewPublicationResult<
 Receipt extends UltraReviewPublicationReceipt,
> {
 artifact: UltraReviewArtifact;
 receipt: Receipt;
}

export class UltraReviewPublicationError extends Error {
 readonly issues: UltraReviewPublicationIssue[];

 constructor(issue: UltraReviewPublicationIssue) {
  super(issue.message);
  this.name = "UltraReviewPublicationError";
  this.issues = [issue];
 }
}

function publicationError(
 code: string,
 path: string,
 message: string,
 repair: string,
): never {
 throw new UltraReviewPublicationError({
  code,
  path,
  message,
  repair,
 });
}

export function ultraReviewPublicationIssues(
 error: unknown,
): UltraReviewPublicationIssue[] {
 if (
  error instanceof UltraReviewPublicationError
  || error instanceof UltraReviewPublicationInputError
 ) {
  return error.issues;
 }
 return [{
  code: "PUBLICATION_REJECTED",
  path: "",
  message: "Charon could not normalize this publication.",
  repair:
   "Use the exact tool schema and retry the call once. Charon owns stored ids, fingerprints, locations, source-claim references, ordering, and coverage.",
 }];
}

function jsonByteLength(value: unknown): number {
 return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function publicationInput<
 Name extends UltraReviewPublicationToolName,
>(
 name: Name,
 value: unknown,
) {
 const bytes = jsonByteLength(value);
 const limit = ultraReviewPublicationPayloadLimit(name);
 if (bytes > limit) {
  publicationError(
   "PAYLOAD_TOO_LARGE",
   "",
   `${name} is ${bytes} bytes; the limit is ${limit}.`,
   `Remove ${bytes - limit} bytes before retrying.`,
  );
 }
 return parseUltraReviewPublicationInput(name, value);
}

function uniqueStrings(values: readonly string[]): string[] {
 return [...new Set(values)];
}

function generatedId(
 prefix: string,
 parts: readonly unknown[],
): string {
 return `${prefix}:${stableUltraReviewHash(JSON.stringify(parts))}`;
}

export function ultraReviewPublicationSystemId(
 key: string,
): string {
 return `system:${key}`;
}

export function ultraReviewPublicationChapterId(
 key: string,
): string {
 return `chapter:${key}`;
}

export function ultraReviewPublicationChapterStageId(
 key: string,
): string {
 return ultraReviewPublicationChapterId(key);
}

function rawAnalysis(
 artifact: UltraReviewArtifact,
 generation: UltraReviewGeneration = artifact.generation,
): JsonObject {
 return {
  version: artifact.version,
  thesis: artifact.galaxy.thesis,
  sourceClaimIds: artifact.galaxy.sourceClaimIds,
  systems: artifact.galaxy.systems,
  evidence: artifact.evidence,
  coverage: artifact.coverage,
  mechanicalChanges: artifact.mechanicalChanges,
  sourceClaims: artifact.sourceClaims,
  concerns: artifact.concerns,
  generation,
 };
}

function planSourceClaims(
 input: UltraReviewPlanPublicationInput,
): UltraReviewSourceClaim[] {
 return input.grounding.map((grounding, index) => ({
  id: generatedId(
   "source",
   ["plan", index, grounding.kind, grounding.claim],
  ),
  kind: grounding.kind,
  claim: grounding.claim,
  evidenceIds: [],
 }));
}

function assertUniqueKey(
 seen: Set<string>,
 key: string,
 path: string,
 kind: string,
): void {
 if (seen.has(key)) {
  publicationError(
   "DUPLICATE_KEY",
   path,
   `${path} duplicates the ${kind} key ${key}.`,
   `Choose a unique ${kind} key.`,
  );
 }
 seen.add(key);
}

export function assembleUltraReviewPlanPublication(
 identity: UltraReviewArtifactIdentity,
 value: unknown,
 trustedEvidence: readonly UltraReviewAnalysisEvidence[],
): UltraReviewPublicationResult<UltraReviewPlanPublicationReceipt> {
 const input = publicationInput("publish_plan", value);
 const sourceClaims = planSourceClaims(input);
 const sourceClaimIds = sourceClaims.map((claim) => claim.id);
 const systemKeys = new Set<string>();
 const chapterKeys = new Set<string>();
 const systemIds: Record<string, string> = {};
 const chapterIds: Record<string, string> = {};
 const stages: UltraReviewGeneration["stages"] = [
  {
   id: "indexing-files",
   label: "Indexing files",
   status: "complete",
   systemId: null,
   error: null,
  },
  {
   id: "building-story",
   label: "Building story",
   status: "complete",
   systemId: null,
   error: null,
  },
 ];
 const systems = input.systems.map((plannedSystem, systemIndex) => {
  assertUniqueKey(
   systemKeys,
   plannedSystem.key,
   `systems[${systemIndex}].key`,
   "system",
  );
  const systemId = ultraReviewPublicationSystemId(
   plannedSystem.key,
  );
  systemIds[plannedSystem.key] = systemId;
  for (
   let chapterIndex = 0;
   chapterIndex < plannedSystem.chapters.length;
   chapterIndex += 1
  ) {
   const plannedChapter = plannedSystem.chapters[chapterIndex];
   assertUniqueKey(
    chapterKeys,
    plannedChapter.key,
    `systems[${systemIndex}].chapters[${chapterIndex}].key`,
    "chapter",
   );
   const chapterId = ultraReviewPublicationChapterId(
    plannedChapter.key,
   );
   chapterIds[plannedChapter.key] = chapterId;
   stages.push({
    id: ultraReviewPublicationChapterStageId(
     plannedChapter.key,
    ),
    label: `Chapter: ${plannedChapter.title}`,
    status: "pending",
    systemId,
    error: null,
   });
  }
  return {
   id: systemId,
   title: plannedSystem.title,
   thesis: plannedSystem.thesis,
   order: systemIndex,
   risk: plannedSystem.risk,
   sourceClaimIds,
   scope: { changedLines: 0, files: 0 },
   chapters: [],
  } satisfies UltraReviewSystem;
 });
 const generation: UltraReviewGeneration = {
  status: "running",
  stages,
  failures: [],
 };
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify({
   version: 1,
   thesis: input.thesis,
   sourceClaimIds,
   systems,
   evidence: [],
   coverage: [],
   mechanicalChanges: [],
   sourceClaims,
   concerns: [],
   generation,
  }),
  identity,
  trustedEvidence,
 );
 return {
  artifact,
  receipt: {
   kind: "plan",
   systemIds,
   chapterIds,
  },
 };
}

function plannedChapterTitle(
 stage: UltraReviewGeneration["stages"][number],
): string {
 const prefix = "Chapter: ";
 return stage.label.startsWith(prefix)
  ? stage.label.slice(prefix.length)
  : stage.label;
}

function chapterKeyFromId(id: string): string {
 return id.startsWith("chapter:")
  ? id.slice("chapter:".length)
  : id;
}

function sourceLines(content: string): string[] {
 if (content.length === 0) return [];
 const lines = content.split(/\r?\n/);
 if (lines[lines.length - 1] === "") lines.pop();
 return lines;
}

function assertRepositoryPath(
 path: string,
 field: string,
): void {
 const segments = path.split("/");
 if (
  path.startsWith("/")
  || path.includes("\\")
  || path.includes("\0")
  || segments.some(
   (segment) =>
    segment.length === 0
    || segment === "."
    || segment === "..",
  )
 ) {
  publicationError(
   "INVALID_REPOSITORY_PATH",
   field,
   `${field} must be a repository-relative path.`,
   "Use a slash-separated path from the review head, without empty, current-directory, or parent-directory segments.",
  );
 }
}

function rangesOverlap(
 leftStart: number,
 leftEnd: number,
 rightStart: number,
 rightEnd: number,
): boolean {
 return leftStart <= rightEnd && rightStart <= leftEnd;
}

function changedEvidenceInContext(
 trustedEvidence: readonly UltraReviewAnalysisEvidence[],
 context: UltraReviewContextRangeInput,
): UltraReviewAnalysisEvidence | undefined {
 return trustedEvidence.find((evidence) => {
  const { location } = evidence;
  return location.path === context.path
   && location.side === "RIGHT"
   && location.startLine !== null
   && location.endLine !== null
   && rangesOverlap(
    context.startLine,
    context.endLine,
    location.startLine,
    location.endLine,
   );
 });
}

function evidenceOwner(
 artifact: UltraReviewArtifact,
 evidenceId: string,
): string | null {
 for (const system of artifact.galaxy.systems) {
  for (const chapter of system.chapters) {
   if (
    chapter.beats.some((beat) =>
     beat.evidenceIds.includes(evidenceId)
    )
   ) {
    return chapterKeyFromId(chapter.id);
   }
  }
 }
 return null;
}

function headFileCandidates(
 path: string,
 trustedEvidence: readonly UltraReviewAnalysisEvidence[],
): string[] {
 const [firstSegment] = path.split("/");
 if (firstSegment === undefined) return [path];
 const marker = `/${firstSegment}/`;
 const candidates = [path];
 for (const evidence of trustedEvidence) {
  const changedPath = evidence.location.path;
  const markerIndex = changedPath.indexOf(marker);
  if (markerIndex < 0) continue;
  candidates.push(
   `${changedPath.slice(0, markerIndex + 1)}${path}`,
  );
 }
 return uniqueStrings(candidates);
}

async function readSupportingFile(
 path: string,
 issuePath: string,
 trustedEvidence: readonly UltraReviewAnalysisEvidence[],
 readHeadFile: UltraReviewHeadFileReader,
): Promise<{ path: string; content: string }> {
 for (const candidate of headFileCandidates(path, trustedEvidence)) {
  try {
   return {
    path: candidate,
    content: await readHeadFile(candidate),
   };
  } catch {
   // Try the same path under a repository subroot inferred from changed files.
  }
 }
 publicationError(
  "CONTEXT_FILE_NOT_FOUND",
  issuePath,
  `${path} could not be read at the review head.`,
  "Use a repository-root-relative path that exists at the supplied head SHA.",
 );
}

async function supportingEvidence(
 input: UltraReviewContextRangeInput,
 path: string,
 current: UltraReviewArtifact,
 trustedEvidence: readonly UltraReviewAnalysisEvidence[],
 readHeadFile: UltraReviewHeadFileReader,
): Promise<UltraReviewEvidence> {
 assertRepositoryPath(input.path, `${path}.path`);
 if (input.startLine > input.endLine) {
  publicationError(
   "INVALID_CONTEXT_RANGE",
   path,
   `${path}.endLine ${input.endLine} precedes startLine ${input.startLine}.`,
   "Use an inclusive range whose endLine is greater than or equal to startLine.",
  );
 }
 const requestedChanged = changedEvidenceInContext(
  trustedEvidence,
  input,
 );
 if (requestedChanged !== undefined) {
  publicationError(
   "CONTEXT_OVERLAPS_CHANGE",
   path,
   `${path} overlaps changed evidence ${requestedChanged.id}.`,
   "Put changed lines in changedEvidenceIds and narrow this context range to unchanged head-commit lines.",
  );
 }
 const resolved = await readSupportingFile(
  input.path,
  `${path}.path`,
  trustedEvidence,
  readHeadFile,
 );
 const normalizedInput = {
  ...input,
  path: resolved.path,
 };
 const changed = changedEvidenceInContext(
  trustedEvidence,
  normalizedInput,
 );
 if (changed !== undefined) {
  publicationError(
   "CONTEXT_OVERLAPS_CHANGE",
   path,
   `${path} overlaps changed evidence ${changed.id}.`,
   "Put changed lines in changedEvidenceIds and narrow this context range to unchanged head-commit lines.",
  );
 }
 const content = resolved.content;
 const lines = sourceLines(content);
 if (input.endLine > lines.length) {
  publicationError(
   "INVALID_CONTEXT_RANGE",
   path,
   `${resolved.path} has ${lines.length} lines at the review head; endLine ${input.endLine} is invalid.`,
   `Choose an inclusive range between lines 1 and ${lines.length}.`,
  );
 }
 const selected = lines.slice(
  input.startLine - 1,
  input.endLine,
 );
 const location = {
  path: resolved.path,
  side: "RIGHT" as const,
  startLine: input.startLine,
  endLine: input.endLine,
 };
 const fingerprint = stableUltraReviewHash(
  JSON.stringify(["context", selected]),
 );
 const evidence: UltraReviewEvidence = {
  id: stableUltraReviewEvidenceId({
   kind: "supporting",
   change: "context",
   location,
   fingerprint,
  }),
  kind: "supporting",
  change: "context",
  location,
  fingerprint,
  sourceClaimIds: [],
  supportingReason: input.reason,
 };
 if (current.evidence.some((item) => item.id === evidence.id)) {
  const owner = evidenceOwner(current, evidence.id);
  publicationError(
   "CONTEXT_ALREADY_ASSIGNED",
   path,
   owner === null
    ? "This context range is already published."
    : `This context range already belongs to chapter ${owner}.`,
   owner === null
    ? "Remove the repeated context range."
    : `Remove the repeated range and add ${owner} to dependencyChapterKeys when this chapter depends on it.`,
  );
 }
 return evidence;
}

function coverageOwner(
 artifact: UltraReviewArtifact,
 coverage: UltraReviewCoverageEntry,
): string {
 if (coverage.assignment.kind === "beat") {
  const beatId = coverage.assignment.beatId;
  for (const system of artifact.galaxy.systems) {
   for (const chapter of system.chapters) {
    if (
     chapter.beats.some(
      (beat) => beat.id === beatId,
     )
    ) {
     return `chapter ${chapterKeyFromId(chapter.id)}`;
    }
   }
  }
 }
 if (coverage.assignment.kind === "mechanical") {
  return "published mechanical work";
 }
 return "published review work";
}

function changedEvidenceAssigner(
 current: UltraReviewArtifact,
 trustedEvidence: readonly UltraReviewAnalysisEvidence[],
) {
 const trustedById = new Map(
  trustedEvidence.map((evidence) => [evidence.id, evidence]),
 );
 const existingCoverage = new Map(
  current.coverage.map((coverage) => [coverage.evidenceId, coverage]),
 );
 const assigned = new Map<string, string>();
 const additions = new Map<string, UltraReviewEvidence>();

 return {
  additions,
  assign(
   evidenceId: string,
   path: string,
   owner: string,
   sourceClaimIds: string[],
  ): UltraReviewEvidence {
   const trusted = trustedById.get(evidenceId);
   if (trusted === undefined) {
    publicationError(
     "UNKNOWN_CHANGED_EVIDENCE",
     path,
     `${evidenceId} is not in Charon's trusted changed-evidence manifest.`,
     "Use an exact evidence id from evidenceInventory.",
    );
   }
   const covered = existingCoverage.get(evidenceId);
   if (covered !== undefined) {
    publicationError(
     "EVIDENCE_ALREADY_ASSIGNED",
     path,
     `${evidenceId} already belongs to ${coverageOwner(current, covered)}.`,
     "Remove it from this call. Add the owning chapter to dependencyChapterKeys when this chapter depends on that work.",
    );
   }
   const priorOwner = assigned.get(evidenceId);
   if (priorOwner !== undefined) {
    publicationError(
     "EVIDENCE_ASSIGNED_TWICE",
     path,
     `${evidenceId} already belongs to ${priorOwner} in this call.`,
     "Keep each changed evidence id in one beat or one mechanical change.",
    );
   }
   assigned.set(evidenceId, owner);
   const evidence: UltraReviewEvidence = {
    ...trusted,
    sourceClaimIds,
   };
   additions.set(evidenceId, evidence);
   return evidence;
  },
 };
}

function systemScope(
 system: UltraReviewSystem,
 evidence: readonly UltraReviewEvidence[],
 sourceClaims: readonly UltraReviewSourceClaim[],
): UltraReviewSystem["scope"] {
 const evidenceById = new Map(
  evidence.map((item) => [item.id, item]),
 );
 const sourceClaimsById = new Map(
  sourceClaims.map((claim) => [claim.id, claim]),
 );
 const changed = uniqueStrings(
  system.sourceClaimIds.flatMap((sourceClaimId) =>
   sourceClaimsById.get(sourceClaimId)?.evidenceIds ?? []
  ),
 ).flatMap((id) => {
  const item = evidenceById.get(id);
  return item?.kind === "changed" ? [item] : [];
 });
 const files = new Set(
  changed.map((item) => item.location.path),
 );
 const changedLines = changed.reduce((sum, item) => {
  const { startLine, endLine } = item.location;
  if (startLine === null || endLine === null) return sum;
  return sum + endLine - startLine + 1;
 }, 0);
 return { changedLines, files: files.size };
}

export async function appendUltraReviewChapterPublication(
 current: UltraReviewArtifact,
 value: unknown,
 trustedEvidence: readonly UltraReviewAnalysisEvidence[],
 readHeadFile: UltraReviewHeadFileReader,
): Promise<
 UltraReviewPublicationResult<UltraReviewChapterPublicationReceipt>
> {
 const input = publicationInput("publish_chapter", value);
 const mechanicalInputs = input.mechanicalChanges ?? [];
 if (input.beats.length === 0 && mechanicalInputs.length === 0) {
  publicationError(
   "CHAPTER_WITHOUT_WORK",
   "",
   `${input.chapterKey} has no beats or mechanical changes.`,
   "Add one evidence-backed beat or one mechanical change.",
  );
 }
 const chapterId = ultraReviewPublicationChapterId(
  input.chapterKey,
 );
 const stage = current.generation.stages.find(
  (item) => item.id === ultraReviewPublicationChapterStageId(
   input.chapterKey,
  ),
 );
 if (stage === undefined || stage.systemId === null) {
  publicationError(
   "UNKNOWN_CHAPTER",
   "chapterKey",
   `${input.chapterKey} is not in the accepted plan.`,
   "Use a chapter key returned by publish_plan.",
  );
 }
 if (
  stage.status === "complete"
  || current.galaxy.systems.some((system) =>
   system.chapters.some((chapter) => chapter.id === chapterId)
  )
 ) {
  publicationError(
   "CHAPTER_ALREADY_PUBLISHED",
   "chapterKey",
   `${input.chapterKey} is already published.`,
   "Continue with the next planned chapter. Do not resend accepted work.",
  );
 }
 const system = current.galaxy.systems.find(
  (item) => item.id === stage.systemId,
 );
 if (system === undefined) {
  publicationError(
   "PLAN_STATE_INVALID",
   "chapterKey",
   `${input.chapterKey} has no planned system.`,
   "Publish a new plan before retrying this chapter.",
  );
 }
 const dependencyChapterIds = (
  input.dependencyChapterKeys ?? []
 ).map((key, index) => {
  const id = ultraReviewPublicationChapterId(key);
  const planned = current.generation.stages.some(
   (item) => item.id === ultraReviewPublicationChapterStageId(key),
  );
  if (!planned) {
   publicationError(
    "UNKNOWN_DEPENDENCY",
    `dependencyChapterKeys[${index}]`,
    `${key} is not in the accepted plan.`,
    "Use an earlier chapter key from publish_plan or remove this dependency.",
   );
  }
  const published = current.galaxy.systems.some((item) =>
   item.chapters.some((chapter) => chapter.id === id)
  );
  if (!published) {
   publicationError(
    "DEPENDENCY_NOT_PUBLISHED",
    `dependencyChapterKeys[${index}]`,
    `${key} has not been published yet.`,
    "Publish the dependency first or remove it from this chapter.",
   );
  }
  return id;
 });
 const assigner = changedEvidenceAssigner(
  current,
  trustedEvidence,
 );
 const supportingById = new Map<string, UltraReviewEvidence>();
 const supportingOwnerById = new Map<string, string>();
 const sourceClaims: UltraReviewSourceClaim[] = [];
 const concerns: UltraReviewConcern[] = [];
 const beats = [];
 const contextsByBeat = await Promise.all(
  input.beats.map((beat, beatIndex) =>
   Promise.all(
    beat.context.map((context, contextIndex) =>
     supportingEvidence(
      context,
      `beats[${beatIndex}].context[${contextIndex}]`,
      current,
      trustedEvidence,
      readHeadFile,
     )
    ),
   )
  ),
 );

 for (
  let beatIndex = 0;
  beatIndex < input.beats.length;
  beatIndex += 1
 ) {
  const beatInput = input.beats[beatIndex];
  const beatPath = `beats[${beatIndex}]`;
  const beatId = generatedId(
   "beat",
   [chapterId, beatIndex, beatInput.title],
  );
  const contexts = contextsByBeat[beatIndex];
  for (let index = 0; index < contexts.length; index += 1) {
   const evidence = contexts[index];
   const priorOwner = supportingOwnerById.get(evidence.id);
   if (priorOwner !== undefined) {
    publicationError(
     "CONTEXT_ASSIGNED_TWICE",
     `${beatPath}.context[${index}]`,
     `This context range already belongs to ${priorOwner} in this call.`,
     "Keep each context range in one beat.",
    );
   }
   supportingOwnerById.set(
    evidence.id,
    `beats[${beatIndex}]`,
   );
  }
  const contextIds = contexts.map((evidence) => evidence.id);
  const allEvidenceIds = [
   ...beatInput.changedEvidenceIds,
   ...contextIds,
  ];
  if (allEvidenceIds.length === 0) {
   publicationError(
    "BEAT_WITHOUT_EVIDENCE",
    beatPath,
    `${beatPath} has no changed evidence or supporting context.`,
    "Add an exact manifest id to changedEvidenceIds or add one unchanged head-commit context range.",
   );
  }
  const sourceClaimId = generatedId(
   "source",
   ["beat", chapterId, beatIndex, beatInput.claim, allEvidenceIds],
  );
  for (
   let evidenceIndex = 0;
   evidenceIndex < beatInput.changedEvidenceIds.length;
   evidenceIndex += 1
  ) {
   assigner.assign(
    beatInput.changedEvidenceIds[evidenceIndex],
    `${beatPath}.changedEvidenceIds[${evidenceIndex}]`,
    beatPath,
    [sourceClaimId],
   );
  }
  for (const evidence of contexts) {
   supportingById.set(evidence.id, {
    ...evidence,
    sourceClaimIds: [sourceClaimId],
   });
  }
  sourceClaims.push({
   id: sourceClaimId,
   kind: "code_observed",
   claim: beatInput.claim,
   evidenceIds: allEvidenceIds,
  });
  beats.push({
   id: beatId,
   title: beatInput.title,
   claim: beatInput.claim,
   objective: beatInput.why,
   question: null,
   order: beatIndex,
   risk: beatInput.risk,
   evidenceIds: allEvidenceIds,
   sourceClaimIds: [sourceClaimId],
  });
  const beatConcerns = beatInput.concerns ?? [];
  for (
   let concernIndex = 0;
   concernIndex < beatConcerns.length;
   concernIndex += 1
  ) {
   const concern = beatConcerns[concernIndex];
   concerns.push({
    id: generatedId(
     "concern",
     [beatId, concernIndex, concern.question],
    ),
    beatId,
    question: concern.question,
    evidenceIds: allEvidenceIds,
    sourceClaimIds: [sourceClaimId],
    severity: concern.severity,
   });
  }
 }

 const mechanicalChanges: UltraReviewMechanicalChange[] =
  mechanicalInputs.map((change, changeIndex) => {
   const path = `mechanicalChanges[${changeIndex}]`;
   const id = generatedId(
    "mechanical",
    [chapterId, changeIndex, change.title, change.changedEvidenceIds],
   );
   const sourceClaimId = generatedId(
    "source",
    ["mechanical", chapterId, changeIndex, change.reason],
   );
   for (
    let evidenceIndex = 0;
    evidenceIndex < change.changedEvidenceIds.length;
    evidenceIndex += 1
   ) {
    assigner.assign(
     change.changedEvidenceIds[evidenceIndex],
     `${path}.changedEvidenceIds[${evidenceIndex}]`,
     path,
     [sourceClaimId],
    );
   }
   sourceClaims.push({
    id: sourceClaimId,
    kind: "code_observed",
    claim: `${change.title}: ${change.reason}`,
    evidenceIds: change.changedEvidenceIds,
   });
   return {
    id,
    title: change.title,
    reason: change.reason,
    evidenceIds: change.changedEvidenceIds,
   };
  });
 const coverage: UltraReviewCoverageEntry[] = [
  ...beats.flatMap((beat) =>
   beat.evidenceIds.flatMap((evidenceId) =>
    assigner.additions.has(evidenceId)
     ? [{
        evidenceId,
        assignment: {
         kind: "beat" as const,
         beatId: beat.id,
        },
       }]
     : []
   )
  ),
  ...mechanicalChanges.flatMap((change) =>
   change.evidenceIds.map((evidenceId) => ({
    evidenceId,
    assignment: {
     kind: "mechanical" as const,
     mechanicalChangeId: change.id,
    },
   }))
  ),
 ];
 const chapter = {
  id: chapterId,
  title: plannedChapterTitle(stage),
  purpose: input.purpose,
  before: input.before,
  after: input.after,
  order: system.chapters.length,
  risk: input.risk,
  sourceClaimIds: sourceClaims.map((claim) => claim.id),
  dependencyChapterIds,
  beats,
  kind: "narrative" as const,
 };
 const evidence = [
  ...assigner.additions.values(),
  ...supportingById.values(),
 ];
 const allEvidence = [...current.evidence, ...evidence];
 const allSourceClaims = [
  ...current.sourceClaims,
  ...sourceClaims,
 ];
 const systems = current.galaxy.systems.map((item) => {
  if (item.id !== system.id) return item;
  const updated = {
   ...item,
   sourceClaimIds: uniqueStrings([
    ...item.sourceClaimIds,
    ...chapter.sourceClaimIds,
   ]),
   chapters: [...item.chapters, chapter],
  };
  return {
   ...updated,
   scope: systemScope(
    updated,
    allEvidence,
    allSourceClaims,
   ),
  };
 });
 const generation: UltraReviewGeneration = {
  status: "running",
  stages: current.generation.stages.map((item) =>
   item.id === stage.id
    ? { ...item, status: "complete", error: null }
    : item
  ),
  failures: [],
 };
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify({
   ...rawAnalysis(current, generation),
   sourceClaimIds: uniqueStrings([
    ...current.galaxy.sourceClaimIds,
    ...chapter.sourceClaimIds,
   ]),
   systems,
   evidence: allEvidence,
   coverage: [...current.coverage, ...coverage],
   mechanicalChanges: [
    ...current.mechanicalChanges,
    ...mechanicalChanges,
   ],
   sourceClaims: allSourceClaims,
   concerns: [...current.concerns, ...concerns],
  }),
  current.identity,
  trustedEvidence,
 );
 return {
  artifact,
  receipt: {
   kind: "chapter",
   chapterKey: input.chapterKey,
   chapterId,
   beatIds: beats.map((beat) => beat.id),
   supportingEvidenceIds: [
    ...supportingById.keys(),
   ],
   sourceClaimIds: sourceClaims.map((claim) => claim.id),
   concernIds: concerns.map((concern) => concern.id),
   mechanicalChangeIds: mechanicalChanges.map(
    (change) => change.id,
   ),
  },
 };
}

function completionFailures(
 current: UltraReviewArtifact,
 input: UltraReviewCompletionPublicationInput,
): UltraReviewGenerationFailure[] {
 const byKey = new Map<string, typeof input.failedChapters[number]>();
 const stageByKey = new Map<
  string,
  UltraReviewGeneration["stages"][number]
 >();
 for (
  let index = 0;
  index < input.failedChapters.length;
  index += 1
 ) {
  const failure = input.failedChapters[index];
  if (byKey.has(failure.chapterKey)) {
   publicationError(
    "DUPLICATE_FAILED_CHAPTER",
    `failedChapters[${index}].chapterKey`,
    `${failure.chapterKey} appears more than once.`,
    "Keep one failure record for each failed chapter.",
   );
  }
  const stage = current.generation.stages.find(
   (item) => item.id === ultraReviewPublicationChapterStageId(
    failure.chapterKey,
   ),
  );
  if (stage === undefined || stage.systemId === null) {
   publicationError(
    "UNKNOWN_FAILED_CHAPTER",
    `failedChapters[${index}].chapterKey`,
    `${failure.chapterKey} is not in the accepted plan.`,
    "Use a chapter key returned by publish_plan.",
   );
  }
  if (stage.status === "complete") {
   publicationError(
    "PUBLISHED_CHAPTER_MARKED_FAILED",
    `failedChapters[${index}].chapterKey`,
    `${failure.chapterKey} is already published.`,
    "Remove it from failedChapters.",
   );
  }
  byKey.set(failure.chapterKey, failure);
  stageByKey.set(failure.chapterKey, stage);
 }
 const pendingStages = current.generation.stages.filter(
  (stage) =>
   stage.id.startsWith("chapter:")
   && stage.status !== "complete",
 );
 for (const stage of pendingStages) {
  const key = chapterKeyFromId(stage.id);
  if (!byKey.has(key)) {
   publicationError(
    "UNFINISHED_CHAPTER",
    "failedChapters",
    `${key} is neither published nor listed as failed.`,
    `Publish ${key} or add one failedChapters record for it.`,
   );
  }
 }
 return input.failedChapters.map((failure) => {
  const stageId = ultraReviewPublicationChapterStageId(
   failure.chapterKey,
  );
  const stage = stageByKey.get(failure.chapterKey);
  if (stage === undefined || stage.systemId === null) {
   publicationError(
    "PLAN_STATE_INVALID",
    "failedChapters",
    `${failure.chapterKey} has no planned system.`,
    "Publish a new plan before retrying finish_review.",
   );
  }
  return {
   id: generatedId(
    "failure",
    [stageId, failure.message, failure.retryable],
   ),
   stageId,
   scope: "system",
   systemId: stage.systemId,
   chapterId: null,
   message: failure.message,
   retryable: failure.retryable,
   evidenceIds: [],
  };
 });
}

export function completeUltraReviewPublication(
 current: UltraReviewArtifact,
 value: unknown,
): UltraReviewPublicationResult<UltraReviewCompletionPublicationReceipt> {
 const input = publicationInput("finish_review", value);
 const failures = completionFailures(current, input);
 const status = failures.length === 0
  ? "complete" as const
  : "partial" as const;
 const generation: UltraReviewGeneration = {
  status,
  stages: current.generation.stages.map((stage) => {
   const failure = failures.find(
    (item) => item.stageId === stage.id,
   );
   return failure === undefined
    ? stage
    : {
       ...stage,
       status: "failed",
       error: failure.message,
      };
  }),
  failures,
 };
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(rawAnalysis(current, generation)),
  current.identity,
  current.evidence,
 );
 return {
  artifact,
  receipt: {
   kind: "complete",
   status,
  },
 };
}
