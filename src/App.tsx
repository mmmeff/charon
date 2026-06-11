import { useEffect, useState } from "react";
import { Launcher } from "./components/Launcher";
import { RepoApp } from "./components/RepoApp";
import { native } from "./lib/tauri";
import { useGlobalConfig } from "./lib/store";

/**
 * Window routing:
 * - `?repo=owner/name` → a repo window (opened by the backend).
 * - `?picker=1` → the repo picker, opened explicitly from a repo window.
 * - no params → app boot: if a last-opened repo is remembered, reopen it
 *   directly and close this window; otherwise show the picker.
 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const repo = params.get("repo");
  const explicitPicker = params.has("picker");
  const { loaded, load } = useGlobalConfig();
  const [autoOpening, setAutoOpening] = useState(!repo && !explicitPicker);

  // Route every external link through the OS browser — the webview must
  // never navigate away, and target=_blank is unreliable inside Tauri.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (/^https?:\/\//.test(href)) {
        e.preventDefault();
        void native.openUrl(href);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    void load().then(async (cfg) => {
      if (repo || explicitPicker) return;
      const canAutoOpen =
        cfg && cfg.token && cfg.login && cfg.lastRepo && cfg.repos.includes(cfg.lastRepo);
      if (canAutoOpen) {
        try {
          await native.openRepoWindow(cfg.lastRepo);
          await native.closeThisWindow();
          return; // window is closing; keep the spinner up meanwhile
        } catch (e) {
          console.error("auto-open failed", e);
        }
      }
      setAutoOpening(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded || (autoOpening && !repo)) {
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        <span className="spin" /> Loading…
      </div>
    );
  }
  return repo ? <RepoApp repo={repo} /> : <Launcher />;
}
