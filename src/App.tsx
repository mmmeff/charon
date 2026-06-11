import { useEffect } from "react";
import { Launcher } from "./components/Launcher";
import { RepoApp } from "./components/RepoApp";
import { useGlobalConfig } from "./lib/store";

/**
 * Window routing: the launcher window has no `?repo=`; each repo window is
 * opened by the backend with `?repo=owner/name` and runs fully independently.
 */
export default function App() {
  const repo = new URLSearchParams(window.location.search).get("repo");
  const { loaded, load } = useGlobalConfig();

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) {
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        <span className="spin" /> Loading…
      </div>
    );
  }
  return repo ? <RepoApp repo={repo} /> : <Launcher />;
}
