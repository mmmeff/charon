/**
 * Design preview entry. Renders real components against fixtures so the UI can
 * be judged and screenshotted in a browser. Selected with ?surface=<name>.
 * Preview-only: not part of the shipped app.
 */
import { MotionConfig } from "motion/react";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import "../../src/styles.css";
import "highlight.js/styles/github-dark.css";

import { AgentCard } from "../../src/components/AgentCard";
import { AppErrorBoundary } from "../../src/components/AppErrorBoundary";
import { Badge, BranchBadge, Section } from "../../src/components/common";
import { DiffViewer } from "../../src/components/DiffViewer";
import { FlowCtx } from "../../src/components/flow";
import { Launcher } from "../../src/components/Launcher";
import { PrWorkspace } from "../../src/components/PrWorkspace";
import { BabysitView } from "../../src/components/views/BabysitView";
import { DraftsView } from "../../src/components/views/DraftsView";
import { ReviewView } from "../../src/components/views/ReviewView";
import { SettingsView } from "../../src/components/views/SettingsView";
import { UltraReviewWorkspace } from "../../src/components/UltraReviewWorkspace";
import { parseUnifiedDiff } from "../../src/lib/diff";
import { RepoPoller, usePrData } from "../../src/lib/events";
import type { FlowContext } from "../../src/lib/flows";
import { GitHubClient } from "../../src/lib/github";
import { useAgentStore, useGlobalConfig, useRepoStore } from "../../src/lib/store";
import { useUltraReviewStore } from "../../src/lib/ultrareview-store";
import type { PrSummary, UltraReviewArtifact } from "../../src/types";
import {
  checks,
  comments,
  deepStackPrs,
  diffText,
  greenChecks,
  greenPr,
  pendingDraftRun,
  prs,
  REPO,
  runs,
} from "./fixtures";
import {
  ultraReviewPreviewArtifact,
  ultraReviewPreviewFiles,
  type UltraReviewPreviewVariant,
} from "./ultrareview-fixtures";

let previewUltraArtifact: UltraReviewArtifact;
let previewUltraPr: PrSummary;
let previewUltraVariant: UltraReviewPreviewVariant = "ready";

async function boot() {
  const global = await useGlobalConfig.getState().load();
  if (!global) throw new Error("preview: global config fixture did not load");
  await useRepoStore.getState().init(REPO);
  await useUltraReviewStore.getState().init(REPO);

  const gh = new GitHubClient(global);
  const repoConfig = useRepoStore.getState().config;
  const surface = new URLSearchParams(window.location.search).get("surface");
  const previewPrs = surface === "stacks" ? deepStackPrs : prs;

  usePrData.getState().patch({
    openPulls: previewPrs,
    myDrafts: previewPrs.filter((p) => p.draft),
    myOpen: surface === "stacks" ? [] : [...prs.filter((p) => !p.draft && p.author === "mfrey"), greenPr],
    reviewQueue: surface === "stacks" ? [] : prs.filter((p) => p.author !== "mfrey"),
    checks: { ...Object.fromEntries(previewPrs.map((p) => [p.number, checks])), [greenPr.number]: greenChecks },
    comments: Object.fromEntries(previewPrs.map((p) => [p.number, comments])),
    lastPollAt: Date.now(),
  });

  // The onboarding surface is the pre-connection state: Launcher renders
  // <Onboarding> whenever the token or login is missing.
  if (new URLSearchParams(window.location.search).get("surface") === "onboarding") {
    useGlobalConfig.setState({ config: { ...global, token: "", login: "" } });
  }

  const allRuns = [...runs, pendingDraftRun];
  useAgentStore.setState({
    runs: Object.fromEntries(allRuns.map((r) => [r.id, r])),
    order: allRuns.map((r) => r.id),
  });

  const ultraVariants: Record<string, UltraReviewPreviewVariant> = {
    ultra: "ready",
    "ultra-loading": "loading",
    "ultra-progressive": "progressive",
    "ultra-invalid": "invalid",
    "ultra-failed": "failed",
    "ultra-resumed": "resumed",
    "ultra-plan": "complex",
    "ultra-partial": "partial",
    "ultra-author": "author",
    "ultra-delta": "delta",
    "ultra-review": "ready",
    "ultra-large": "large",
    "ultra-raw": "ready",
    "ultra-closing": "ready",
    "ultra-merged": "ready",
    "ultra-diff-error": "ready",
    "pr-building": "loading",
    "review-building": "loading",
  };
  previewUltraVariant = ultraVariants[surface ?? ""] ?? "ready";
  previewUltraPr = surface === "pr-building"
    ? prs[0]
    : previewUltraVariant === "author"
    ? prs[0]
    : prs[3];
  if (
    previewUltraVariant === "loading"
    || previewUltraVariant === "progressive"
  ) {
    const analysisRun = {
      ...runs[0],
      id: "run-ultrareview-analysis",
      kind: "ultrareview" as const,
      relation: "build UltraReview",
      prNumber: previewUltraPr.number,
      prTitle: previewUltraPr.title,
      prompt: "Build UltraReview from trusted pull request evidence.",
      startedAt: Date.now() - 41_000,
      entries: [
        {
          type: "thought" as const,
          at: Date.now() - 8_000,
          text:
            previewUltraVariant === "progressive"
              ? "The review plan is published.\n\nTracing the rescue path and its tests into the next review chapter."
              : "The pull request evidence is indexed.\n\nMapping the chapter relationships and assigning each diff to one beat.",
        },
      ],
      tools: {},
      plan: [
        {
          content: "Index pull request evidence",
          status: "completed" as const,
        },
        {
          content: "Build causal chapters",
          status: "in_progress" as const,
        },
        {
          content: "Check changed-line coverage",
          status: "pending" as const,
        },
      ],
    };
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        [analysisRun.id]: analysisRun,
      },
      order: [analysisRun.id, ...state.order],
    }));
  }
  if (surface === "ultra-merged") {
    previewUltraPr = {
      ...previewUltraPr,
      state: "closed",
      merged: true,
    };
  }
  previewUltraArtifact = ultraReviewPreviewArtifact(
    previewUltraPr,
    previewUltraVariant,
  );
  await useUltraReviewStore.getState().put(
    previewUltraArtifact,
  );
  if (previewUltraVariant === "invalid") {
    useUltraReviewStore.setState({
      rejectedArtifactKeys: ["ultrareview:v99:quarantined"],
    });
  }

  const ctx: FlowContext = {
    gh,
    repo: REPO,
    config: repoConfig,
    global,
    skills: [],
    prStacks: usePrData.getState().prStacks,
  };
  const poller = new RepoPoller(() => ctx);
  return { ctx, poller, prStacks: usePrData.getState().prStacks };
}

/** Small plain caption so a proof sheet reads as a sheet, not as product UI. */
function Sheet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "22px 26px 6px" }}>
      <p className="u-mark" style={{ margin: "0 0 12px" }}>{label}</p>
      {children}
    </section>
  );
}

function Kitchen() {
  return (
    <div style={{ maxWidth: 1180 }}>
      <Sheet label="Buttons">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button>Default</button>
          <button className="primary">Push fix</button>
          <button className="danger">Kill run</button>
          <button className="small">Small</button>
          <button disabled>Disabled</button>
          <button className="link">A text link</button>
        </div>
      </Sheet>
      <Sheet label="Fields">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, maxWidth: 760 }}>
          <label className="field">
            <span>Validation command</span>
            <input type="text" defaultValue="npm run typecheck && npm run lint" />
            <small>Runs in the worktree before any push. A non-zero exit sends the commit to a rescue branch.</small>
          </label>
          <label className="field">
            <span>Clone path</span>
            <input type="text" placeholder="leave empty for an app-managed clone" />
            <small>Placeholder contrast is measured against the inset ground, not assumed.</small>
          </label>
        </div>
        <label className="field" style={{ maxWidth: 760 }}>
          <span>Prompt</span>
          <textarea rows={3} defaultValue="Read the failing check and fix the type mismatch." />
        </label>
      </Sheet>
      <Sheet label="Badges, chips, branches">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge color="gray">draft</Badge>
          <Badge color="green">approved</Badge>
          <Badge color="red">2 failing</Badge>
          <Badge color="yellow">queued</Badge>
          <Badge color="blue">running</Badge>
          <Badge color="purple">review requested</Badge>
          <BranchBadge head="mfrey/reject-unreachable-worktrees" base="main" />
        </div>
      </Sheet>
      <Sheet label="Section">
        <Section label="Pending proposals">
          <div className="card">
            <h4>One issue comment queued</h4>
            <p className="meta">Waiting on your approval before it touches GitHub.</p>
          </div>
        </Section>
      </Sheet>
    </div>
  );
}

function Agents() {
  return (
    <div style={{ padding: 22, display: "grid", gap: 12, maxWidth: 1100 }}>
      {runs.map((r) => (
        <AgentCard key={r.id} run={r} defaultOpen />
      ))}
    </div>
  );
}

function Diff() {
  return (
    <div className="pr-diff" style={{ padding: 22 }}>
      <DiffViewer files={parseUnifiedDiff(diffText)} selectable />
    </div>
  );
}

function UltraReviewPreview() {
  const requestedSurface =
    new URLSearchParams(window.location.search).get("surface");
  const initialSurface = requestedSurface === "ultra-review"
    || requestedSurface === "ultra-large"
    || requestedSurface === "ultra-merged"
    ? "review" as const
    : requestedSurface === "ultra-raw"
      ? "raw" as const
      : requestedSurface === "ultra-closing"
        ? "ledger" as const
        : previewUltraVariant === "loading"
      ? "generation" as const
      : previewUltraVariant === "resumed"
          ? "review" as const
          : previewUltraVariant === "author"
            ? "ledger" as const
            : "intro" as const;
  return (
    <UltraReviewWorkspace
      pr={previewUltraPr}
      mode={
        previewUltraVariant === "author"
          ? "author"
          : "teammate"
      }
      files={
        requestedSurface === "ultra-diff-error"
          ? null
          : ultraReviewPreviewFiles(previewUltraVariant)
      }
      filesError={
        requestedSurface === "ultra-diff-error"
          ? "Native diff proxy returned 502 for this pull request."
          : undefined
      }
      onRetryFiles={
        requestedSurface === "ultra-diff-error"
          ? () => undefined
          : undefined
      }
      remoteViewed={{
        map: { "src/lib/worktree.ts": "VIEWED" },
        toggle: () => undefined,
      }}
      initialSurface={initialSurface}
      onLeave={() => undefined}
    />
  );
}

const SURFACES: Record<string, () => React.ReactElement> = {
  kitchen: () => <Kitchen />,
  agents: () => <Agents />,
  diff: () => <Diff />,
  launcher: () => <Launcher />,
  onboarding: () => <Launcher />,
  settings: () => <SettingsView />,
  review: () => <ReviewView />,
  "review-building": () => <ReviewView />,
  open: () => <BabysitView />,
  drafts: () => <DraftsView />,
  stacks: () => <DraftsView />,
  pr: () => <PrWorkspace pr={prs[0]} variant="babysit" />,
  "pr-building": () => (
    <PrWorkspace pr={prs[0]} variant="babysit" />
  ),
  clean: () => <PrWorkspace pr={greenPr} variant="babysit" />,
  draft: () => <PrWorkspace pr={prs[2]} variant="draft" />,
  ultra: () => <UltraReviewPreview />,
  "ultra-loading": () => <UltraReviewPreview />,
  "ultra-progressive": () => <UltraReviewPreview />,
  "ultra-invalid": () => <UltraReviewPreview />,
  "ultra-failed": () => <UltraReviewPreview />,
  "ultra-resumed": () => <UltraReviewPreview />,
  "ultra-plan": () => <UltraReviewPreview />,
  "ultra-partial": () => <UltraReviewPreview />,
  "ultra-author": () => <UltraReviewPreview />,
  "ultra-delta": () => <UltraReviewPreview />,
  "ultra-review": () => <UltraReviewPreview />,
  "ultra-large": () => <UltraReviewPreview />,
  "ultra-raw": () => <UltraReviewPreview />,
  "ultra-closing": () => <UltraReviewPreview />,
  "ultra-merged": () => <UltraReviewPreview />,
  "ultra-diff-error": () => <UltraReviewPreview />,
};

boot().then((value) => {
  const name = new URLSearchParams(window.location.search).get("surface") ?? "kitchen";
  const render = SURFACES[name];
  const body = render ? (
    render()
  ) : (
    <p style={{ padding: 24 }}>Unknown surface "{name}". Try: {Object.keys(SURFACES).join(", ")}</p>
  );
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <MotionConfig reducedMotion="user">
          <FlowCtx.Provider value={value}>{body}</FlowCtx.Provider>
        </MotionConfig>
      </AppErrorBoundary>
    </React.StrictMode>
  );
});
