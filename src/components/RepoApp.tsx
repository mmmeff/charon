import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { refreshModels } from "../lib/agents";
import { GitHubClient } from "../lib/github";
import { RepoPoller, usePrData } from "../lib/events";
import type { FlowContext } from "../lib/flows";
import { loadSkills } from "../lib/skills";
import { useAgentStore, useGlobalConfig, useRepoStore, useSkillStore } from "../lib/store";
import { native } from "../lib/tauri";
import { timeAgo, useNow } from "./common";
import {
  IconActivity,
  IconDrafts,
  IconOpen,
  IconRefresh,
  IconRepos,
  IconReview,
  IconSettings,
} from "./icons";
import { ActivityView } from "./views/ActivityView";
import { BabysitView } from "./views/BabysitView";
import { DraftsView } from "./views/DraftsView";
import { ReviewView } from "./views/ReviewView";
import { SettingsView } from "./views/SettingsView";

type Tab = "drafts" | "open" | "review" | "activity" | "settings";

const FlowCtx = createContext<{ ctx: FlowContext; poller: RepoPoller } | null>(null);

export function useFlow() {
  const v = useContext(FlowCtx);
  if (!v) throw new Error("FlowCtx missing");
  return v;
}

/** One repo, one window: tabbed shell that owns the poller and flow context. */
export function RepoApp({ repo }: { repo: string }) {
  const global = useGlobalConfig((s) => s.config);
  const repoStore = useRepoStore();
  const skills = useSkillStore((s) => s.skills);
  const [tab, setTab] = useState<Tab>("open");
  const prData = usePrData();
  const agentOrder = useAgentStore((s) => s.order);
  const runs = useAgentStore((s) => s.runs);
  useNow(); // keeps "synced Xs ago" ticking without interaction

  useEffect(() => {
    void repoStore.init(repo);
    // remember this repo so the next app boot reopens it directly
    void useGlobalConfig.getState().setLastRepo(repo);
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
    const ids: Tab[] = ["drafts", "open", "review", "activity", "settings"];
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= ids.length) {
        e.preventDefault();
        setTab(ids[n - 1]);
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
      <div className="empty" style={{ paddingTop: 120 }}>
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
          <div className="rail-brand" title="Switchyard">
            ▙
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
            <span className="brand">SWITCHYARD</span>
            <span className="dim">/ {repo}</span>
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
              onClick={() => poller.refresh()}
              disabled={prData.polling}
              title="Sync now"
            >
              <IconRefresh />
            </button>
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
