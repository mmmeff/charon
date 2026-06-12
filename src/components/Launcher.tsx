import { useEffect, useState } from "react";
import { listCursorModels, refreshModels } from "../lib/agents";
import { AsciiField } from "./AsciiField";
import { IconCharonMoon } from "./icons";
import { defaultGlobalConfig } from "../lib/defaults";
import { GitHubClient } from "../lib/github";
import { native } from "../lib/tauri";
import { useGlobalConfig } from "../lib/store";
import type { GlobalConfig } from "../types";

/**
 * The launcher window: first-boot onboarding (GitHub instance + auth +
 * initial settings) and the repo list. Each repo opens in its own window.
 */
export function Launcher() {
  const { config, save } = useGlobalConfig();
  if (!config || !config.token || !config.login) {
    return <Onboarding existing={config} onDone={save} />;
  }
  return <RepoList config={config} save={save} />;
}

// ---------------------------------------------------------------------------

function Onboarding({
  existing,
  onDone,
}: {
  existing: GlobalConfig | null;
  onDone: (cfg: GlobalConfig) => Promise<void>;
}) {
  // || not ??: a saved-but-empty URL should still fall back to github.com
  const [url, setUrl] = useState(existing?.githubUrl || "https://github.com");
  const [token, setToken] = useState(existing?.token ?? "");
  const [insecure, setInsecure] = useState(existing?.insecureTls ?? false);
  const [binary, setBinary] = useState(existing?.cursorBinary ?? "cursor-agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // valid host URL → deep link to the classic-token page, scopes prefilled
  const tokenUrl = (() => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" || u.protocol === "http:") {
        return `${u.origin}/settings/tokens/new?scopes=repo&description=Charon`;
      }
    } catch {
      /* not a parseable URL yet */
    }
    return null;
  })();

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const gh = new GitHubClient({ githubUrl: url, token, insecureTls: insecure, login: "" });
      const login = await gh.connect();
      // verify the agent binary while we're at it (non-fatal)
      const defaults = defaultGlobalConfig();
      let models = defaults.models;
      let modelLabels = defaults.modelLabels;
      const discovered = await listCursorModels(binary);
      if (discovered.length > 0) {
        models = discovered.map((m) => m.id);
        modelLabels = Object.fromEntries(discovered.map((m) => [m.id, m.label]));
      }
      const cfg: GlobalConfig = {
        ...defaults,
        ...(existing ?? {}),
        githubUrl: url.replace(/\/+$/, ""),
        token,
        insecureTls: insecure,
        login,
        cursorBinary: binary,
        models,
        modelLabels,
        defaultModel: existing?.defaultModel || "auto",
      };
      await onDone(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="launcher">
      <div className="hero">
        <AsciiField height={120} opacity={0.45} />
        <div className="hero-text">
          <h1>
            <IconCharonMoon size={26} id="connect" /> CHARON
          </h1>
          <div className="sub">human-in-the-loop agents for pull requests</div>
        </div>
      </div>
      <p className="sub2">
        Connect to GitHub to get started. Works with github.com and GitHub Enterprise. Agents never
        write to GitHub without your approval — only pushes to your own PR branches are automated.
      </p>
      <label className="field">
        <span>GitHub instance URL</span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com or https://ghe.yourcompany.com"
        />
      </label>
      <label className="field">
        <span>Personal access token</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_…"
        />
        <small>
          Use a <strong>classic</strong> token with the full <code>repo</code> scope checked.
          {tokenUrl && (
            <>
              {" "}
              <a href={tokenUrl} target="_blank" rel="noreferrer">
                Generate one on {new URL(tokenUrl).host} ↗
              </a>{" "}
              (the <code>repo</code> scope comes pre-checked).
            </>
          )}
        </small>
      </label>
      <label className="field">
        <span>Cursor agent binary</span>
        <input type="text" value={binary} onChange={(e) => setBinary(e.target.value)} />
        <small>
          Path or name of the Cursor CLI (<code>cursor-agent</code>). Used for every LLM run.
        </small>
      </label>
      <label className="switch">
        <input type="checkbox" checked={insecure} onChange={(e) => setInsecure(e.target.checked)} />
        Accept self-signed TLS certificates (GHE behind a corporate CA)
      </label>
      <div style={{ marginTop: 20 }}>
        <button className="primary" disabled={busy || !token || !url} onClick={() => void connect()}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RepoList({
  config,
  save,
}: {
  config: GlobalConfig;
  save: (cfg: GlobalConfig) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const gh = new GitHubClient(config);

  // keep the model list current with the Cursor CLI
  useEffect(() => {
    void refreshModels(config, save);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!query.includes("/") || query.length < 3) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const [owner, name] = query.split("/");
        const found = await gh.searchRepos(`${name} user:${owner} fork:true`);
        setSuggestions(found.filter((f) => !config.repos.includes(f)).slice(0, 6));
      } catch {
        setSuggestions([]);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const addRepo = async (full: string) => {
    setBusy(true);
    setError("");
    try {
      if (!(await gh.repoExists(full))) throw new Error(`Repository ${full} not found or not accessible.`);
      if (!config.repos.includes(full)) {
        await save({ ...config, repos: [...config.repos, full], lastRepo: full });
      }
      setQuery("");
      setSuggestions([]);
      await openRepo(full);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // open the repo window and retire the picker — it can be reopened from any
  // repo window's "repos" button
  const openRepo = async (full: string) => {
    await native.openRepoWindow(full);
    await native.closeThisWindow();
  };

  return (
    <div className="launcher">
      <div className="hero">
        <AsciiField height={120} opacity={0.45} />
        <div className="hero-text">
          <h1>
            <IconCharonMoon size={26} id="picker" /> CHARON
          </h1>
        </div>
      </div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <span className="subtle">
          operator: {config.login} @ {config.githubUrl.replace(/^https?:\/\//, "")}
        </span>
        <button
          className="link small"
          onClick={() => void save({ ...config, login: "" })}
          title="Reconfigure connection"
        >
          change
        </button>
      </div>

      <label className="field">
        <span>Add a repository</span>
        <div className="row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="owner/name"
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.includes("/")) void addRepo(query.trim());
            }}
          />
          <button disabled={busy || !query.includes("/")} onClick={() => void addRepo(query.trim())}>
            Add
          </button>
        </div>
      </label>
      {suggestions.map((s) => (
        <div key={s} className="repo-item">
          <span>{s}</span>
          <button className="small" onClick={() => void addRepo(s)}>
            Add
          </button>
        </div>
      ))}
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}

      <hr />
      {config.repos.length === 0 && <p className="subtle">No repositories yet.</p>}
      {config.repos.map((r) => (
        <div key={r} className="repo-item">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void openRepo(r);
            }}
          >
            {r}
          </a>
          <div className="row">
            <button className="small primary" onClick={() => void openRepo(r)}>
              Open
            </button>
            <button
              className="small danger"
              onClick={() => void save({ ...config, repos: config.repos.filter((x) => x !== r) })}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
