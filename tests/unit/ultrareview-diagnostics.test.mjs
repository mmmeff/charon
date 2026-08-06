import assert from "node:assert/strict";
import test from "node:test";

import {
  appendUltraReviewDiagnostic,
  createUltraReviewDiagnostics,
  parseUltraReviewDiagnostics,
  serializeUltraReviewDiagnostics,
} from "../../src/lib/ultrareview-diagnostics.ts";

const completedStage = {
  stageId: "analysis.parse",
  elapsedMs: 843,
  retryCount: 0,
  outcome: "success",
  failureCategory: null,
};

test("safe stage metadata round-trips through a native blob string", () => {
  const diagnostics = appendUltraReviewDiagnostic(
    createUltraReviewDiagnostics(),
    completedStage,
  );

  const parsed = parseUltraReviewDiagnostics(
    serializeUltraReviewDiagnostics(diagnostics),
  );

  assert.deepEqual(parsed, {
    diagnostics,
    rejectedEntryCount: 0,
  });
});

test("append is immutable and retains only the newest bounded entries", () => {
  const empty = createUltraReviewDiagnostics();
  const first = appendUltraReviewDiagnostic(empty, completedStage, {
    entryLimit: 2,
  });
  const second = appendUltraReviewDiagnostic(
    first,
    {
      ...completedStage,
      stageId: "analysis.audit",
      elapsedMs: 91,
    },
    { entryLimit: 2 },
  );
  const third = appendUltraReviewDiagnostic(
    second,
    {
      stageId: "analysis.persist",
      elapsedMs: 17,
      retryCount: 1,
      outcome: "failure",
      failureCategory: "persistence",
    },
    { entryLimit: 2 },
  );

  assert.deepEqual(empty.entries, []);
  assert.deepEqual(
    third.entries.map((entry) => entry.stageId),
    ["analysis.audit", "analysis.persist"],
  );
});

test("outcome and failure category must agree", () => {
  const diagnostics = createUltraReviewDiagnostics();

  assert.throws(
    () =>
      appendUltraReviewDiagnostic(diagnostics, {
        ...completedStage,
        failureCategory: "generation",
      }),
    /successful stage cannot have a failure category/,
  );
  assert.throws(
    () =>
      appendUltraReviewDiagnostic(diagnostics, {
        ...completedStage,
        outcome: "failure",
      }),
    /failed stage requires a failure category/,
  );
});

test("append rejects prose and payload fields instead of storing them", () => {
  const diagnostics = createUltraReviewDiagnostics();
  const unsafeFields = [
    ["body", "pull request body"],
    ["diff", "@@ -1 +1 @@"],
    ["commentText", "review comment"],
    ["note", "reviewer note"],
    ["modelContent", "model output"],
    ["payloadBody", "GitHub request body"],
  ];

  for (const [field, value] of unsafeFields) {
    assert.throws(
      () =>
        appendUltraReviewDiagnostic(diagnostics, {
          ...completedStage,
          [field]: value,
        }),
      new RegExp(`unsupported field ${field}`),
    );
  }
});

test("stage identifiers cannot smuggle arbitrary prose", () => {
  assert.throws(
    () =>
      appendUltraReviewDiagnostic(createUltraReviewDiagnostics(), {
        ...completedStage,
        stageId: "The PR body says to approve this change.",
      }),
    /stageId must be a bounded machine identifier/,
  );
});

test("parse omits unsafe entries and all unrecognized root content", () => {
  const raw = JSON.stringify({
    version: 1,
    body: "pull request prose",
    payload: { body: "GitHub request body" },
    entries: [
      completedStage,
      {
        ...completedStage,
        stageId: "analysis.generate",
        modelContent: "private model prose",
      },
      {
        ...completedStage,
        stageId: "analysis.review",
        note: "private reviewer note",
      },
    ],
  });

  const parsed = parseUltraReviewDiagnostics(raw);
  const serialized = serializeUltraReviewDiagnostics(parsed.diagnostics);

  assert.deepEqual(parsed.diagnostics.entries, [completedStage]);
  assert.equal(parsed.rejectedEntryCount, 2);
  assert.equal(serialized.includes("pull request prose"), false);
  assert.equal(serialized.includes("GitHub request body"), false);
  assert.equal(serialized.includes("private model prose"), false);
  assert.equal(serialized.includes("private reviewer note"), false);
});

test("parse rejects malformed roots and unknown versions", () => {
  assert.throws(
    () => parseUltraReviewDiagnostics("[]"),
    /diagnostics root must be an object/,
  );
  assert.throws(
    () =>
      parseUltraReviewDiagnostics(
        JSON.stringify({ version: 2, entries: [] }),
      ),
    /unsupported diagnostics version 2/,
  );
});
