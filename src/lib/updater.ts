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
const SNOOZE_KEY = "charon-update-snooze";
const LOCK_TTL_MS = 15 * 60 * 1000;

// Dismissing the toast hides it for an hour, doubling each subsequent
// dismissal (1h → 2h → 4h … capped at 24h). The download still proceeds in
// the background; snooze only governs the toast's visibility.
const SNOOZE_BASE_MS = 60 * 60 * 1000;
const SNOOZE_MAX_MS = 24 * 60 * 60 * 1000;

interface UpdateState {
  /** version string as soon as a newer release is detected */
  available: string | null;
  /** version string once that update is downloaded and ready to apply */
  ready: string | null;
  /** true while a user-requested update is waiting on the download */
  updating: boolean;
  /** epoch ms until which the toast stays hidden (0 = visible) */
  snoozedUntil: number;
}

export const useUpdateStore = create<UpdateState>(() => ({
  available: null,
  ready: null,
  updating: false,
  snoozedUntil: 0,
}));

/** persisted snooze: which version, how many dismissals, until when */
interface Snooze {
  version: string;
  count: number;
  until: number;
}

function readSnooze(): Snooze | null {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    return raw ? (JSON.parse(raw) as Snooze) : null;
  } catch {
    return null;
  }
}

let unsnoozeTimer: ReturnType<typeof setTimeout> | undefined;

/** Reflect the persisted snooze for `version` into the store + schedule its expiry. */
function applySnooze(version: string): void {
  const s = readSnooze();
  const active = s && s.version === version && s.until > Date.now() ? s.until : 0;
  useUpdateStore.setState({ snoozedUntil: active });
  clearTimeout(unsnoozeTimer);
  if (active) {
    unsnoozeTimer = setTimeout(() => useUpdateStore.setState({ snoozedUntil: 0 }), active - Date.now());
  }
}

/** Hide the toast with exponential backoff; it reappears when the snooze lapses. */
export function dismissUpdateToast(): void {
  const version = useUpdateStore.getState().available;
  if (!version) return;
  const prev = readSnooze();
  const count = prev && prev.version === version ? prev.count + 1 : 1;
  const delay = Math.min(SNOOZE_BASE_MS * 2 ** (count - 1), SNOOZE_MAX_MS);
  const until = Date.now() + delay;
  localStorage.setItem(SNOOZE_KEY, JSON.stringify({ version, count, until } satisfies Snooze));
  applySnooze(version);
}

/** set when the user clicks the toast before the download has finished */
let applyWhenReady = false;

async function checkOnce(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;
    useUpdateStore.setState({ available: update.version });
    applySnooze(update.version);

    // another window may already be downloading this version
    const lock = localStorage.getItem(LOCK_KEY);
    if (lock && Date.now() - Number(lock) < LOCK_TTL_MS) return;
    localStorage.setItem(LOCK_KEY, String(Date.now()));

    await update.downloadAndInstall();
    localStorage.setItem(READY_KEY, update.version);
    localStorage.removeItem(LOCK_KEY);
    useUpdateStore.setState({ ready: update.version });
    if (applyWhenReady) await applyUpdate();
  } catch (e) {
    localStorage.removeItem(LOCK_KEY);
    applyWhenReady = false;
    useUpdateStore.setState({ updating: false });
    console.warn("update check failed", e);
  }
}

/**
 * Toast click: restart immediately if the update is staged, otherwise ride
 * the in-flight download (or start one) and relaunch the moment it lands.
 */
export async function kickOffUpdate(): Promise<void> {
  if (useUpdateStore.getState().ready) return applyUpdate();
  applyWhenReady = true;
  useUpdateStore.setState({ updating: true });
  // user opted in — drop any snooze so the staged toast shows immediately
  localStorage.removeItem(SNOOZE_KEY);
  // fresh lock → a download is already running here or in another window;
  // it will apply via applyWhenReady / the storage mirror when it lands
  const lock = localStorage.getItem(LOCK_KEY);
  if (lock && Date.now() - Number(lock) < LOCK_TTL_MS) return;
  await checkOnce();
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
      else {
        useUpdateStore.setState({ available: staged, ready: staged });
        applySnooze(staged);
      }
    });
  }

  // mirror "ready" across windows
  window.addEventListener("storage", (e) => {
    if (e.key === READY_KEY && e.newValue) {
      useUpdateStore.setState({ available: e.newValue, ready: e.newValue });
      applySnooze(e.newValue);
      if (applyWhenReady) void applyUpdate();
    }
    // another window dismissed/cleared the toast — mirror the new schedule
    if (e.key === SNOOZE_KEY) {
      const v = useUpdateStore.getState().available;
      if (v) applySnooze(v);
    }
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
    useUpdateStore.setState({ available: update.version });
    applySnooze(update.version);

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
