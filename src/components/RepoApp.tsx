import { useEffect, useMemo, useRef, useState } from "react";
import { refreshModels } from "../lib/agents";
import { isActiveAgentStatus, isVisibleAgentRun } from "../lib/agent-runs";
import { GitHubClient } from "../lib/github";
import { RepoPoller, usePrData } from "../lib/events";
import type { FlowContext } from "../lib/flows";
import { loadSkills } from "../lib/skills";
import { initAgentPersistence } from "../lib/agents";
import {
  initSwarmPersistence,
  useAgentStore,
  useGlobalConfig,
  useRepoStore,
  useSkillStore,
  useSwarmStore,
  useUiStore,
} from "../lib/store";
import {
  actionForShortcutEvent,
  formatShortcut,
  isShortcutRecorderTarget,
  resolveShortcutMap,
} from "../lib/shortcuts";
import { native } from "../lib/tauri";
import { navigateToPr } from "../lib/nav";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { timeAgo, useNow } from "../lib/ui";
import type { ShortcutActionId, PrSummary } from "../types";
import { FlowCtx, useFlow } from "./flow";
import {
  IconActivity,
  IconCharonMoon,
  IconDrafts,
  IconOpen,
  IconRefresh,
  IconRepos,
  IconReview,
  IconSettings,
  IconSidePanel,
} from "./icons";
import { AsciiField } from "./AsciiField";
import { CommitDiffModal } from "./CommitDiffModal";
import { CommandPalette } from "./CommandPalette";
import { PrWorkspace } from "./PrWorkspace";
import { ActivityView } from "./views/ActivityView";
import { BabysitView } from "./views/BabysitView";
import { DraftsView } from "./views/DraftsView";
import { ReviewView } from "./views/ReviewView";
import { SettingsView } from "./views/SettingsView";

type Tab = "drafts" | "open" | "review" | "activity" | "settings";
const TABS: Tab[] = ["drafts", "open", "review", "activity", "settings"];
const TAB_SHORTCUTS: Record<Tab, ShortcutActionId> = {
  drafts: "tab_drafts",
  open: "tab_open",
  review: "tab_review",
  activity: "tab_activity",
  settings: "tab_settings",
};

function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest("input, textarea, select, [contenteditable]")
  );
}

/** One repo, one window: tabbed shell that owns the poller and flow context. */
export function RepoApp({ repo }: { repo: string }) {
  const global = useGlobalConfig((s) => s.config);
  const shortcuts = useMemo(() => resolveShortcutMap(global?.shortcuts), [global?.shortcuts]);
  const repoStore = useRepoStore();
  const skills = useSkillStore((s) => s.skills);
  // remember the last tab per repo across launches
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = localStorage.getItem(`prc-tab-${repo}`) as Tab | null;
    return saved && TABS.includes(saved) ? saved : "open";
  });
  const setTab = (t: Tab) => {
    localStorage.setItem(`prc-tab-${repo}`, t);
    setTabState(t);
    const ui = useUiStore.getState();
    ui.navPush(t, ui.focusedPr[t] ?? null);
  };

  // back/forward across (tab, focused PR) locations
  const navIndex = useUiStore((s) => s.navIndex);
  const navLen = useUiStore((s) => s.navHistory.length);
  const goHistory = (delta: 1 | -1) => {
    const ui = useUiStore.getState();
    const loc = ui.navGo(delta);
    if (!loc) return;
    localStorage.setItem(`prc-tab-${repo}`, loc.tab);
    setTabState(loc.tab as Tab);
    if (loc.pr != null) ui.setFocusedPr(loc.tab, loc.pr);
    ui.navApplied();
  };
  // seed the history with the restored location
  useEffect(() => {
    const ui = useUiStore.getState();
    ui.navPush(tab, ui.focusedPr[tab] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastNonActivityTab = useRef<Tab>(tab === "activity" ? "open" : tab);
  useEffect(() => {
    if (tab !== "activity") lastNonActivityTab.current = tab;
  }, [tab]);

  // tab switches requested elsewhere (e.g. agent-card PR links)
  const requestedTab = useUiStore((s) => s.requestedTab);
  useEffect(() => {
    if (requestedTab && TABS.includes(requestedTab.tab as Tab)) setTab(requestedTab.tab as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab?.nonce]);
  const prData = usePrData();
  // Active-agent count drives the rail badge. Derived as a single primitive
  // so RepoApp re-renders only when the count actually changes — appending a
  // chunk to any run produces a fresh `runs` ref (store.appendChunk replaces
  // the object), so a whole-map subscription would re-render RepoApp (and via
  // it the entire active tab subtree) on EVERY chunk from EVERY background
  // agent. A number-returning selector falls back to `Object.is` and stays
  // stable across chunks whose runs don't change the active set.
  const activeAgents = useAgentStore((s) => {
    let n = 0;
    for (const id of s.order) {
      const r = s.runs[id];
      if (r && isVisibleAgentRun(r) && isActiveAgentStatus(r.status)) n++;
    }
    return n;
  });
  const scrolledPr = useUiStore((s) => s.scrolledPrTitle);
  const activityPanelOpen = useUiStore((s) => s.activityPanelOpen);
  const setActivityPanelOpen = useUiStore((s) => s.setActivityPanelOpen);
  const prSidebarOpen = useUiStore((s) => s.prSidebarOpen);
  const setPrSidebarOpen = useUiStore((s) => s.setPrSidebarOpen);
  const orphanPr = useUiStore((s) => s.orphanPr);
  // keep the breadcrumb mounted briefly on hide so it can animate out
  const [crumb, setCrumb] = useState(scrolledPr);
  const [crumbLeaving, setCrumbLeaving] = useState(false);
  useEffect(() => {
    if (scrolledPr) {
      setCrumb(scrolledPr);
      setCrumbLeaving(false);
    } else if (crumb) {
      setCrumbLeaving(true);
      const t = setTimeout(() => {
        setCrumb(null);
        setCrumbLeaving(false);
      }, 180);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrolledPr]);
  useNow(); // keeps "synced Xs ago" ticking without interaction

  useEffect(() => {
    void repoStore.init(repo);
    // remember this repo so the next app boot reopens it directly
    void useGlobalConfig.getState().setLastRepo(repo);
    // restore agent history and keep persisting it across restarts
    let cleanups: Array<() => void> = [];
    // initAgentPersistence first — it marks in-flight runs as killed on restart.
    // initSwarmPersistence runs after so it sees the post-restart contender
    // statuses and re-leases held worktrees accordingly (ADR-0003 hydrate order).
    void initAgentPersistence(repo).then((c) => cleanups.push(c));
    void initSwarmPersistence(repo).then((c) => cleanups.push(c));
    return () => cleanups.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  useEffect(() => {
    if (global) void loadSkills(global.extraSkillDirs);
  }, [global]);

  // refresh the model list from the Cursor CLI once per window startup
  const saveGlobal = useGlobalConfig((s) => s.save);
  const modelsRefreshed = useRef(false);
  useEffect(() => {
    if (global && !modelsRefreshed.current) {
      modelsRefreshed.current = true;
      void refreshModels(global, saveGlobal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [global]);

  const gh = useMemo(
    () => (global ? new GitHubClient(global) : null),
    [global?.githubUrl, global?.token, global?.insecureTls, global?.login]
  );

  // Poller reads the *latest* context through a ref so config edits apply
  // without restarting it. The context object itself is memoized so its
  // identity stays stable across RepoApp re-renders (the useNow() ticker, poll
  // updates, active-agent badge changes) — without this, an inline object
  // literal here would give FlowCtx a new ref every render and force every
  // `useFlow()` consumer (CommitDiffModal's DiffViewer, swarm ContenderDiff,
  // nav, etc.) to re-render on every RepoApp tick, which rebuilds thousands of
  // diff rows per second and triggers full-GC pressure.
  const ctxRef = useRef<FlowContext | null>(null);
  const flowCtx = useMemo<FlowContext | null>(
    () =>
      gh && global && repoStore.loaded
        ? { gh, repo, config: repoStore.config, global, skills, prStacks: prData.prStacks }
        : null,
    [gh, global, repoStore.loaded, repo, repoStore.config, skills, prData.prStacks]
  );
  ctxRef.current = flowCtx;
  const [poller] = useState(() => new RepoPoller(() => ctxRef.current!));
  const flowCtxValue = useMemo(
    () => ({ ctx: flowCtx!, poller, prStacks: prData.prStacks }),
    [flowCtx, poller, prData.prStacks]
  );
  const reviewFiltersKey = repoStore.loaded ? JSON.stringify(repoStore.config.reviewFilters) : "";
  const seenReviewFiltersKey = useRef<string | null>(null);
  const reviewFiltersChangedInSettings = useRef(false);
  const previousTab = useRef(tab);
  const currentViewedPrNumber = () => {
    const ui = useUiStore.getState();
    const visible = ui.visiblePrWorkspace;
    if (ui.orphanPr != null) return visible?.source === "orphan" ? visible.prNumber : null;
    return visible?.source === tab ? visible.prNumber : null;
  };

  useEffect(() => {
    if (!repoStore.loaded || !gh || !global) return;
    poller.start();
    return () => poller.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoStore.loaded, gh]);

  useEffect(() => {
    if (!repoStore.loaded) {
      seenReviewFiltersKey.current = null;
      reviewFiltersChangedInSettings.current = false;
      return;
    }
    if (seenReviewFiltersKey.current === null) {
      seenReviewFiltersKey.current = reviewFiltersKey;
      return;
    }
    if (seenReviewFiltersKey.current !== reviewFiltersKey) {
      if (tab === "settings") reviewFiltersChangedInSettings.current = true;
      seenReviewFiltersKey.current = reviewFiltersKey;
    }
  }, [repoStore.loaded, reviewFiltersKey, tab]);

  useEffect(() => {
    const prev = previousTab.current;
    previousTab.current = tab;
    if (prev === "settings" && tab !== "settings" && reviewFiltersChangedInSettings.current) {
      reviewFiltersChangedInSettings.current = false;
      if (ctxRef.current) poller.refresh();
    }
  }, [tab, poller]);

  // OS-notification deep-link: the PR this window should jump to. Set on a cold
  // start by `focus_pr`'s `?pr=` URL, and live by its `navigate-to-pr` event
  // (scoped to this repo's window). Resolution waits for the PR to show up in a
  // list, since a freshly opened window may still be loading.
  const [pendingNavPr, setPendingNavPr] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("pr");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  });
  useEffect(() => {
    const un = getCurrentWebviewWindow().listen<number>("navigate-to-pr", (e) => {
      setPendingNavPr(e.payload);
    });
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => {
    if (pendingNavPr == null) return;
    if (navigateToPr(pendingNavPr)) setPendingNavPr(null);
  }, [pendingNavPr, prData.myDrafts, prData.myOpen, prData.reviewQueue]);

  // Configurable repo-window shortcuts.
  // Must live above the loading early-returns: hooks can't come after them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isShortcutRecorderTarget(e.target)) return;
      const action = actionForShortcutEvent(e, shortcuts);
      if (!action || action === "zoom_in" || action === "zoom_out" || action === "zoom_reset") return;
      const ui = useUiStore.getState();
      const switchTo = (next: Tab) => {
        e.preventDefault();
        setTab(next);
      };

      if (action === "nav_back" || action === "nav_forward") {
        e.preventDefault();
        goHistory(action === "nav_back" ? -1 : 1);
        return;
      }
      if (action === "toggle_pr_sidebar") {
        e.preventDefault();
        ui.setPrSidebarOpen(!ui.prSidebarOpen);
        return;
      }
      if (action === "toggle_activity_panel") {
        e.preventDefault();
        ui.setActivityPanelOpen(!ui.activityPanelOpen);
        return;
      }
      if (action === "toggle_agents") {
        switchTo(tab === "activity" ? lastNonActivityTab.current : "activity");
        return;
      }
      if (action === "new_draft") {
        e.preventDefault();
        setTab("drafts");
        ui.requestNewDraft();
        return;
      }
      if (action === "refresh_current_pr") {
        if (isTextEditingTarget(e.target)) return;
        e.preventDefault();
        const prNumber = currentViewedPrNumber();
        if (prNumber == null) return;
        void poller.refreshPr(prNumber);
        return;
      }
      if (action === "command_palette") {
        e.preventDefault();
        ui.setPaletteOpen(true);
        return;
      }

      const tabAction = (Object.entries(TAB_SHORTCUTS) as [Tab, ShortcutActionId][]).find(
        ([, id]) => id === action
      );
      if (tabAction) {
        switchTo(tabAction[0]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcuts, tab]);

  if (!global || !gh) {
    return <div className="empty">Configure the GitHub connection in the launcher window first.</div>;
  }
  if (!repoStore.loaded || !ctxRef.current) {
    return (
      <div className="empty" style={{ paddingTop: 90 }}>
        <AsciiField height={150} color="255, 79, 0" opacity={0.35} />
        <span className="spin" /> Loading {repo}…
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: () => JSX.Element; count?: number; hot?: boolean }[] = [
    { id: "drafts", label: "Drafts", icon: IconDrafts, count: prData.myDrafts.length },
    { id: "open", label: "Open PRs", icon: IconOpen, count: prData.myOpen.length },
    { id: "review", label: "Review", icon: IconReview, count: prData.reviewQueue.length },
    { id: "activity", label: "Agents", icon: IconActivity, count: activeAgents, hot: activeAgents > 0 },
    { id: "settings", label: "Settings", icon: IconSettings },
  ];
  const shortcutHint = (id: ShortcutActionId) => {
    const label = formatShortcut(shortcuts[id]);
    return label === "Unassigned" ? "" : ` · ${label}`;
  };

  return (
    <FlowCtx.Provider value={flowCtxValue}>
      <div className="app">
        <nav className="rail">
          <div className="rail-brand" title="Charon">
            <IconCharonMoon size={22} id="rail" />
          </div>
          {tabs.map((t, i) => (
            <button
              key={t.id}
              className={`rail-btn ${tab === t.id ? "active" : ""}`}
              data-tip={`${t.label}${t.count ? ` — ${t.count}` : ""}${shortcutHint(TAB_SHORTCUTS[t.id])}`}
              onClick={() => setTab(t.id)}
            >
              <t.icon />
              {t.count !== undefined && t.count > 0 && (
                <span className={`rail-count ${t.hot ? "hot" : ""}`}>
                  {t.count > 99 ? "99" : t.count}
                </span>
              )}
            </button>
          ))}
          <div className="rail-spacer" />
          <button
            className="rail-btn"
            data-tip="Switch repository"
            onClick={() => void native.openLauncherWindow()}
          >
            <IconRepos />
          </button>
          <div className="rail-version" title="Charon version">
            v{__APP_VERSION__}
          </div>
        </nav>

        <div className="app-col">
          <div className="topstrip">
            {prData.polling && (
              <div className="topstrip-field" aria-hidden>
                <AsciiField height={36} color="255, 79, 0" opacity={0.22} speed={2.6} />
              </div>
            )}
            <button
              className="rail-btn navbtn"
              disabled={navIndex <= 0}
              title={`Back${shortcutHint("nav_back")}`}
              onClick={() => goHistory(-1)}
            >
              ←
            </button>
            <button
              className="rail-btn navbtn"
              disabled={navIndex >= navLen - 1}
              title={`Forward${shortcutHint("nav_forward")}`}
              onClick={() => goHistory(1)}
            >
              →
            </button>
            <span className="brand">CHARON</span>
            <span className="dim">/ {repo}</span>
            {crumb && (
              <button
                key={crumb.number}
                className={`topstrip-pr ${crumbLeaving ? "out" : "in"}`}
                title="Jump to top"
                onClick={() =>
                  document.querySelector(".ws-main")?.scrollTo({ top: 0, behavior: "smooth" })
                }
              >
                / #{crumb.number} {crumb.title}
              </button>
            )}
            <span className="spacer" />
            <span
              className={`pollstatus ${prData.pollError ? "err" : ""}`}
              title={
                prData.pollError ??
                (prData.lastPollAt ? `last synced ${timeAgo(prData.lastPollAt)}` : "")
              }
            >
              {prData.polling ? (
                <span className="cursor-blink">syncing</span>
              ) : prData.pollError ? (
                "sync error"
              ) : prData.nextPollAt ? (
                `sync t-${Math.max(0, Math.ceil((prData.nextPollAt - Date.now()) / 1000))}s`
              ) : (
                <span className="cursor-blink">starting</span>
              )}
            </span>
            <button
              className="rail-btn"
              style={{ width: 26, height: 26 }}
              onClick={(e) => (e.shiftKey ? window.location.reload() : poller.refresh())}
              title="Sync now (⇧-click: reload the app)"
            >
              <IconRefresh />
            </button>
            {(tab === "drafts" || tab === "open" || tab === "review") && (
              <>
                <button
                  className={`rail-btn ${prSidebarOpen ? "active" : ""}`}
                  style={{ width: 26, height: 26 }}
                  onClick={() => setPrSidebarOpen(!prSidebarOpen)}
                  title={`${prSidebarOpen ? "Hide" : "Show"} PR list${shortcutHint("toggle_pr_sidebar")}`}
                >
                  <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
                    <IconSidePanel />
                  </span>
                </button>
                <button
                  className={`rail-btn ${activityPanelOpen ? "active" : ""}`}
                  style={{ width: 26, height: 26 }}
                  onClick={() => setActivityPanelOpen(!activityPanelOpen)}
                  title={`${activityPanelOpen ? "Hide" : "Show"} activity panel${shortcutHint("toggle_activity_panel")}`}
                >
                  <IconSidePanel />
                </button>
              </>
            )}
          </div>

          {tab === "drafts" && <DraftsView />}
          {tab === "open" && <BabysitView />}
          {tab === "review" && <ReviewView />}
          {tab === "activity" && <ActivityView />}
          {tab === "settings" && <SettingsView />}

          {orphanPr != null && (
            <OrphanPrView
              prNumber={orphanPr}
              onClose={() => useUiStore.getState().setOrphanPr(null)}
            />
          )}
        </div>
      </div>
      <CommandPalette />
      <CommitDiffModal />
    </FlowCtx.Provider>
  );
}

/**
 * Orphan PR view: a PR opened by number that isn't in any filtered list (or
 * that the user wants to view without the sidebar). Overlays the normal tab
 * content with a full-height PR workspace — fetched on demand from GitHub.
 */
function OrphanPrView({ prNumber, onClose }: { prNumber: number; onClose: () => void }) {
  const { ctx, poller } = useFlow();
  const [pr, setPr] = useState<PrSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setPr(null);
    setError("");
    ctx.gh
      .getPull(ctx.repo, prNumber)
      .then(setPr)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prNumber, ctx.repo]);

  useEffect(() => {
    useUiStore.getState().setVisiblePrWorkspace("orphan", pr?.number ?? null);
    return () => useUiStore.getState().setVisiblePrWorkspace("orphan", null);
  }, [pr?.number]);

  const mine = pr?.author === ctx.gh.login;
  const variant = mine ? (pr?.draft ? "draft" : "babysit") : "babysit";

  return (
    <div className="orphan-pr-overlay">
      <div className="orphan-pr-bar">
        <button className="link small" onClick={onClose} title="Close (Esc)">
          ✕ close
        </button>
        <span className="subtle" style={{ fontWeight: 700, letterSpacing: "0.08em" }}>
          ORPHAN PR
        </span>
        {pr && (
          <a href={pr.url} target="_blank" rel="noreferrer" className="subtle">
            #{pr.number} ↗
          </a>
        )}
        <span style={{ flex: 1 }} />
        {pr && (
          <button
            className="link small"
            title="Refresh this PR"
            onClick={() => void poller.refreshPr(pr.number)}
          >
            ↻ refresh
          </button>
        )}
      </div>
      {error && <div className="empty" style={{ padding: 40, color: "var(--red)" }}>{error}</div>}
      {!pr && !error && (
        <div className="empty" style={{ padding: 40 }}>
          <span className="spin" /> Loading PR #{prNumber}…
        </div>
      )}
      {pr && <PrWorkspace pr={pr} variant={variant} />}
    </div>
  );
}
