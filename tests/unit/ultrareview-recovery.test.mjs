import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

import {
  recoverInterruptedUltraReviewArtifact,
} from "../../src/lib/ultrareview-recovery.ts";
import {
  createUltraReviewArtifact,
  parseUltraReviewArtifact,
} from "../../src/lib/ultraReview.ts";

if (globalThis.localStorage === undefined) {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

const server = await createServer({
  root: process.cwd(),
  server: {
    middlewareMode: true,
  },
  appType: "custom",
  logLevel: "silent",
});

after(async () => {
  await server.close();
});

const identity = {
  repo: "charon/core",
  prNumber: 42,
  baseSha: "base-1",
  headSha: "head-1",
};

test("a persisted running plan becomes restartable after app restart", () => {
  const running = createUltraReviewArtifact(identity);
  const interrupted = recoverInterruptedUltraReviewArtifact(
    running,
    [],
  );

  assert.equal(interrupted.generation.status, "failed");
  assert.equal(
    interrupted.generation.failures[0]?.message,
    "Analysis stopped when Charon restarted.",
  );
  assert.equal(
    interrupted.generation.failures[0]?.retryable,
    true,
  );
  assert.equal(
    interrupted.generation.stages[0]?.status,
    "failed",
  );
  assert.doesNotThrow(() => parseUltraReviewArtifact(interrupted));
});

test("a live UltraReview agent keeps its artifact running", () => {
  const running = createUltraReviewArtifact(identity);
  const recovered = recoverInterruptedUltraReviewArtifact(
    running,
    [{
      relation: "build UltraReview",
      repo: identity.repo,
      prNumber: identity.prNumber,
      status: "running",
    }],
  );

  assert.equal(recovered, running);
});

test("restart recovery does not rewrite completed stages", () => {
  const running = createUltraReviewArtifact(identity);
  running.generation.stages = [{
    id: "indexing-files",
    label: "Index pull request evidence",
    status: "complete",
    systemId: null,
    error: null,
  }];

  const interrupted = recoverInterruptedUltraReviewArtifact(
    running,
    [],
  );

  assert.equal(
    interrupted.generation.stages[0]?.status,
    "complete",
  );
  assert.equal(
    interrupted.generation.stages[1]?.id,
    "analysis-interrupted",
  );
  assert.equal(
    interrupted.generation.stages[1]?.status,
    "failed",
  );
});

test("completed chapters survive an interrupted continuation", () => {
  const running = createUltraReviewArtifact(identity);
  running.galaxy.systems = [{
    id: "system:one",
    title: "Preserve the review",
    summary: "Keep completed work.",
    order: 0,
    sourceClaimIds: [],
    chapters: [{
      id: "chapter:one",
      systemId: "system:one",
      title: "Keep the chapter",
      purpose: "Keep completed work.",
      before: "No recovery.",
      after: "Recovery.",
      dependencies: [],
      risk: "low",
      order: 0,
      sourceClaimIds: [],
      beats: [],
    }],
  }];

  const interrupted = recoverInterruptedUltraReviewArtifact(
    running,
    [],
  );

  assert.equal(interrupted.generation.status, "partial");
  assert.equal(
    interrupted.galaxy.systems[0]?.chapters[0]?.title,
    "Keep the chapter",
  );
});

test("startup reconciliation persists the restartable state", async () => {
  const {
    reconcileInterruptedUltraReviews,
    useUltraReviewStore,
  } = await server.ssrLoadModule(
    "/src/lib/ultrareview-store.ts",
  );
  const { useAgentStore } = await server.ssrLoadModule(
    "/src/lib/store.ts",
  );
  const running = createUltraReviewArtifact(identity);
  const blobs = new Map([
    [
      "repos/charon__core/ultrareviews.json",
      JSON.stringify({
        [running.artifactKey]: running,
      }),
    ],
  ]);
  const storage = {
    loadBlob: async (path) => blobs.get(path) ?? null,
    saveBlob: async (path, value) => {
      blobs.set(path, value);
    },
  };
  useAgentStore.setState({
    runs: {},
    order: [],
  });
  useUltraReviewStore.setState({
    repo: null,
    loaded: false,
    artifacts: {},
    rejectedArtifactKeys: [],
  });

  await useUltraReviewStore.getState().init(
    identity.repo,
    storage,
  );
  const recovered =
    await reconcileInterruptedUltraReviews(identity.repo, storage);
  const persisted = JSON.parse(
    blobs.get("repos/charon__core/ultrareviews.json"),
  );

  assert.equal(recovered, 1);
  assert.equal(
    persisted[running.artifactKey].generation.status,
    "failed",
  );
});
