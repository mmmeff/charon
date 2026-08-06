import { native } from "./tauri";
import type { UltraReviewDiagnosticEntry } from "../types";
import {
  appendUltraReviewDiagnostic,
  createUltraReviewDiagnostics,
  parseUltraReviewDiagnostics,
  serializeUltraReviewDiagnostics,
} from "./ultrareview-diagnostics";

const repoKey = (repo: string): string =>
  repo.replace(/[^a-zA-Z0-9_.-]/g, "__");

export const ultraReviewDiagnosticsPath = (
  repo: string,
): string =>
  `repos/${repoKey(repo)}/ultrareview-diagnostics.json`;

let diagnosticsQueue: Promise<void> = Promise.resolve();

/**
 * Persist bounded troubleshooting metadata on this device.
 *
 * The diagnostics schema rejects prose and payload content before this
 * function reaches native blob storage.
 */
export function recordUltraReviewDiagnostic(
  repo: string,
  entry: UltraReviewDiagnosticEntry,
): Promise<void> {
  diagnosticsQueue = diagnosticsQueue
    .catch(() => undefined)
    .then(async () => {
      const path = ultraReviewDiagnosticsPath(repo);
      const raw = await native.loadBlob(path);
      const current = raw
        ? parseUltraReviewDiagnostics(raw).diagnostics
        : createUltraReviewDiagnostics();
      const next = appendUltraReviewDiagnostic(current, entry);
      await native.saveBlob(
        path,
        serializeUltraReviewDiagnostics(next),
      );
    });
  return diagnosticsQueue;
}
