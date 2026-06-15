import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface HttpResponseRaw {
  status: number;
  headers: [string, string][];
  body: string;
}

export interface AgentStreamEvent {
  id: string;
  kind: "stdout" | "stderr" | "exit" | "spawn-error";
  line: string | null;
  code: number | null;
}

export interface SkillFileRaw {
  name: string;
  source: string;
  path: string;
  content: string;
}

export const native = {
  httpRequest(req: {
    method: string;
    url: string;
    headers: [string, string][];
    body?: string;
    insecure?: boolean;
  }): Promise<HttpResponseRaw> {
    return invoke("http_request", { req });
  },

  runGit(args: string[], cwd?: string): Promise<ExecResult> {
    return invoke("run_git", { cwd: cwd ?? null, args });
  },

  runExec(binary: string, args: string[], cwd?: string): Promise<ExecResult> {
    return invoke("run_exec", { binary, args, cwd: cwd ?? null });
  },

  spawnAgent(opts: {
    id: string;
    binary: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<void> {
    return invoke("spawn_agent", {
      id: opts.id,
      binary: opts.binary,
      args: opts.args,
      cwd: opts.cwd ?? null,
      env: opts.env ?? null,
    });
  },

  /** Write one JSON-RPC line to an ACP agent's stdin (newline appended in Rust). */
  agentSend(id: string, line: string): Promise<void> {
    return invoke("agent_send", { id, line });
  },

  killAgent(id: string): Promise<void> {
    return invoke("kill_agent", { id });
  },

  loadBlob(rel: string): Promise<string | null> {
    return invoke("load_blob", { rel });
  },

  saveBlob(rel: string, content: string): Promise<void> {
    return invoke("save_blob", { rel, content });
  },

  appDataDir(): Promise<string> {
    return invoke("app_data_dir");
  },

  listCursorSkills(extraDirs: string[]): Promise<SkillFileRaw[]> {
    return invoke("list_cursor_skills", { extraDirs });
  },

  openRepoWindow(repo: string): Promise<void> {
    return invoke("open_repo_window", { repo });
  },

  /** Open/focus the repo's window and deep-link it to a PR (notification click). */
  focusPr(repo: string, prNumber: number): Promise<void> {
    return invoke("focus_pr", { repo, prNumber });
  },

  openLauncherWindow(): Promise<void> {
    return invoke("open_launcher_window");
  },

  closeThisWindow(): Promise<void> {
    return invoke("close_window");
  },

  openUrl(url: string): Promise<void> {
    return invoke("open_url", { url });
  },

  onAgentStream(cb: (ev: AgentStreamEvent) => void): Promise<UnlistenFn> {
    return listen<AgentStreamEvent>("agent-stream", (e) => cb(e.payload));
  },
};

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isLocalDevelopment(): boolean {
  const host = window.location.hostname;
  return import.meta.env.DEV || host === "localhost" || host === "127.0.0.1" || host === "::1";
}
