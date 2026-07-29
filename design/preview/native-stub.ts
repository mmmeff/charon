/**
 * Drop-in replacement for `src/lib/tauri` used only by the design preview.
 *
 * The real module funnels every byte of I/O through Tauri IPC, so in a plain
 * browser the app hangs before it paints. This keeps the same public surface
 * and answers from memory, letting the real components render real markup
 * against fixture data. Preview-only: never imported by the app.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { blobs, diffText } from "./fixtures";

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

const store = new Map<string, string>(Object.entries(blobs));

export const native = {
  httpRequest(req: {
    method: string;
    url: string;
    headers: [string, string][];
    body?: string;
    insecure?: boolean;
  }): Promise<HttpResponseRaw> {
    const wantsDiff = req.headers.some(([k, v]) => k.toLowerCase() === "accept" && /diff/.test(v));
    // unknown shapes degrade to an empty list or object so callers parse rather than throw
    let body = "{}";
    if (wantsDiff || /\.diff$/.test(req.url)) body = diffText;
    else if (/graphql/.test(req.url)) body = JSON.stringify({ data: {} });
    else if (/\/(pulls|files|comments|reviews|check-runs|statuses|labels|commits|events|timeline)/.test(req.url)) body = "[]";
    return Promise.resolve({ status: 200, headers: [["content-type", "application/json"]], body });
  },

  runGit(_args: string[], _cwd?: string): Promise<ExecResult> {
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  },

  runExec(_binary: string, _args: string[], _cwd?: string): Promise<ExecResult> {
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  },

  spawnAgent(_opts: { id: string; binary: string; args: string[]; cwd?: string; env?: Record<string, string> }): Promise<void> {
    return Promise.resolve();
  },

  agentSend(_id: string, _line: string): Promise<void> {
    return Promise.resolve();
  },

  killAgent(_id: string): Promise<void> {
    return Promise.resolve();
  },

  opencodeSessionErrors(_sessionId: string, _sinceMs: number): Promise<string[]> {
    return Promise.resolve([]);
  },

  loadBlob(rel: string): Promise<string | null> {
    return Promise.resolve(store.get(rel) ?? null);
  },

  saveBlob(rel: string, content: string): Promise<void> {
    store.set(rel, content);
    return Promise.resolve();
  },

  appDataDir(): Promise<string> {
    return Promise.resolve("/preview/app-data");
  },

  listCursorSkills(_extraDirs: string[]): Promise<SkillFileRaw[]> {
    return Promise.resolve([
      { name: "review", source: "skill", path: "/preview/skills/review.md", content: "# review" },
      { name: "deslop", source: "skill", path: "/preview/skills/deslop.md", content: "# deslop" },
    ]);
  },

  openRepoWindow(_repo: string): Promise<void> {
    return Promise.resolve();
  },

  focusPr(_repo: string, _prNumber: number): Promise<void> {
    return Promise.resolve();
  },

  openLauncherWindow(): Promise<void> {
    return Promise.resolve();
  },

  closeThisWindow(): Promise<void> {
    return Promise.resolve();
  },

  openUrl(_url: string): Promise<void> {
    return Promise.resolve();
  },

  onAgentStream(_cb: (ev: AgentStreamEvent) => void): Promise<UnlistenFn> {
    return Promise.resolve(() => undefined);
  },
};

export function isTauri(): boolean {
  return true;
}

export function isLocalDevelopment(): boolean {
  return true;
}
