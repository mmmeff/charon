import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "./tauri";

const ZOOM_STORAGE_KEY = "prc-ui-zoom";
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.8;
const STEP = 0.1;

export function currentUiZoom(): number {
  return parseZoom(localStorage.getItem(ZOOM_STORAGE_KEY));
}

export function initUiZoom(): () => void {
  void applyUiZoom(currentUiZoom());
  const onStorage = (event: StorageEvent) => {
    if (event.key === ZOOM_STORAGE_KEY) void applyUiZoom(parseZoom(event.newValue));
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export async function adjustUiZoom(delta: 1 | -1): Promise<number> {
  return setUiZoom(currentUiZoom() + delta * STEP);
}

export async function resetUiZoom(): Promise<number> {
  return setUiZoom(DEFAULT_ZOOM);
}

async function setUiZoom(value: number): Promise<number> {
  const zoom = clampZoom(value);
  localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
  await applyUiZoom(zoom);
  return zoom;
}

async function applyUiZoom(value: number): Promise<void> {
  const zoom = clampZoom(value);
  if (isTauri()) {
    await getCurrentWebview().setZoom(zoom).catch((e) => {
      console.error("failed to set UI zoom", e);
    });
    return;
  }
  (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(zoom);
}

function parseZoom(raw: string | null): number {
  const n = raw ? Number(raw) : DEFAULT_ZOOM;
  return Number.isFinite(n) ? clampZoom(n) : DEFAULT_ZOOM;
}

function clampZoom(value: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)) * 100) / 100;
}
