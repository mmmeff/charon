import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@choochmeque/tauri-plugin-notifications-api";
import type { NotificationCategory } from "../types";
import { notificationEnabled } from "./defaults";
import { useGlobalConfig } from "./store";

let granted: boolean | null = null;

/** Where clicking a notification should take the user: a specific PR's window. */
export interface NotifyNav {
  repo: string;
  prNumber: number;
}

/**
 * Fire a native OS notification IF the user has its category enabled
 * (best-effort; failures only log). This is the ONE place notifications are
 * raised and the ONE place preferences are checked — the required `category`
 * argument means no caller can skip the user's Settings → Notifications choices.
 *
 * Pass `nav` for PR-scoped notifications so a click opens the app on that PR
 * (see `initNotificationNav`). The payload rides in `extra` as strings — the
 * macOS backend only round-trips string-valued `extra` back to the click
 * handler.
 */
export async function notify(
  category: NotificationCategory,
  title: string,
  body: string,
  nav?: NotifyNav
): Promise<void> {
  try {
    const prefs = useGlobalConfig.getState().config?.notifications;
    if (!notificationEnabled(prefs, category)) return;
    if (granted === null) {
      granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;
    await sendNotification({
      title,
      body,
      autoCancel: true,
      ...(nav ? { extra: { navRepo: nav.repo, navPr: String(nav.prNumber) } } : {}),
    });
  } catch (e) {
    console.error("notification failed", e);
  }
}
