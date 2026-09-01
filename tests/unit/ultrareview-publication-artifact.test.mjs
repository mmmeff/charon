import assert from "node:assert/strict";
import test, { after } from "node:test";

import { createServer } from "vite";

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
const {
  appendUltraReviewChapterPublication,
  assembleUltraReviewPlanPublication,
  completeUltraReviewPublication,
  ultraReviewPublicationIssues,
} = await server.ssrLoadModule(
  "/src/lib/ultrareview-publication-artifact.ts",
);
const {
  enumerateUltraReviewDiffChanges,
} = await server.ssrLoadModule(
  "/src/lib/ultrareview-diff-audit.ts",
);
const { parseUnifiedDiff } = await server.ssrLoadModule(
  "/src/lib/diff.ts",
);

after(async () => {
  await server.close();
});

const identity = {
  repo: "openai/charon",
  prNumber: 42,
  baseSha: "base-abc",
  headSha: "head-def",
};

const diff = [
  "diff --git a/src/one.ts b/src/one.ts",
  "index 1111111..2222222 100644",
  "--- a/src/one.ts",
  "+++ b/src/one.ts",
  "@@ -0,0 +1 @@",
  "+export const one = 1;",
  "diff --git a/src/two.ts b/src/two.ts",
  "index 3333333..4444444 100644",
  "--- a/src/two.ts",
  "+++ b/src/two.ts",
  "@@ -0,0 +1 @@",
  "+export const two = 2;",
].join("\n");
const trustedEvidence = enumerateUltraReviewDiffChanges(
  parseUnifiedDiff(diff),
).map((evidence) => ({ ...evidence, kind: "changed" }));
const headFiles = new Map([
  [
    "src/context.ts",
    [
      "export interface Publisher {",
      "  publish(): Promise<void>;",
      "}",
    ].join("\n"),
  ],
]);
const readHeadFile = async (path) => {
  const content = headFiles.get(path);
  if (content === undefined) throw new Error("not found");
  return content;
};

function planPublication() {
  return {
    thesis: "Publish review chapters without repeating prior work.",
    grounding: [{
      kind: "author_stated",
      claim: "The publisher should expose each chapter once.",
    }],
    systems: [{
      key: "publisher",
      title: "Review publisher",
      thesis: "Charon assembles bounded semantic chapter calls.",
      risk: "medium",
      chapters: [
        {
          key: "one",
          title: "Publish the first chapter",
        },
        {
          key: "two",
          title: "Publish the second chapter",
        },
      ],
    }],
  };
}

function chapterPublication(index, context = []) {
  const number = index + 1;
  const word = number === 1 ? "one" : "two";
  return {
    chapterKey: word,
    purpose: "Expose completed review work immediately.",
    before: "The reviewer waits for the full analysis.",
    after: "The reviewer can start with this chapter.",
    risk: "medium",
    ...(index === 0
      ? {}
      : { dependencyChapterKeys: ["one"] }),
    beats: [{
      title: `Explain chapter ${word}`,
      claim: `Chapter ${word} owns its changed evidence.`,
      why: "This chapter advances incremental review generation.",
      risk: "medium",
      changedEvidenceIds: [trustedEvidence[index].id],
      context,
      concerns: index === 0
        ? [{
            severity: "minor",
            question: "Does the publisher keep this context stable?",
          }]
        : [],
    }],
  };
}

test("Charon normalizes semantic chapter calls into one artifact", async () => {
  const planned = assembleUltraReviewPlanPublication(
    identity,
    planPublication(),
    trustedEvidence,
  );
  const firstPayload = chapterPublication(0, [{
    path: "src/context.ts",
    startLine: 1,
    endLine: 3,
    reason: "Defines the interface used by the changed publisher.",
  }]);
  const first = await appendUltraReviewChapterPublication(
    planned.artifact,
    firstPayload,
    trustedEvidence,
    readHeadFile,
  );
  const secondPayload = chapterPublication(1);
  const second = await appendUltraReviewChapterPublication(
    first.artifact,
    secondPayload,
    trustedEvidence,
    readHeadFile,
  );
  const completed = completeUltraReviewPublication(
    second.artifact,
    { failedChapters: [] },
  );

  assert.deepEqual(planned.receipt.chapterIds, {
    one: "chapter:one",
    two: "chapter:two",
  });
  assert.deepEqual(
    first.artifact.galaxy.systems[0].chapters.map(
      (chapter) => chapter.id,
    ),
    ["chapter:one"],
  );
  assert.deepEqual(
    completed.artifact.galaxy.systems[0].chapters.map(
      (chapter) => chapter.id,
    ),
    ["chapter:one", "chapter:two"],
  );
  assert.equal(completed.artifact.generation.status, "complete");
  assert.equal(completed.artifact.evidence.length, 3);
  assert.equal(completed.artifact.coverage.length, 2);
  assert.deepEqual(
    completed.artifact.galaxy.systems[0].scope,
    { changedLines: 2, files: 2 },
  );
  const supporting = first.artifact.evidence.find(
    (evidence) => evidence.kind === "supporting",
  );
  assert.ok(supporting);
  assert.equal(supporting.change, "context");
  assert.equal(supporting.location.side, "RIGHT");
  assert.equal(supporting.location.path, "src/context.ts");
  assert.match(supporting.id, /^evidence:[0-9a-f]{16}$/);
  assert.equal(supporting.sourceClaimIds.length, 1);
  assert.equal(first.receipt.supportingEvidenceIds[0], supporting.id);
  assert.equal(first.receipt.beatIds.length, 1);
  assert.equal(first.receipt.concernIds.length, 1);
  assert.doesNotMatch(
    JSON.stringify(firstPayload),
    /sourceClaimIds|fingerprint|supportingEvidence|"id"|"order"/,
  );
});

test("supporting context paths are normalized to the repository root", async () => {
  const nestedDiff = [
    "diff --git a/services/fusion/apps/web/src/changed.ts b/services/fusion/apps/web/src/changed.ts",
    "index 1111111..2222222 100644",
    "--- a/services/fusion/apps/web/src/changed.ts",
    "+++ b/services/fusion/apps/web/src/changed.ts",
    "@@ -0,0 +1 @@",
    "+export const changed = true;",
  ].join("\n");
  const nestedEvidence = enumerateUltraReviewDiffChanges(
    parseUnifiedDiff(nestedDiff),
  ).map((evidence) => ({ ...evidence, kind: "changed" }));
  const nestedPlan = assembleUltraReviewPlanPublication(
    identity,
    planPublication(),
    nestedEvidence,
  );
  const attemptedPaths = [];
  const nestedReader = async (path) => {
    attemptedPaths.push(path);
    if (
      path
      === "services/fusion/apps/web/src/context.ts"
    ) {
      return "export const context = true;";
    }
    throw new Error("not found");
  };
  const payload = chapterPublication(0, [{
    path: "apps/web/src/context.ts",
    startLine: 1,
    endLine: 1,
    reason: "Explains the adjacent runtime contract.",
  }]);
  payload.beats[0].changedEvidenceIds = [nestedEvidence[0].id];

  const published = await appendUltraReviewChapterPublication(
    nestedPlan.artifact,
    payload,
    nestedEvidence,
    nestedReader,
  );
  const supporting = published.artifact.evidence.find(
    (evidence) => evidence.kind === "supporting",
  );

  assert.deepEqual(attemptedPaths, [
    "apps/web/src/context.ts",
    "services/fusion/apps/web/src/context.ts",
  ]);
  assert.equal(
    supporting.location.path,
    "services/fusion/apps/web/src/context.ts",
  );
});

test("a chapter cannot repeat changed evidence", async () => {
  const planned = assembleUltraReviewPlanPublication(
    identity,
    planPublication(),
    trustedEvidence,
  );
  const first = await appendUltraReviewChapterPublication(
    planned.artifact,
    chapterPublication(0),
    trustedEvidence,
    readHeadFile,
  );
  const repeated = chapterPublication(1);
  repeated.beats[0].changedEvidenceIds = [trustedEvidence[0].id];

  await assert.rejects(
    () => appendUltraReviewChapterPublication(
      first.artifact,
      repeated,
      trustedEvidence,
      readHeadFile,
    ),
    (error) => {
      const [issue] = ultraReviewPublicationIssues(error);
      assert.equal(issue.code, "EVIDENCE_ALREADY_ASSIGNED");
      assert.equal(issue.path, "beats[0].changedEvidenceIds[0]");
      assert.match(issue.message, /chapter one/);
      return true;
    },
  );
});

test("context range errors describe the semantic repair", async () => {
  const planned = assembleUltraReviewPlanPublication(
    identity,
    planPublication(),
    trustedEvidence,
  );

  await assert.rejects(
    () => appendUltraReviewChapterPublication(
      planned.artifact,
      chapterPublication(0, [{
        path: "src/context.ts",
        startLine: 2,
        endLine: 40,
        reason: "Defines the publisher interface.",
      }]),
      trustedEvidence,
      readHeadFile,
    ),
    (error) => {
      const [issue] = ultraReviewPublicationIssues(error);
      assert.equal(issue.code, "INVALID_CONTEXT_RANGE");
      assert.equal(issue.path, "beats[0].context[0]");
      assert.match(issue.message, /has 3 lines/);
      assert.match(issue.repair, /between lines 1 and 3/);
      return true;
    },
  );
});

test("supporting context cannot repeat changed lines", async () => {
  const planned = assembleUltraReviewPlanPublication(
    identity,
    planPublication(),
    trustedEvidence,
  );

  await assert.rejects(
    () => appendUltraReviewChapterPublication(
      planned.artifact,
      chapterPublication(0, [{
        path: "src/one.ts",
        startLine: 1,
        endLine: 1,
        reason: "Repeats the changed export.",
      }]),
      trustedEvidence,
      readHeadFile,
    ),
    (error) => {
      const [issue] = ultraReviewPublicationIssues(error);
      assert.equal(issue.code, "CONTEXT_OVERLAPS_CHANGE");
      assert.equal(issue.path, "beats[0].context[0]");
      assert.match(issue.repair, /changedEvidenceIds/);
      return true;
    },
  );
});

test("a mechanical-only chapter receives generated provenance", async () => {
  const planned = assembleUltraReviewPlanPublication(
    identity,
    planPublication(),
    trustedEvidence,
  );
  const published = await appendUltraReviewChapterPublication(
    planned.artifact,
    {
      chapterKey: "one",
      purpose: "Group generated changes without inventing a review beat.",
      before: "The generated output was stale.",
      after: "The generated output matches its source.",
      risk: "low",
      beats: [],
      mechanicalChanges: [{
        title: "Generated output",
        reason: "This line is generated from the source definition.",
        changedEvidenceIds: [trustedEvidence[0].id],
      }],
    },
    trustedEvidence,
    readHeadFile,
  );

  const [chapter] = published.artifact.galaxy.systems[0].chapters;
  const [mechanical] = published.artifact.mechanicalChanges;
  const claim = published.artifact.sourceClaims.find(
    (source) => source.id === chapter.sourceClaimIds[0],
  );
  assert.deepEqual(chapter.beats, []);
  assert.deepEqual(mechanical.evidenceIds, [trustedEvidence[0].id]);
  assert.deepEqual(claim.evidenceIds, [trustedEvidence[0].id]);
  assert.deepEqual(
    published.artifact.galaxy.systems[0].scope,
    { changedLines: 1, files: 1 },
  );
});

test("finish_review normalizes failed chapter ownership", async () => {
  const planned = assembleUltraReviewPlanPublication(
    identity,
    planPublication(),
    trustedEvidence,
  );
  const first = await appendUltraReviewChapterPublication(
    planned.artifact,
    chapterPublication(0),
    trustedEvidence,
    readHeadFile,
  );
  const completed = completeUltraReviewPublication(
    first.artifact,
    {
      failedChapters: [{
        chapterKey: "two",
        message: "Repository context was unavailable.",
        retryable: true,
      }],
    },
  );

  assert.equal(completed.artifact.generation.status, "partial");
  assert.deepEqual(
    completed.artifact.generation.failures.map((failure) => ({
      stageId: failure.stageId,
      scope: failure.scope,
      systemId: failure.systemId,
      chapterId: failure.chapterId,
      evidenceIds: failure.evidenceIds,
    })),
    [{
      stageId: "chapter:two",
      scope: "system",
      systemId: "system:publisher",
      chapterId: null,
      evidenceIds: [],
    }],
  );
});
