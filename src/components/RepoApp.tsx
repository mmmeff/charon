import { useEffect, useMemo, useRef, useState } from "react";
import { refreshModels } from "../lib/agents";
import { GitHubClient } from "../lib/github";
import { RepoPoller, usePrData } from "../lib/events";
import type { FlowContext } from "../lib/flows";
import { loadSkills } from "../lib/skills";
import { initAgentPersistence } from "../lib/agents";
import { useAgentStore, useGlobalConfig, useRepoStore, useSkillStore, useUiStore } from "../lib/store";
import { native } from "../lib/tauri";
import { timeAgo, useNow } from "../lib/ui";
import { FlowCtx } from "./flow";
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
import { ActivityView } from "./views/ActivityView";
import { BabysitView } from "./views/BabysitView";
import { DraftsView } from "./views/DraftsView";
import { ReviewView } from "./views/ReviewView";
import { SettingsView } from "./views/SettingsView";

type Tab = "drafts" | "open" | "review" | "activity" | "settings";
const TABS: Tab[] = ["drafts", "open", "review", "activity", "settings"];

/** One repo, one window: tabbed shell that owns the poller and flow context. */
export function RepoApp({ repo }: { repo: string }) {
  const global = useGlobalConfig((s) => s.config);
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
  const prData = usePrData();
  const agentOrder = useAgentStore((s) => s.order);
  const runs = useAgentStore((s) => s.runs);
  const scrolledPr = useUiStore((s) => s.scrolledPrTitle);
  const activityPanelOpen = useUiStore((s) => s.activityPanelOpen);
  const setActivityPanelOpen = useUiStore((s) => s.setActivityPanelOpen);
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
    let cleanup: (() => void) | undefined;
    void initAgentPersistence(repo).then((c) => (cleanup = c));
    return () => cleanup?.();
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
  // without restarting it.
  const ctxRef = useRef<FlowContext | null>(null);
  if (gh && global && repoStore.loaded) {
    ctxRef.current = { gh, repo, config: repoStore.config, global, skills };
  }
  const [poller] = useState(() => new RepoPoller(() => ctxRef.current!));

  useEffect(() => {
    if (!repoStore.loaded || !gh || !global) return;
    poller.start();
    return () => poller.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoStore.loaded, gh]);

  // ⌘1–⌘5 (ctrl on other platforms) jumps between tabs.
  // Must live above the loading early-returns: hooks can't come after them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        goHistory(e.key === "[" ? -1 : 1);
        return;
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= TABS.length) {
        e.preventDefault();
        setTab(TABS[n - 1]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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

  const activeAgents = agentOrder.filter(
    (id) => runs[id]?.status === "running" || runs[id]?.status === "starting"
  ).length;
  const pendingProposals = repoStore.proposals.filter((p) => p.status === "pending").length;

  const tabs: { id: Tab; label: string; icon: () => JSX.Element; count?: number; hot?: boolean }[] = [
    { id: "drafts", label: "Drafts", icon: IconDrafts, count: prData.myDrafts.length },
    { id: "open", label: "Open PRs", icon: IconOpen, count: prData.myOpen.length },
    { id: "review", label: "Review", icon: IconReview, count: prData.reviewQueue.length },
    { id: "activity", label: "Activity Feed", icon: IconActivity, count: activeAgents, hot: activeAgents > 0 },
    { id: "settings", label: "Settings", icon: IconSettings },
  ];

  return (
    <FlowCtx.Provider value={{ ctx: ctxRef.current, poller }}>
      <div className="app">
        <nav className="rail">
          <div className="rail-brand" title="Charon">
            <IconCharonMoon size={22} id="rail" />
          </div>
          {tabs.map((t, i) => (
            <button
              key={t.id}
              className={`rail-btn ${tab === t.id ? "active" : ""}`}
              data-tip={`${t.label}${t.count ? ` — ${t.count}` : ""} · ⌘${i + 1}`}
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
              title="Back (⌘[)"
              onClick={() => goHistory(-1)}
            >
              ←
            </button>
            <button
              className="rail-btn navbtn"
              disabled={navIndex >= navLen - 1}
              title="Forward (⌘])"
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
            {pendingProposals > 0 && (
              <span className="badge yellow">
                {pendingProposals} pending approval{pendingProposals > 1 ? "s" : ""}
              </span>
            )}
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
              <button
                className={`rail-btn ${activityPanelOpen ? "active" : ""}`}
                style={{ width: 26, height: 26 }}
                onClick={() => setActivityPanelOpen(!activityPanelOpen)}
                title={activityPanelOpen ? "Hide activity panel" : "Show activity panel"}
              >
                <IconSidePanel />
              </button>
            )}
          </div>

          {tab === "drafts" && <DraftsView />}
          {tab === "open" && <BabysitView />}
          {tab === "review" && <ReviewView />}
          {tab === "activity" && <ActivityView />}
          {tab === "settings" && <SettingsView />}
        </div>
      </div>
    </FlowCtx.Provider>
  );
}
