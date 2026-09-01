import type {
  DiffViewerViewState,
  UltraReviewArtifact,
  UltraReviewConcern,
  UltraReviewConcernDisposition,
  UltraReviewDraft,
  UltraReviewDraftProvenance,
  UltraReviewMode,
  UltraReviewNote,
  UltraReviewNoteKind,
  UltraReviewProgress,
  UltraReviewResumePosition,
  UltraReviewSession,
  UltraReviewSubmissionSnapshot,
} from "../types";

function cloneDiffViewState(
  state: DiffViewerViewState,
): DiffViewerViewState {
  return {
    collapsed: { ...state.collapsed },
    expandedContext: Object.fromEntries(
      Object.entries(state.expandedContext).map(
        ([key, expansion]) => [key, { ...expansion }],
      ),
    ),
    ...(state.viewed === undefined
      ? {}
      : { viewed: { ...state.viewed } }),
  };
}

export class UltraReviewSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UltraReviewSessionError";
  }
}

export interface UltraReviewBeatNoteInput {
  id: string;
  beatId: string;
  body: string;
  kind?: UltraReviewNoteKind;
  createdAt: number;
}

export interface UltraReviewLineNoteInput {
  id: string;
  evidenceIds: string[];
  body: string;
  kind?: UltraReviewNoteKind;
  startLine: number;
  endLine: number;
  createdAt: number;
}

export interface UltraReviewConcernPromotionInput {
  body?: string;
  createdAt: number;
}

export interface UltraReviewDraftResponseContext {
  draftId: string;
  notes: readonly UltraReviewNote[];
  concerns?: readonly UltraReviewConcern[];
}

interface UltraReviewSubmissionSnapshotInput {
  id: string;
  submittedAt: number;
  headSha: string;
  verdict: UltraReviewSubmissionSnapshot["verdict"];
  draft: UltraReviewDraft;
  progress: UltraReviewProgress;
}

export interface UltraReviewPullRequestOwnership {
  viewerLogin: string;
  authorLogin: string;
  repositoryFullName: string;
  headRepositoryFullName: string;
}

type JsonObject = Record<string, unknown>;

interface ParsedDraftSection {
  body: string;
  sourceNoteIds: string[];
}

interface ParsedDraftResponse {
  body: string;
  recommendedVerdict: UltraReviewDraft["recommendedVerdict"];
  sections: ParsedDraftSection[];
  incorporatedNoteIds: string[];
  combinedNoteIds: string[];
  omittedNoteIds: string[];
}

const DRAFT_KEYS = [
  "body",
  "recommendedVerdict",
  "sections",
  "incorporatedNoteIds",
  "combinedNoteIds",
  "omittedNoteIds",
] as const;

const SECTION_KEYS = [
  "body",
  "sourceNoteIds",
] as const;

function nonEmptyString(
  value: unknown,
  path: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new UltraReviewSessionError(
      `${path} must be a non-empty string`,
    );
  }
  return value;
}

function timestamp(
  value: number,
  path: string,
): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new UltraReviewSessionError(
      `${path} must be a non-negative integer`,
    );
  }
  return value;
}

function lineNumber(
  value: unknown,
  path: string,
): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new UltraReviewSessionError(
      `${path} must be a positive integer`,
    );
  }
  return value as number;
}

function jsonObject(
  value: unknown,
  path: string,
): JsonObject {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw new UltraReviewSessionError(
      `${path} must be an object`,
    );
  }
  return value as JsonObject;
}

function exactKeys(
  value: JsonObject,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter(
    (key) => !allowed.has(key),
  );
  const missing = allowedKeys.filter(
    (key) => !(key in value),
  );
  if (unexpected.length > 0) {
    throw new UltraReviewSessionError(
      `${path} contains unsupported fields: ${unexpected.join(", ")}`,
    );
  }
  if (missing.length > 0) {
    throw new UltraReviewSessionError(
      `${path} is missing fields: ${missing.join(", ")}`,
    );
  }
}

function stringArray(
  value: unknown,
  path: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new UltraReviewSessionError(
      `${path} must be an array`,
    );
  }
  const result = value.map(
    (entry, index) =>
      nonEmptyString(entry, `${path}[${index}]`),
  );
  if (new Set(result).size !== result.length) {
    throw new UltraReviewSessionError(
      `${path} contains duplicate note ids`,
    );
  }
  return result;
}

function appendNote(
  session: UltraReviewSession,
  note: UltraReviewNote,
): UltraReviewSession {
  if (session.notes.some((item) => item.id === note.id)) {
    throw new UltraReviewSessionError(
      `note id ${note.id} already exists`,
    );
  }
  return {
    ...session,
    draft: null,
    notes: [
      ...session.notes,
      note,
    ],
  };
}

function artifactBeatIds(
  artifact: UltraReviewArtifact,
): Set<string> {
  return new Set(
    artifact.galaxy.systems.flatMap(
      (system) =>
        system.chapters.flatMap(
          (chapter) =>
            chapter.beats.map((beat) => beat.id),
        ),
    ),
  );
}

function noteBase(
  input: {
    id: string;
    body: string;
    kind?: UltraReviewNoteKind;
    createdAt: number;
  },
): Pick<
  UltraReviewNote,
  "id" | "body" | "kind" | "submitAsComment" | "createdAt" | "stale"
> {
  const kind = input.kind ?? "note";
  if (
    kind !== "note"
    && kind !== "nitpick"
    && kind !== "request"
    && kind !== "suggestion"
    && kind !== "praise"
  ) {
    throw new UltraReviewSessionError(
      `note.kind has unsupported value ${String(kind)}`,
    );
  }
  return {
    id: nonEmptyString(input.id, "note.id"),
    body: nonEmptyString(input.body, "note.body"),
    kind,
    submitAsComment: false,
    createdAt: timestamp(input.createdAt, "note.createdAt"),
    stale: false,
  };
}

export function completeUltraReviewDocument(
  session: UltraReviewSession,
  completedAt: number,
): UltraReviewSession {
  return {
    ...session,
    reviewCompletedAt: timestamp(
      completedAt,
      "reviewCompletedAt",
    ),
  };
}

export function updateUltraReviewResume(
  session: UltraReviewSession,
  resume: UltraReviewResumePosition,
): UltraReviewSession {
  if (!Number.isInteger(resume.scrollTop) || resume.scrollTop < 0) {
    throw new UltraReviewSessionError(
      "resume.scrollTop must be a non-negative integer",
    );
  }
  return {
    ...session,
    resume: {
      ...resume,
      expandedEvidenceIds: [
        ...new Set(resume.expandedEvidenceIds),
      ],
      ...(resume.diffViewStates === undefined
        ? {}
        : {
            diffViewStates: {
              ...(resume.diffViewStates.raw === undefined
                ? {}
                : {
                    raw: cloneDiffViewState(
                      resume.diffViewStates.raw,
                    ),
                  }),
              ...(resume.diffViewStates.beats === undefined
                ? {}
                : {
                    beats: Object.fromEntries(
                      Object.entries(
                        resume.diffViewStates.beats,
                      ).map(([beatId, state]) => [
                        beatId,
                        cloneDiffViewState(state),
                      ]),
                    ),
                  }),
            },
          }),
    },
  };
}

export function addUltraReviewBeatNote(
  session: UltraReviewSession,
  artifact: UltraReviewArtifact,
  input: UltraReviewBeatNoteInput,
): UltraReviewSession {
  if (!artifactBeatIds(artifact).has(input.beatId)) {
    throw new UltraReviewSessionError(
      `cannot anchor a note to unknown beat ${input.beatId}`,
    );
  }
  return appendNote(
    session,
    {
      ...noteBase(input),
      anchor: {
        kind: "beat",
        beatId: input.beatId,
      },
    },
  );
}

export function addUltraReviewLineNote(
  session: UltraReviewSession,
  artifact: UltraReviewArtifact,
  input: UltraReviewLineNoteInput,
): UltraReviewSession {
  const evidenceIds = unique(input.evidenceIds);
  if (evidenceIds.length === 0) {
    throw new UltraReviewSessionError(
      "a line note needs at least one evidence id",
    );
  }
  const evidence = evidenceIds.map((evidenceId) => {
    const item = artifact.evidence.find(
      (candidate) => candidate.id === evidenceId,
    );
    if (!item) {
      throw new UltraReviewSessionError(
        `cannot anchor a note to unknown evidence ${evidenceId}`,
      );
    }
    return item;
  });
  const startLine = lineNumber(
    input.startLine,
    "note.anchor.startLine",
  );
  const endLine = lineNumber(
    input.endLine,
    "note.anchor.endLine",
  );
  const ordered = [...evidence].sort((left, right) =>
    (left.location.startLine ?? 0) -
    (right.location.startLine ?? 0)
  );
  const first = ordered[0];
  const trustedStart = first.location.startLine;
  const trustedEnd = ordered[ordered.length - 1].location.endLine;
  let nextLine = startLine;
  const coherent = ordered.every((item) => {
    const location = item.location;
    if (
      item.kind !== "changed"
      || location.path !== first.location.path
      || location.side !== first.location.side
      || location.startLine === null
      || location.endLine === null
      || location.endLine < startLine
      || location.startLine > endLine
      || location.startLine > nextLine
    ) {
      return false;
    }
    nextLine = Math.max(nextLine, location.endLine + 1);
    return true;
  });
  if (
    trustedStart === null
    || trustedEnd === null
    || startLine > endLine
    || startLine < trustedStart
    || endLine > trustedEnd
    || !coherent
    || nextLine <= endLine
  ) {
    throw new UltraReviewSessionError(
      `note lines must stay inside one contiguous trusted evidence range `
      + `${String(trustedStart)}-${String(trustedEnd)}`,
    );
  }
  return appendNote(
    session,
    {
      ...noteBase(input),
      anchor: {
        kind: "line",
        evidenceIds: ordered.map((item) => item.id),
        path: first.location.path,
        side: first.location.side,
        startLine,
        endLine,
        headSha: artifact.identity.headSha,
      },
    },
  );
}

export function updateUltraReviewNote(
  session: UltraReviewSession,
  noteId: string,
  update: {
    body: string;
    kind: UltraReviewNoteKind;
    submitAsComment: boolean;
  },
): UltraReviewSession {
  const id = nonEmptyString(noteId, "noteId");
  const index = session.notes.findIndex((note) => note.id === id);
  if (index < 0) {
    throw new UltraReviewSessionError(`unknown note ${id}`);
  }
  const current = session.notes[index];
  const base = noteBase({
    id: current.id,
    body: update.body,
    kind: update.kind,
    createdAt: current.createdAt,
  });
  const note: UltraReviewNote = {
    ...current,
    body: base.body,
    kind: base.kind,
    submitAsComment:
      current.anchor.kind === "line"
      && update.submitAsComment,
  };
  const assessmentChanged = current.body !== note.body
    || current.kind !== note.kind;
  return {
    ...session,
    draft: assessmentChanged ? null : session.draft,
    notes: session.notes.map((candidate, candidateIndex) =>
      candidateIndex === index ? note : candidate
    ),
  };
}

export function ultraReviewNotesFingerprint(
  notes: readonly UltraReviewNote[],
): string {
  const serialized = JSON.stringify(
    [...notes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((note) => ({
        id: note.id,
        body: note.body,
        kind: note.kind,
        anchor: note.anchor,
        stale: note.stale,
      })),
  );
  let hash = 2_166_136_261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `notes:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function setConcernDisposition(
  session: UltraReviewSession,
  concernId: string,
  disposition: UltraReviewConcernDisposition,
): UltraReviewSession {
  const promotedNoteId = `concern:${concernId}`;
  const notes = disposition === "promoted"
    ? session.notes
    : session.notes.filter(
        (note) => note.id !== promotedNoteId,
      );
  return {
    ...session,
    draft:
      notes.length === session.notes.length
        ? session.draft
        : null,
    concernDispositions: {
      ...session.concernDispositions,
      [concernId]: disposition,
    },
    notes,
  };
}

export function dismissUltraReviewConcern(
  session: UltraReviewSession,
  concernId: string,
): UltraReviewSession {
  return setConcernDisposition(
    session,
    nonEmptyString(concernId, "concernId"),
    "dismissed",
  );
}

export function verifyUltraReviewConcern(
  session: UltraReviewSession,
  concernId: string,
): UltraReviewSession {
  return setConcernDisposition(
    session,
    nonEmptyString(concernId, "concernId"),
    "verified",
  );
}

export function promoteUltraReviewConcern(
  session: UltraReviewSession,
  concern: UltraReviewConcern,
  input: UltraReviewConcernPromotionInput,
): UltraReviewSession {
  const noteId = `concern:${concern.id}`;
  const withDisposition = setConcernDisposition(
    session,
    concern.id,
    "promoted",
  );
  if (
    withDisposition.notes.some(
      (note) => note.id === noteId,
    )
  ) {
    return withDisposition;
  }
  return appendNote(
    withDisposition,
    {
      ...noteBase({
        id: noteId,
        body: input.body ?? concern.question,
        createdAt: input.createdAt,
      }),
      anchor: {
        kind: "beat",
        beatId: concern.beatId,
      },
    },
  );
}

export function acknowledgeUltraReviewMechanicalChange(
  session: UltraReviewSession,
  mechanicalChangeId: string,
): UltraReviewSession {
  const id = nonEmptyString(
    mechanicalChangeId,
    "mechanicalChangeId",
  );
  if (
    session.acknowledgedMechanicalChangeIds.includes(id)
  ) {
    return session;
  }
  return {
    ...session,
    acknowledgedMechanicalChangeIds: [
      ...session.acknowledgedMechanicalChangeIds,
      id,
    ],
  };
}

function terminalDraftJson(text: string): unknown {
  const openTag = "<ultrareview-draft>";
  const closeTag = "</ultrareview-draft>";
  const openingCount = text.split(openTag).length - 1;
  const closingCount = text.split(closeTag).length - 1;
  const start = text.indexOf(openTag);
  const end = text.indexOf(closeTag);
  if (
    openingCount !== 1
    || closingCount !== 1
    || start < 0
    || end < start
    || text.slice(end + closeTag.length).trim() !== ""
  ) {
    throw new UltraReviewSessionError(
      "Expected exactly one terminal <ultrareview-draft> block.",
    );
  }
  const raw = text.slice(start + openTag.length, end);
  try {
    return JSON.parse(raw);
  } catch {
    throw new UltraReviewSessionError(
      "UltraReview draft must contain valid JSON",
    );
  }
}

function parseSection(
  value: unknown,
  index: number,
): ParsedDraftSection {
  const path = `draft.sections[${index}]`;
  const section = jsonObject(value, path);
  exactKeys(section, SECTION_KEYS, path);
  const sourceNoteIds = stringArray(
    section.sourceNoteIds,
    `${path}.sourceNoteIds`,
  );
  if (sourceNoteIds.length === 0) {
    throw new UltraReviewSessionError(
      `${path} introduces prose without note provenance`,
    );
  }
  return {
    body: nonEmptyString(section.body, `${path}.body`),
    sourceNoteIds,
  };
}

function parsedDraftResponse(
  value: unknown,
): ParsedDraftResponse {
  const draft = jsonObject(value, "draft");
  exactKeys(draft, DRAFT_KEYS, "draft");
  if (!Array.isArray(draft.sections)) {
    throw new UltraReviewSessionError(
      "draft.sections must be an array",
    );
  }
  const sections = draft.sections.map(parseSection);
  const body = nonEmptyString(draft.body, "draft.body");
  if (body !== sections.map((section) => section.body).join("\n\n")) {
    throw new UltraReviewSessionError(
      "draft.body contains prose outside source-linked sections",
    );
  }
  return {
    body,
    recommendedVerdict: (() => {
      const verdict = draft.recommendedVerdict;
      if (
        verdict !== "COMMENT"
        && verdict !== "APPROVE"
        && verdict !== "REQUEST_CHANGES"
      ) {
        throw new UltraReviewSessionError(
          "draft.recommendedVerdict must be COMMENT, APPROVE, or REQUEST_CHANGES",
        );
      }
      return verdict;
    })(),
    sections,
    incorporatedNoteIds: stringArray(
      draft.incorporatedNoteIds,
      "draft.incorporatedNoteIds",
    ),
    combinedNoteIds: stringArray(
      draft.combinedNoteIds,
      "draft.combinedNoteIds",
    ),
    omittedNoteIds: stringArray(
      draft.omittedNoteIds,
      "draft.omittedNoteIds",
    ),
  };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function noteProvenance(
  sourceNoteIds: readonly string[],
  notesById: ReadonlyMap<string, UltraReviewNote>,
  concernsById: ReadonlyMap<string, UltraReviewConcern>,
): UltraReviewDraftProvenance {
  const notes = sourceNoteIds.map(
    (noteId) => notesById.get(noteId)!,
  );
  const concerns = notes.flatMap((note) => {
    const prefix = "concern:";
    if (!note.id.startsWith(prefix)) return [];
    const concern = concernsById.get(
      note.id.slice(prefix.length),
    );
    return concern ? [concern] : [];
  });
  return {
    noteIds: [...sourceNoteIds],
    beatIds: unique([
      ...notes.flatMap((note) =>
        note.anchor.kind === "beat"
          ? [note.anchor.beatId]
          : []),
      ...concerns.map((concern) => concern.beatId),
    ]),
    evidenceIds: unique([
      ...notes.flatMap((note) =>
        note.anchor.kind === "line"
          ? note.anchor.evidenceIds
          : []),
      ...concerns.flatMap(
        (concern) => concern.evidenceIds,
      ),
    ]),
    concernIds: unique(
      concerns.map((concern) => concern.id),
    ),
  };
}

function assertKnownNoteIds(
  ids: readonly string[],
  notesById: ReadonlyMap<string, UltraReviewNote>,
  path: string,
): void {
  for (const id of ids) {
    if (!notesById.has(id)) {
      throw new UltraReviewSessionError(
        `${path} references unknown note ${id}`,
      );
    }
  }
}

function assertNoteLedger(
  draft: ParsedDraftResponse,
  notes: readonly UltraReviewNote[],
  citedNoteIds: ReadonlySet<string>,
): void {
  const groups = [
    draft.incorporatedNoteIds,
    draft.combinedNoteIds,
    draft.omittedNoteIds,
  ];
  const classified = groups.flat();
  if (new Set(classified).size !== classified.length) {
    throw new UltraReviewSessionError(
      "each note must have exactly one closing disposition",
    );
  }
  const known = new Set(notes.map((note) => note.id));
  if (
    known.size !== classified.length
    || [...known].some((id) => !classified.includes(id))
  ) {
    throw new UltraReviewSessionError(
      "closing dispositions must account for every known note",
    );
  }
  const represented = new Set([
    ...draft.incorporatedNoteIds,
    ...draft.combinedNoteIds,
  ]);
  for (const noteId of citedNoteIds) {
    if (!represented.has(noteId)) {
      throw new UltraReviewSessionError(
        `cited note ${noteId} is not represented in the ledger`,
      );
    }
  }
  for (const noteId of represented) {
    if (!citedNoteIds.has(noteId)) {
      throw new UltraReviewSessionError(
        `represented note ${noteId} has no draft provenance`,
      );
    }
  }
}

export function parseUltraReviewDraftResponse(
  text: string,
  context: UltraReviewDraftResponseContext,
): UltraReviewDraft {
  const draftId = nonEmptyString(
    context.draftId,
    "draftId",
  );
  const notesById = new Map(
    context.notes.map((note) => [note.id, note]),
  );
  if (notesById.size !== context.notes.length) {
    throw new UltraReviewSessionError(
      "known notes contain duplicate ids",
    );
  }
  const concernsById = new Map(
    (context.concerns ?? []).map(
      (concern) => [concern.id, concern],
    ),
  );
  const draft = parsedDraftResponse(terminalDraftJson(text));
  const citedNoteIds = new Set<string>();

  for (let index = 0; index < draft.sections.length; index += 1) {
    const section = draft.sections[index];
    assertKnownNoteIds(
      section.sourceNoteIds,
      notesById,
      `draft.sections[${index}].sourceNoteIds`,
    );
    for (const id of section.sourceNoteIds) {
      citedNoteIds.add(id);
    }
  }
  for (const [name, ids] of [
    ["incorporatedNoteIds", draft.incorporatedNoteIds],
    ["combinedNoteIds", draft.combinedNoteIds],
    ["omittedNoteIds", draft.omittedNoteIds],
  ] as const) {
    assertKnownNoteIds(ids, notesById, `draft.${name}`);
  }
  assertNoteLedger(draft, context.notes, citedNoteIds);

  return {
    id: draftId,
    body: draft.body,
    recommendedVerdict: draft.recommendedVerdict,
    sourceNotesFingerprint: ultraReviewNotesFingerprint(
      context.notes,
    ),
    sections: draft.sections.map(
      (section, index) => ({
        id: `${draftId}:section:${index}`,
        body: section.body,
        provenance: noteProvenance(
          section.sourceNoteIds,
          notesById,
          concernsById,
        ),
      }),
    ),
    inlineComments: [],
    incorporatedNoteIds: [
      ...draft.incorporatedNoteIds,
    ],
    combinedNoteIds: [...draft.combinedNoteIds],
    omittedNoteIds: [...draft.omittedNoteIds],
  };
}

function deepFreeze<T>(value: T): T {
  if (
    value === null
    || typeof value !== "object"
    || Object.isFrozen(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

export function buildUltraReviewSubmissionSnapshot(
  input: UltraReviewSubmissionSnapshotInput,
): UltraReviewSubmissionSnapshot {
  const includedInlineComments = input.draft.inlineComments
    .filter((comment) => comment.included)
    .map((comment) => ({
      ...comment,
      provenance: {
        noteIds: [...comment.provenance.noteIds],
        beatIds: [...comment.provenance.beatIds],
        evidenceIds: [...comment.provenance.evidenceIds],
        concernIds: [...comment.provenance.concernIds],
      },
    }));
  const noteIds = unique([
    ...input.draft.sections.flatMap(
      (section) => section.provenance.noteIds,
    ),
    ...includedInlineComments.flatMap(
      (comment) => comment.provenance.noteIds,
    ),
  ]);
  return deepFreeze({
    id: nonEmptyString(input.id, "snapshot.id"),
    submittedAt: timestamp(
      input.submittedAt,
      "snapshot.submittedAt",
    ),
    headSha: nonEmptyString(
      input.headSha,
      "snapshot.headSha",
    ),
    verdict: input.verdict,
    body: input.draft.body,
    inlineComments: includedInlineComments,
    noteIds,
    progress: {
      ...input.progress,
    },
  });
}

export function recordUltraReviewSubmissionSnapshot(
  session: UltraReviewSession,
  snapshot: UltraReviewSubmissionSnapshot,
): UltraReviewSession {
  if (
    session.snapshots.some(
      (candidate) => candidate.id === snapshot.id,
    )
  ) {
    return session;
  }
  return {
    ...session,
    snapshots: [...session.snapshots, snapshot],
  };
}

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase();
}

export function ultraReviewModeForPullRequest(
  ownership: UltraReviewPullRequestOwnership,
): UltraReviewMode {
  const viewer = normalizedIdentity(ownership.viewerLogin);
  const author = normalizedIdentity(ownership.authorLogin);
  return viewer !== "" && viewer === author
    ? "author"
    : "teammate";
}
