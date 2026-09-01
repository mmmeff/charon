import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUltraReviewSubmission,
  submitUltraReviewWithReceipt,
} from "../../src/lib/ultrareview-submission.ts";

const draft = {
  body: "The persistence path is sound after the requested retry fix.",
  sections: [
    {
      id: "section-1",
      body: "The persistence path is sound.",
      sourceNoteIds: ["note-1"],
    },
  ],
  comments: [
    {
      key: "comment-1",
      path: "src/store.ts",
      line: 42,
      side: "RIGHT",
      body: "Please retain the head SHA in this record.",
      severity: "major",
      confidence: 100,
      included: true,
    },
  ],
};

const snapshot = {
  id: "snapshot-1",
  submittedAt: 100,
  headSha: "head-sha",
  verdict: "REQUEST_CHANGES",
  body: draft.body,
  inlineComments: [],
  noteIds: ["note-1"],
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

test("reviewer builds the exact GitHub payload from known human notes", () => {
  const payload = buildUltraReviewSubmission({
    draft,
    verdict: "REQUEST_CHANGES",
    knownNoteIds: new Set(["note-1"]),
    missingCoverageIds: [],
    incompleteAcknowledged: false,
  });

  assert.deepEqual(payload, {
    body: draft.body,
    event: "REQUEST_CHANGES",
    comments: draft.comments,
  });
});

test("model cannot introduce a draft section without human-note provenance", () => {
  assert.throws(
    () =>
      buildUltraReviewSubmission({
        draft: {
          ...draft,
          sections: [
            {
              id: "invented",
              body: "A new criticism appeared at closing.",
              sourceNoteIds: ["missing-note"],
            },
          ],
        },
        verdict: "COMMENT",
        knownNoteIds: new Set(["note-1"]),
        missingCoverageIds: [],
        incompleteAcknowledged: false,
      }),
    /unknown note missing-note/,
  );
});

test("incomplete review requires one explicit acknowledgment", () => {
  assert.throws(
    () =>
      buildUltraReviewSubmission({
        draft,
        verdict: "APPROVE",
        knownNoteIds: new Set(["note-1"]),
        missingCoverageIds: ["beat-3", "mechanical"],
        incompleteAcknowledged: false,
      }),
    /beat-3, mechanical/,
  );

  assert.equal(
    buildUltraReviewSubmission({
      draft,
      verdict: "APPROVE",
      knownNoteIds: new Set(["note-1"]),
      missingCoverageIds: ["beat-3", "mechanical"],
      incompleteAcknowledged: true,
    }).event,
    "APPROVE",
  );
});

test("submission does not report success before the local receipt persists", async () => {
  let finishPersistence;
  const persistence = new Promise((resolve) => {
    finishPersistence = resolve;
  });
  let settled = false;
  const pending = submitUltraReviewWithReceipt({
    snapshot,
    submit: async () => "https://github.test/review/1",
    persist: async () => persistence,
  });
  void pending.then(() => {
    settled = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  finishPersistence();
  assert.deepEqual(await pending, {
    status: "persisted",
    url: "https://github.test/review/1",
  });
});

test("a failed local receipt is recoverable without posting twice", async () => {
  let submissionCount = 0;
  let persistenceCount = 0;
  const persist = async () => {
    persistenceCount += 1;
    if (persistenceCount === 1) {
      throw new Error("disk full");
    }
  };
  const outcome = await submitUltraReviewWithReceipt({
    snapshot,
    submit: async () => {
      submissionCount += 1;
      return "https://github.test/review/2";
    },
    persist,
  });

  assert.equal(outcome.status, "persistence_failed");
  assert.equal(outcome.url, "https://github.test/review/2");
  assert.equal(outcome.error, "disk full");
  await persist(outcome.snapshot);
  assert.equal(submissionCount, 1);
  assert.equal(persistenceCount, 2);
});
