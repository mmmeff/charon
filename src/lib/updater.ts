import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { isTauri } from "./tauri";

/**
 * Auto-update loop: checks the GitHub `latest.json` on boot and every few
 * hours, downloads + installs silently, then surfaces a "restart to apply"
 * banner. Multiple windows share one app process, so a localStorage lock
 * keeps concurrent windows from racing the download; the ready flag is
 * mirrored across windows via the `storage` event.
 */

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const LOCK_KEY = "charon-update-lock";
const READY_KEY = "charon-update-ready";
const LOCK_TTL_MS = 15 * 60 * 1000;

interface UpdateState {
  /** version string when an update is downloaded and ready to apply */
  ready: string | null;
}

export const useUpdateStore = create<UpdateState>(() => ({
  ready: null,
}));

async function checkOnce(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    // another window may already be downloading this version
    const lock = localStorage.getItem(LOCK_KEY);
    if (lock && Date.now() - Number(lock) < LOCK_TTL_MS) return;
    localStorage.setItem(LOCK_KEY, String(Date.now()));

    await update.downloadAndInstall();
    localStorage.setItem(READY_KEY, update.version);
    localStorage.removeItem(LOCK_KEY);
    useUpdateStore.setState({ ready: update.version });
  } catch (e) {
    localStorage.removeItem(LOCK_KEY);
    console.warn("update check failed", e);
  }
}

let started = false;

export function startUpdateLoop(): void {
  if (!isTauri() || started) return;
  started = true;

  // a previous session (or another window) may have an install staged already;
  // drop the flag if we already relaunched into (or past) that version
  const staged = localStorage.getItem(READY_KEY);
  if (staged) {
    void getVersion().then((current) => {
      if (cmpVersions(current, staged) >= 0) localStorage.removeItem(READY_KEY);
      else useUpdateStore.setState({ ready: staged });
    });
  }

  // mirror "ready" across windows
  window.addEventListener("storage", (e) => {
    if (e.key === READY_KEY && e.newValue) useUpdateStore.setState({ ready: e.newValue });
  });

  void checkOnce();
  setInterval(() => void checkOnce(), CHECK_INTERVAL_MS);
}

/** Clear the staged flag right before relaunching into the new version. */
export async function applyUpdate(): Promise<void> {
  localStorage.removeItem(READY_KEY);
  await relaunch();
}

function cmpVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
