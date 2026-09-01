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
  allBeats,
} = await server.ssrLoadModule(
  "/src/components/ultrareview/navigation.ts",
);
const {
  lineNoteEvidenceIds,
  saveNoteComposerBody,
} = await server.ssrLoadModule(
  "/src/components/ultrareview/review-shared.tsx",
);

after(async () => {
  await server.close();
});

function beat(id, order) {
  return {
    id,
    order,
  };
}

function chapter(id, order, beats) {
  return {
    id,
    order,
    beats,
  };
}

function system(id, order, chapters) {
  return {
    id,
    order,
    chapters,
  };
}

test("beat order follows systems, then chapters, then local beat order", () => {
  const artifact = {
    galaxy: {
      systems: [
        system("system:second", 1, [
          chapter("chapter:second:one", 0, [
            beat("beat:second:one:two", 1),
            beat("beat:second:one:one", 0),
          ]),
        ]),
        system("system:first", 0, [
          chapter("chapter:first:two", 1, [
            beat("beat:first:two:one", 0),
          ]),
          chapter("chapter:first:one", 0, [
            beat("beat:first:one:two", 1),
            beat("beat:first:one:one", 0),
          ]),
        ]),
      ],
    },
  };

  assert.deepEqual(
    allBeats(artifact).map((item) => item.id),
    [
      "beat:first:one:one",
      "beat:first:one:two",
      "beat:first:two:one",
      "beat:second:one:one",
      "beat:second:one:two",
    ],
  );
});

test("rejected note saves preserve the draft and keep the composer open", () => {
  let closeCount = 0;
  let receivedBody = "";
  const rejected = saveNoteComposerBody(
    "  Keep this range note.  ",
    (body) => {
      receivedBody = body;
      return false;
    },
    () => {
      closeCount += 1;
    },
  );

  assert.equal(receivedBody, "Keep this range note.");
  assert.equal(rejected, "  Keep this range note.  ");
  assert.equal(closeCount, 0);

  const accepted = saveNoteComposerBody(
    rejected,
    () => true,
    () => {
      closeCount += 1;
    },
  );
  assert.equal(accepted, "");
  assert.equal(closeCount, 1);
});

test("a line note can span adjacent changed evidence", () => {
  const artifact = {
    evidence: [
      {
        id: "evidence:10",
        kind: "changed",
        location: {
          path: "src/review.ts",
          side: "RIGHT",
          startLine: 10,
          endLine: 10,
        },
      },
      {
        id: "evidence:11",
        kind: "changed",
        location: {
          path: "src/review.ts",
          side: "RIGHT",
          startLine: 11,
          endLine: 11,
        },
      },
    ],
  };

  assert.deepEqual(
    lineNoteEvidenceIds(artifact, {
      path: "src/review.ts",
      side: "RIGHT",
      startLine: 10,
      endLine: 11,
      snippet: "first\nsecond",
    }),
    ["evidence:10", "evidence:11"],
  );
});
