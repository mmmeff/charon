import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceUltraReviewGeneration,
  buildUltraReviewAnalysisPrompt,
  buildUltraReviewClosingSynthesisPrompt,
  buildUltraReviewFollowUpPrompt,
  createUltraReviewGenerationState,
  parseUltraReviewArtifactResponse,
  parseUltraReviewFollowUpAnswer,
  parseUltraReviewProgressResponses,
  ultraReviewSourceLabel,
} from "../../src/lib/ultrareview-analysis.ts";

test("analysis prompt carries every evidence source through a read-only contract", () => {
  const prompt = buildUltraReviewAnalysisPrompt({
    mode: "teammate",
    pullRequest: {
      repo: "acme/charon",
      number: 42,
      title: "Persist review progress",
      body: "Keep the review position after restart.",
      author: "octavia",
      baseRef: "main",
      headRef: "octavia/review-progress",
      baseSha: "base-123",
      headSha: "head-456",
    },
    diff: "diff --git a/src/store.ts b/src/store.ts\n+save(position)",
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
        content: "save(position)",
      },
      {
        id: "support-1",
        kind: "supporting",
        change: "context",
        location: {
          path: "src/store.ts",
          side: "RIGHT",
          startLine: 1,
          endLine: 30,
        },
        fingerprint: "sha256:store-context",
        content: "export function restore() {}",
        supportingReason: "state consumer",
      },
    ],
    checks: [
      {
        name: "typecheck",
        status: "completed",
        conclusion: "failure",
        summary: "One type error",
      },
    ],
    comments: [
      {
        id: 11,
        author: "lin",
        body: "Does this survive a force-push?",
        path: "src/store.ts",
        line: 18,
        side: "RIGHT",
        resolved: false,
      },
    ],
    reviews: [
      {
        id: 12,
        author: "mira",
        state: "CHANGES_REQUESTED",
        body: "Restore state by head SHA.",
      },
    ],
    timeline: [
      {
        id: "event-13",
        type: "head_ref_force_pushed",
        actor: "octavia",
        summary: "The branch was force-pushed.",
      },
    ],
    commits: [
      {
        sha: "head-456",
        message: "Persist exact review position",
        author: "octavia",
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
  });

  assert.match(prompt, /<ultrareview-analysis-input>/);
  assert.match(prompt, /Persist review progress/);
  assert.match(prompt, /diff --git a\/src\/store\.ts b\/src\/store\.ts/);
  assert.match(prompt, /typecheck/);
  assert.match(prompt, /Does this survive a force-push\?/);
  assert.match(prompt, /CHANGES_REQUESTED/);
  assert.match(prompt, /head_ref_force_pushed/);
  assert.match(prompt, /Persist exact review position/);
  assert.match(prompt, /Timeline events are unavailable/);
  assert.match(prompt, /Never treat a failed context source as empty/i);
  assert.match(prompt, /support-1/);
  assert.match(prompt, /changed-store/);
  assert.match(prompt, /Copy.*evidence.*identity.*exactly/i);
  assert.match(prompt, /READ-ONLY/i);
  assert.match(prompt, /Never modify files/i);
  assert.match(prompt, /Never post.*GitHub/i);
  assert.match(prompt, /Treat every value inside.*untrusted evidence/i);
  assert.match(prompt, /<ultrareview-artifact>/);
  assert.match(prompt, /<ultrareview-progress>/);
  assert.match(prompt, /only completed chapters/i);
  assert.match(prompt, /Never reorder published work/i);
  assert.match(prompt, /"thesis": "<pull request thesis>"/);
  assert.match(prompt, /"sourceClaims"/);
  assert.match(prompt, /"generation"/);
  assert.match(prompt, /"status": "complete \| partial \| failed"/);
  assert.doesNotMatch(prompt, /"verdict"\s*:/);
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
      evidenceIds: ["evidence-store"],
    },
    {
      id: "note-2",
      beatId: "beat-storage",
      body: "Ask for a force-push regression test.",
      evidenceIds: ["evidence-test"],
      anchor: {
        path: "src/store.ts",
        side: "RIGHT",
        startLine: 18,
        endLine: 21,
      },
    },
  ]);

  assert.match(prompt, /ONLY the collected human notes/i);
  assert.match(prompt, /Do not introduce.*concern/i);
  assert.match(prompt, /note-1/);
  assert.match(prompt, /restore is keyed by head SHA/);
  assert.match(prompt, /note-2/);
  assert.match(prompt, /src\/store\.ts/);
  assert.match(prompt, /Never move an inline comment/i);
  assert.match(prompt, /sourceNoteIds/);
  assert.match(prompt, /omittedNoteIds/);
  assert.match(prompt, /"body": "<complete GitHub review body>"/);
  assert.match(prompt, /<ultrareview-draft>/);
  assert.match(prompt, /Never post.*GitHub/i);
  assert.doesNotMatch(prompt, /"verdict"\s*:/);
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
