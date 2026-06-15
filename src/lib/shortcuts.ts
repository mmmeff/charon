import type { KeyBinding, ShortcutActionId, ShortcutMap } from "../types";

export interface ShortcutDef {
  id: ShortcutActionId;
  group: string;
  label: string;
  description: string;
  defaultBinding: KeyBinding | null;
}

export const SHORTCUT_CATALOG: ShortcutDef[] = [
  {
    id: "zoom_in",
    group: "View",
    label: "Zoom in",
    description: "Scale the app UI up.",
    defaultBinding: { primary: true, key: "=" },
  },
  {
    id: "zoom_out",
    group: "View",
    label: "Zoom out",
    description: "Scale the app UI down.",
    defaultBinding: { primary: true, key: "-" },
  },
  {
    id: "zoom_reset",
    group: "View",
    label: "Reset zoom",
    description: "Return the app UI to 100%.",
    defaultBinding: { primary: true, key: "0" },
  },
  {
    id: "toggle_pr_sidebar",
    group: "Panels",
    label: "Toggle PR list",
    description: "Show or hide the PR list sidebar in Drafts, Open PRs, and Review.",
    defaultBinding: { primary: true, key: "b" },
  },
  {
    id: "toggle_activity_panel",
    group: "Panels",
    label: "Toggle activity panel",
    description: "Show or hide the right-hand PR activity panel.",
    defaultBinding: { primary: true, key: "i" },
  },
  {
    id: "toggle_agents",
    group: "Panels",
    label: "Toggle Agents",
    description: "Jump to the Agents tab, or return to the previous PR tab.",
    defaultBinding: { primary: true, key: "j" },
  },
  {
    id: "tab_drafts",
    group: "Navigation",
    label: "Open Drafts",
    description: "Switch to the Drafts tab.",
    defaultBinding: { primary: true, key: "1" },
  },
  {
    id: "tab_open",
    group: "Navigation",
    label: "Open PRs",
    description: "Switch to the Open PRs tab.",
    defaultBinding: { primary: true, key: "2" },
  },
  {
    id: "tab_review",
    group: "Navigation",
    label: "Open Review",
    description: "Switch to the Review tab.",
    defaultBinding: { primary: true, key: "3" },
  },
  {
    id: "tab_activity",
    group: "Navigation",
    label: "Open Agents",
    description: "Switch to the Agents tab.",
    defaultBinding: { primary: true, key: "4" },
  },
  {
    id: "tab_settings",
    group: "Navigation",
    label: "Open Settings",
    description: "Switch to the Settings tab.",
    defaultBinding: { primary: true, key: "5" },
  },
  {
    id: "nav_back",
    group: "Navigation",
    label: "Back",
    description: "Move back through the tab and PR focus history.",
    defaultBinding: { primary: true, key: "[" },
  },
  {
    id: "nav_forward",
    group: "Navigation",
    label: "Forward",
    description: "Move forward through the tab and PR focus history.",
    defaultBinding: { primary: true, key: "]" },
  },
];

export const DEFAULT_SHORTCUTS: Record<ShortcutActionId, KeyBinding | null> = Object.fromEntries(
  SHORTCUT_CATALOG.map((s) => [s.id, s.defaultBinding])
) as Record<ShortcutActionId, KeyBinding | null>;

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function normalizeShortcutKey(key: string): string {
  if (key === " ") return "space";
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

export function normalizeBinding(binding: KeyBinding): KeyBinding {
  return {
    ...(binding.primary ? { primary: true } : {}),
    ...(binding.ctrl ? { ctrl: true } : {}),
    ...(binding.meta ? { meta: true } : {}),
    ...(binding.alt ? { alt: true } : {}),
    ...(binding.shift ? { shift: true } : {}),
    key: normalizeShortcutKey(binding.key),
  };
}

export function resolveShortcutMap(overrides: ShortcutMap | undefined): Record<ShortcutActionId, KeyBinding | null> {
  const resolved = {} as Record<ShortcutActionId, KeyBinding | null>;
  for (const def of SHORTCUT_CATALOG) {
    if (overrides && Object.hasOwn(overrides, def.id)) {
      const binding = overrides[def.id];
      resolved[def.id] = binding ? normalizeBinding(binding) : null;
    } else {
      resolved[def.id] = def.defaultBinding ? normalizeBinding(def.defaultBinding) : null;
    }
  }
  return resolved;
}

export function bindingsEqual(a: KeyBinding | null | undefined, b: KeyBinding | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeBinding(a);
  const y = normalizeBinding(b);
  return (
    x.key === y.key &&
    !!x.primary === !!y.primary &&
    !!x.ctrl === !!y.ctrl &&
    !!x.meta === !!y.meta &&
    !!x.alt === !!y.alt &&
    !!x.shift === !!y.shift
  );
}

export function bindingFromEvent(event: KeyboardEvent, mac = isMacPlatform()): KeyBinding | null {
  if (isModifierOnlyKey(event.key)) return null;
  const key = normalizeShortcutKey(event.key);
  const primaryDown = mac ? event.metaKey : event.ctrlKey;
  const binding: KeyBinding = { key };
  if (primaryDown) binding.primary = true;
  if (event.ctrlKey && !(primaryDown && !mac)) binding.ctrl = true;
  if (event.metaKey && !(primaryDown && mac)) binding.meta = true;
  if (event.altKey) binding.alt = true;
  if (event.shiftKey) binding.shift = true;
  return normalizeBinding(binding);
}

export function shortcutMatchesEvent(binding: KeyBinding, event: KeyboardEvent, mac = isMacPlatform()): boolean {
  const b = normalizeBinding(binding);
  const expectedCtrl = !!b.ctrl || (!!b.primary && !mac);
  const expectedMeta = !!b.meta || (!!b.primary && mac);
  return (
    b.key === normalizeShortcutKey(event.key) &&
    expectedCtrl === event.ctrlKey &&
    expectedMeta === event.metaKey &&
    !!b.alt === event.altKey &&
    !!b.shift === event.shiftKey
  );
}

export function actionForShortcutEvent(
  event: KeyboardEvent,
  shortcuts: Record<ShortcutActionId, KeyBinding | null>
): ShortcutActionId | null {
  for (const def of SHORTCUT_CATALOG) {
    const binding = shortcuts[def.id];
    if (binding && shortcutMatchesEvent(binding, event)) return def.id;
  }
  return null;
}

export function validateBinding(binding: KeyBinding | null): string | null {
  if (!binding) return null;
  const b = normalizeBinding(binding);
  const hasModifier = !!(b.primary || b.ctrl || b.meta || b.alt || b.shift);
  if (!hasModifier && isPrintableKey(b.key)) {
    return "Use at least one modifier for letter, number, punctuation, or space shortcuts.";
  }
  return null;
}

export function formatShortcut(binding: KeyBinding | null | undefined, mac = isMacPlatform()): string {
  if (!binding) return "Unassigned";
  const b = normalizeBinding(binding);
  const parts: string[] = [];
  if (mac) {
    if (b.primary) parts.push("⌘");
    if (b.ctrl) parts.push("⌃");
    if (b.alt) parts.push("⌥");
    if (b.shift) parts.push("⇧");
    if (b.meta) parts.push("⌘");
    return `${parts.join("")}${formatKey(b.key, mac)}`;
  }
  if (b.primary) parts.push("Ctrl");
  if (b.ctrl) parts.push("Ctrl");
  if (b.alt) parts.push("Alt");
  if (b.shift) parts.push("Shift");
  if (b.meta) parts.push("Meta");
  parts.push(formatKey(b.key, mac));
  return parts.join("+");
}

export function shortcutConflict(
  actionId: ShortcutActionId,
  binding: KeyBinding | null,
  shortcuts: Record<ShortcutActionId, KeyBinding | null>
): ShortcutDef | null {
  if (!binding) return null;
  return SHORTCUT_CATALOG.find((def) => def.id !== actionId && bindingsEqual(shortcuts[def.id], binding)) ?? null;
}

export function isShortcutRecorderTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("[data-shortcut-recorder]");
}

function isModifierOnlyKey(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta" || key === "OS";
}

function isPrintableKey(key: string): boolean {
  return key === "space" || key.length === 1;
}

function formatKey(key: string, mac: boolean): string {
  switch (key) {
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "escape":
      return "Esc";
    case "backspace":
      return "Backspace";
    case "delete":
      return "Delete";
    case "enter":
      return mac ? "↩" : "Enter";
    case "tab":
      return "Tab";
    case "space":
      return "Space";
    default:
      return key.length === 1 ? key.toUpperCase() : key.replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
