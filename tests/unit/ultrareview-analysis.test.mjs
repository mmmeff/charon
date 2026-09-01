import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceUltraReviewGeneration,
  buildUltraReviewAnalysisContext,
  buildUltraReviewAnalysisPrompt,
  buildUltraReviewPublicationPrompt,
  buildUltraReviewClosingSynthesisPrompt,
  buildUltraReviewFollowUpPrompt,
  createUltraReviewGenerationState,
  parseUltraReviewArtifactCandidate,
  parseUltraReviewArtifactResponse,
  parseUltraReviewFollowUpAnswer,
  parseUltraReviewProgressResponses,
  ultraReviewSourceLabel,
} from "../../src/lib/ultrareview-analysis.ts";

test("staged publication uses bounded deltas instead of terminal artifacts", () => {
  const prompt = buildUltraReviewPublicationPrompt();

  assert.match(prompt, /publish_plan/);
  assert.match(prompt, /publish_chapter/);
  assert.match(prompt, /finish_review/);
  assert.match(prompt, /as soon as it is complete/);
  assert.match(prompt, /JSON Schemas are the source of truth/);
  assert.match(prompt, /Charon assigns stored ids/);
  assert.match(prompt, /head-commit path, inclusive line range, and reason/);
  assert.match(prompt, /descriptive plain English/);
  assert.match(prompt, /repository-root-relative/);
  assert.match(prompt, /tests? in the same beat/i);
  assert.match(prompt, /Do not create a separate test-only beat/i);
  assert.doesNotMatch(prompt, /supportingEvidence/);
  assert.doesNotMatch(prompt, /sourceClaimIds.*source claim id/);
  assert.doesNotMatch(prompt, /cumulative/i);
  assert.doesNotMatch(prompt, /complete terminal artifact/i);
});

test("analysis prompt points to evidence instead of embedding bulky PR data", () => {
  const input = {
    mode: "teammate",
    githubHost: "github.example.com",
    pullRequest: {
      repo: "acme/charon",
      number: 42,
      title: "Persist review progress",
      author: "octavia",
      baseRef: "main",
      headRef: "octavia/review-progress",
      baseSha: "base-123",
      headSha: "head-456",
    },
    evidenceInventory: [
      {
        id: "changed-store",
        kind: "changed",
        change: "addition",
        location: {
          path: "src/store.ts",
          side: "RIGHT",
          startLine: 18,
          endLine: 18,
        },
        fingerprint: "sha256:store-line",
      },
    ],
    contextFailures: [
      {
        source: "timeline",
        message: "Timeline events are unavailable on this GitHub host.",
        retryable: false,
      },
    ],
    checkout: {
      available: true,
      root: "/tmp/readonly-review",
    },
    artifactValidation: {
      candidatePath:
        "/tmp/Charon/ultrareview-candidates/validation-42.json",
      contextPath:
        "/tmp/Charon/ultrareview-candidates/validation-42.context.json",
      command:
        "node '/Applications/Charon.app/validate-ultrareview.mjs' --candidate '/tmp/Charon/ultrareview-candidates/validation-42.json' --context '/tmp/Charon/ultrareview-candidates/validation-42.context.json'",
    },
  };
  const prompt = buildUltraReviewAnalysisPrompt(input);
  const publicationPrompt = buildUltraReviewAnalysisPrompt(
    input,
    { publication: true },
  );
  const context = buildUltraReviewAnalysisContext(input);
  const bulkyDiff = [
    "diff --git a/src/store.ts b/src/store.ts",
    ...Array.from(
      { length: 1_000 },
      (_, index) => `+save(position-${index})`,
    ),
  ].join("\n");
  const legacyContext = JSON.stringify(
    {
      ...input,
      pullRequest: {
        ...input.pullRequest,
        body: "Keep the review position after restart.".repeat(200),
      },
      diff: bulkyDiff,
      evidenceInventory: input.evidenceInventory.map(
        (evidence) => ({
          ...evidence,
          content: bulkyDiff,
        }),
      ),
      checks: [
        { summary: "One type error".repeat(200) },
      ],
      comments: [
        {
          body: "Does this survive a force-push?".repeat(200),
        },
      ],
      reviews: [
        { body: "Restore state by head SHA.".repeat(200) },
      ],
      timeline: [
        { summary: "The branch was force-pushed.".repeat(200) },
      ],
      commits: [
        { message: "Persist exact review position".repeat(200) },
      ],
    },
    null,
    2,
  );

  assert.match(prompt, /<ultrareview-mission>/);
  assert.match(prompt, /EVIDENCE MANIFEST:/);
  assert.match(
    prompt,
    /validation-42\.context\.json/,
  );
  assert.match(prompt, /evidenceInventory/);
  assert.match(prompt, /Persist review progress/);
  assert.match(prompt, /github\.example\.com/);
  assert.match(prompt, /git diff --find-renames <baseSha>\.\.<headSha>/);
  assert.match(prompt, /gh auth status --hostname <githubHost>/);
  assert.match(prompt, /gh pr view <number> --repo <githubHost>\/<repo>/);
  assert.match(prompt, /gh pr checks <number> --repo <githubHost>\/<repo>/);
  assert.match(prompt, /GET-only/);
  assert.match(prompt, /Do not assume GitHub CLI, credentials, or network access/);
  assert.match(prompt, /Timeline events are unavailable/);
  assert.match(prompt, /Never treat a failed context source as empty/i);
  assert.doesNotMatch(prompt, /changed-store/);
  assert.doesNotMatch(prompt, /sha256:store-line/);
  assert.match(prompt, /Copy.*evidence.*identity.*exactly/i);
  assert.match(prompt, /READ-ONLY/i);
  assert.match(prompt, /Never modify the checkout/i);
  assert.match(prompt, /Never post.*GitHub/i);
  assert.match(prompt, /untrusted evidence/i);
  assert.match(
    prompt,
    /The sole permitted write is.*validation-42\.json/is,
  );
  assert.match(
    prompt,
    /run.*validate-ultrareview\.mjs.*until it exits 0/is,
  );
  assert.match(
    prompt,
    /terminal block must contain exactly the validated file/i,
  );
  assert.doesNotMatch(prompt, /diff --git a\/src\/store\.ts b\/src\/store\.ts/);
  assert.doesNotMatch(prompt, /Keep the review position after restart/);
  assert.doesNotMatch(prompt, /Does this survive a force-push\?/);
  assert.doesNotMatch(prompt, /Restore state by head SHA/);
  assert.ok(
    context.length < legacyContext.length * 0.1,
    `expected a compact handoff; ${context.length} vs ${legacyContext.length}`,
  );
  assert.match(prompt, /<ultrareview-artifact>/);
  assert.match(prompt, /<ultrareview-progress>/);
  assert.match(prompt, /only completed chapters/i);
  assert.match(prompt, /Never reorder published work/i);
  assert.match(prompt, /"thesis": "<pull request thesis>"/);
  assert.match(prompt, /"sourceClaims"/);
  assert.match(prompt, /"generation"/);
  assert.match(prompt, /"status": "complete \| partial \| failed"/);
  assert.doesNotMatch(prompt, /"verdict"\s*:/);
  assert.doesNotMatch(publicationPrompt, /ARTIFACT PREFLIGHT:/);
  assert.doesNotMatch(publicationPrompt, /<ultrareview-artifact>/);
  assert.doesNotMatch(publicationPrompt, /<ultrareview-progress>/);
  assert.doesNotMatch(
    publicationPrompt,
    /write the final raw JSON object/i,
  );
});

test("analysis prompt size does not grow with the evidence manifest", () => {
  const evidenceInventory = Array.from(
    { length: 1_000 },
    (_, index) => ({
      id: `evidence:${index}`,
      kind: "changed",
      change: "addition",
      location: {
        path: `src/generated/file-${index}.ts`,
        side: "RIGHT",
        startLine: index + 1,
        endLine: index + 1,
      },
      fingerprint: `fingerprint-${index}`,
    }),
  );
  const prompt = buildUltraReviewAnalysisPrompt({
    mode: "teammate",
    githubHost: "github.com",
    pullRequest: {
      repo: "acme/charon",
      number: 44,
      title: "File-backed evidence",
      author: "octavia",
      baseRef: "main",
      headRef: "octavia/file-backed-evidence",
      baseSha: "base-440",
      headSha: "head-440",
    },
    evidenceInventory,
    contextFailures: [],
    checkout: {
      available: true,
      root: "/tmp/readonly-review",
    },
    artifactValidation: {
      candidatePath:
        "/tmp/Charon/ultrareview-candidates/validation-44.json",
      contextPath:
        "/tmp/Charon/ultrareview-candidates/validation-44.context.json",
      command:
        "node validator --candidate candidate --context context",
    },
  });

  assert.ok(
    prompt.length < 12_000,
    `expected file-backed evidence; prompt was ${prompt.length} bytes`,
  );
  assert.doesNotMatch(prompt, /evidence:999/);
  assert.doesNotMatch(prompt, /src\/generated\/file-999\.ts/);
  assert.match(prompt, /validation-44\.context\.json/);
});

test("analysis prompt preserves the trusted diff only without a checkout", () => {
  const prompt = buildUltraReviewAnalysisPrompt({
    mode: "author",
    githubHost: "github.com",
    pullRequest: {
      repo: "acme/charon",
      number: 43,
      title: "Review without a checkout",
      author: "octavia",
      baseRef: "main",
      headRef: "octavia/no-checkout",
      baseSha: "base-789",
      headSha: "head-789",
    },
    evidenceInventory: [],
    contextFailures: [
      {
        source: "checkout",
        message: "The checkout is unavailable.",
        retryable: true,
      },
    ],
    checkout: {
      available: false,
    },
    artifactValidation: {
      candidatePath:
        "/tmp/Charon/ultrareview-candidates/validation-43.json",
      contextPath:
        "/tmp/Charon/ultrareview-candidates/validation-43.context.json",
      command:
        "node '/Applications/Charon.app/validate-ultrareview.mjs' --candidate '/tmp/Charon/ultrareview-candidates/validation-43.json' --context '/tmp/Charon/ultrareview-candidates/validation-43.context.json'",
    },
    fallbackDiff:
      "diff --git a/src/fallback.ts b/src/fallback.ts\n+recover()",
  });

  assert.match(prompt, /<ultrareview-fallback-diff>/);
  assert.match(prompt, /diff --git a\/src\/fallback\.ts b\/src\/fallback\.ts/);
  assert.match(prompt, /When no checkout is available/);
});

test("progress parser publishes only closed snapshots from real streamed output", () => {
  const results = parseUltraReviewProgressResponses(
    [
      "<ultrareview-progress>{\"chapter\":\"one\"}</ultrareview-progress>",
      "<ultrareview-progress>{\"chapter\":\"two\"}</ultrareview-progress>",
      "<ultrareview-progress>{\"chapter\":\"partial\"}",
    ].join("\n"),
    "identity",
    (raw, identity) => ({
      ...JSON.parse(raw),
      identity,
    }),
  );

  assert.deepEqual(results, [
    {
      ok: true,
      artifact: {
        chapter: "one",
        identity: "identity",
      },
    },
    {
      ok: true,
      artifact: {
        chapter: "two",
        identity: "identity",
      },
    },
  ]);
});

test("follow-up answers remain attached to the beat through trusted evidence ids", () => {
  const prompt = buildUltraReviewFollowUpPrompt({
    action: "trace_callers",
    question: "Which callers can restore stale progress?",
    beat: {
      id: "beat-storage",
      claim: "Review position now persists by pull request head.",
      objective: "Trace restoration into the persisted store.",
    },
    evidence: [
      {
        id: "evidence-store",
        kind: "changed",
        path: "src/store.ts",
        side: "RIGHT",
        startLine: 18,
        endLine: 21,
        content: "restoreProgress(headSha)",
      },
      {
        id: "support-caller",
        kind: "supporting",
        path: "src/RepoApp.tsx",
        startLine: 44,
        endLine: 48,
        content: "restoreProgress(pr.headSha)",
      },
    ],
    checkout: {
      available: true,
      root: "/tmp/readonly-review",
    },
  });
  const answer = parseUltraReviewFollowUpAnswer(
    `<ultrareview-answer>{
      "answer": "RepoApp restores progress using the current head SHA.",
      "citationIds": ["support-caller"],
      "insufficientEvidence": false
    }</ultrareview-answer>`,
    ["evidence-store", "support-caller"],
  );

  assert.match(prompt, /trace callers/i);
  assert.match(prompt, /Which callers can restore stale progress\?/);
  assert.match(prompt, /support-caller/);
  assert.match(prompt, /read-only/i);
  assert.match(prompt, /cite every material claim/i);
  assert.match(prompt, /Do not rewrite.*story/i);
  assert.deepEqual(answer, {
    ok: true,
    answer: {
      text: "RepoApp restores progress using the current head SHA.",
      citationIds: ["support-caller"],
      insufficientEvidence: false,
    },
  });
});

test("follow-up answer requires an explicit evidence sufficiency decision", () => {
  const answer = parseUltraReviewFollowUpAnswer(
    `<ultrareview-answer>{
      "answer": "The caller uses the current head.",
      "citationIds": ["support-caller"]
    }</ultrareview-answer>`,
    ["support-caller"],
  );

  assert.deepEqual(answer, {
    ok: false,
    error:
      "UltraReview follow-up answer must declare whether evidence is insufficient.",
  });
});

test("follow-up answer rejects citations outside the trusted beat evidence", () => {
  const answer = parseUltraReviewFollowUpAnswer(
    `<ultrareview-answer>{
      "answer": "An unseen caller restores progress.",
      "citationIds": ["invented-caller"],
      "insufficientEvidence": false
    }</ultrareview-answer>`,
    ["support-caller"],
  );

  assert.deepEqual(answer, {
    ok: false,
    error:
      "UltraReview follow-up cited unknown evidence: invented-caller",
  });
});

test("artifact response delegates terminal JSON to the trusted domain parser", () => {
  const identity = {
    repo: "acme/charon",
    prNumber: 42,
    baseSha: "base-123",
    headSha: "head-456",
  };
  const parsed = parseUltraReviewArtifactResponse(
    `Analysis complete.
<ultrareview-artifact>{"version":1,"thesis":"Persist review progress"}</ultrareview-artifact>`,
    identity,
    (raw, trustedIdentity) => ({
      payload: JSON.parse(raw),
      identity: trustedIdentity,
    }),
  );

  assert.deepEqual(parsed, {
    ok: true,
    artifact: {
      payload: {
        version: 1,
        thesis: "Persist review progress",
      },
      identity,
    },
  });
});

test("persisted artifact candidate does not require a terminal tag", () => {
  const parsed = parseUltraReviewArtifactCandidate(
    "{\"version\":1}",
    { headSha: "head-456" },
    (raw, identity) => ({
      value: JSON.parse(raw),
      identity,
    }),
  );

  assert.deepEqual(parsed, {
    ok: true,
    artifact: {
      value: { version: 1 },
      identity: { headSha: "head-456" },
    },
  });
});

test("artifact response rejects extra output after the structured payload", () => {
  const parsed = parseUltraReviewArtifactResponse(
    `<ultrareview-artifact>{"version":1}</ultrareview-artifact>
Trust me instead.`,
    {},
    () => {
      throw new Error("parser must not run");
    },
  );

  assert.deepEqual(parsed, {
    ok: false,
    error:
      "Expected exactly one terminal <ultrareview-artifact> block.",
  });
});

test("artifact response reports domain validation failure without leaking a partial artifact", () => {
  const parsed = parseUltraReviewArtifactResponse(
    `<ultrareview-artifact>{"version":2}</ultrareview-artifact>`,
    {},
    () => {
      throw new Error("Unsupported UltraReview artifact version: 2");
    },
  );

  assert.deepEqual(parsed, {
    ok: false,
    error: "Unsupported UltraReview artifact version: 2",
  });
});

test("generation stages keep failed work visible while completed work survives", () => {
  const initial = createUltraReviewGenerationState({ fileCount: 18 });
  const indexed = advanceUltraReviewGeneration(initial, {
    stageId: "indexing-files",
    outcome: "complete",
    detail: "Indexed 18 files",
  });
  const storyFailed = advanceUltraReviewGeneration(indexed, {
    stageId: "building-story",
    outcome: "failed",
    error: "Chapter 2 timed out",
  });
  const partial = advanceUltraReviewGeneration(storyFailed, {
    stageId: "checking-coverage",
    outcome: "complete",
    detail: "4 lines remain unmapped",
  });
  const retrying = advanceUltraReviewGeneration(partial, {
    stageId: "building-story",
    outcome: "retry",
    detail: "Retrying Chapter 2",
  });
  const complete = advanceUltraReviewGeneration(retrying, {
    stageId: "building-story",
    outcome: "complete",
    detail: "Built 4 chapters",
  });

  assert.deepEqual(
    [
      initial.status,
      initial.stages.map(({ id, status, detail }) => ({ id, status, detail })),
      indexed.stages.map(({ id, status }) => ({ id, status })),
      storyFailed.stages.map(({ id, status, error }) => ({
        id,
        status,
        error,
      })),
      partial.status,
      retrying.status,
      complete.status,
    ],
    [
      "running",
      [
        {
          id: "indexing-files",
          status: "running",
          detail: "Indexing 18 files",
        },
        {
          id: "building-story",
          status: "pending",
          detail: "Building chapters",
        },
        {
          id: "checking-coverage",
          status: "pending",
          detail: "Checking coverage",
        },
      ],
      [
        { id: "indexing-files", status: "complete" },
        { id: "building-story", status: "running" },
        { id: "checking-coverage", status: "pending" },
      ],
      [
        { id: "indexing-files", status: "complete", error: undefined },
        {
          id: "building-story",
          status: "failed",
          error: "Chapter 2 timed out",
        },
        { id: "checking-coverage", status: "running", error: undefined },
      ],
      "partial",
      "running",
      "complete",
    ],
  );
});

test("closing synthesis can draft only from collected notes and preserves anchors", () => {
  const prompt = buildUltraReviewClosingSynthesisPrompt([
    {
      id: "note-1",
      beatId: "beat-storage",
      body: "Call out that restore is keyed by head SHA.",
      kind: "note",
      stale: false,
      evidenceIds: ["evidence-store"],
    },
    {
      id: "note-2",
      beatId: "beat-storage",
      body: "Ask for a force-push regression test.",
      kind: "request",
      stale: false,
      evidenceIds: ["evidence-test"],
      anchor: {
        path: "src/store.ts",
        side: "RIGHT",
        startLine: 18,
        endLine: 21,
      },
    },
  ], "Lead with merge blockers and keep the assessment under 100 words.");

  assert.match(prompt, /ONLY the collected human notes/i);
  assert.match(prompt, /Do not introduce.*concern/i);
  assert.match(prompt, /note-1/);
  assert.match(prompt, /restore is keyed by head SHA/);
  assert.match(prompt, /note-2/);
  assert.match(prompt, /src\/store\.ts/);
  assert.match(prompt, /Lead with merge blockers/i);
  assert.match(prompt, /Do not write inline comments/i);
  assert.match(prompt, /sourceNoteIds/);
  assert.match(prompt, /omittedNoteIds/);
  assert.match(prompt, /"body": "<complete GitHub review body>"/);
  assert.match(prompt, /<ultrareview-draft>/);
  assert.match(prompt, /Never post.*GitHub/i);
  assert.match(prompt, /"recommendedVerdict"\s*:/);
});

test("source claim labels keep observation and inference visibly distinct", () => {
  assert.deepEqual(
    [
      "author_stated",
      "code_observed",
      "ci_observed",
      "existing_feedback",
      "commit_history",
      "timeline_event",
      "model_inference",
      "predicted_behavior",
    ].map((kind) => ultraReviewSourceLabel(kind)),
    [
      "Author-stated intent",
      "Observed in code",
      "Observed in CI",
      "Existing review feedback",
      "Commit history",
      "Pull request timeline",
      "Model inference",
      "Predicted behavior",
    ],
  );
});
