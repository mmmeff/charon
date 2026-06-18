import type { ReactNode } from "react";

/**
 * Command palette registry.
 *
 * Commands are registered as they become relevant — features add their own
 * commands at module load time via `registerCommand`, and the palette picks
 * up the full set at open time. This keeps command definitions co-located
 * with the features that own them.
 *
 * Dynamic commands (e.g. "Open PR #N") use `dynamic: true` and a `match`
 * function to produce results from the user's query at runtime, rather than
 * pre-enumerating every possible PR.
 */

export interface CommandResult {
  /** unique id for this result (for React keys) */
  id: string;
  /** main label shown in the palette */
  label: ReactNode;
  /** optional hint shown on the right (shortcut, category, etc.) */
  hint?: ReactNode;
  /** run the command; the palette closes immediately after */
  run: () => void;
}

export interface Command {
  /** stable id; deduplicates re-registrations */
  id: string;
  /** category label for grouping in the palette */
  group: string;
  /** static label (for non-dynamic commands) */
  label: string;
  /** optional static hint (shortcut, etc.) */
  hint?: string;
  /**
   * Dynamic commands don't have a static label — they generate results from
   * the user's query. When `dynamic` is true, `match(query)` is called on
   * every keystroke and its results replace the command's static entry.
   */
  dynamic?: boolean;
  /**
   * For dynamic commands: produce zero or more results from the query.
   * For static commands: return `true` if the command matches the query
   * (substring/keyword match), or omit to always include it.
   */
  match?: (query: string) => boolean | CommandResult[];
  /** run the command (static commands only) */
  run?: () => void;
}

const registry: Command[] = [];
const registered = new Set<string>();

/** Register a command. Re-registering the same id is a silent no-op. */
export function registerCommand(cmd: Command): void {
  if (registered.has(cmd.id)) return;
  registered.add(cmd.id);
  registry.push(cmd);
}

/** Remove a command (for feature teardown — rarely needed). */
export function unregisterCommand(id: string): void {
  registered.delete(id);
  const i = registry.findIndex((c) => c.id === id);
  if (i >= 0) registry.splice(i, 1);
}

/** Snapshot of all registered commands (copy so callers can't mutate). */
export function getCommands(): Command[] {
  return [...registry];
}

/**
 * Resolve a query into a flat list of results, preserving group order.
 * Static commands that don't define `match` are always included (the palette
 * filters them by label substring).
 */
export function resolveCommands(query: string): CommandResult[] {
  const q = query.trim().toLowerCase();
  const out: CommandResult[] = [];
  for (const cmd of registry) {
    if (cmd.dynamic && cmd.match) {
      const results = cmd.match(query);
      if (Array.isArray(results)) {
        out.push(...results);
      }
      continue;
    }
    // static command: include if no match fn, or match returns true
    if (q === "" || !cmd.match || cmd.match(query)) {
      out.push({
        id: cmd.id,
        label: cmd.label,
        hint: cmd.hint,
        run: () => cmd.run?.(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Built-in commands — registered at module load so they're always available.
// ---------------------------------------------------------------------------

/** Substring match for static commands (case-insensitive). */
function labelMatches(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.trim().toLowerCase());
}
