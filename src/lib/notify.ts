import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let granted: boolean | null = null;

/** Fire a native OS notification (best-effort; failures only log). */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (granted === null) {
      granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title, body });
  } catch (e) {
    console.error("notification failed", e);
  }
}
