import assert from "node:assert/strict";
import test, { after } from "node:test";

import { createServer } from "vite";

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const server = await createServer({
  root: process.cwd(),
  server: {
    middlewareMode: true,
  },
  appType: "custom",
  logLevel: "silent",
});
const {
  buildUltraReviewFocusedRetryInstruction,
  mergeUltraReviewProgressArtifact,
  mergeFocusedRetry,
  resolveUltraReviewGenerationModel,
  ultraReviewCandidatePreservesPublishedChapters,
  ultraReviewProgressArtifactIsSafe,
} = await server.ssrLoadModule(
  "/src/lib/ultrareview-flow.ts",
);
const {
  enumerateUltraReviewDiffChanges,
} = await server.ssrLoadModule(
  "/src/lib/ultrareview-diff-audit.ts",
);
const {
  FLOW_MODEL_CATALOG,
  resolveFlowFastMode,
  resolveFlowReasoning,
} = await server.ssrLoadModule(
  "/src/lib/defaults.ts",
);
const {
  createUltraReviewArtifact,
  parseUltraReviewAnalysisJson,
} = await server.ssrLoadModule(
  "/src/lib/ultraReview.ts",
);
const {
  appendUltraReviewChapterPublication,
  assembleUltraReviewPlanPublication,
} = await server.ssrLoadModule(
  "/src/lib/ultrareview-publication-artifact.ts",
);

after(async () => {
  await server.close();
});

test("UltraReview generation has a dedicated model default", () => {
  const ctx = {
    global: {
      models: ["global-model", "review-model", "ultra-model"],
      defaultModel: "global-model",
      modelOverrides: {
        review: "review-model",
      },
    },
  };

  assert.equal(
    resolveUltraReviewGenerationModel(ctx),
    "review-model",
  );
  ctx.global.modelOverrides.ultrareview = "ultra-model";
  assert.equal(
    resolveUltraReviewGenerationModel(ctx),
    "ultra-model",
  );
  ctx.global.modelOverrides.ultrareview = "missing-model";
  assert.equal(
    resolveUltraReviewGenerationModel(ctx),
    "review-model",
  );
});

test("Settings exposes the UltraReview generation model route", () => {
  const route = FLOW_MODEL_CATALOG.find(
    (entry) => entry.kind === "ultrareview",
  );

  assert.deepEqual(route, {
    kind: "ultrareview",
    label: "UltraReview generation",
    capability: "automatic · model + reasoning + speed defaults",
    inheritsFrom: "review",
  });
});

test("UltraReview generation can override inherited reasoning and speed", () => {
  const config = {
    reasoningEffort: "medium",
    reasoningOverrides: { review: "xhigh" },
    fastMode: false,
    fastModeOverrides: { review: true },
  };

  assert.equal(resolveFlowReasoning(config, "ultrareview"), "xhigh");
  assert.equal(resolveFlowFastMode(config, "ultrareview"), true);

  config.reasoningOverrides.ultrareview = "high";
  config.fastModeOverrides.ultrareview = false;
  assert.equal(resolveFlowReasoning(config, "ultrareview"), "high");
  assert.equal(resolveFlowFastMode(config, "ultrareview"), false);
});

function session(mode) {
  return {
    mode,
    acknowledgedMechanicalChangeIds: [],
    concernDispositions: {},
    notes: [],
    answers: [],
    draft: null,
    snapshots: [],
    resume: {
      systemId: "system:review",
      chapterId: "chapter:failed",
      beatId: "beat:failed",
      scrollTop: 0,
      expandedEvidenceIds: [],
    },
  };
}

function artifact() {
  return {
    version: 1,
    identity: {
      repo: "openai/charon",
      prNumber: 42,
      baseSha: "base-abc",
      headSha: "head-def",
    },
    artifactKey:
      "ultrareview:v1:openai%2Fcharon:42:base-abc..head-def",
    galaxy: {
      id: "galaxy:42",
      thesis: "Keep completed review regions stable.",
      sourceClaimIds: ["source:root"],
      systems: [
        {
          id: "system:review",
          title: "Review system",
          thesis: "Split complete work from failed work.",
          order: 0,
          risk: "high",
          sourceClaimIds: ["source:root"],
          scope: {
            changedLines: 2,
            files: 2,
          },
          chapters: [
            {
              id: "chapter:stable",
              title: "Completed chapter",
              purpose: "Keep accepted analysis unchanged.",
              before: "The review was incomplete.",
              after: "This chapter is complete.",
              order: 0,
              risk: "low",
              sourceClaimIds: ["source:stable"],
              dependencyChapterIds: [],
              beats: [
                {
                  id: "beat:stable",
                  title: "Inspect stable evidence",
                  claim: "The stable region is complete.",
                  objective: "Preserve it.",
                  question: null,
                  order: 0,
                  risk: "low",
                  evidenceIds: ["evidence:stable"],
                  sourceClaimIds: ["source:stable"],
                },
              ],
            },
            {
              id: "chapter:failed",
              title: "Failed chapter",
              purpose: "Retry one incomplete region.",
              before: "The region failed analysis.",
              after: "The region has a bounded retry.",
              order: 1,
              risk: "high",
              sourceClaimIds: ["source:failed"],
              dependencyChapterIds: ["chapter:stable"],
              beats: [
                {
                  id: "beat:failed",
                  title: "Inspect failed evidence",
                  claim: "The failed region needs analysis.",
                  objective: "Retry it.",
                  question: "Does the retry preserve completed work?",
                  order: 0,
                  risk: "high",
                  evidenceIds: ["evidence:failed"],
                  sourceClaimIds: ["source:failed"],
                },
              ],
            },
          ],
        },
        {
          id: "system:other",
          title: "Other system",
          thesis: "An unrelated region stays visible.",
          order: 1,
          risk: "medium",
          sourceClaimIds: ["source:other"],
          scope: {
            changedLines: 1,
            files: 1,
          },
          chapters: [
            {
              id: "chapter:other",
              title: "Other chapter",
              purpose: "Carry an unrelated failure.",
              before: "The region failed.",
              after: "The failure stays visible.",
              order: 0,
              risk: "medium",
              sourceClaimIds: ["source:other"],
              dependencyChapterIds: [],
              beats: [
                {
                  id: "beat:other",
                  title: "Inspect other evidence",
                  claim: "Another region is incomplete.",
                  objective: "Do not hide it.",
                  question: null,
                  order: 0,
                  risk: "medium",
                  evidenceIds: ["evidence:other"],
                  sourceClaimIds: ["source:other"],
                },
              ],
            },
          ],
        },
      ],
    },
    evidence: [
      {
        id: "evidence:stable",
        kind: "changed",
        change: "addition",
        location: {
          path: "src/stable.ts",
          side: "RIGHT",
          startLine: 1,
          endLine: 1,
        },
        fingerprint: "sha256:stable",
        sourceClaimIds: ["source:stable"],
      },
      {
        id: "evidence:failed",
        kind: "changed",
        change: "addition",
        location: {
          path: "src/failed.ts",
          side: "RIGHT",
          startLine: 2,
          endLine: 2,
        },
        fingerprint: "sha256:failed",
        sourceClaimIds: ["source:failed"],
      },
      {
        id: "evidence:other",
        kind: "changed",
        change: "addition",
        location: {
          path: "src/other.ts",
          side: "RIGHT",
          startLine: 3,
          endLine: 3,
        },
        fingerprint: "sha256:other",
        sourceClaimIds: ["source:other"],
      },
    ],
    coverage: [
      {
        evidenceId: "evidence:stable",
        assignment: {
          kind: "beat",
          beatId: "beat:stable",
        },
      },
      {
        evidenceId: "evidence:failed",
        assignment: {
          kind: "unmapped",
          reason: "Analysis failed.",
        },
      },
      {
        evidenceId: "evidence:other",
        assignment: {
          kind: "beat",
          beatId: "beat:other",
        },
      },
    ],
    mechanicalChanges: [],
    sourceClaims: [
      {
        id: "source:root",
        kind: "author_stated",
        claim: "Retry failed analysis without discarding completed work.",
        evidenceIds: [],
      },
      {
        id: "source:stable",
        kind: "code_observed",
        claim: "The stable region is complete.",
        evidenceIds: ["evidence:stable"],
      },
      {
        id: "source:failed",
        kind: "code_observed",
        claim: "The failed region is incomplete.",
        evidenceIds: ["evidence:failed"],
      },
      {
        id: "source:other",
        kind: "code_observed",
        claim: "The other region is incomplete.",
        evidenceIds: ["evidence:other"],
      },
    ],
    concerns: [
      {
        id: "concern:failed-old",
        beatId: "beat:failed",
        question: "Can the failed region recover?",
        evidenceIds: ["evidence:failed"],
        sourceClaimIds: ["source:failed"],
        severity: "major",
      },
      {
        id: "concern:other",
        beatId: "beat:other",
        question: "Does the other failure remain visible?",
        evidenceIds: ["evidence:other"],
        sourceClaimIds: ["source:other"],
        severity: "minor",
      },
    ],
    generation: {
      status: "partial",
      stages: [
        {
          id: "stage:stable",
          label: "Completed chapter",
          status: "complete",
          systemId: "system:review",
          error: null,
        },
        {
          id: "stage:failed",
          label: "Failed chapter",
          status: "failed",
          systemId: "system:review",
          error: "The chapter timed out.",
        },
        {
          id: "stage:other",
          label: "Other system",
          status: "failed",
          systemId: "system:other",
          error: "Context is unavailable.",
        },
      ],
      failures: [
        {
          id: "failure:target",
          stageId: "stage:failed",
          scope: "chapter",
          systemId: "system:review",
          chapterId: "chapter:failed",
          message: "The chapter timed out.",
          retryable: true,
          evidenceIds: ["evidence:failed"],
        },
        {
          id: "failure:other",
          stageId: "stage:other",
          scope: "system",
          systemId: "system:other",
          chapterId: null,
          message: "Context is unavailable.",
          retryable: true,
          evidenceIds: ["evidence:other"],
        },
      ],
    },
    sessions: {
      teammate: session("teammate"),
      author: session("author"),
    },
    lifecycle: "active",
  };
}

function cloned(value) {
  return structuredClone(value);
}

const PROGRESS_IDENTITY = {
  repo: "openai/charon",
  prNumber: 99,
  baseSha: "base-progress",
  headSha: "head-progress",
};

const PROGRESS_DIFF = [
  "diff --git a/src/progress.ts b/src/progress.ts",
  "--- a/src/progress.ts",
  "+++ b/src/progress.ts",
  "@@ -0,0 +1,2 @@",
  "+const first = true;",
  "+const second = true;",
].join("\n");

function progressArtifact(changeCount = 1) {
  const changes = enumerateUltraReviewDiffChanges(
    [{
      oldPath: "src/progress.ts",
      newPath: "src/progress.ts",
      isBinary: false,
      isNew: false,
      isDeleted: false,
      isRename: false,
      lines: [
        {
          type: "hunk",
          oldNum: null,
          newNum: null,
          text: "@@ -0,0 +1,2 @@",
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 2,
        },
        {
          type: "add",
          oldNum: null,
          newNum: 1,
          text: "const first = true;",
        },
        {
          type: "add",
          oldNum: null,
          newNum: 2,
          text: "const second = true;",
        },
      ],
    }],
  ).slice(0, changeCount);
  return parseUltraReviewAnalysisJson(
    JSON.stringify({
      version: 1,
      thesis: "Publish complete chapters while analysis continues.",
      sourceClaimIds: ["source:root"],
      systems: [{
        id: "system:progress",
        title: "Progressive review",
        thesis: "Completed chapters open before later work.",
        order: 0,
        risk: "medium",
        sourceClaimIds: ["source:root"],
        scope: {
          changedLines: 2,
          files: 1,
        },
        chapters: changes.map((change, index) => ({
          id: `chapter:progress:${index}`,
          title: `Ready chapter ${index + 1}`,
          purpose: "Expose validated review work.",
          before: "The reviewer waited for the complete artifact.",
          after: "A completed chapter opens immediately.",
          order: index,
          risk: "medium",
          sourceClaimIds: [`source:progress:${index}`],
          dependencyChapterIds:
            index === 0 ? [] : ["chapter:progress:0"],
          beats: [{
            id: `beat:progress:${index}`,
            title: `Inspect chapter ${index + 1}`,
            claim: "This chapter owns exact changed evidence.",
            objective: "Inspect the published evidence.",
            question: null,
            order: 0,
            risk: "medium",
            evidenceIds: [change.id],
            sourceClaimIds: [`source:progress:${index}`],
          }],
        })),
      }],
      evidence: changes.map((change, index) => ({
        ...change,
        kind: "changed",
        sourceClaimIds: [`source:progress:${index}`],
      })),
      coverage: changes.map((change, index) => ({
        evidenceId: change.id,
        assignment: {
          kind: "beat",
          beatId: `beat:progress:${index}`,
        },
      })),
      mechanicalChanges: [],
      sourceClaims: [
        {
          id: "source:root",
          kind: "author_stated",
          claim: "Review completed chapters before analysis finishes.",
          evidenceIds: [],
        },
        ...changes.map((change, index) => ({
          id: `source:progress:${index}`,
          kind: "code_observed",
          claim: "The trusted diff contains this line.",
          evidenceIds: [change.id],
        })),
      ],
      concerns: [],
      generation: {
        status: "running",
        stages: [{
          id: "building-story",
          label: "Building causal chapters",
          status: "running",
          systemId: null,
          error: null,
        }],
        failures: [],
      },
    }),
    PROGRESS_IDENTITY,
  );
}

test("validated progress becomes usable before the terminal artifact", () => {
  const current = createUltraReviewArtifact(PROGRESS_IDENTITY);
  current.generation.stages = [{
    id: "building-story",
    label: "Building causal chapters",
    status: "running",
    systemId: null,
    error: null,
  }];
  const first = progressArtifact(1);

  assert.equal(
    ultraReviewProgressArtifactIsSafe(PROGRESS_DIFF, first),
    true,
  );
  const result = mergeUltraReviewProgressArtifact(
    PROGRESS_DIFF,
    current,
    first,
    [],
  );
  assert.equal(result.accepted, true);
  const merged = result.artifact;
  assert.equal(merged.generation.status, "running");
  assert.equal(
    merged.galaxy.systems[0].chapters[0].id,
    "chapter:progress:0",
  );
  assert.equal(
    merged.sessions.teammate.reviewCompletedAt,
    undefined,
  );

  const forged = progressArtifact(1);
  forged.evidence[0].fingerprint = "forged";
  assert.equal(
    ultraReviewProgressArtifactIsSafe(PROGRESS_DIFF, forged),
    false,
  );
  const unsafe = mergeUltraReviewProgressArtifact(
    PROGRESS_DIFF,
    current,
    forged,
    [],
  );
  assert.equal(unsafe.accepted, false);
  assert.equal(
    unsafe.issue.code,
    "PROGRESS_ARTIFACT_UNSAFE",
  );

  const mismatched = progressArtifact(2);
  mismatched.coverage[0].assignment.beatId =
    "beat:progress:1";
  mismatched.coverage[1].assignment.beatId =
    "beat:progress:0";
  assert.equal(
    ultraReviewProgressArtifactIsSafe(
      PROGRESS_DIFF,
      mismatched,
    ),
    false,
  );
});

test("a validated system plan becomes visible before its first chapter", () => {
  const current = createUltraReviewArtifact(PROGRESS_IDENTITY);
  const plan = progressArtifact(0);

  assert.equal(
    ultraReviewProgressArtifactIsSafe(PROGRESS_DIFF, plan),
    true,
  );
  const result = mergeUltraReviewProgressArtifact(
    PROGRESS_DIFF,
    current,
    plan,
    [],
  );
  assert.equal(result.accepted, true);
  const merged = result.artifact;
  assert.equal(merged.galaxy.systems.length, 1);
  assert.equal(merged.galaxy.systems[0].chapters.length, 0);
  assert.equal(merged.generation.status, "running");
});

test("normalized chapters append to their published plan", async () => {
  const trustedEvidence = progressArtifact(2).evidence;
  const planned = assembleUltraReviewPlanPublication(
    PROGRESS_IDENTITY,
    {
      thesis: "Publish complete chapters while analysis continues.",
      grounding: [{
        kind: "author_stated",
        claim: "Completed chapters should open before analysis finishes.",
      }],
      systems: [{
        key: "progress",
        title: "Progressive review",
        thesis: "Completed chapters open before later work.",
        risk: "medium",
        chapters: [
          {
            key: "first",
            title: "Ready first chapter",
          },
          {
            key: "second",
            title: "Ready second chapter",
          },
        ],
      }],
    },
    trustedEvidence,
  );
  const planResult = mergeUltraReviewProgressArtifact(
    PROGRESS_DIFF,
    createUltraReviewArtifact(PROGRESS_IDENTITY),
    planned.artifact,
    [],
  );
  assert.equal(planResult.accepted, true);
  const publishedPlan = planResult.artifact;

  const first = await appendUltraReviewChapterPublication(
    publishedPlan,
    {
      chapterKey: "first",
      purpose: "Expose validated review work.",
      before: "The reviewer waited for the complete artifact.",
      after: "The first completed chapter opens immediately.",
      risk: "medium",
      beats: [{
        title: "Explain the first change",
        claim: "The first line enables progressive review.",
        why: "This chapter starts the pull request story.",
        risk: "medium",
        changedEvidenceIds: [trustedEvidence[0].id],
        context: [],
      }],
    },
    trustedEvidence,
    async () => {
      throw new Error("This chapter has no supporting context.");
    },
  );
  const result = mergeUltraReviewProgressArtifact(
    PROGRESS_DIFF,
    publishedPlan,
    first.artifact,
    [],
  );

  assert.equal(result.accepted, true);
  const merged = result.artifact;
  assert.equal(
    merged.galaxy.systems[0].chapters[0].id,
    "chapter:first",
  );

  const second = await appendUltraReviewChapterPublication(
    merged,
    {
      chapterKey: "second",
      purpose: "Continue the validated review story.",
      before: "Only the first chapter is visible.",
      after: "Both completed chapters are visible.",
      risk: "medium",
      dependencyChapterKeys: ["first"],
      beats: [{
        title: "Explain the second change",
        claim: "The second line continues progressive review.",
        why: "This chapter completes the pull request story.",
        risk: "medium",
        changedEvidenceIds: [trustedEvidence[1].id],
        context: [],
      }],
    },
    trustedEvidence,
    async () => {
      throw new Error("This chapter has no supporting context.");
    },
  );
  const secondResult = mergeUltraReviewProgressArtifact(
    PROGRESS_DIFF,
    merged,
    second.artifact,
    [],
  );

  assert.equal(secondResult.accepted, true);
  assert.deepEqual(
    secondResult.artifact.galaxy.systems[0].chapters.map(
      (chapter) => chapter.id,
    ),
    ["chapter:first", "chapter:second"],
  );
});

test("later analysis may append work but cannot rewrite published chapters", () => {
  const first = progressArtifact(1);
  const second = progressArtifact(2);

  assert.equal(
    ultraReviewCandidatePreservesPublishedChapters(
      first,
      second,
    ),
    true,
  );
  const duplicateCoverage = progressArtifact(2);
  duplicateCoverage.coverage.push({
    ...duplicateCoverage.coverage[0],
  });
  assert.equal(
    ultraReviewCandidatePreservesPublishedChapters(
      first,
      duplicateCoverage,
    ),
    false,
  );
  const changedThesisSources = progressArtifact(2);
  changedThesisSources.galaxy.sourceClaimIds.push(
    "source:progress:1",
  );
  assert.equal(
    ultraReviewCandidatePreservesPublishedChapters(
      first,
      changedThesisSources,
    ),
    false,
  );
  second.galaxy.systems[0].chapters[0].beats[0].objective =
    "Rewrite published review work.";
  assert.equal(
    ultraReviewCandidatePreservesPublishedChapters(
      first,
      second,
    ),
    false,
  );
  const rejected = mergeUltraReviewProgressArtifact(
    PROGRESS_DIFF,
    first,
    second,
    [],
  );
  assert.equal(rejected.accepted, false);
  assert.equal(
    rejected.issue.code,
    "PUBLISHED_WORK_CHANGED",
  );
});

test("focused retry prompt names one failure and carries the prior artifact", () => {
  const previous = artifact();
  const prompt = buildUltraReviewFocusedRetryInstruction(
    previous,
    "failure:target",
  );

  assert.match(prompt, /Retry only chapter chapter:failed/);
  assert.match(prompt, /"id": "failure:target"/);
  assert.match(prompt, /"id": "chapter:stable"/);
  assert.match(prompt, /Preserve every untargeted system and chapter exactly/);
  assert.match(prompt, /Return the complete UltraReview artifact/);
  assert.doesNotMatch(prompt, /"sessions"/);
  assert.equal(
    buildUltraReviewFocusedRetryInstruction(
      previous,
      "failure:missing",
    ),
    null,
  );
});

test("chapter retry replaces only the failed chapter and its owned data", () => {
  const previous = artifact();
  const generated = cloned(previous);
  generated.galaxy.systems[0].chapters[0].title =
    "Model rewrote completed work";
  generated.galaxy.systems[0].chapters[1].title =
    "Recovered chapter";
  generated.galaxy.systems[1].title =
    "Model rewrote another system";
  generated.evidence[0].fingerprint =
    "sha256:model-rewrote-stable";
  generated.sourceClaims[1].claim =
    "The model rewrote a completed claim.";
  generated.sourceClaims[2].claim =
    "The failed region recovered.";
  generated.coverage[0].assignment.beatId = "beat:failed";
  generated.coverage[1] = {
    evidenceId: "evidence:failed",
    assignment: {
      kind: "beat",
      beatId: "beat:failed",
    },
  };
  generated.concerns = [
    {
      id: "concern:failed-new",
      beatId: "beat:failed",
      question: "Is the recovered behavior correct?",
      evidenceIds: ["evidence:failed"],
      sourceClaimIds: ["source:failed"],
      severity: "minor",
    },
    {
      id: "concern:model-other",
      beatId: "beat:other",
      question: "This untargeted concern must not appear.",
      evidenceIds: ["evidence:other"],
      sourceClaimIds: ["source:other"],
      severity: "major",
    },
  ];
  generated.generation.stages[1] = {
    ...generated.generation.stages[1],
    status: "complete",
    error: null,
  };
  generated.generation.failures = [];
  generated.generation.status = "complete";

  const merged = mergeFocusedRetry(
    previous,
    generated,
    "failure:target",
  );

  assert.deepEqual(
    merged.galaxy.systems[0].chapters[0],
    previous.galaxy.systems[0].chapters[0],
  );
  assert.deepEqual(
    merged.galaxy.systems[1],
    previous.galaxy.systems[1],
  );
  assert.equal(
    merged.galaxy.systems[0].chapters[1].title,
    "Recovered chapter",
  );
  assert.equal(
    merged.evidence[0].fingerprint,
    "sha256:stable",
  );
  assert.equal(
    merged.sourceClaims[1].claim,
    "The stable region is complete.",
  );
  assert.equal(
    merged.sourceClaims[2].claim,
    "The failed region recovered.",
  );
  assert.deepEqual(
    merged.coverage.find(
      (entry) => entry.evidenceId === "evidence:stable",
    ),
    previous.coverage[0],
  );
  assert.equal(
    merged.coverage.find(
      (entry) => entry.evidenceId === "evidence:failed",
    ).assignment.kind,
    "beat",
  );
  assert.deepEqual(
    merged.concerns.map((concern) => concern.id),
    ["concern:other", "concern:failed-new"],
  );
  assert.deepEqual(
    merged.generation.failures.map((failure) => failure.id),
    ["failure:other"],
  );
  assert.equal(
    merged.generation.stages.find(
      (stage) => stage.id === "stage:stable",
    ).status,
    "complete",
  );
  assert.equal(
    merged.generation.stages.find(
      (stage) => stage.id === "stage:failed",
    ).status,
    "complete",
  );
  assert.equal(merged.generation.status, "partial");
});

test("system retry may replace its full system but not its neighbors", () => {
  const previous = artifact();
  previous.generation.failures[0] = {
    ...previous.generation.failures[0],
    scope: "system",
    chapterId: null,
  };
  const generated = cloned(previous);
  generated.galaxy.systems[0].title = "Recovered review system";
  generated.galaxy.systems[1].title =
    "Model rewrote another system";
  generated.sourceClaims[0].claim =
    "The model rewrote the pull request thesis.";
  generated.generation.stages[1] = {
    ...generated.generation.stages[1],
    status: "complete",
    error: null,
  };
  generated.generation.failures = [];

  const merged = mergeFocusedRetry(
    previous,
    generated,
    "failure:target",
  );

  assert.equal(
    merged.galaxy.systems[0].title,
    "Recovered review system",
  );
  assert.deepEqual(
    merged.galaxy.systems[1],
    previous.galaxy.systems[1],
  );
  assert.equal(
    merged.sourceClaims[0].claim,
    previous.sourceClaims[0].claim,
  );
});
