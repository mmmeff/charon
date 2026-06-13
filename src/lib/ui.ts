import { useEffect, useState, type RefObject } from "react";
import { useUiStore } from "./store";
import type { PrSummary } from "../types";

// Non-component UI helpers and hooks. They live here (not in a component
// file) so component files export only components — mixed exports break
// Vite Fast Refresh and force full-state reloads in dev.

// Per-page scroll positions, keyed by a stable page id. In-memory (session
// scoped) — restores when the user navigates back to a page they left.
const scrollMemory = new Map<string, number>();

/**
 * Remember a scroll container's position under `key` and restore it on
 * remount. Tolerates async content (diffs load after mount) by re-applying
 * the saved offset over a short window as the page grows, and bails the
 * moment the user scrolls/wheels so it never fights them.
 */
export function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  key: string | null | undefined
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !key) return;
    let restoring = (scrollMemory.get(key) ?? 0) > 0;

    const stopRestoring = () => {
      restoring = false;
    };
    const onScroll = () => {
      if (!restoring) scrollMemory.set(key, el.scrollTop);
    };
    // any explicit user gesture cancels an in-flight restore
    el.addEventListener("wheel", stopRestoring, { passive: true });
    el.addEventListener("touchstart", stopRestoring, { passive: true });
    el.addEventListener("keydown", stopRestoring);
    el.addEventListener("scroll", onScroll, { passive: true });

    if (restoring) {
      const target = scrollMemory.get(key) ?? 0;
      let tries = 0;
      const tick = () => {
        if (!restoring) return;
        el.scrollTop = target;
        // settled (content tall enough and offset applied) or timed out (~0.8s)
        if (Math.abs(el.scrollTop - target) < 2 || tries++ > 48) {
          restoring = false;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    return () => {
      el.removeEventListener("wheel", stopRestoring);
      el.removeEventListener("touchstart", stopRestoring);
      el.removeEventListener("keydown", stopRestoring);
      el.removeEventListener("scroll", onScroll);
    };
  }, [ref, key]);
}

/**
 * Report when the workspace's PR title scrolls out of view so the topstrip
 * can show a breadcrumb (`/ #1234 title`) that jumps back to the top.
 */
export function useScrolledPrTitle(
  mainRef: RefObject<HTMLDivElement | null>,
  pr: PrSummary
): void {
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const update = () => {
      const past = el.scrollTop > 64;
      const ui = useUiStore.getState();
      const cur = ui.scrolledPrTitle;
      if (past && (cur?.number !== pr.number || cur?.title !== pr.title)) {
        ui.setScrolledPrTitle({ number: pr.number, title: pr.title });
      } else if (!past && cur) {
        ui.setScrolledPrTitle(null);
      }
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      el.removeEventListener("scroll", update);
      useUiStore.getState().setScrolledPrTitle(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, pr.title]);
}

/**
 * Re-render ticker for relative timestamps ("synced 5s ago", elapsed
 * counters). Pass 0 to disable the timer (e.g. for finished agents).
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!intervalMs) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function timeAgo(ts: number | string): string {
  return `${age(ts)} ago`;
}

/** Compact age: "40s", "12m", "3h", "5d". */
export function age(ts: number | string): string {
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

// ---------------------------------------------------------------------------
// PR list sorting
// ---------------------------------------------------------------------------

export type SortKey = "updated" | "oldest" | "number" | "size";

export function sortPrs(prs: PrSummary[], key: SortKey): PrSummary[] {
  const list = [...prs];
  switch (key) {
    case "updated":
      return list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    case "oldest":
      return list.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    case "number":
      return list.sort((a, b) => b.number - a.number);
    case "size":
      return list.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
  }
}
