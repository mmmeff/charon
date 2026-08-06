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
  firstBeatForChapter,
} = await server.ssrLoadModule(
  "/src/components/ultrareview/navigation.ts",
);
const {
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

test("chapter selection starts at its first incomplete beat", () => {
  const targetChapter = chapter("chapter:target", 0, [
    beat("beat:last", 2),
    beat("beat:first", 0),
    beat("beat:middle", 1),
  ]);
  const session = {
    beatStates: {
      "beat:first": "reviewed",
      "beat:middle": "stale",
      "beat:last": "pending",
    },
  };

  assert.equal(
    firstBeatForChapter(targetChapter, session).id,
    "beat:middle",
  );

  session.beatStates["beat:middle"] = "reviewed";
  session.beatStates["beat:last"] = "reviewed";
  assert.equal(
    firstBeatForChapter(targetChapter, session).id,
    "beat:first",
  );
  assert.equal(
    firstBeatForChapter(
      chapter("chapter:empty", 0, []),
      session,
    ),
    null,
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
