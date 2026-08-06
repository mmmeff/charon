import assert from "node:assert/strict";
import test from "node:test";

import {
  focusedRangeIsComplete,
  inspectUltraReviewBeatEvidence,
  projectFocusedEvidence,
} from "../../src/lib/ultrareview-evidence.ts";
import {
  enumerateUltraReviewDiffChanges,
} from "../../src/lib/ultrareview-diff-audit.ts";

const hunk = {
  type: "hunk",
  oldNum: null,
  newNum: null,
  text: "@@ -10,7 +10,8 @@",
  oldStart: 10,
  oldLines: 7,
  newStart: 10,
  newLines: 8,
};

const file = {
  oldPath: "src/review.ts",
  newPath: "src/review.ts",
  isBinary: false,
  isNew: false,
  isDeleted: false,
  isRename: false,
  lines: [
    hunk,
    { type: "context", oldNum: 10, newNum: 10, text: "const before = 1;" },
    { type: "del", oldNum: 11, newNum: null, text: "const value = oldValue;" },
    { type: "add", oldNum: null, newNum: 11, text: "const value = newValue;" },
    { type: "context", oldNum: 12, newNum: 12, text: "use(value);" },
    { type: "context", oldNum: 13, newNum: 13, text: "trace(value);" },
    { type: "add", oldNum: null, newNum: 14, text: "persist(value);" },
    { type: "context", oldNum: 14, newNum: 15, text: "return value;" },
  ],
};

test("reviewer sees only focused evidence with nearby diff context", () => {
  const projected = projectFocusedEvidence(
    [file],
    [{ path: "src/review.ts", side: "RIGHT", startLine: 14, endLine: 14 }],
    1,
  );

  assert.equal(projected.length, 1);
  assert.deepEqual(
    projected[0].lines.map((line) => [line.type, line.oldNum, line.newNum, line.text]),
    [
      ["hunk", null, null, "@@ -10,7 +10,8 @@"],
      ["context", 13, 13, "trace(value);"],
      ["add", null, 14, "persist(value);"],
      ["context", 14, 15, "return value;"],
    ],
  );
});

test("overlapping focal ranges never duplicate rendered lines", () => {
  const projected = projectFocusedEvidence(
    [file],
    [
      { path: "src/review.ts", side: "RIGHT", startLine: 11, endLine: 12 },
      { path: "src/review.ts", side: "RIGHT", startLine: 12, endLine: 14 },
    ],
    0,
  );

  assert.deepEqual(
    projected[0].lines.filter((line) => line.type !== "hunk").map((line) => line.text),
    ["const value = newValue;", "use(value);", "trace(value);", "persist(value);"],
  );
});

test("left-side evidence keeps deleted lines and shared context", () => {
  const projected = projectFocusedEvidence(
    [file],
    [{ path: "src/review.ts", side: "LEFT", startLine: 11, endLine: 11 }],
    1,
  );

  assert.deepEqual(
    projected[0].lines.filter((line) => line.type !== "hunk").map((line) => line.text),
    ["const before = 1;", "const value = oldValue;", "use(value);"],
  );
});

test("binary evidence remains visible as a complete file marker", () => {
  const binary = {
    oldPath: "assets/logo.png",
    newPath: "assets/logo.png",
    isBinary: true,
    isNew: false,
    isDeleted: false,
    isRename: false,
    lines: [],
  };

  assert.deepEqual(
    projectFocusedEvidence(
      [binary],
      [{ path: "assets/logo.png", side: "RIGHT", startLine: 0, endLine: 0 }],
    ),
    [binary],
  );
});

test("review credit requires every trusted line to exist", () => {
  assert.equal(
    focusedRangeIsComplete(
      [file],
      {
        path: "src/review.ts",
        side: "RIGHT",
        startLine: 11,
        endLine: 14,
      },
    ),
    true,
  );
  assert.equal(
    focusedRangeIsComplete(
      [file],
      {
        path: "src/review.ts",
        side: "RIGHT",
        startLine: 11,
        endLine: 16,
      },
    ),
    false,
  );
});

test("file-level evidence requires an exact diff marker and explicit credit", () => {
  const renamed = {
    oldPath: "src/old.ts",
    newPath: "src/new.ts",
    isBinary: false,
    isNew: false,
    isDeleted: false,
    isRename: true,
    lines: [],
  };
  const [change] = enumerateUltraReviewDiffChanges([renamed]);
  const evidence = {
    ...change,
    kind: "changed",
    sourceClaimIds: [],
  };

  assert.deepEqual(
    inspectUltraReviewBeatEvidence(
      [renamed],
      [evidence],
      [],
      [],
    ),
    {
      ready: false,
      hasReviewEvidence: true,
      exactChangedEvidence: true,
      outstandingStructuralEvidenceIds: [evidence.id],
      outstandingRemovedEvidenceIds: [],
    },
  );
  assert.equal(
    inspectUltraReviewBeatEvidence(
      [renamed],
      [evidence],
      [],
      [evidence.id],
    ).ready,
    true,
  );
  assert.equal(
    inspectUltraReviewBeatEvidence(
      [{ ...renamed, isRename: false }],
      [evidence],
      [],
      [evidence.id],
    ).ready,
    false,
  );
});

test("removed delta evidence has a separate acknowledgement path", () => {
  assert.deepEqual(
    inspectUltraReviewBeatEvidence(
      [],
      [],
      ["evidence:prior"],
      [],
    ),
    {
      ready: false,
      hasReviewEvidence: true,
      exactChangedEvidence: true,
      outstandingStructuralEvidenceIds: [],
      outstandingRemovedEvidenceIds: ["evidence:prior"],
    },
  );
  assert.equal(
    inspectUltraReviewBeatEvidence(
      [],
      [],
      ["evidence:prior"],
      ["evidence:prior"],
    ).ready,
    true,
  );
});
