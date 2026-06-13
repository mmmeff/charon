import { usePrData } from "./events";
import { useUiStore } from "./store";

/**
 * Focus a PR by number within this repo window: switch to whichever list tab
 * currently holds it and select it. Priority drafts → open → review mirrors the
 * tab order. Returns `false` when the PR isn't in any loaded list — it may be
 * closed/merged, or the poller may not have fetched yet — so callers driving a
 * deep-link can retry once data arrives.
 */
export function navigateToPr(prNumber: number): boolean {
  const d = usePrData.getState();
  const has = (l: { number: number }[]) => l.some((p) => p.number === prNumber);
  const tab = has(d.myDrafts) ? "drafts" : has(d.myOpen) ? "open" : has(d.reviewQueue) ? "review" : null;
  if (!tab) return false;
  const ui = useUiStore.getState();
  ui.setFocusedPr(tab, prNumber);
  ui.requestTab(tab);
  return true;
}
