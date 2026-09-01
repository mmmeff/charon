import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeUltraReviewMechanicalChange,
  addUltraReviewBeatNote,
  addUltraReviewLineNote,
  buildUltraReviewSubmissionSnapshot,
  completeUltraReviewDocument,
  dismissUltraReviewConcern,
  parseUltraReviewDraftResponse,
  promoteUltraReviewConcern,
  recordUltraReviewSubmissionSnapshot,
  ultraReviewNotesFingerprint,
  ultraReviewModeForPullRequest,
  updateUltraReviewNote,
  updateUltraReviewResume,
  verifyUltraReviewConcern,
} from "../../src/lib/ultrareview-session.ts";

function makeSession() {
  return {
    mode: "teammate",
    acknowledgedMechanicalChangeIds: [],
    concernDispositions: {},
    notes: [],
    draft: null,
    snapshots: [],
    resume: {
      systemId: "system-api",
      chapterId: "chapter-api",
      beatId: "beat-api",
      scrollTop: 0,
      expandedEvidenceIds: [],
    },
  };
}

function makeArtifact() {
  return {
    version: 1,
    identity: {
      repo: "acme/widgets",
      prNumber: 42,
      baseSha: "base-abc",
      headSha: "head-def",
    },
    artifactKey:
      "ultrareview:v1:acme%2Fwidgets:42:base-abc..head-def",
    galaxy: {
      id: "galaxy:root",
      thesis: "Protect the API boundary",
      systems: [
        {
          id: "system-api",
          title: "API",
          thesis: "Validate requests",
          order: 0,
          risk: "high",
          scope: {
            changedLines: 5,
            files: 1,
          },
          chapters: [
            {
              id: "chapter-api",
              title: "Validation",
              purpose: "Reject malformed input",
              before: "Input crossed unchecked",
              after: "Input is validated",
              order: 0,
              risk: "high",
              dependencyChapterIds: [],
              beats: [
                {
                  id: "beat-api",
                  title: "Guard the boundary",
                  claim: "The endpoint validates IDs",
                  objective: "Confirm invalid IDs are rejected",
                  question: null,
                  order: 0,
                  risk: "high",
                  evidenceIds: ["evidence-api"],
                  sourceClaimIds: [],
                },
              ],
            },
          ],
        },
      ],
    },
    evidence: [
      {
        id: "evidence-api",
        kind: "changed",
        change: "modification",
        location: {
          path: "src/api.ts",
          side: "RIGHT",
          startLine: 20,
          endLine: 24,
        },
        fingerprint: "api-lines",
        sourceClaimIds: [],
      },
    ],
    coverage: [
      {
        evidenceId: "evidence-api",
        assignment: {
          kind: "beat",
          beatId: "beat-api",
        },
      },
    ],
    mechanicalChanges: [
      {
        id: "mechanical-lock",
        title: "Lockfile",
        reason: "Dependency resolution",
        evidenceIds: [],
      },
    ],
    sourceClaims: [],
    concerns: [
      {
        id: "concern-invalid-id",
        beatId: "beat-api",
        question: "Could an invalid ID still reach storage?",
        evidenceIds: ["evidence-api"],
        sourceClaimIds: [],
        severity: "major",
      },
    ],
    generation: {
      status: "complete",
      stages: [],
      failures: [],
    },
    sessions: {
      teammate: makeSession(),
      author: {
        ...makeSession(),
        mode: "author",
      },
    },
    lifecycle: "active",
  };
}

test("completing the review document is immutable", () => {
  const session = makeSession();
  const next = completeUltraReviewDocument(session, 1_723_000);

  assert.notEqual(next, session);
  assert.equal(next.reviewCompletedAt, 1_723_000);
  assert.deepEqual(next.concernDispositions, {});
  assert.equal(session.reviewCompletedAt, undefined);
});

test("resume updates retain a private copy of expanded evidence", () => {
  const session = makeSession();
  const expandedEvidenceIds = ["evidence-api"];
  const next = updateUltraReviewResume(session, {
    systemId: "system-api",
    chapterId: "chapter-api",
    beatId: "beat-api",
    scrollTop: 320,
    expandedEvidenceIds,
  });

  expandedEvidenceIds.push("later-mutation");

  assert.deepEqual(next.resume, {
    systemId: "system-api",
    chapterId: "chapter-api",
    beatId: "beat-api",
    scrollTop: 320,
    expandedEvidenceIds: ["evidence-api"],
  });
  assert.equal(session.resume.scrollTop, 0);
});

test("beat and line notes use trusted artifact anchors", () => {
  const artifact = makeArtifact();
  const beatSession = addUltraReviewBeatNote(
    makeSession(),
    artifact,
    {
      id: "note-beat",
      beatId: "beat-api",
      body: "Validation needs a regression test.",
      createdAt: 100,
    },
  );
  const lineSession = addUltraReviewLineNote(
    beatSession,
    artifact,
    {
      id: "note-line",
      evidenceIds: ["evidence-api"],
      body: "Reject this before the storage call.",
      startLine: 21,
      endLine: 23,
      createdAt: 101,
    },
  );

  assert.deepEqual(lineSession.notes[0].anchor, {
    kind: "beat",
    beatId: "beat-api",
  });
  assert.deepEqual(lineSession.notes[1].anchor, {
    kind: "line",
    evidenceIds: ["evidence-api"],
    path: "src/api.ts",
    side: "RIGHT",
    startLine: 21,
    endLine: 23,
    headSha: "head-def",
  });
  assert.equal(makeSession().notes.length, 0);
  assert.throws(
    () =>
      addUltraReviewLineNote(
        makeSession(),
        artifact,
        {
          id: "bad-line",
          evidenceIds: ["evidence-api"],
          body: "Outside the trusted range.",
          startLine: 19,
          endLine: 23,
          createdAt: 102,
        },
      ),
    /trusted evidence range/i,
  );
});

test("line notes span adjacent evidence and retain reviewer metadata", () => {
  const artifact = makeArtifact();
  artifact.evidence[0].location.endLine = 21;
  artifact.evidence.push({
    ...artifact.evidence[0],
    id: "evidence-api-next",
    location: {
      ...artifact.evidence[0].location,
      startLine: 22,
      endLine: 24,
    },
  });
  const added = addUltraReviewLineNote(
    makeSession(),
    artifact,
    {
      id: "note-range",
      evidenceIds: ["evidence-api", "evidence-api-next"],
      body: "The guard and storage call must move together.",
      kind: "request",
      startLine: 20,
      endLine: 24,
      createdAt: 105,
    },
  );
  const draft = {
    id: "draft-before-edit",
    body: "Existing assessment.",
  };
  const withDraft = { ...added, draft };
  const selected = updateUltraReviewNote(
    withDraft,
    "note-range",
    {
      body: added.notes[0].body,
      kind: "request",
      submitAsComment: true,
    },
  );

  assert.deepEqual(selected.notes[0].anchor.evidenceIds, [
    "evidence-api",
    "evidence-api-next",
  ]);
  assert.equal(selected.notes[0].kind, "request");
  assert.equal(selected.notes[0].submitAsComment, true);
  assert.equal(selected.draft, draft);
  assert.equal(
    ultraReviewNotesFingerprint(selected.notes),
    ultraReviewNotesFingerprint(added.notes),
  );
});

test("concern actions stay local until promotion creates a human note", () => {
  const concern = makeArtifact().concerns[0];
  const dismissed = dismissUltraReviewConcern(
    makeSession(),
    concern.id,
  );
  const verified = verifyUltraReviewConcern(
    makeSession(),
    concern.id,
  );
  const promoted = promoteUltraReviewConcern(
    makeSession(),
    concern,
    {
      body: "Invalid IDs can reach storage.",
      createdAt: 110,
    },
  );

  assert.equal(
    dismissed.concernDispositions[concern.id],
    "dismissed",
  );
  assert.equal(
    verified.concernDispositions[concern.id],
    "verified",
  );
  assert.equal(
    promoted.concernDispositions[concern.id],
    "promoted",
  );
  assert.deepEqual(promoted.notes, [
    {
      id: "concern:concern-invalid-id",
      body: "Invalid IDs can reach storage.",
      kind: "note",
      submitAsComment: false,
      anchor: {
        kind: "beat",
        beatId: "beat-api",
      },
      createdAt: 110,
      stale: false,
    },
  ]);
});

test("mechanical acknowledgment is immutable and idempotent", () => {
  const session = makeSession();
  const first = acknowledgeUltraReviewMechanicalChange(
    session,
    "mechanical-lock",
  );
  const second = acknowledgeUltraReviewMechanicalChange(
    first,
    "mechanical-lock",
  );

  assert.deepEqual(
    second.acknowledgedMechanicalChangeIds,
    ["mechanical-lock"],
  );
  assert.deepEqual(session.acknowledgedMechanicalChangeIds, []);
});

test("closing response becomes a source-linked editable draft", () => {
  const artifact = makeArtifact();
  let session = addUltraReviewBeatNote(
    makeSession(),
    artifact,
    {
      id: "note-beat",
      beatId: "beat-api",
      body: "Validation needs a regression test.",
      createdAt: 100,
    },
  );
  session = addUltraReviewLineNote(
    session,
    artifact,
    {
      id: "note-line",
      evidenceIds: ["evidence-api"],
      body: "Reject this before the storage call.",
      startLine: 21,
      endLine: 23,
      createdAt: 101,
    },
  );
  const body =
    "Please add a regression test.\n\n" +
    "Reject invalid IDs before storage.";
  const response = [
    "Synthesis complete.",
    "<ultrareview-draft>",
    JSON.stringify({
      body,
      recommendedVerdict: "REQUEST_CHANGES",
      sections: [
        {
          body: "Please add a regression test.",
          sourceNoteIds: ["note-beat"],
        },
        {
          body: "Reject invalid IDs before storage.",
          sourceNoteIds: ["note-line"],
        },
      ],
      incorporatedNoteIds: ["note-beat", "note-line"],
      combinedNoteIds: [],
      omittedNoteIds: [],
    }),
    "</ultrareview-draft>",
  ].join("");

  const draft = parseUltraReviewDraftResponse(response, {
    draftId: "draft-1",
    notes: session.notes,
    concerns: artifact.concerns,
  });

  assert.equal(draft.id, "draft-1");
  assert.equal(draft.recommendedVerdict, "REQUEST_CHANGES");
  assert.match(draft.sourceNotesFingerprint, /^notes:/);
  assert.deepEqual(draft.sections[0].provenance, {
    noteIds: ["note-beat"],
    beatIds: ["beat-api"],
    evidenceIds: [],
    concernIds: [],
  });
  assert.deepEqual(draft.inlineComments, []);
});

test("closing parser rejects detached prose, unknown notes, and invalid verdicts", () => {
  const artifact = makeArtifact();
  const session = addUltraReviewLineNote(
    makeSession(),
    artifact,
    {
      id: "note-line",
      evidenceIds: ["evidence-api"],
      body: "Reject this before the storage call.",
      startLine: 21,
      endLine: 23,
      createdAt: 101,
    },
  );
  const response = (overrides) =>
    `<ultrareview-draft>${JSON.stringify({
      body: "Reject invalid IDs before storage.",
      recommendedVerdict: "REQUEST_CHANGES",
      sections: [
        {
          body: "Reject invalid IDs before storage.",
          sourceNoteIds: ["note-line"],
        },
      ],
      incorporatedNoteIds: ["note-line"],
      combinedNoteIds: [],
      omittedNoteIds: [],
      ...overrides,
    })}</ultrareview-draft>`;

  assert.throws(
    () =>
      parseUltraReviewDraftResponse(
        `${response({})}${response({})}`,
        {
          draftId: "draft-2",
          notes: session.notes,
          concerns: artifact.concerns,
        },
      ),
    /exactly one terminal/i,
  );
  assert.throws(
    () =>
      parseUltraReviewDraftResponse(
        response({
          sections: [
            {
              body: "Brand-new criticism.",
              sourceNoteIds: [],
            },
          ],
          body: "Brand-new criticism.",
        }),
        {
          draftId: "draft-2",
          notes: session.notes,
          concerns: artifact.concerns,
        },
      ),
    /without note provenance/i,
  );
  assert.throws(
    () =>
      parseUltraReviewDraftResponse(
        response({
          sections: [
            {
              body: "Unknown source.",
              sourceNoteIds: ["note-unknown"],
            },
          ],
          body: "Unknown source.",
          incorporatedNoteIds: ["note-unknown"],
          omittedNoteIds: ["note-line"],
        }),
        {
          draftId: "draft-2",
          notes: session.notes,
          concerns: artifact.concerns,
        },
      ),
    /unknown note/i,
  );
  assert.throws(
    () =>
      parseUltraReviewDraftResponse(
        response({
          recommendedVerdict: "MERGE_IT",
        }),
        {
          draftId: "draft-2",
          notes: session.notes,
          concerns: artifact.concerns,
        },
      ),
    /recommendedVerdict/i,
  );
});

test("submission snapshot is detached and deeply frozen", () => {
  const progress = {
    documentReviewed: true,
    acknowledgedMechanicalChanges: 1,
    totalMechanicalChanges: 1,
    coveredChangedEvidence: 1,
    totalChangedEvidence: 1,
    failedRegions: 0,
    unmappedEvidence: 0,
    fullyReviewed: true,
  };
  const draft = {
    id: "draft-1",
    body: "Ship it.",
    recommendedVerdict: "APPROVE",
    sourceNotesFingerprint: "notes:test",
    sections: [],
    inlineComments: [
      {
        id: "draft-1:inline:0",
        path: "src/api.ts",
        side: "RIGHT",
        line: 23,
        startLine: 21,
        body: "One inline comment.",
        included: true,
        provenance: {
          noteIds: ["note-line"],
          beatIds: [],
          evidenceIds: ["evidence-api"],
          concernIds: [],
        },
      },
      {
        id: "draft-1:inline:1",
        path: "src/api.ts",
        side: "RIGHT",
        line: 24,
        body: "Excluded.",
        included: false,
        provenance: {
          noteIds: ["note-other"],
          beatIds: [],
          evidenceIds: ["evidence-api"],
          concernIds: [],
        },
      },
    ],
    incorporatedNoteIds: ["note-line"],
    combinedNoteIds: [],
    omittedNoteIds: ["note-other"],
  };
  const snapshot = buildUltraReviewSubmissionSnapshot({
    id: "submission-1",
    submittedAt: 200,
    headSha: "head-def",
    verdict: "REQUEST_CHANGES",
    draft,
    progress,
  });

  draft.inlineComments[0].body = "Later edit.";
  progress.documentReviewed = false;

  assert.equal(snapshot.inlineComments.length, 1);
  assert.equal(snapshot.inlineComments[0].body, "One inline comment.");
  assert.equal(snapshot.progress.documentReviewed, true);
  assert.deepEqual(snapshot.noteIds, ["note-line"]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.inlineComments[0].provenance), true);
  assert.throws(
    () => {
      snapshot.inlineComments.push(draft.inlineComments[1]);
    },
    TypeError,
  );
});

test("author mode follows case-insensitive PR authorship across forks", () => {
  assert.equal(
    ultraReviewModeForPullRequest({
      viewerLogin: "Mfrey",
      authorLogin: "mfrey",
      repositoryFullName: "OpenAI/Charon",
      headRepositoryFullName: "openai/charon",
    }),
    "author",
  );
  assert.equal(
    ultraReviewModeForPullRequest({
      viewerLogin: "mfrey",
      authorLogin: "MFREY",
      repositoryFullName: "openai/charon",
      headRepositoryFullName: "mfrey/charon",
    }),
    "author",
  );
  assert.equal(
    ultraReviewModeForPullRequest({
      viewerLogin: "mfrey",
      authorLogin: "teammate",
      repositoryFullName: "openai/charon",
      headRepositoryFullName: "openai/charon",
    }),
    "teammate",
  );
});

test("submission snapshot recording is idempotent for persistence retry", () => {
  const session = makeSession();
  const snapshot = {
    id: "snapshot-1",
    submittedAt: 200,
    headSha: "head-def",
    verdict: "APPROVE",
    body: "The boundary holds.",
    inlineComments: [],
    noteIds: [],
    progress: {
      documentReviewed: true,
      acknowledgedMechanicalChanges: 0,
      totalMechanicalChanges: 0,
      coveredChangedEvidence: 1,
      totalChangedEvidence: 1,
      failedRegions: 0,
      unmappedEvidence: 0,
      fullyReviewed: true,
    },
  };
  const once = recordUltraReviewSubmissionSnapshot(
    session,
    snapshot,
  );
  const twice = recordUltraReviewSubmissionSnapshot(
    once,
    snapshot,
  );

  assert.equal(once.snapshots.length, 1);
  assert.equal(twice, once);
});
