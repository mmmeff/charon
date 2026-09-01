import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

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
const root = fileURLToPath(new URL("../..", import.meta.url));
const { ReviewPlanIntro } = await server.ssrLoadModule(
  "/src/components/ultrareview/ReviewPlanIntro.tsx",
);
const { ReviewOutline } = await server.ssrLoadModule(
  "/src/components/ultrareview/ReviewOutline.tsx",
);
const { UltraReviewEntry } = await server.ssrLoadModule(
  "/src/components/ultrareview/UltraReviewEntry.tsx",
);
const {
  ReviewDocument,
  reviewDiffUnitCount,
  reviewProgressPercent,
} = await server.ssrLoadModule(
  "/src/components/ultrareview/ReviewDocument.tsx",
);
const { UltraReviewWorkspace } = await server.ssrLoadModule(
  "/src/components/UltraReviewWorkspace.tsx",
);
const { FlowCtx } = await server.ssrLoadModule(
  "/src/components/flow.ts",
);
const {
  ultraReviewPreviewArtifact,
  ultraReviewPreviewFiles,
} = await server.ssrLoadModule(
  "/design/preview/ultrareview-fixtures.ts",
);
const { prs } = await server.ssrLoadModule(
  "/design/preview/fixtures.ts",
);
const { useUiStore } = await server.ssrLoadModule(
  "/src/lib/store.ts",
);
const { useUltraReviewStore } = await server.ssrLoadModule(
  "/src/lib/ultrareview-store.ts",
);

after(async () => {
  await server.close();
});

const beat = {
  id: "beat:one",
  title: "Inspect the boundary",
  objective: "Tell the reviewer what to inspect.",
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

test("UltraReview entry is one accessible action", () => {
  const html = render(UltraReviewEntry, {
    onBegin: () => {},
  });

  assert.equal(html.match(/<button/g)?.length, 1);
  assert.match(html, /aria-label="Open UltraReview"/);
  assert.match(html, /aria-describedby="[^"]+"/);
  assert.match(html, /data-generation-status="new"/);
  assert.match(
    html,
    /ultra-entry-banner-title">UltraReview<\/span>/,
  );
  assert.match(
    html,
    /ultra-entry-banner-badge" aria-live="polite" aria-atomic="true">New<\/span>/,
  );
  assert.match(
    html,
    /ultra-entry-banner-signal" aria-hidden="true"><svg/,
  );
  assert.doesNotMatch(html, />Begin</);
  assert.doesNotMatch(html, /Review this change in causal order/);
});

test("UltraReview entry reflects persisted generation state", () => {
  for (const [generationStatus, label] of [
    ["idle", "Waiting"],
    ["running", "Building"],
    ["partial", "Partial"],
    ["complete", "Ready"],
    ["failed", "Failed"],
  ]) {
    const html = render(UltraReviewEntry, {
      generationStatus,
      onBegin: () => {},
    });

    assert.match(
      html,
      new RegExp(`data-generation-status="${generationStatus}"`),
    );
    assert.match(
      html,
      new RegExp(`aria-atomic="true">${label}<\\/span>`),
    );
    assert.doesNotMatch(html, />New<\/span>/);
  }
});

test("UltraReview uses the app navigation history", () => {
  for (const tab of ["drafts", "open", "review"]) {
    useUiStore.setState({
      navHistory: [],
      navIndex: -1,
      navApplying: false,
    });
    const ui = useUiStore.getState();
    ui.navPush(tab, 10997);
    ui.navPush(tab, 10997, "ultrareview");

    assert.deepEqual(
      useUiStore.getState().navHistory,
      [
        { tab, pr: 10997, view: "pr" },
        { tab, pr: 10997, view: "ultrareview" },
      ],
    );
    assert.deepEqual(
      useUiStore.getState().navGo(-1),
      { tab, pr: 10997, view: "pr" },
    );
    useUiStore.getState().navApplied();
    assert.deepEqual(
      useUiStore.getState().navGo(1),
      { tab, pr: 10997, view: "ultrareview" },
    );
    useUiStore.getState().navApplied();
  }
});

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

test("the document outline stays focused on navigation", () => {
  const html = render(ReviewOutline, {
    systems: [system],
    activeBeatId: beat.id,
  });

  assert.match(html, /Inspect the boundary/);
  assert.match(html, /Reject the stale root/);
  assert.match(html, /aria-current="location"/);
  assert.match(
    html,
    /ultra-review-outline-chapter" data-active="true"/,
  );
  assert.doesNotMatch(html, /Tell the reviewer what to inspect/);
  assert.doesNotMatch(html, /inspected/i);
  assert.doesNotMatch(html, /risk/i);
});

test("each beat owns one quiet, locally tracked diff viewer", () => {
  const beatWorkspace = readFileSync(
    `${root}/src/components/ultrareview/BeatWorkspace.tsx`,
    "utf8",
  );
  const diffViewer = readFileSync(
    `${root}/src/components/DiffViewer.tsx`,
    "utf8",
  );
  const rawDiffWorkspace = readFileSync(
    `${root}/src/components/ultrareview/RawDiffWorkspace.tsx`,
    "utf8",
  );
  const closingLedger = readFileSync(
    `${root}/src/components/ultrareview/ClosingLedger.tsx`,
    "utf8",
  );

  assert.equal(beatWorkspace.match(/<DiffViewer\b/g)?.length, 1);
  assert.equal(
    diffViewer.match(/className="diff-title-control-bar"/g)?.length,
    1,
  );
  assert.match(beatWorkspace, /\{beat\.objective\}/);
  assert.match(beatWorkspace, /WHY THIS BEAT EXISTS/);
  assert.match(beatWorkspace, /PR CONNECTION/);
  assert.match(beatWorkspace, /disablePatternAutoCollapse/);
  assert.match(rawDiffWorkspace, /disablePatternAutoCollapse/);
  assert.match(closingLedger, /disablePatternAutoCollapse/);
  assert.match(beatWorkspace, /trackViewed/);
  assert.match(beatWorkspace, /GitHubCommentBody/);
  assert.match(rawDiffWorkspace, /GitHubCommentBody/);
  assert.match(closingLedger, /GitHubCommentBody/);
  assert.match(diffViewer, /rememberScrollAnchor/);
  assert.match(diffViewer, /restoreScrollAnchor/);
  assert.doesNotMatch(beatWorkspace, /remoteViewed/);
  assert.doesNotMatch(beatWorkspace, /ultra-beat-grounding/);
  assert.doesNotMatch(beatWorkspace, /CONTEXT TOOLS/);
  assert.doesNotMatch(beatWorkspace, /components move together/);
});

test("the closing workspace is one review editor without a payload dump", () => {
  const closingLedger = readFileSync(
    `${root}/src/components/ultrareview/ClosingLedger.tsx`,
    "utf8",
  );

  assert.match(closingLedger, />Final Review</);
  assert.match(closingLedger, />Submit Review</);
  assert.doesNotMatch(closingLedger, /Judgment starts after evidence/);
  assert.doesNotMatch(closingLedger, /EXACT GITHUB PAYLOAD/);
  assert.doesNotMatch(closingLedger, /The model does not choose this/);
  assert.doesNotMatch(closingLedger, /ultra-payload-preview/);
  assert.match(closingLedger, /Submit as inline comment/);
  assert.match(closingLedger, /Assessment recommendation/);
  assert.match(closingLedger, /updateUltraReviewNote/);
  assert.match(closingLedger, /sourceNotesFingerprint/);
});

test("note types and final assessment policy are reviewer-configurable", () => {
  const shared = readFileSync(
    `${root}/src/components/ultrareview/review-shared.tsx`,
    "utf8",
  );
  const settings = readFileSync(
    `${root}/src/components/views/SettingsView.tsx`,
    "utf8",
  );
  for (const kind of [
    "note",
    "nitpick",
    "request",
    "suggestion",
    "praise",
  ]) {
    assert.match(shared, new RegExp(`\\[\"${kind}\"`));
  }
  assert.match(settings, /UltraReview final assessment prompt/);
  assert.match(settings, /ultraReviewFinalAssessmentPrompt/);
  assert.match(shared, /export function GitHubCommentBody/);
  assert.match(shared, /<Markdown/);
});

test("review mode uses scroll progress and one completion action", () => {
  const workspace = readFileSync(
    `${root}/src/components/UltraReviewWorkspace.tsx`,
    "utf8",
  );
  const document = readFileSync(
    `${root}/src/components/ultrareview/ReviewDocument.tsx`,
    "utf8",
  );
  const types = readFileSync(
    `${root}/src/types.ts`,
    "utf8",
  );

  assert.match(workspace, /<ReviewDocument/);
  assert.match(workspace, /<ReviewOutline/);
  assert.match(document, /<BeatWorkspace/);
  assert.match(document, /system\.chapters/);
  assert.match(document, /chapter\.beats/);
  assert.match(workspace, /<ReviewScrollProgress/);
  assert.match(workspace, /Done reviewing/);
  assert.match(document, /Done reviewing/);
  assert.match(types, /reviewCompletedAt\?: number/);
  assert.doesNotMatch(workspace, /<ReviewStoryRail/);
  assert.doesNotMatch(workspace, /ultra-review-flowbar/);
  assert.doesNotMatch(workspace, /advanceCurrentBeat/);
  assert.doesNotMatch(workspace, /Beat \{beatIndex \+ 1\} of/);
  assert.doesNotMatch(document, /Mark inspected/i);
  assert.doesNotMatch(types, /beatStates/);
});

test("UltraReview renders generation while its artifact is absent", () => {
  const pr = prs[3];
  let html;

  useUltraReviewStore.setState({
    repo: "octavia/charon",
    loaded: true,
    artifacts: {},
    rejectedArtifactKeys: [],
  });

  try {
    html = renderToStaticMarkup(
      React.createElement(
        FlowCtx.Provider,
        {
          value: {
            ctx: {
              repo: "octavia/charon",
              gh: {
                getFileText: async () => null,
              },
            },
            poller: {},
            prStacks: {},
          },
        },
        React.createElement(UltraReviewWorkspace, {
          pr,
          mode: "teammate",
          files: [],
          onLeave: () => {},
          initialSurface: "generation",
        }),
      ),
    );
  } finally {
    useUltraReviewStore.setState({
      repo: null,
      loaded: false,
      artifacts: {},
      rejectedArtifactKeys: [],
    });
  }

  assert.match(html, /Indexing files/);
});

test("large review documents mount only reached diff viewers", () => {
  const pr = prs[3];
  const artifact = ultraReviewPreviewArtifact(pr, "large");
  const files = ultraReviewPreviewFiles("large");
  const renderDocument = (props = {}) => renderToStaticMarkup(
    React.createElement(
      FlowCtx.Provider,
      {
        value: {
          ctx: {
            repo: "octavia/charon",
            gh: {
              getFileText: async () => null,
            },
          },
          poller: {},
          prStacks: {},
        },
      },
      React.createElement(ReviewDocument, {
        pr,
        artifact,
        session: artifact.sessions.teammate,
        files,
        comments: [],
        readOnly: false,
        onMutate: () => {},
        onDoneReviewing: () => {},
        ...props,
      }),
    ),
  );
  const html = renderDocument();

  assert.equal(
    html.match(/data-ultra-beat-id=/g)?.length,
    24,
  );
  assert.equal(
    html.match(/class="diff-title-control-bar"/g)?.length,
    2,
  );
  assert.doesNotMatch(
    html,
    /data-materialized="true" style="min-height:/,
  );
  assert.match(
    html,
    /data-materialized="false" style="min-height:/,
  );
  assert.match(html, /data-ultra-progress-total="\d+"/);
  assert.match(html, /data-ultra-progress-unit="1"/);
  assert.match(html, /data-ultra-progress-end="true"/);

  const finalBeat = artifact.galaxy.systems
    .flatMap((candidate) => candidate.chapters)
    .flatMap((candidate) => candidate.beats)
    .at(-1);
  assert.ok(finalBeat);
  const jumpedHtml = renderDocument({
    forceMaterializedBeatId: finalBeat.id,
  });
  assert.equal(
    jumpedHtml.match(/class="diff-title-control-bar"/g)?.length,
    3,
  );
});

test("large review scrolling does no synchronous section layout", () => {
  const workspace = readFileSync(
    `${root}/src/components/UltraReviewWorkspace.tsx`,
    "utf8",
  );
  const document = readFileSync(
    `${root}/src/components/ultrareview/ReviewDocument.tsx`,
    "utf8",
  );
  const styles = readFileSync(
    `${root}/src/styles.css`,
    "utf8",
  );
  const persistStart = workspace.indexOf(
    "  const persistScroll = () => {",
  );
  const persistEnd = workspace.indexOf(
    "\n  useEffect(",
    persistStart,
  );
  const persistScroll = workspace.slice(persistStart, persistEnd);

  assert.match(workspace, /new IntersectionObserver\(/);
  assert.doesNotMatch(workspace, /BEAT_MATERIALIZATION_IDLE_MS/);
  assert.doesNotMatch(persistScroll, /getBoundingClientRect/);
  assert.doesNotMatch(persistScroll, /querySelectorAll/);
  assert.match(document, /memo\(function ReviewDocument/);
  assert.match(document, /new IntersectionObserver\(/);
  assert.match(document, /root\.clientHeight/);
  assert.match(document, /rootMargin:/);
  assert.match(document, /startTransition\(/);
  assert.doesNotMatch(document, /activeBeatIndex/);
  assert.match(styles, /content-visibility: auto/);
});

test("review progress uses fixed beat and hunk units", () => {
  const workspace = readFileSync(
    `${root}/src/components/UltraReviewWorkspace.tsx`,
    "utf8",
  );
  const progressStart = workspace.indexOf(
    "function ReviewScrollProgress",
  );
  const progressEnd = workspace.indexOf(
    "interface UltraReviewWorkspaceProps",
    progressStart,
  );
  const progressSource = workspace.slice(
    progressStart,
    progressEnd,
  );
  const files = [
    {
      oldPath: "src/two-hunks.ts",
      newPath: "src/two-hunks.ts",
      lines: [
        { type: "hunk", text: "@@ -1 +1 @@" },
        { type: "add", text: "+one" },
        { type: "hunk", text: "@@ -8 +8 @@" },
        { type: "add", text: "+two" },
      ],
    },
    {
      oldPath: "assets/image.png",
      newPath: "assets/image.png",
      isBinary: true,
      lines: [],
    },
  ];

  assert.equal(reviewDiffUnitCount(files), 3);
  assert.equal(reviewProgressPercent(1, 10), 0);
  assert.equal(reviewProgressPercent(6, 10), 50);
  assert.equal(reviewProgressPercent(11, 10), 100);
  assert.doesNotMatch(progressSource, /scrollHeight/);
  assert.doesNotMatch(progressSource, /scrollTop/);
  assert.match(progressSource, /data-ultra-progress-unit/);
  assert.match(progressSource, /Math\.max\(current, next\)/);
});

test("single-system reviews lead with chapters", () => {
  const plan = render(ReviewPlanIntro, {
    thesis,
    systems: [system],
    onBeginReview: () => {},
  });
  const outline = render(ReviewOutline, {
    systems: [system],
  });

  assert.doesNotMatch(plan, /System 01/);
  assert.doesNotMatch(outline, /System 01/);
  assert.match(plan, /Reject the stale root/);
  assert.match(outline, /Reject the stale root/);
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
  const outline = render(ReviewOutline, { systems });

  assert.match(plan, /System 01/);
  assert.match(plan, /System 02/);
  assert.match(outline, /System 01/);
  assert.match(outline, /System 02/);
});

test("story generation owns the live reasoning signal", () => {
  const html = render(ReviewPlanIntro, {
    thesis,
    systems: [],
    generation: {
      status: "running",
      stages: [
        {
          id: "indexing",
          label: "Index pull request evidence",
          status: "complete",
        },
        {
          id: "story",
          label: "Build causal chapters",
          status: "running",
        },
      ],
    },
    reasoningActivity: "First thought.\n\nLatest useful paragraph.",
    onBeginReview: () => {},
  });
  const hero = html.slice(
    0,
    html.indexOf('<section class="ultra-review-plan-generation"'),
  );

  assert.match(html, />1<\/span><div class="ultra-review-plan-stage-copy"><strong>Indexing files/);
  assert.match(html, />2<\/span><div class="ultra-review-plan-stage-copy"><strong>Building story/);
  assert.match(
    html,
    /<strong>Building story<\/strong>[\s\S]*?Latest useful paragraph/,
  );
  assert.doesNotMatch(hero, /Latest useful paragraph/);
  assert.doesNotMatch(html, /Building Review Chapters/);
  assert.doesNotMatch(html, /First thought/);
  assert.doesNotMatch(html, /No review plan yet/);
});

test("planned chapters nest under one live generation step", () => {
  const html = render(ReviewPlanIntro, {
    thesis,
    systems: [system],
    generation: {
      status: "running",
      stages: [
        {
          id: "indexing",
          label: "Index pull request evidence",
          status: "complete",
        },
        {
          id: "story",
          label: "Build causal chapters",
          status: "complete",
        },
        {
          id: "chapter:one",
          label: "Chapter: Reject the stale root",
          status: "complete",
          systemId: "system:one",
        },
        {
          id: "chapter:two",
          label: "Chapter: Preserve the rejected commit",
          status: "pending",
          systemId: "system:one",
        },
      ],
    },
    reasoningActivity: "First thought.\n\nLatest useful paragraph.",
    onBeginReview: () => {},
  });

  assert.match(html, /<strong>Building Review Chapters<\/strong>/);
  assert.match(
    html,
    /data-stage-group="chapters" aria-current="step"/,
  );
  assert.match(html, /class="ultra-review-plan-chapter-stages"/);
  assert.match(html, /Reject the stale root/);
  assert.match(html, /Preserve the rejected commit/);
  assert.match(html, /Latest useful paragraph/);
  assert.equal(
    html.match(/Latest useful paragraph/g)?.length,
    1,
  );
  assert.equal(html.match(/role="status"/g)?.length, 1);
  assert.doesNotMatch(html, /First thought/);
  assert.doesNotMatch(html, /Live analysis/);
  assert.doesNotMatch(html, /Observed agent activity/);
  assert.doesNotMatch(html, /No review plan yet/);
  assert.match(html, /data-motion="live"/);
});

test("chapter generation stays active through final assembly", () => {
  const html = render(ReviewPlanIntro, {
    thesis,
    systems: [system],
    generation: {
      status: "running",
      stages: [
        {
          id: "indexing",
          label: "Index pull request evidence",
          status: "complete",
        },
        {
          id: "story",
          label: "Build causal chapters",
          status: "complete",
        },
        {
          id: "chapter:one",
          label: "Chapter: Reject the stale root",
          status: "complete",
          systemId: "system:one",
        },
      ],
    },
    reasoningActivity: "Assembling the final coverage audit.",
    onBeginReview: () => {},
  });

  assert.match(html, /2 of 3 complete/);
  assert.match(
    html,
    /data-status="running" data-stage-group="chapters" aria-current="step"/,
  );
  assert.match(html, /Assembling the final coverage audit/);
});

test("UltraReview settings expose their own reasoning picker", () => {
  const settings = readFileSync(
    `${root}/src/components/views/SettingsView.tsx`,
    "utf8",
  );
  assert.doesNotMatch(settings, /modelOnly/);
  assert.match(settings, /\{reasoningSelect\(/);
});

test("failed analysis stops active progress and exposes recovery", () => {
  const html = render(ReviewPlanIntro, {
    thesis: {
      ...thesis,
      summary: "Analysis in progress",
    },
    systems: [],
    failures: [
      {
        id: "analysis",
        message: "UltraReview could not build this review plan.",
        retryable: true,
      },
    ],
    generation: {
      status: "failed",
      stages: [
        {
          id: "story",
          label: "Build causal chapters",
          status: "running",
        },
      ],
    },
    reasoningActivity: "This stream must stop",
    onRetryFailure: () => {},
    onBeginReview: () => {},
  });

  assert.match(html, /UltraReview could not build this review plan/);
  assert.match(html, />failed</);
  assert.match(html, /Restart analysis/);
  assert.doesNotMatch(html, /Working now/);
  assert.doesNotMatch(html, /aria-current="step"/);
  assert.doesNotMatch(html, /This stream must stop/);
  assert.doesNotMatch(html, /Analysis in progress/);
  assert.doesNotMatch(html, /raw diff stays available/i);
  assert.doesNotMatch(html, /completed chapters remain reviewable/i);
  assert.match(html, /data-motion="still"/);
});
