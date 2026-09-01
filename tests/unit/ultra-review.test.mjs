import assert from "node:assert/strict";
import test from "node:test";

import {
 auditUltraReviewCoverage,
 calculateUltraReviewDelta,
 calculateUltraReviewProgress,
 continueUltraReviewArtifact,
 createUltraReviewArtifact,
 parseUltraReviewArtifact,
 parseUltraReviewAnalysisJson,
 stableUltraReviewEvidenceId,
} from "../../src/lib/ultraReview.ts";

const IDENTITY = {
 repo: "openai/charon",
 prNumber: 42,
 baseSha: "base-abc",
 headSha: "head-def",
};

function minimalAnalysis(overrides = {}) {
 return {
  version: 1,
  thesis: "Persist review progress without trusting stale evidence.",
  sourceClaimIds: ["source:identity"],
  systems: [
   {
    id: "system:persistence",
    title: "Persist the review",
    thesis: "Keep one local story for one pull request version.",
    order: 0,
    risk: "medium",
    sourceClaimIds: ["source:identity"],
    scope: {
     changedLines: 1,
     files: 1,
    },
    chapters: [
     {
      id: "chapter:artifact",
      title: "Define the artifact",
      purpose: "Give review state one durable owner.",
      before: "Review progress disappears.",
      after: "Review progress resumes.",
      order: 0,
      risk: "medium",
      sourceClaimIds: ["source:identity"],
      dependencyChapterIds: [],
      beats: [
       {
        id: "beat:identity",
        title: "Bind state to the diff",
        claim: "The artifact records both pull request SHAs.",
        objective: "Inspect the version identity.",
        question: null,
        order: 0,
        risk: "medium",
        evidenceIds: [],
        sourceClaimIds: ["source:identity"],
       },
      ],
     },
    ],
   },
  ],
  evidence: [],
  coverage: [],
  mechanicalChanges: [],
  sourceClaims: [
   {
    id: "source:identity",
    kind: "author_stated",
    claim: "Review progress must survive restart.",
    evidenceIds: [],
   },
  ],
  concerns: [],
  generation: {
   status: "complete",
   stages: [
    {
     id: "stage:coverage",
     label: "Checking coverage",
     status: "complete",
     systemId: null,
     error: null,
    },
   ],
   failures: [],
  },
  ...overrides,
 };
}

function analysisWithChangedEvidence() {
 const analysis = minimalAnalysis();
 const evidenceId = "evidence:7fc8b372869214a5";
 analysis.evidence = [
  {
   id: evidenceId,
   kind: "changed",
   change: "addition",
   location: {
    path: "src/lib/store.ts",
    side: "RIGHT",
    startLine: 210,
    endLine: 210,
   },
   fingerprint: "sha256:add-line",
   sourceClaimIds: ["source:identity"],
  },
 ];
 analysis.coverage = [
  {
   evidenceId,
   assignment: {
    kind: "beat",
    beatId: "beat:identity",
   },
  },
 ];
 analysis.systems[0].chapters[0].beats[0].evidenceIds = [
  evidenceId,
 ];
 return analysis;
}

function refreshSingleEvidenceId(analysis) {
 const evidenceId = stableUltraReviewEvidenceId(
  analysis.evidence[0],
 );
 analysis.evidence[0].id = evidenceId;
 analysis.coverage[0].evidenceId = evidenceId;
 analysis.systems[0].chapters[0].beats[0]
  .evidenceIds = [evidenceId];
 return evidenceId;
}

test("analysis JSON becomes an artifact under the trusted pull request identity", () => {
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(minimalAnalysis()),
  IDENTITY,
 );

 assert.deepEqual(
  {
   version: artifact.version,
   identity: artifact.identity,
   artifactKey: artifact.artifactKey,
   thesis: artifact.galaxy.thesis,
   teammate: artifact.sessions.teammate,
  },
  {
   version: 1,
   identity: IDENTITY,
   artifactKey:
    "ultrareview:v1:openai%2Fcharon:42:base-abc..head-def",
   thesis: "Persist review progress without trusting stale evidence.",
   teammate: {
    mode: "teammate",
    acknowledgedMechanicalChangeIds: [],
    concernDispositions: {},
    notes: [],
    answers: [],
    draft: null,
    snapshots: [],
    resume: {
     systemId: "system:persistence",
     chapterId: "chapter:artifact",
     beatId: "beat:identity",
     scrollTop: 0,
     expandedEvidenceIds: [],
    },
   },
 },
 );
});

test("trusted evidence identity survives model transcription errors", () => {
 const analysis = analysisWithChangedEvidence();
 const evidence = analysis.evidence[0];
 const trustedEvidence = [
  {
   id: evidence.id,
   kind: evidence.kind,
   change: evidence.change,
   location: { ...evidence.location },
   fingerprint: evidence.fingerprint,
  },
 ];
 analysis.evidence[0].fingerprint += "a";

 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysis),
  IDENTITY,
  trustedEvidence,
 );

 assert.deepEqual(
  artifact.evidence[0],
  {
   ...analysis.evidence[0],
   fingerprint: trustedEvidence[0].fingerprint,
   supportingReason: undefined,
  },
 );
});

test("untrusted evidence still requires self-consistent identity", () => {
 const analysis = analysisWithChangedEvidence();
 analysis.evidence[0].fingerprint += "a";
 const expectedId = stableUltraReviewEvidenceId(
  analysis.evidence[0],
 );

 assert.throws(
  () => parseUltraReviewAnalysisJson(
   JSON.stringify(analysis),
   IDENTITY,
  ),
  {
   name: "UltraReviewValidationError",
   message:
    `analysis.evidence[0].id must equal ${expectedId}`,
  },
 );
});

test("analysis JSON rejects unknown artifact versions", () => {
 assert.throws(
  () => parseUltraReviewAnalysisJson(
   JSON.stringify(minimalAnalysis({ version: 2 })),
   IDENTITY,
  ),
  {
   name: "UltraReviewValidationError",
   message: "analysis.version 2 is unsupported",
  },
 );
});

test("analysis JSON rejects coverage assigned to a missing beat", () => {
 const analysis = analysisWithChangedEvidence();
 analysis.coverage[0].assignment.beatId = "beat:missing";

 assert.throws(
  () => parseUltraReviewAnalysisJson(
   JSON.stringify(analysis),
   IDENTITY,
  ),
  {
   name: "UltraReviewValidationError",
   message:
    "analysis.coverage[0].assignment.beatId references unknown beat:missing",
  },
 );
});

test("persisted artifacts hydrate without losing session state", () => {
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 artifact.sessions.teammate.reviewCompletedAt = 1;
 artifact.sessions.teammate.resume.scrollTop = 480;
 artifact.sessions.teammate.resume.expandedEvidenceIds = [
  "evidence:7fc8b372869214a5",
 ];
 artifact.sessions.teammate.resume.diffViewStates = {
  beats: {
   "beat:identity": {
    collapsed: { "src/lib/worktree.ts": true },
    expandedContext: {
     "src/lib/worktree.ts:0": { head: 10, tail: 20 },
    },
    viewed: { "src/lib/worktree.ts": "2147261087" },
   },
  },
  raw: {
   collapsed: {},
   expandedContext: {},
   viewed: {},
  },
 };

 assert.deepEqual(
  parseUltraReviewArtifact(
   JSON.parse(JSON.stringify(artifact)),
  ),
 artifact,
 );
});

test("author readiness survives persisted artifact hydration", () => {
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 artifact.sessions.author.authorOutcome = "ready";
 artifact.sessions.author.authorCompletedAt = 1_754_323_200_000;

 const hydrated = parseUltraReviewArtifact(
  JSON.parse(JSON.stringify(artifact)),
 );

 assert.equal(hydrated.sessions.author.authorOutcome, "ready");
 assert.equal(
  hydrated.sessions.author.authorCompletedAt,
  1_754_323_200_000,
 );
});

test("running artifact skeletons hydrate before narrative provenance exists", () => {
 const artifact = createUltraReviewArtifact(IDENTITY);

 assert.deepEqual(
  parseUltraReviewArtifact(
   JSON.parse(JSON.stringify(artifact)),
  ),
  artifact,
 );
});

test("removed delta evidence survives artifact hydration", () => {
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 artifact.galaxy.systems[0].chapters[0].beats[0]
  .removedEvidenceIds = ["evidence:prior-head"];

 const hydrated = parseUltraReviewArtifact(
  JSON.parse(JSON.stringify(artifact)),
 );
 assert.deepEqual(
  hydrated.galaxy.systems[0].chapters[0].beats[0]
   .removedEvidenceIds,
  ["evidence:prior-head"],
 );
});

test("persisted follow-up answers retain their beat and evidence citations", () => {
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 artifact.sessions.teammate.answers = [
  {
   id: "answer:callers",
   beatId: "beat:identity",
   action: "trace_callers",
   question: "Who reads this artifact?",
   text: "The review workspace reads it.",
   citationIds: ["evidence:7fc8b372869214a5"],
   insufficientEvidence: false,
   status: "complete",
   headSha: "head-def",
   createdAt: 60,
   stale: false,
  },
 ];

 assert.deepEqual(
  parseUltraReviewArtifact(
   JSON.parse(JSON.stringify(artifact)),
  ).sessions.teammate.answers,
 artifact.sessions.teammate.answers,
 );
});

test("submission snapshot hydration preserves an empty GitHub review body", () => {
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 artifact.sessions.teammate.snapshots = [
  {
   id: "snapshot:approve",
   submittedAt: 70,
   headSha: "head-def",
   verdict: "APPROVE",
   body: "",
   inlineComments: [],
   noteIds: [],
   progress: calculateUltraReviewProgress(
    artifact,
    "teammate",
   ),
  },
 ];

 assert.equal(
  parseUltraReviewArtifact(
   JSON.parse(JSON.stringify(artifact)),
  ).sessions.teammate.snapshots[0].body,
 "",
 );
});

test("continuation retains old-head answers and marks changed citations stale", () => {
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 previous.sessions.teammate.answers = [
  {
   id: "answer:dependency",
   beatId: "beat:identity",
   action: "explain_dependency",
   question: "Why does this line matter?",
   text: "It binds progress to the current diff.",
   citationIds: ["evidence:7fc8b372869214a5"],
   insufficientEvidence: false,
   status: "complete",
   headSha: "head-def",
   createdAt: 80,
   stale: false,
  },
 ];
 const changed = analysisWithChangedEvidence();
 changed.evidence[0].id =
  "evidence:612f70fda065d458";
 changed.evidence[0].fingerprint =
  "sha256:changed-line";
 changed.coverage[0].evidenceId =
  "evidence:612f70fda065d458";
 changed.systems[0].chapters[0].beats[0]
  .evidenceIds = ["evidence:612f70fda065d458"];
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(changed),
  {
   ...IDENTITY,
   headSha: "head-next",
  },
 );

 assert.deepEqual(
  continueUltraReviewArtifact(previous, next)
   .artifact.sessions.teammate.answers[0],
  {
   ...previous.sessions.teammate.answers[0],
   stale: true,
  },
 );
});

test("coverage audit proves every changed evidence unit has one primary home", () => {
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );

 assert.deepEqual(
  auditUltraReviewCoverage(artifact),
  {
   missingEvidenceIds: [],
   duplicateEvidenceIds: [],
   unknownEvidenceIds: [],
   unmappedEvidenceIds: [],
   mismatchedEvidenceIds: [],
   invalidBeatIds: [],
   invalidMechanicalChangeIds: [],
   supportingEvidenceIds: [],
   overlaps: [],
   failedRegionIds: [],
   incompleteStageIds: [],
   generationComplete: true,
   complete: true,
  },
 );
});

test("supporting evidence is reported without blocking exact changed coverage", () => {
 const analysis = analysisWithChangedEvidence();
 const supporting = {
  kind: "supporting",
  change: "context",
  location: {
   path: "src/lib/reader.ts",
   side: "RIGHT",
   startLine: 12,
   endLine: 18,
  },
  fingerprint: "sha256:supporting-reader",
  sourceClaimIds: ["source:identity"],
  supportingReason: "Shows the unchanged consumer.",
 };
 const supportingId = stableUltraReviewEvidenceId(supporting);
 analysis.evidence.push({
  id: supportingId,
  ...supporting,
 });
 analysis.systems[0].chapters[0].beats[0]
  .evidenceIds.push(supportingId);
 analysis.coverage.push({
  evidenceId: supportingId,
  assignment: {
   kind: "beat",
   beatId: "beat:identity",
  },
 });
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysis),
  IDENTITY,
 );

 const audit = auditUltraReviewCoverage(artifact);

 assert.deepEqual(audit.supportingEvidenceIds, [supportingId]);
 assert.equal(audit.complete, true);
});

test("document completion covers its assigned evidence", () => {
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 artifact.sessions.teammate.reviewCompletedAt = 1;

 assert.deepEqual(
  calculateUltraReviewProgress(artifact, "teammate"),
  {
   documentReviewed: true,
   acknowledgedMechanicalChanges: 0,
   totalMechanicalChanges: 0,
   coveredChangedEvidence: 1,
   totalChangedEvidence: 1,
   failedRegions: 0,
   unmappedEvidence: 0,
   fullyReviewed: true,
  },
 );
});

test("coverage audit exposes overlap, supporting code, and unmapped changes", () => {
 const analysis = minimalAnalysis();
 analysis.evidence = [
  {
   id: "evidence:3479e0d3c50f2e27",
   kind: "changed",
   change: "addition",
   location: {
    path: "src/lib/store.ts",
    side: "RIGHT",
    startLine: 210,
    endLine: 211,
   },
   fingerprint: "sha256:add-range",
   sourceClaimIds: ["source:identity"],
  },
  {
   id: "evidence:e245ab1f87a87cac",
   kind: "changed",
   change: "addition",
   location: {
    path: "src/lib/store.ts",
    side: "RIGHT",
    startLine: 211,
    endLine: 212,
   },
   fingerprint: "sha256:other-range",
   sourceClaimIds: ["source:identity"],
  },
  {
   id: "evidence:89986c62ab547199",
   kind: "supporting",
   change: "context",
   location: {
    path: "src/lib/store.ts",
    side: "RIGHT",
    startLine: 200,
    endLine: 205,
   },
   fingerprint: "sha256:context",
   sourceClaimIds: ["source:identity"],
   supportingReason: "Shows the persistence boundary.",
  },
 ];
 analysis.systems[0].chapters[0].beats[0].evidenceIds =
  analysis.evidence.map((evidence) => evidence.id);
 analysis.coverage = [
  {
   evidenceId: "evidence:3479e0d3c50f2e27",
   assignment: {
    kind: "beat",
    beatId: "beat:identity",
   },
  },
  {
   evidenceId: "evidence:e245ab1f87a87cac",
   assignment: {
    kind: "unmapped",
    reason: "The model did not place this range.",
   },
  },
  {
   evidenceId: "evidence:89986c62ab547199",
   assignment: {
    kind: "beat",
    beatId: "beat:identity",
   },
  },
 ];
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysis),
  IDENTITY,
 );

 assert.deepEqual(
  auditUltraReviewCoverage(artifact),
  {
   missingEvidenceIds: [],
   duplicateEvidenceIds: [],
   unknownEvidenceIds: [],
   unmappedEvidenceIds: [
    "evidence:e245ab1f87a87cac",
   ],
   mismatchedEvidenceIds: [],
   invalidBeatIds: [],
   invalidMechanicalChangeIds: [],
   supportingEvidenceIds: [
    "evidence:89986c62ab547199",
   ],
   overlaps: [
    {
     path: "src/lib/store.ts",
     side: "RIGHT",
     line: 211,
     evidenceIds: [
      "evidence:3479e0d3c50f2e27",
      "evidence:e245ab1f87a87cac",
     ],
    },
   ],
   failedRegionIds: [],
   incompleteStageIds: [],
   generationComplete: true,
   complete: false,
  },
 );
});

test("mechanical acknowledgment covers deletion, binary, rename, and whitespace evidence", () => {
 const analysis = minimalAnalysis();
 analysis.evidence = [
  {
   id: "evidence:e3e83d5a7d710163",
   kind: "changed",
   change: "deletion",
   location: {
    path: "src/a.ts",
    side: "LEFT",
    startLine: 8,
    endLine: 8,
   },
   fingerprint: "sha256:del",
   sourceClaimIds: ["source:identity"],
  },
  {
   id: "evidence:623732c21e5f02fa",
   kind: "changed",
   change: "binary",
   location: {
    path: "assets/logo.png",
    side: "RIGHT",
    startLine: null,
    endLine: null,
   },
   fingerprint: "sha256:binary",
   sourceClaimIds: ["source:identity"],
  },
  {
   id: "evidence:dd829c7330a4320d",
   kind: "changed",
   change: "rename",
   location: {
    path: "src/new.ts",
    oldPath: "src/old.ts",
    side: "RIGHT",
    startLine: null,
    endLine: null,
   },
   fingerprint: "sha256:rename",
   sourceClaimIds: ["source:identity"],
  },
  {
   id: "evidence:34ba59f2cf18fafd",
   kind: "changed",
   change: "whitespace",
   location: {
    path: "src/a.ts",
    side: "RIGHT",
    startLine: 4,
    endLine: 7,
   },
   fingerprint: "sha256:space",
   sourceClaimIds: ["source:identity"],
  },
 ];
 analysis.mechanicalChanges = [
  {
   id: "mechanical:generated",
   title: "Mechanical changes",
   reason: "No semantic behavior changed.",
   evidenceIds: analysis.evidence.map(
    (evidence) => evidence.id,
   ),
  },
 ];
 analysis.coverage = analysis.evidence.map(
  (evidence) => ({
   evidenceId: evidence.id,
   assignment: {
    kind: "mechanical",
    mechanicalChangeId: "mechanical:generated",
   },
  }),
 );
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysis),
  IDENTITY,
 );
 artifact.sessions.teammate.reviewCompletedAt = 1;
 artifact.sessions.teammate
  .acknowledgedMechanicalChangeIds.push(
   "mechanical:generated",
  );

 assert.deepEqual(
  calculateUltraReviewProgress(artifact, "teammate"),
  {
   documentReviewed: true,
   acknowledgedMechanicalChanges: 1,
   totalMechanicalChanges: 1,
   coveredChangedEvidence: 4,
   totalChangedEvidence: 4,
   failedRegions: 0,
   unmappedEvidence: 0,
   fullyReviewed: true,
  },
 );
});

test("partial generation stays usable while failed regions block completion", () => {
 const analysis = analysisWithChangedEvidence();
 analysis.generation = {
  status: "partial",
  stages: [
   {
    id: "stage:coverage",
    label: "Checking coverage",
    status: "failed",
    systemId: "system:persistence",
    error: "Coverage timed out.",
   },
  ],
  failures: [
   {
    id: "failure:coverage",
    stageId: "stage:coverage",
    scope: "system",
    systemId: "system:persistence",
    chapterId: null,
    message: "Coverage timed out.",
    retryable: true,
    evidenceIds: ["evidence:7fc8b372869214a5"],
   },
  ],
 };
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysis),
  IDENTITY,
 );
 artifact.sessions.teammate.reviewCompletedAt = 1;

 assert.deepEqual(
  calculateUltraReviewProgress(artifact, "teammate"),
  {
   documentReviewed: true,
   acknowledgedMechanicalChanges: 0,
   totalMechanicalChanges: 0,
   coveredChangedEvidence: 1,
   totalChangedEvidence: 1,
   failedRegions: 1,
   unmappedEvidence: 0,
   fullyReviewed: false,
  },
 );
});

test("delta analysis names changed and added evidence before invalidating affected beats", () => {
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 previous.sessions.teammate.notes.push({
  id: "note:line",
  body: "Verify the persistence anchor.",
  anchor: {
   kind: "line",
   evidenceIds: ["evidence:7fc8b372869214a5"],
   path: "src/lib/store.ts",
   side: "RIGHT",
   startLine: 210,
   endLine: 210,
   headSha: "head-def",
  },
  createdAt: 10,
  stale: false,
 });
 const nextAnalysis = analysisWithChangedEvidence();
 nextAnalysis.evidence[0].id =
  "evidence:612f70fda065d458";
 nextAnalysis.evidence[0].fingerprint =
  "sha256:changed-line";
 nextAnalysis.evidence.push({
  id: "evidence:fc70854e528e3d0d",
  kind: "changed",
  change: "addition",
  location: {
   path: "src/lib/new.ts",
   side: "RIGHT",
   startLine: 1,
   endLine: 1,
  },
  fingerprint: "sha256:new-line",
  sourceClaimIds: ["source:identity"],
 });
 nextAnalysis.coverage = nextAnalysis.evidence.map(
  (evidence) => ({
   evidenceId: evidence.id,
   assignment: {
    kind: "beat",
    beatId: "beat:identity",
   },
  }),
 );
 nextAnalysis.systems[0].chapters[0].beats[0]
  .evidenceIds = nextAnalysis.evidence.map(
   (evidence) => evidence.id,
  );
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(nextAnalysis),
  {
   ...IDENTITY,
   headSha: "head-next",
  },
 );

 assert.deepEqual(
  calculateUltraReviewDelta(previous, next),
  {
   fromBaseSha: "base-abc",
   fromHeadSha: "head-def",
   toBaseSha: "base-abc",
   toHeadSha: "head-next",
   baseChanged: false,
   addedEvidenceIds: [
    "evidence:fc70854e528e3d0d",
   ],
   removedEvidenceIds: [],
   changedEvidence: [
    {
     beforeEvidenceId: "evidence:7fc8b372869214a5",
     afterEvidenceId: "evidence:612f70fda065d458",
     },
    ],
   reanchoredEvidence: [],
   unchangedEvidenceIds: [],
   invalidatedBeatIds: ["beat:identity"],
   staleNoteIds: ["note:line"],
  },
 );
});

test("continuation preserves notes and snapshots but reopens document review", () => {
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 previous.sessions.teammate.reviewCompletedAt = 1;
 previous.sessions.teammate.resume = {
  systemId: "system:persistence",
  chapterId: "chapter:artifact",
  beatId: "beat:identity",
  scrollTop: 480,
  expandedEvidenceIds: [
   "evidence:7fc8b372869214a5",
  ],
 };
 previous.sessions.teammate.notes.push({
  id: "note:unchanged",
  body: "The anchor remains relevant.",
  anchor: {
   kind: "line",
   evidenceIds: ["evidence:7fc8b372869214a5"],
   path: "src/lib/store.ts",
   side: "RIGHT",
   startLine: 210,
   endLine: 210,
   headSha: "head-def",
  },
  createdAt: 20,
  stale: false,
 });
 previous.sessions.teammate.snapshots.push({
  id: "snapshot:first",
  submittedAt: 30,
  headSha: "head-def",
  verdict: "COMMENT",
  body: "The persisted review is sound.",
  inlineComments: [],
  noteIds: ["note:unchanged"],
  progress: calculateUltraReviewProgress(
   previous,
   "teammate",
  ),
 });
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  {
   ...IDENTITY,
   headSha: "head-next",
  },
 );
 const continuation = continueUltraReviewArtifact(
  previous,
  next,
 );
 continuation.artifact.sessions.teammate
  .snapshots[0].body = "Edited continuation copy.";

 assert.deepEqual(
  {
   unchangedEvidenceIds:
    continuation.delta.unchangedEvidenceIds,
   reviewCompletedAt:
    continuation.artifact.sessions.teammate.reviewCompletedAt,
   resume:
    continuation.artifact.sessions.teammate.resume,
   note:
    continuation.artifact.sessions.teammate.notes[0],
   originalSnapshotBody:
    previous.sessions.teammate.snapshots[0].body,
  },
  {
   unchangedEvidenceIds: [
    "evidence:7fc8b372869214a5",
   ],
   reviewCompletedAt: undefined,
   resume: {
    systemId: "system:persistence",
    chapterId: "chapter:artifact",
    beatId: "beat:identity",
    scrollTop: 480,
    expandedEvidenceIds: [
     "evidence:7fc8b372869214a5",
    ],
   },
   note: {
    id: "note:unchanged",
    body: "The anchor remains relevant.",
    anchor: {
     kind: "line",
     evidenceIds: ["evidence:7fc8b372869214a5"],
     path: "src/lib/store.ts",
     side: "RIGHT",
     startLine: 210,
     endLine: 210,
     headSha: "head-def",
    },
    createdAt: 20,
    stale: false,
   },
   originalSnapshotBody:
    "The persisted review is sound.",
  },
 );
});

test("analysis JSON rejects model confidence outside zero through one hundred", () => {
 const analysis = minimalAnalysis();
 analysis.systems[0].chapters[0].beats[0].confidence =
  101;

 assert.throws(
  () => parseUltraReviewAnalysisJson(
   JSON.stringify(analysis),
   IDENTITY,
  ),
  {
   name: "UltraReviewValidationError",
   message:
    "analysis.systems[0].chapters[0].beats[0].confidence " +
    "must be a number from 0 through 100",
  },
 );
});

test("evidence identity is stable across generation runs", () => {
 assert.equal(
  stableUltraReviewEvidenceId({
   kind: "changed",
   change: "addition",
   location: {
    path: "src/lib/store.ts",
    side: "RIGHT",
    startLine: 210,
    endLine: 210,
   },
   fingerprint: "sha256:add-line",
  }),
  "evidence:7fc8b372869214a5",
 );
});

test("a base change invalidates every prior beat even when evidence ids match", () => {
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  {
   ...IDENTITY,
   baseSha: "base-next",
   headSha: "head-next",
  },
 );
 const delta = calculateUltraReviewDelta(previous, next);

 assert.deepEqual(
  {
   baseChanged: delta.baseChanged,
   unchangedEvidenceIds: delta.unchangedEvidenceIds,
   invalidatedBeatIds: delta.invalidatedBeatIds,
  },
  {
   baseChanged: true,
   unchangedEvidenceIds: [
    "evidence:7fc8b372869214a5",
   ],
   invalidatedBeatIds: ["beat:identity"],
  },
 );
});

test("delta analysis pairs renamed evidence instead of reporting remove plus add", () => {
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 const renamedAnalysis = analysisWithChangedEvidence();
 renamedAnalysis.evidence[0].id =
  "evidence:2eec1d190ef1e429";
 renamedAnalysis.evidence[0].location = {
  path: "src/renamed.ts",
  oldPath: "src/lib/store.ts",
  side: "RIGHT",
  startLine: 210,
  endLine: 210,
 };
 renamedAnalysis.coverage[0].evidenceId =
  "evidence:2eec1d190ef1e429";
 renamedAnalysis.systems[0].chapters[0].beats[0]
  .evidenceIds = ["evidence:2eec1d190ef1e429"];
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(renamedAnalysis),
  {
   ...IDENTITY,
   headSha: "head-next",
  },
 );
 const delta = calculateUltraReviewDelta(previous, next);

 assert.deepEqual(
  {
   addedEvidenceIds: delta.addedEvidenceIds,
   removedEvidenceIds: delta.removedEvidenceIds,
   changedEvidence: delta.changedEvidence,
   reanchoredEvidence: delta.reanchoredEvidence,
  },
  {
   addedEvidenceIds: [],
   removedEvidenceIds: [],
   changedEvidence: [],
   reanchoredEvidence: [
    {
     beforeEvidenceId: "evidence:7fc8b372869214a5",
     afterEvidenceId: "evidence:2eec1d190ef1e429",
    },
   ],
  },
 );
});

test("continuation keeps deleted evidence notes visible and marks them stale", () => {
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 previous.sessions.teammate.reviewCompletedAt = 1;
 previous.sessions.teammate.notes.push({
  id: "note:deleted",
  body: "This range disappeared.",
  anchor: {
   kind: "line",
   evidenceIds: ["evidence:7fc8b372869214a5"],
   path: "src/lib/store.ts",
   side: "RIGHT",
   startLine: 210,
   endLine: 210,
   headSha: "head-def",
  },
  createdAt: 40,
  stale: false,
 });
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(minimalAnalysis()),
  {
   ...IDENTITY,
   headSha: "head-next",
  },
 );
 const continuation = continueUltraReviewArtifact(
  previous,
  next,
 );

 assert.deepEqual(
  {
   removedEvidenceIds:
    continuation.delta.removedEvidenceIds,
   reviewCompletedAt:
    continuation.artifact.sessions.teammate.reviewCompletedAt,
   note:
    continuation.artifact.sessions.teammate.notes[0],
  },
  {
   removedEvidenceIds: [
    "evidence:7fc8b372869214a5",
   ],
   reviewCompletedAt: undefined,
   note: {
    id: "note:deleted",
    body: "This range disappeared.",
    anchor: {
     kind: "line",
     evidenceIds: ["evidence:7fc8b372869214a5"],
     path: "src/lib/store.ts",
     side: "RIGHT",
     startLine: 210,
     endLine: 210,
     headSha: "head-def",
    },
    createdAt: 40,
    stale: true,
   },
  },
 );
});

test("regrouped evidence invalidates notes tied to the removed beat identity", () => {
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 previous.sessions.teammate.notes.push({
  id: "note:beat",
  body: "This objective changed shape.",
  anchor: {
   kind: "beat",
   beatId: "beat:identity",
  },
  createdAt: 50,
  stale: false,
 });
 const regrouped = analysisWithChangedEvidence();
 regrouped.systems[0].chapters[0].beats[0].id =
  "beat:regrouped";
 regrouped.coverage[0].assignment.beatId =
  "beat:regrouped";
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(regrouped),
  {
   ...IDENTITY,
   headSha: "head-next",
  },
 );
 const continuation = continueUltraReviewArtifact(
  previous,
  next,
 );

 assert.deepEqual(
  {
   invalidatedBeatIds:
    continuation.delta.invalidatedBeatIds,
   noteStale:
    continuation.artifact.sessions.teammate
     .notes[0].stale,
  },
  {
   invalidatedBeatIds: ["beat:identity"],
   noteStale: true,
  },
 );
});

test("rename evidence requires the old path", () => {
 const analysis = analysisWithChangedEvidence();
 const location = {
  path: "src/new.ts",
  side: "RIGHT",
  startLine: null,
  endLine: null,
 };
 analysis.evidence[0] = {
  id: stableUltraReviewEvidenceId({
   kind: "changed",
   change: "rename",
   location,
   fingerprint: "sha256:rename-without-old-path",
  }),
  kind: "changed",
  change: "rename",
  location,
  fingerprint: "sha256:rename-without-old-path",
  sourceClaimIds: ["source:identity"],
 };
 analysis.coverage[0].evidenceId =
  analysis.evidence[0].id;
 analysis.systems[0].chapters[0].beats[0]
  .evidenceIds = [analysis.evidence[0].id];

 assert.throws(
  () => parseUltraReviewAnalysisJson(
   JSON.stringify(analysis),
   IDENTITY,
  ),
  {
   name: "UltraReviewValidationError",
   message:
    "analysis.evidence[0].location.oldPath " +
    "must be present for rename evidence",
  },
 );
});

test("galaxy progress counts shared evidence only at its primary beat", () => {
 const analysis = analysisWithChangedEvidence();
 analysis.systems.push({
  id: "system:consumer",
  title: "Use the persisted review",
  thesis: "Restore progress in the review workspace.",
  order: 1,
  risk: "low",
  sourceClaimIds: ["source:identity"],
  scope: {
   changedLines: 0,
   files: 0,
  },
  chapters: [
   {
    id: "chapter:consumer",
    title: "Restore the workspace",
    purpose: "Show the saved position.",
    before: "The workspace starts at the beginning.",
    after: "The workspace resumes in place.",
    order: 0,
    risk: "low",
    sourceClaimIds: ["source:identity"],
    dependencyChapterIds: ["chapter:artifact"],
    beats: [
     {
      id: "beat:consumer",
      title: "Read the artifact",
      claim: "The workspace reads the saved beat.",
      objective: "Trace the shared evidence.",
      question: null,
      order: 0,
      risk: "low",
      evidenceIds: [
       "evidence:7fc8b372869214a5",
      ],
      sourceClaimIds: ["source:identity"],
     },
    ],
   },
  ],
 });
 const artifact = parseUltraReviewAnalysisJson(
  JSON.stringify(analysis),
  IDENTITY,
 );
 assert.deepEqual(
  calculateUltraReviewProgress(artifact, "teammate"),
  {
   documentReviewed: false,
   acknowledgedMechanicalChanges: 0,
   totalMechanicalChanges: 0,
   coveredChangedEvidence: 0,
   totalChangedEvidence: 1,
   failedRegions: 0,
   unmappedEvidence: 0,
   fullyReviewed: false,
  },
 );
});

test("continuation rejects artifacts from another pull request", () => {
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  {
   ...IDENTITY,
   prNumber: 43,
   headSha: "head-next",
  },
 );

 assert.throws(
  () => continueUltraReviewArtifact(previous, next),
  {
   name: "UltraReviewValidationError",
   message:
    "UltraReview continuation requires the same repository and pull request",
  },
 );
});

test("system generation failures require an owning system", () => {
 const analysis = analysisWithChangedEvidence();
 analysis.generation = {
  status: "partial",
  stages: [
   {
    id: "stage:coverage",
    label: "Checking coverage",
    status: "failed",
    systemId: null,
    error: "Coverage failed.",
   },
  ],
  failures: [
   {
    id: "failure:coverage",
    stageId: "stage:coverage",
    scope: "system",
    systemId: null,
    chapterId: null,
    message: "Coverage failed.",
    retryable: true,
    evidenceIds: [],
   },
  ],
 };

 assert.throws(
  () => parseUltraReviewAnalysisJson(
   JSON.stringify(analysis),
   IDENTITY,
  ),
  {
   name: "UltraReviewValidationError",
   message:
    "analysis.generation.failures[0].systemId " +
    "must be present for a system failure",
  },
 );
});

test("narrative theses require source-claim provenance", () => {
 const analysis = minimalAnalysis();
 delete analysis.systems[0].sourceClaimIds;

 assert.throws(
  () => parseUltraReviewAnalysisJson(
   JSON.stringify(analysis),
   IDENTITY,
  ),
  {
   name: "UltraReviewValidationError",
   message:
    "analysis.systems[0].sourceClaimIds must be an array",
  },
 );
});

test("line movement reanchors evidence and reopens document review", () => {
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(analysisWithChangedEvidence()),
  IDENTITY,
 );
 previous.sessions.teammate.reviewCompletedAt = 1;
 previous.sessions.teammate.notes.push({
  id: "note:moved",
  body: "The same line moved down.",
  anchor: {
   kind: "line",
   evidenceIds: ["evidence:7fc8b372869214a5"],
   path: "src/lib/store.ts",
   side: "RIGHT",
   startLine: 210,
   endLine: 210,
   headSha: "head-def",
  },
  createdAt: 90,
  stale: false,
 });
 const moved = analysisWithChangedEvidence();
 moved.evidence[0].id =
  "evidence:cb8d1d6fe6470c9d";
 moved.evidence[0].location.startLine = 214;
 moved.evidence[0].location.endLine = 214;
 moved.coverage[0].evidenceId =
  "evidence:cb8d1d6fe6470c9d";
 moved.systems[0].chapters[0].beats[0]
  .evidenceIds = ["evidence:cb8d1d6fe6470c9d"];
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(moved),
  {
   ...IDENTITY,
   headSha: "head-next",
  },
 );
 const continuation = continueUltraReviewArtifact(
  previous,
  next,
 );

 assert.deepEqual(
  {
   reanchoredEvidence:
    continuation.delta.reanchoredEvidence,
   invalidatedBeatIds:
    continuation.delta.invalidatedBeatIds,
   reviewCompletedAt:
    continuation.artifact.sessions.teammate.reviewCompletedAt,
   anchor:
    continuation.artifact.sessions.teammate
     .notes[0].anchor,
  },
  {
   reanchoredEvidence: [
    {
     beforeEvidenceId: "evidence:7fc8b372869214a5",
     afterEvidenceId: "evidence:cb8d1d6fe6470c9d",
    },
   ],
   invalidatedBeatIds: [],
   reviewCompletedAt: undefined,
   anchor: {
    kind: "line",
    evidenceIds: ["evidence:cb8d1d6fe6470c9d"],
    path: "src/lib/store.ts",
    side: "RIGHT",
    startLine: 214,
    endLine: 214,
    headSha: "head-next",
   },
 },
 );
});

test("line movement preserves a note's selected subrange", () => {
 const previousAnalysis = analysisWithChangedEvidence();
 previousAnalysis.evidence[0].location.startLine = 210;
 previousAnalysis.evidence[0].location.endLine = 214;
 const previousEvidenceId =
  refreshSingleEvidenceId(previousAnalysis);
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(previousAnalysis),
  IDENTITY,
 );
 previous.sessions.teammate.notes.push({
  id: "note:moved-subrange",
  body: "Only these three lines need scrutiny.",
  anchor: {
   kind: "line",
   evidenceIds: [previousEvidenceId],
   path: "src/lib/store.ts",
   side: "RIGHT",
   startLine: 211,
   endLine: 213,
   headSha: "head-def",
  },
  createdAt: 91,
  stale: false,
 });
 const moved = analysisWithChangedEvidence();
 moved.evidence[0].location.startLine = 220;
 moved.evidence[0].location.endLine = 224;
 const movedEvidenceId =
  refreshSingleEvidenceId(moved);
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(moved),
  {
   ...IDENTITY,
   headSha: "head-next",
  },
 );

 const note = continueUltraReviewArtifact(
  previous,
  next,
 ).artifact.sessions.teammate.notes[0];

 assert.deepEqual(note, {
  id: "note:moved-subrange",
  body: "Only these three lines need scrutiny.",
  anchor: {
   kind: "line",
   evidenceIds: [movedEvidenceId],
   path: "src/lib/store.ts",
   side: "RIGHT",
   startLine: 221,
   endLine: 223,
   headSha: "head-next",
  },
  createdAt: 91,
  stale: false,
 });
});

test("line movement marks a note stale when its subrange cannot translate exactly", () => {
 const previousAnalysis = analysisWithChangedEvidence();
 previousAnalysis.evidence[0].location.startLine = 210;
 previousAnalysis.evidence[0].location.endLine = 214;
 const previousEvidenceId =
  refreshSingleEvidenceId(previousAnalysis);
 const previous = parseUltraReviewAnalysisJson(
  JSON.stringify(previousAnalysis),
  IDENTITY,
 );
 previous.sessions.teammate.notes.push({
  id: "note:ambiguous-subrange",
  body: "Do not widen this note.",
  anchor: {
   kind: "line",
   evidenceIds: [previousEvidenceId],
   path: "src/lib/store.ts",
   side: "RIGHT",
   startLine: 211,
   endLine: 213,
   headSha: "head-def",
  },
  createdAt: 92,
  stale: false,
 });
 const moved = analysisWithChangedEvidence();
 moved.evidence[0].location.startLine = 220;
 moved.evidence[0].location.endLine = 222;
 const movedEvidenceId =
  refreshSingleEvidenceId(moved);
 const next = parseUltraReviewAnalysisJson(
  JSON.stringify(moved),
  {
   ...IDENTITY,
   headSha: "head-next",
  },
 );

 const note = continueUltraReviewArtifact(
  previous,
  next,
 ).artifact.sessions.teammate.notes[0];

 assert.deepEqual(note, {
  ...previous.sessions.teammate.notes[0],
  stale: true,
 });
 assert.notDeepEqual(note.anchor, {
  kind: "line",
  evidenceIds: [movedEvidenceId],
  path: "src/lib/store.ts",
  side: "RIGHT",
  startLine: 220,
  endLine: 222,
  headSha: "head-next",
 });
});
