import assert from "node:assert/strict";
import test from "node:test";

import {
  auditUltraReviewDiff,
  enumerateUltraReviewDiffChanges,
  fingerprintUltraReviewDiffRange,
} from "../../src/lib/ultrareview-diff-audit.ts";

const sourceFile = {
  oldPath: "src/review.ts",
  newPath: "src/review.ts",
  isBinary: false,
  isNew: false,
  isDeleted: false,
  isRename: false,
  lines: [
    {
      type: "hunk",
      oldNum: null,
      newNum: null,
      text: "@@ -10,2 +10,2 @@",
      oldStart: 10,
      oldLines: 2,
      newStart: 10,
      newLines: 2,
    },
    {
      type: "del",
      oldNum: 10,
      newNum: null,
      text: "const verdict = oldVerdict;",
    },
    {
      type: "add",
      oldNum: null,
      newNum: 10,
      text: "const verdict = nextVerdict;",
    },
    {
      type: "context",
      oldNum: 11,
      newNum: 11,
      text: "submit(verdict);",
    },
  ],
};

const evidenceFrom = (change, overrides = {}) => ({
  id: change.id,
  kind: "changed",
  change: change.change,
  location: change.location,
  fingerprint: change.fingerprint,
  sourceClaimIds: [],
  ...overrides,
});

const artifactWith = (evidence, coverage) => ({
  evidence,
  coverage,
});

test("trusted inventory enumerates additions and deletions, then proves exact primary coverage", () => {
  const changes = enumerateUltraReviewDiffChanges([sourceFile]);

  assert.deepEqual(
    changes.map((change) => ({
      change: change.change,
      path: change.location.path,
      side: change.location.side,
      line: change.location.startLine,
      text: change.text,
    })),
    [
      {
        change: "deletion",
        path: "src/review.ts",
        side: "LEFT",
        line: 10,
        text: "const verdict = oldVerdict;",
      },
      {
        change: "addition",
        path: "src/review.ts",
        side: "RIGHT",
        line: 10,
        text: "const verdict = nextVerdict;",
      },
    ],
  );

  const evidence = changes.map((change) => evidenceFrom(change));
  const coverage = evidence.map((item) => ({
    evidenceId: item.id,
    assignment: {
      kind: "unmapped",
      reason: "Awaiting narrative classification",
    },
  }));
  const audit = auditUltraReviewDiff(
    [sourceFile],
    artifactWith(evidence, coverage),
  );

  assert.equal(audit.complete, true);
  assert.deepEqual(audit.invalidEvidence, []);
  assert.deepEqual(audit.uncoveredChangeIds, []);
  assert.deepEqual(audit.duplicatePrimaryCoverage, []);
});

test("trusted inventory keeps rename, binary, and whitespace-only changes visible", () => {
  const rename = {
    oldPath: "src/old-name.ts",
    newPath: "src/new-name.ts",
    isBinary: false,
    isNew: false,
    isDeleted: false,
    isRename: true,
    lines: [],
  };
  const binary = {
    oldPath: "assets/logo.png",
    newPath: "assets/logo.png",
    isBinary: true,
    isNew: false,
    isDeleted: false,
    isRename: false,
    lines: [],
  };
  const whitespace = {
    oldPath: "src/format.ts",
    newPath: "src/format.ts",
    isBinary: false,
    isNew: false,
    isDeleted: false,
    isRename: false,
    lines: [
      {
        type: "hunk",
        oldNum: null,
        newNum: null,
        text: "@@ -3 +3 @@",
      },
      {
        type: "del",
        oldNum: 3,
        newNum: null,
        text: "const count=1;",
      },
      {
        type: "add",
        oldNum: null,
        newNum: 3,
        text: "const count = 1;",
      },
    ],
  };

  const changes = enumerateUltraReviewDiffChanges([
    rename,
    binary,
    whitespace,
  ]);

  assert.deepEqual(
    changes.map((change) => ({
      change: change.change,
      path: change.location.path,
      oldPath: change.location.oldPath,
      side: change.location.side,
      startLine: change.location.startLine,
      endLine: change.location.endLine,
      text: change.text,
    })),
    [
      {
        change: "rename",
        path: "src/new-name.ts",
        oldPath: "src/old-name.ts",
        side: "RIGHT",
        startLine: null,
        endLine: null,
        text: null,
      },
      {
        change: "binary",
        path: "assets/logo.png",
        oldPath: undefined,
        side: "RIGHT",
        startLine: null,
        endLine: null,
        text: null,
      },
      {
        change: "whitespace",
        path: "src/format.ts",
        oldPath: undefined,
        side: "LEFT",
        startLine: 3,
        endLine: 3,
        text: "const count=1;",
      },
      {
        change: "whitespace",
        path: "src/format.ts",
        oldPath: undefined,
        side: "RIGHT",
        startLine: 3,
        endLine: 3,
        text: "const count = 1;",
      },
    ],
  );

  const evidence = changes.map((change) =>
    evidenceFrom(change),
  );
  const audit = auditUltraReviewDiff(
    [rename, binary, whitespace],
    artifactWith(
      evidence,
      evidence.map((item) => ({
        evidenceId: item.id,
        assignment: {
          kind: "unmapped",
          reason: "Inventory verification",
        },
      })),
    ),
  );

  assert.equal(audit.complete, true);
  assert.deepEqual(audit.uncoveredChangeIds, []);
});

test("overlapping primary ranges are duplicates and supporting evidence covers nothing", () => {
  const file = {
    ...sourceFile,
    lines: [
      {
        type: "hunk",
        oldNum: null,
        newNum: null,
        text: "@@ -10,0 +10,3 @@",
      },
      {
        type: "add",
        oldNum: null,
        newNum: 10,
        text: "const first = true;",
      },
      {
        type: "add",
        oldNum: null,
        newNum: 11,
        text: "const second = true;",
      },
      {
        type: "add",
        oldNum: null,
        newNum: 12,
        text: "const supportOnly = true;",
      },
    ],
  };
  const changes = enumerateUltraReviewDiffChanges([file]);
  const range = evidenceFrom(changes[0], {
    id: "changed-range",
    location: {
      ...changes[0].location,
      endLine: 11,
    },
    fingerprint: fingerprintUltraReviewDiffRange(
      changes.slice(0, 2),
    ),
  });
  const overlap = evidenceFrom(changes[1], {
    id: "changed-overlap",
  });
  const supporting = {
    id: "supporting-context",
    kind: "supporting",
    change: "context",
    location: changes[2].location,
    fingerprint: changes[2].fingerprint,
    sourceClaimIds: [],
    supportingReason: "Shows the caller",
  };
  const audit = auditUltraReviewDiff(
    [file],
    artifactWith(
      [range, overlap, supporting],
      [
        {
          evidenceId: range.id,
          assignment: {
            kind: "unmapped",
            reason: "Pending",
          },
        },
        {
          evidenceId: overlap.id,
          assignment: {
            kind: "unmapped",
            reason: "Pending",
          },
        },
        {
          evidenceId: supporting.id,
          assignment: {
            kind: "unmapped",
            reason: "Must not count",
          },
        },
      ],
    ),
  );

  assert.deepEqual(audit.invalidEvidence, []);
  assert.deepEqual(audit.uncoveredChangeIds, [
    changes[2].id,
  ]);
  assert.deepEqual(audit.duplicatePrimaryCoverage, [
    {
      changeId: changes[1].id,
      evidenceIds: [range.id, overlap.id],
      assignmentCount: 2,
    },
  ]);
  assert.deepEqual(
    audit.supportingCoverageEvidenceIds,
    [supporting.id],
  );
  assert.equal(audit.complete, false);
});

test("stale, out-of-range, malformed, and misclassified evidence fails closed", () => {
  const rename = {
    oldPath: "src/before.ts",
    newPath: "src/after.ts",
    isBinary: false,
    isNew: false,
    isDeleted: false,
    isRename: true,
    lines: [],
  };
  const changes = enumerateUltraReviewDiffChanges([
    sourceFile,
    rename,
  ]);
  const deletion = changes[0];
  const addition = changes[1];
  const renameChange = changes[2];
  const stale = evidenceFrom(addition, {
    id: "stale-content",
    fingerprint: "old-content-fingerprint",
  });
  const outside = evidenceFrom(deletion, {
    id: "outside-range",
    location: {
      ...deletion.location,
      startLine: 99,
      endLine: 99,
    },
  });
  const malformed = evidenceFrom(renameChange, {
    id: "half-line-free",
    location: {
      ...renameChange.location,
      endLine: 1,
    },
  });
  const misclassified = evidenceFrom(deletion, {
    id: "wrong-change-kind",
    change: "addition",
  });
  const evidence = [
    stale,
    outside,
    malformed,
    misclassified,
  ];
  const audit = auditUltraReviewDiff(
    [sourceFile, rename],
    artifactWith(
      evidence,
      evidence.map((item) => ({
        evidenceId: item.id,
        assignment: {
          kind: "unmapped",
          reason: "Invalid model claim",
        },
      })),
    ),
  );

  assert.deepEqual(audit.invalidEvidence, [
    {
      evidenceId: stale.id,
      reason: "fingerprint-mismatch",
    },
    {
      evidenceId: outside.id,
      reason: "outside-diff",
    },
    {
      evidenceId: malformed.id,
      reason: "outside-diff",
    },
    {
      evidenceId: misclassified.id,
      reason: "change-mismatch",
    },
  ]);
  assert.deepEqual(
    new Set(audit.uncoveredChangeIds),
    new Set(changes.map((change) => change.id)),
  );
  assert.equal(audit.complete, false);
});
