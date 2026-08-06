import assert from "node:assert/strict";
import test, { after } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  DiffViewer,
  equalDiffInputs,
} = await server.ssrLoadModule(
  "/src/components/DiffViewer.tsx",
);

after(async () => {
  await server.close();
});

function fileDiff(text = "const value = 1;") {
  return {
    oldPath: "src/value.ts",
    newPath: "src/value.ts",
    isBinary: false,
    isNew: false,
    isDeleted: false,
    isRename: false,
    lines: [
      {
        type: "hunk",
        oldNum: null,
        newNum: null,
        text: "@@ -1 +1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
      },
      {
        type: "add",
        oldNum: null,
        newNum: 1,
        text,
      },
    ],
  };
}

test("equivalent recreated diff inputs compare equal", () => {
  assert.equal(
    equalDiffInputs([fileDiff()], [fileDiff()]),
    true,
  );
});

test("changed diff content does not compare equal", () => {
  assert.equal(
    equalDiffInputs(
      [fileDiff("const value = 1;")],
      [fileDiff("const value = 2;")],
    ),
    false,
  );
});

test("read-only remote viewed state renders one disabled pressed button", () => {
  const html = renderToStaticMarkup(
    createElement(DiffViewer, {
      files: [fileDiff()],
      remoteViewed: {
        map: {
          "src/value.ts": "VIEWED",
        },
      },
    }),
  );

  assert.match(
    html,
    /class="viewed-toggle-btn on"[^>]*aria-pressed="true"[^>]*disabled=""/,
  );
  assert.doesNotMatch(
    html,
    /class="viewed-toggle-btn on"[\s\S]*?<input/,
  );
});

test("mutable remote viewed state keeps the button enabled", () => {
  const html = renderToStaticMarkup(
    createElement(DiffViewer, {
      files: [fileDiff()],
      remoteViewed: {
        map: {},
        toggle: () => {},
      },
    }),
  );

  assert.match(
    html,
    /class="viewed-toggle-btn "[^>]*aria-pressed="false"/,
  );
  assert.doesNotMatch(
    html,
    /class="viewed-toggle-btn "[^>]*disabled=""/,
  );
});
