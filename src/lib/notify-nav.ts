import { onNotificationClicked } from "@choochmeque/tauri-plugin-notifications-api";
import { isLocalDevelopment, native } from "./tauri";

let initialized = false;

/**
 * Wire macOS notification taps to in-app navigation. Call once per window at
 * startup.
 *
 * The plugin broadcasts a tap to every window that registered a listener and
 * buffers a cold-start tap (app was quit) until the first listener registers —
 * so registering in each window also covers "launched by clicking a
 * notification". Routing to the right repo window + PR happens in the `focus_pr`
 * backend command, which is idempotent, so duplicate delivery across windows is
 * harmless.
 *
 * The listener is intentionally never torn down: the plugin's "a click listener
 * is active" flag is process-global, so unregistering one window's listener
 * would silently stop live delivery to other open windows. The channel dies
 * naturally when its webview closes. A module-level guard avoids double
 * registration within a window (React StrictMode / re-mounts).
 */
export async function initNotificationNav(): Promise<void> {
  if (initialized || isLocalDevelopment()) return;
  initialized = true;
  try {
    await onNotificationClicked((data) => {
      const repo = data.data?.navRepo;
      const prNumber = data.data?.navPr ? Number(data.data.navPr) : NaN;
      if (!repo || !Number.isFinite(prNumber)) return;
      void native.focusPr(repo, prNumber);
    });
  } catch (e) {
    initialized = false; // let a later attempt retry if plugin init was transient
    console.error("notification nav init failed", e);
  }
}
