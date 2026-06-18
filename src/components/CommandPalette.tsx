import { useEffect, useMemo, useRef, useState } from "react";
import { getCommands, registerCommand, resolveCommands, type CommandResult } from "../lib/commands";
import { usePrData } from "../lib/events";
import { navigateToPr } from "../lib/nav";
import { useUiStore } from "../lib/store";
import { useFlow } from "./flow";
import { formatShortcut, resolveShortcutMap } from "../lib/shortcuts";
import { useGlobalConfig } from "../lib/store";
import type { ShortcutActionId } from "../types";

/**
 * Command palette (⌘K). A floating modal that matches against a registry of
 * commands — static actions (switch tabs, new draft, etc.) plus dynamic ones
 * (open PR by number). Features register their own commands at load time;
 * the palette picks them up when it opens.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setOrphanPr = useUiStore((s) => s.setOrphanPr);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // register built-in commands once
  useBuiltinCommands();

  const results = useMemo(() => resolveCommands(query), [query, open]);

  // reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      // focus on next tick so the input is mounted
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // clamp selection when results change
  useEffect(() => {
    if (selected >= results.length) setSelected(0);
  }, [results.length, selected]);

  // scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const close = () => setOpen(false);

  const runSelected = () => {
    const r = results[selected];
    if (r) {
      r.run();
      close();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runSelected();
    }
  };

  if (!open) return null;

  return (
    <div className="palette-overlay" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command or PR number (e.g. #9907)…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        {results.length > 0 && (
          <div className="palette-results" ref={listRef}>
            {results.map((r, i) => (
              <button
                key={r.id}
                data-idx={i}
                className={`palette-item ${i === selected ? "selected" : ""}`}
                onMouseEnter={() => setSelected(i)}
                onClick={runSelected}
              >
                <span className="palette-item-label">{r.label}</span>
                {r.hint && <span className="palette-item-hint">{r.hint}</span>}
              </button>
            ))}
          </div>
        )}
        {results.length === 0 && (
          <div className="palette-empty subtle">No matching commands.</div>
        )}
      </div>
    </div>
  );
}

/**
 * Register the built-in palette commands. Runs once per mount (the registry
 * deduplicates by id). Each command is self-contained — it reads the live
 * store state at execution time, not at registration time.
 */
function useBuiltinCommands() {
  const global = useGlobalConfig((s) => s.config);
  const { ctx } = useFlow();
  const openPulls = usePrData((s) => s.openPulls);
  const myDrafts = usePrData((s) => s.myDrafts);
  const myOpen = usePrData((s) => s.myOpen);
  const reviewQueue = usePrData((s) => s.reviewQueue);
  const setOrphanPr = useUiStore((s) => s.setOrphanPr);

  const shortcuts = useMemo(
    () => resolveShortcutMap(global?.shortcuts),
    [global?.shortcuts]
  );
  const hint = (id: ShortcutActionId) => {
    const label = formatShortcut(shortcuts[id]);
    return label === "Unassigned" ? undefined : label;
  };

  // re-register on every render so closures capture fresh data — the
  // registry deduplicates by id so this is cheap
  useMemo(() => {
    // --- Navigation commands ---
    registerCommand({
      id: "nav-drafts",
      group: "Navigation",
      label: "Go to Drafts",
      hint: hint("tab_drafts"),
      match: (q) => labelMatches("Go to Drafts", q),
      run: () => useUiStore.getState().requestTab("drafts"),
    });
    registerCommand({
      id: "nav-open",
      group: "Navigation",
      label: "Go to Open PRs",
      hint: hint("tab_open"),
      match: (q) => labelMatches("Go to Open PRs", q),
      run: () => useUiStore.getState().requestTab("open"),
    });
    registerCommand({
      id: "nav-review",
      group: "Navigation",
      label: "Go to Review",
      hint: hint("tab_review"),
      match: (q) => labelMatches("Go to Review", q),
      run: () => useUiStore.getState().requestTab("review"),
    });
    registerCommand({
      id: "nav-agents",
      group: "Navigation",
      label: "Go to Agents",
      hint: hint("tab_activity"),
      match: (q) => labelMatches("Go to Agents", q),
      run: () => useUiStore.getState().requestTab("activity"),
    });
    registerCommand({
      id: "nav-settings",
      group: "Navigation",
      label: "Go to Settings",
      hint: hint("tab_settings"),
      match: (q) => labelMatches("Go to Settings", q),
      run: () => useUiStore.getState().requestTab("settings"),
    });

    // --- Action commands ---
    registerCommand({
      id: "action-new-draft",
      group: "Actions",
      label: "New draft PR",
      hint: hint("new_draft"),
      match: (q) => labelMatches("New draft PR", q),
      run: () => {
        useUiStore.getState().requestTab("drafts");
        useUiStore.getState().requestNewDraft();
      },
    });
    registerCommand({
      id: "action-sync",
      group: "Actions",
      label: "Sync now",
      match: (q) => labelMatches("Sync now", q),
      run: () => {
        // the poller is accessible via flow context at runtime, but we can
        // also just dispatch a refresh event — simpler: use the store
        // Actually we need the poller. Let's use a custom event.
        document.dispatchEvent(new CustomEvent("prc-sync-now"));
      },
    });
    registerCommand({
      id: "action-toggle-sidebar",
      group: "Actions",
      label: "Toggle PR list sidebar",
      hint: hint("toggle_pr_sidebar"),
      match: (q) => labelMatches("Toggle PR list sidebar", q),
      run: () => {
        const ui = useUiStore.getState();
        ui.setPrSidebarOpen(!ui.prSidebarOpen);
      },
    });
    registerCommand({
      id: "action-toggle-activity",
      group: "Actions",
      label: "Toggle activity panel",
      hint: hint("toggle_activity_panel"),
      match: (q) => labelMatches("Toggle activity panel", q),
      run: () => {
        const ui = useUiStore.getState();
        ui.setActivityPanelOpen(!ui.activityPanelOpen);
      },
    });

    // --- Open PR by number (dynamic) ---
    registerCommand({
      id: "open-pr",
      group: "PRs",
      label: "Open PR",
      dynamic: true,
      match: (q: string): CommandResult[] => {
        const query = q.trim();
        if (!query) return [];
        // match "#1234", "1234", or partial "open pr 1234"
        const numMatch = query.match(/#?(\d{1,7})$/);
        if (!numMatch) return [];
        const num = parseInt(numMatch[1], 10);
        if (!num || num < 1) return [];

        // check if it's in a known list first
        const allKnown = [...myDrafts, ...myOpen, ...reviewQueue, ...openPulls];
        const found = allKnown.find((p) => p.number === num);
        const title = found?.title;
        const isKnown = !!found;

        return [
          {
            id: `open-pr-${num}`,
            label: (
              <span>
                Open PR #{num}
                {title && <span className="subtle"> — {title}</span>}
                {!isKnown && <span className="subtle"> (orphan)</span>}
              </span>
            ),
            hint: isKnown ? undefined : "⌘↵",
            run: () => {
              // try in-app navigation first
              if (navigateToPr(num)) return;
              // not in any list — open as orphan
              setOrphanPr(num);
            },
          },
        ];
      },
    });

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shortcuts,
    openPulls,
    myDrafts,
    myOpen,
    reviewQueue,
    setOrphanPr,
    ctx,
  ]);
}

function labelMatches(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.trim().toLowerCase());
}
