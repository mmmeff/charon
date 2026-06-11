import hljs from "highlight.js/lib/common";
import dockerfile from "highlight.js/lib/languages/dockerfile";

hljs.registerLanguage("dockerfile", dockerfile);

/** Extensions that don't match their highlight.js language id. */
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  kts: "kotlin",
  cs: "csharp",
  h: "c",
  cc: "cpp",
  hpp: "cpp",
  cxx: "cpp",
  m: "objectivec",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  toml: "ini",
  htm: "xml",
  html: "xml",
  vue: "xml",
  svelte: "xml",
  md: "markdown",
  pl: "perl",
};

export function langForPath(path: string): string | null {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === "makefile" || base.endsWith(".mk")) return "makefile";
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  if (!ext) return null;
  const lang = EXT_LANG[ext] ?? ext;
  return hljs.getLanguage(lang) ? lang : null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Highlight a single diff line to HTML. Line-at-a-time means multi-line
 * constructs (block comments, template literals) can lose state mid-block —
 * the standard trade-off for diff highlighting; GitHub does the same.
 */
export function highlightLine(text: string, lang: string | null): string {
  if (!lang || !text) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

/**
 * Per-file memo of highlighted lines, keyed by line object identity so both
 * the unified and split renderers can share it.
 */
export function highlightFileLines(
  lines: { text: string; type: string }[],
  lang: string | null
): Map<object, string> {
  const map = new Map<object, string>();
  for (const l of lines) {
    if (l.type === "hunk") continue;
    map.set(l, highlightLine(l.text, lang));
  }
  return map;
}
