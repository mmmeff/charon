import assert from "node:assert/strict";
import test from "node:test";

import {
  readUltraReviewArtifacts,
  ultraReviewArtifactsPath,
  writeUltraReviewArtifacts,
} from "../../src/lib/ultrareview-storage.ts";
import {
  createUltraReviewArtifact,
} from "../../src/lib/ultraReview.ts";

const memoryStorage = () => {
  const blobs = new Map();
  return {
    blobs,
    loadBlob: async (path) => blobs.get(path) ?? null,
    saveBlob: async (path, value) => {
      blobs.set(path, value);
    },
  };
};

const identity = {
  repo: "charon/core",
  prNumber: 42,
  baseSha: "base-1",
  headSha: "head-1",
};

test("repository artifacts round-trip through their native blob boundary", async () => {
  const storage = memoryStorage();
  const artifact = createUltraReviewArtifact(identity);

  await writeUltraReviewArtifacts(storage, identity.repo, {
    [artifact.artifactKey]: artifact,
  });
  const loaded = await readUltraReviewArtifacts(storage, identity.repo);

  assert.deepEqual(loaded.artifacts, {
    [artifact.artifactKey]: artifact,
  });
  assert.deepEqual(loaded.rejected, []);
});

test("invalid persisted entries are reported without hiding valid reviews", async () => {
  const storage = memoryStorage();
  const artifact = createUltraReviewArtifact(identity);
  storage.blobs.set(
    ultraReviewArtifactsPath(identity.repo),
    JSON.stringify({
      [artifact.artifactKey]: artifact,
      broken: { version: 99, artifactKey: "broken" },
    }),
  );

  const loaded = await readUltraReviewArtifacts(storage, identity.repo);

  assert.deepEqual(Object.keys(loaded.artifacts), [artifact.artifactKey]);
  assert.deepEqual(loaded.rejected, ["broken"]);
});

test("malformed persisted roots are quarantined instead of rejecting initialization", async () => {
  const storage = memoryStorage();
  storage.blobs.set(
    ultraReviewArtifactsPath(identity.repo),
    '{"truncated":',
  );

  const loaded = await readUltraReviewArtifacts(storage, identity.repo);

  assert.deepEqual(loaded, {
    artifacts: {},
    rejected: ["<root>"],
  });
});

test("empty persisted roots are quarantined as malformed JSON", async () => {
  const storage = memoryStorage();
  storage.blobs.set(
    ultraReviewArtifactsPath(identity.repo),
    "",
  );

  const loaded = await readUltraReviewArtifacts(storage, identity.repo);

  assert.deepEqual(loaded, {
    artifacts: {},
    rejected: ["<root>"],
  });
});

test("repository names cannot escape their native storage directory", () => {
  assert.equal(
    ultraReviewArtifactsPath("acme/../../secrets"),
    "repos/acme__..__..__secrets/ultrareviews.json",
  );
});
