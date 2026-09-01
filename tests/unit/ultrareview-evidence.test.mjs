import assert from "node:assert/strict";
import test from "node:test";

import {
  projectFocusedEvidence,
  projectOwnedBeatHunks,
  projectOwnedHunksByBeat,
} from "../../src/lib/ultrareview-evidence.ts";

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

test("one causal beat owns each physical diff hunk", () => {
  const secondHunk = {
    type: "hunk",
    oldNum: null,
    newNum: null,
    text: "@@ -30,1 +31,2 @@",
    oldStart: 30,
    oldLines: 1,
    newStart: 31,
    newLines: 2,
  };
  const twoHunks = {
    ...file,
    lines: [
      ...file.lines,
      secondHunk,
      { type: "context", oldNum: 30, newNum: 31, text: "const later = 1;" },
      { type: "add", oldNum: null, newNum: 32, text: "publish(later);" },
    ],
  };
  const artifact = {
    galaxy: {
      systems: [{
        order: 0,
        chapters: [{
          order: 0,
          beats: [
            { id: "beat:first", order: 0 },
            { id: "beat:overlap", order: 1 },
            { id: "beat:later", order: 2 },
          ],
        }],
      }],
    },
    evidence: [
      {
        id: "evidence:first",
        kind: "changed",
        location: {
          path: "src/review.ts",
          side: "RIGHT",
          startLine: 11,
          endLine: 11,
        },
      },
      {
        id: "evidence:overlap",
        kind: "changed",
        location: {
          path: "src/review.ts",
          side: "RIGHT",
          startLine: 14,
          endLine: 14,
        },
      },
      {
        id: "evidence:later",
        kind: "changed",
        location: {
          path: "src/review.ts",
          side: "RIGHT",
          startLine: 32,
          endLine: 32,
        },
      },
    ],
    coverage: [
      {
        evidenceId: "evidence:first",
        assignment: { kind: "beat", beatId: "beat:first" },
      },
      {
        evidenceId: "evidence:overlap",
        assignment: { kind: "beat", beatId: "beat:overlap" },
      },
      {
        evidenceId: "evidence:later",
        assignment: { kind: "beat", beatId: "beat:later" },
      },
    ],
  };

  const first = projectOwnedBeatHunks(
    [twoHunks],
    artifact,
    "beat:first",
  );
  const overlap = projectOwnedBeatHunks(
    [twoHunks],
    artifact,
    "beat:overlap",
  );
  const later = projectOwnedBeatHunks(
    [twoHunks],
    artifact,
    "beat:later",
  );
  const projectedByBeat = projectOwnedHunksByBeat(
    [twoHunks],
    artifact,
  );

  assert.deepEqual(
    first[0].lines.filter((line) => line.type === "hunk").map((line) => line.text),
    [hunk.text],
  );
  assert.deepEqual(overlap, []);
  assert.deepEqual(
    later[0].lines.filter((line) => line.type === "hunk").map((line) => line.text),
    [secondHunk.text],
  );
  assert.deepEqual(projectedByBeat.get("beat:first"), first);
  assert.deepEqual(projectedByBeat.get("beat:overlap"), overlap);
  assert.deepEqual(projectedByBeat.get("beat:later"), later);
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
