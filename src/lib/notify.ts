import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { NotificationCategory } from "../types";
import { notificationEnabled } from "./defaults";
import { useGlobalConfig } from "./store";

let granted: boolean | null = null;

/**
 * Fire a native OS notification IF the user has its category enabled
 * (best-effort; failures only log). This is the ONE place notifications are
 * raised and the ONE place preferences are checked — the required `category`
 * argument means no caller can skip the user's Settings → Notifications choices.
 */
export async function notify(
  category: NotificationCategory,
  title: string,
  body: string
): Promise<void> {
  try {
    const prefs = useGlobalConfig.getState().config?.notifications;
    if (!notificationEnabled(prefs, category)) return;
    if (granted === null) {
      granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title, body });
  } catch (e) {
    console.error("notification failed", e);
  }
}
