import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";
import { notify } from "./notify";
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

  // "Check for Updates…" in the macOS app menu — Rust emits this to the
  // focused window only, so exactly one window responds
  void getCurrentWebviewWindow().listen("menu-check-updates", () => {
    void checkForUpdatesManually();
  });
}

let manualCheckActive = false;

/**
 * Menu-driven update check. Unlike the silent background loop, this always
 * tells the user something: an OS notification when already up to date, or a
 * native Update/Cancel dialog with the new version and its changelog.
 */
export async function checkForUpdatesManually(): Promise<void> {
  if (!isTauri() || manualCheckActive) return;
  manualCheckActive = true;
  try {
    // the background loop may already have an install staged
    const staged = useUpdateStore.getState().ready;
    if (staged) {
      const restart = await ask(
        `Charon v${staged} is already downloaded and ready to install.\n\nRestart now to apply it?`,
        { title: "Update ready", kind: "info", okLabel: "Restart now", cancelLabel: "Later" },
      );
      if (restart) await applyUpdate();
      return;
    }

    const update = await check();
    if (!update) {
      const current = await getVersion();
      await notify("Charon is up to date", `v${current} is the latest version.`);
      return;
    }

    // ...or be mid-download in another window
    const lock = localStorage.getItem(LOCK_KEY);
    if (lock && Date.now() - Number(lock) < LOCK_TTL_MS) {
      await notify(
        `Charon v${update.version} is downloading`,
        "You'll be prompted to restart when it's ready.",
      );
      return;
    }

    const current = await getVersion();
    const accepted = await ask(
      `Charon v${update.version} is available (you have v${current}).${formatNotes(update.body)}`,
      {
        title: "Update available",
        kind: "info",
        okLabel: "Update",
        cancelLabel: "Cancel",
      },
    );
    if (!accepted) return;

    localStorage.setItem(LOCK_KEY, String(Date.now()));
    await update.downloadAndInstall();
    localStorage.setItem(READY_KEY, update.version);
    localStorage.removeItem(LOCK_KEY);
    useUpdateStore.setState({ ready: update.version });
    await applyUpdate();
  } catch (e) {
    localStorage.removeItem(LOCK_KEY);
    console.warn("manual update check failed", e);
    await notify("Update check failed", String(e));
  } finally {
    manualCheckActive = false;
  }
}

/** Trim the release notes down to dialog-sized changelog bullets. */
function formatNotes(body: string | undefined): string {
  if (!body) return "";
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
  if (!lines.length) return "";
  const shown = lines.slice(0, 10);
  if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more`);
  return `\n\nChanges:\n${shown.join("\n")}`;
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
