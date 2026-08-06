import assert from "node:assert/strict";
import test, { after } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  root: process.cwd(),
  server: {
    middlewareMode: true,
  },
  appType: "custom",
  logLevel: "silent",
});
const { ReviewPlanIntro } = await server.ssrLoadModule(
  "/src/components/ultrareview/ReviewPlanIntro.tsx",
);
const { ReviewStoryRail } = await server.ssrLoadModule(
  "/src/components/ultrareview/ReviewStoryRail.tsx",
);

after(async () => {
  await server.close();
});

const beat = {
  id: "beat:one",
  title: "Inspect the boundary",
  state: "pending",
};
const chapter = {
  id: "chapter:one",
  title: "Reject the stale root",
  state: "pending",
  beats: [beat],
};
const system = {
  id: "system:one",
  title: "Make leasing honest",
  state: "pending",
  chapters: [chapter],
};
const thesis = {
  title: "Preserve rejected work",
  summary: "Fail early, then keep the commit.",
  scope: {
    changedLines: 12,
    files: 3,
  },
};

function render(component, props) {
  return renderToStaticMarkup(
    React.createElement(component, props),
  );
}

test("review plan exposes trusted scope and coverage", () => {
  const html = render(ReviewPlanIntro, {
    thesis,
    systems: [system],
    coverage: {
      mapped: 11,
      total: 12,
      unmapped: 1,
    },
    onBeginReview: () => {},
  });

  assert.match(html, /12 changed lines in 3 files/);
  assert.match(html, /11\/12 mapped \/ 1 unmapped/);
  assert.match(html, /1 chapter/);
  assert.match(html, /1 beat/);
});

test("single-system reviews lead with chapters", () => {
  const plan = render(ReviewPlanIntro, {
    thesis,
    systems: [system],
    onBeginReview: () => {},
  });
  const rail = render(ReviewStoryRail, {
    systems: [system],
  });

  assert.doesNotMatch(plan, /System 01/);
  assert.doesNotMatch(rail, /System 01/);
  assert.match(plan, /Reject the stale root/);
  assert.match(rail, /Reject the stale root/);
});

test("multi-system reviews retain explicit system groups", () => {
  const systems = [
    system,
    {
      ...system,
      id: "system:two",
      title: "Preserve rejected work",
    },
  ];
  const plan = render(ReviewPlanIntro, {
    thesis,
    systems,
    onBeginReview: () => {},
  });
  const rail = render(ReviewStoryRail, { systems });

  assert.match(plan, /System 01/);
  assert.match(plan, /System 02/);
  assert.match(rail, /System 01/);
  assert.match(rail, /System 02/);
});
