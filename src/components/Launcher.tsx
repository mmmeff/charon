import { useEffect, useState } from "react";
import { refreshModels } from "../lib/agents";
import { probeHarness, sortAcpModels, summarizeProbe } from "../lib/acp";
import { AsciiField } from "./AsciiField";
import { IconCharonMoon } from "./icons";
import {
  defaultGlobalConfig,
  harnessModelDefaults,
  harnessTemplates,
  reconcileHarnessDefaults,
} from "../lib/defaults";
import { GitHubClient } from "../lib/github";
import { native } from "../lib/tauri";
import { useGlobalConfig } from "../lib/store";
import type { GlobalConfig, Harness } from "../types";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // harness selection
  const templates = harnessTemplates(existing?.cursorBinary || "cursor-agent");
  const [harnessId, setHarnessId] = useState(existing?.activeHarness || "cursor");
  const picked = templates.find((t) => t.id === harnessId) ?? templates[0];
  const [command, setCommand] = useState(picked.command);
  const [args, setArgs] = useState(picked.args.join(" "));
  const [verify, setVerify] = useState<
    null | { busy: true } | { busy: false; ok: boolean; msg: string; models: number }
  >(null);
  const selectHarness = (id: string) => {
    setHarnessId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setCommand(t.command);
      setArgs(t.args.join(" "));
    }
    setVerify(null);
  };
  const harness = (): Harness => ({
    id: harnessId,
    name: picked.name,
    command: command.trim(),
    args: args.trim() ? args.trim().split(/\s+/) : [],
    note: picked.note,
  });

  const runVerify = async () => {
    setVerify({ busy: true });
    const h = harness();
    const cwd = await native.appDataDir();
    const r = await probeHarness(h.command, h.args, cwd);
    setVerify({ busy: false, ok: r.ok, msg: summarizeProbe(r), models: r.models.length });
  };

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
      const defaults = defaultGlobalConfig();
      const h = harness();
      // source the live model/reasoning list from the chosen harness, then
      // apply that harness's hardcoded defaults reconciled against what it
      // actually exposes (best-effort: a failed probe keeps the "auto" seed)
      const cwd = await native.appDataDir();
      const probe = await probeHarness(h.command, h.args, cwd).catch(() => null);
      let models = ["auto"];
      let modelLabels: Record<string, string> = { auto: "Auto" };
      let reasoningOptions: string[] = [];
      let reasoningLabels: Record<string, string> = {};
      if (probe?.ok && probe.models.length) {
        const sorted = sortAcpModels(probe.models);
        models = ["auto", ...sorted.map((m) => m.modelId)];
        modelLabels = { auto: "Auto" };
        for (const m of sorted) modelLabels[m.modelId] = m.name;
        h.verified = true;
      }
      if (probe?.ok && probe.reasoning?.options.length) {
        reasoningOptions = probe.reasoning.options.map((o) => o.modelId);
        reasoningLabels = Object.fromEntries(probe.reasoning.options.map((o) => [o.modelId, o.name]));
      }
      const rec = reconcileHarnessDefaults(harnessModelDefaults(h.id), models, reasoningOptions);
      // hardcoded default unavailable → fall back to the harness's own current pick
      const defaultModel =
        rec.defaultModel !== "auto"
          ? rec.defaultModel
          : probe?.currentId && models.includes(probe.currentId)
            ? probe.currentId
            : models[1] ?? "auto";
      const reasoningEffort =
        rec.reasoningEffort ||
        (probe?.reasoning?.currentId && reasoningOptions.includes(probe.reasoning.currentId)
          ? probe.reasoning.currentId
          : "");
      const cfg: GlobalConfig = {
        ...defaults,
        ...(existing ?? {}),
        githubUrl: url.replace(/\/+$/, ""),
        token,
        insecureTls: insecure,
        login,
        cursorBinary: h.id === "cursor" ? h.command : existing?.cursorBinary || "cursor-agent",
        harnesses: [h],
        activeHarness: h.id,
        models,
        modelLabels,
        defaultModel,
        reasoningOptions,
        reasoningLabels,
        reasoningEffort,
        modelOverrides: rec.modelOverrides,
        reasoningOverrides: rec.reasoningOverrides,
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
        <span>Agent harness</span>
        <div className="seg" style={{ marginBottom: 8, flexWrap: "wrap" }}>
          {templates.map((t) => (
            <button
              key={t.id}
              className={`small ${harnessId === t.id ? "primary" : ""}`}
              onClick={() => selectHarness(t.id)}
            >
              {t.name}
              {t.verified ? " ✓" : ""}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <input
            type="text"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              setVerify(null);
            }}
            placeholder="command"
            style={{ flex: "0 0 38%" }}
          />
          <input
            type="text"
            value={args}
            onChange={(e) => {
              setArgs(e.target.value);
              setVerify(null);
            }}
            placeholder="args (space-separated)"
            style={{ flex: 1 }}
          />
        </div>
        <small>
          The ACP agent Charon drives — spawned as <code>{command || "…"} {args}</code>. {picked.note}{" "}
          Other harnesses are configurable later in Settings.
        </small>
        <div className="row" style={{ marginTop: 6 }}>
          <button
            className="small"
            disabled={!command.trim() || (verify != null && verify.busy)}
            onClick={() => void runVerify()}
          >
            {verify?.busy ? "Verifying…" : "Verify connection"}
          </button>
          {verify && !verify.busy && (
            <span style={{ color: verify.ok ? "var(--acid)" : "var(--red)", fontSize: 12 }}>
              {verify.ok ? "✓ " : "✗ "}
              {verify.msg}
            </span>
          )}
        </div>
      </label>
      <label className="switch">
        <input type="checkbox" checked={insecure} onChange={(e) => setInsecure(e.target.checked)} />
        Accept self-signed TLS certificates (GHE behind a corporate CA)
      </label>
      <div style={{ marginTop: 20 }}>
        <button
          className="primary"
          disabled={busy || !token || !url || !command.trim()}
          onClick={() => void connect()}
        >
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
