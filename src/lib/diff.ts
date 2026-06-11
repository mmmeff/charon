import type { DiffLine, FileDiff } from "../types";

/** Parse a unified diff (GitHub `application/vnd.github.v3.diff`). */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let oldNum = 0;
  let newNum = 0;

  const push = () => {
    if (cur) files.push(cur);
    cur = null;
  };

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      push();
      // diff --git a/path b/path  (paths may contain spaces; split on " b/")
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      cur = {
        oldPath: m ? m[1] : "",
        newPath: m ? m[2] : "",
        isBinary: false,
        isNew: false,
        isDeleted: false,
        isRename: false,
        lines: [],
      };
      continue;
    }
    if (!cur) continue;

    if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
      cur.isBinary = true;
      continue;
    }
    if (line.startsWith("new file mode")) {
      cur.isNew = true;
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      cur.isDeleted = true;
      continue;
    }
    if (line.startsWith("rename from") || line.startsWith("rename to")) {
      cur.isRename = true;
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ")) {
      continue;
    }
    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldNum = parseInt(m[1], 10);
        newNum = parseInt(m[2], 10);
      }
      cur.lines.push({ type: "hunk", oldNum: null, newNum: null, text: line });
      continue;
    }
    if (line.startsWith("+")) {
      cur.lines.push({ type: "add", oldNum: null, newNum: newNum++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      cur.lines.push({ type: "del", oldNum: oldNum++, newNum: null, text: line.slice(1) });
    } else if (line.startsWith(" ") || line === "") {
      cur.lines.push({
        type: "context",
        oldNum: oldNum++,
        newNum: newNum++,
        text: line.slice(1),
      });
    }
    // "\ No newline at end of file" intentionally skipped
  }
  push();
  return files;
}

/** A side-by-side row: a paired left/right line, or a full-width hunk header. */
export interface SplitRow {
  kind: "hunk" | "pair";
  text?: string;
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Pair del/add runs into side-by-side rows (classic split-diff alignment). */
export function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.type === "hunk") {
      rows.push({ kind: "hunk", text: l.text, left: null, right: null });
      i++;
      continue;
    }
    if (l.type === "context") {
      rows.push({ kind: "pair", left: l, right: l });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    while (i < lines.length && lines[i].type === "del") dels.push(lines[i++]);
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].type === "add") adds.push(lines[i++]);
    for (let x = 0; x < Math.max(dels.length, adds.length); x++) {
      rows.push({ kind: "pair", left: dels[x] ?? null, right: adds[x] ?? null });
    }
  }
  return rows;
}

const stripWs = (s: string) => s.replace(/\s+/g, "");

/**
 * GitHub-style "hide whitespace": del/add runs whose lines differ only in
 * whitespace are folded back into context lines (keeping both line numbers,
 * so comment anchoring and selection still work), then hunks and files left
 * with no real changes are dropped/emptied. Runs are folded all-or-nothing to
 * preserve line ordering; mixed runs stay as-is.
 */
export function hideWhitespaceChanges(files: FileDiff[]): FileDiff[] {
  return files.map((f) => {
    if (f.isBinary) return f;
    const folded: DiffLine[] = [];
    const lines = f.lines;
    let i = 0;
    while (i < lines.length) {
      if (lines[i].type !== "del") {
        folded.push(lines[i]);
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "del") dels.push(lines[i++]);
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "add") adds.push(lines[i++]);
      if (dels.length === adds.length && dels.every((d, x) => stripWs(d.text) === stripWs(adds[x].text))) {
        for (let x = 0; x < dels.length; x++) {
          folded.push({ type: "context", oldNum: dels[x].oldNum, newNum: adds[x].newNum, text: adds[x].text });
        }
      } else {
        folded.push(...dels, ...adds);
      }
    }
    // drop hunks that no longer contain any change
    const cleaned: DiffLine[] = [];
    for (let x = 0; x < folded.length; x++) {
      if (folded[x].type === "hunk") {
        let y = x + 1;
        let hasChange = false;
        while (y < folded.length && folded[y].type !== "hunk") {
          if (folded[y].type !== "context") hasChange = true;
          y++;
        }
        if (!hasChange) {
          x = y - 1;
          continue;
        }
      }
      cleaned.push(folded[x]);
    }
    return { ...f, lines: cleaned };
  });
}

/** Extract the text of lines in [startLine, endLine] on `side` of a file diff. */
export function snippetFor(
  file: FileDiff,
  side: "LEFT" | "RIGHT",
  startLine: number,
  endLine: number
): string {
  const out: string[] = [];
  for (const l of file.lines) {
    const num = side === "RIGHT" ? l.newNum : l.oldNum;
    if (num !== null && num >= startLine && num <= endLine) {
      const sign = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
      out.push(sign + l.text);
    }
  }
  return out.join("\n");
}

/**
 * Validate that a (path, line, side) is commentable — i.e. appears in the
 * diff. Used to sanity-check LLM-proposed inline comments before submission;
 * GitHub rejects comments on lines outside the diff.
 */
export function lineInDiff(
  files: FileDiff[],
  path: string,
  line: number,
  side: "LEFT" | "RIGHT"
): boolean {
  const file = files.find((f) => f.newPath === path || f.oldPath === path);
  if (!file) return false;
  return file.lines.some((l) => (side === "RIGHT" ? l.newNum : l.oldNum) === line);
}

/** Text of the line at (path, side, line), or null if not in the diff. */
export function lineTextAt(
  files: FileDiff[],
  path: string,
  side: "LEFT" | "RIGHT",
  line: number
): string | null {
  const file = files.find((f) => f.newPath === path || f.oldPath === path);
  if (!file) return null;
  const hit = file.lines.find((l) => (side === "RIGHT" ? l.newNum : l.oldNum) === line);
  return hit ? hit.text : null;
}

/**
 * Content-based re-anchor: find the line in the (new) diff whose text matches
 * `anchorText`, preferring the candidate nearest the original line number.
 * Trimmed comparison so whitespace-only churn doesn't break the match; very
 * short anchors ("}", "end") are rejected as too ambiguous.
 */
export function findLineByText(
  files: FileDiff[],
  path: string,
  side: "LEFT" | "RIGHT",
  anchorText: string,
  nearLine: number
): { line: number; side: "LEFT" | "RIGHT" } | null {
  const needle = anchorText.trim();
  if (needle.length < 4) return null;
  const file = files.find((f) => f.newPath === path || f.oldPath === path);
  if (!file) return null;
  let best: { line: number; side: "LEFT" | "RIGHT"; dist: number } | null = null;
  for (const l of file.lines) {
    if (l.type === "hunk" || l.text.trim() !== needle) continue;
    const num = side === "RIGHT" ? l.newNum : l.oldNum;
    const fallback = l.newNum ?? l.oldNum;
    const n = num ?? fallback;
    if (n === null) continue;
    const s: "LEFT" | "RIGHT" = num !== null ? side : l.newNum !== null ? "RIGHT" : "LEFT";
    const dist = Math.abs(n - nearLine);
    if (!best || dist < best.dist) best = { line: n, side: s, dist };
  }
  return best ? { line: best.line, side: best.side } : null;
}

/** Best-effort re-anchor for an LLM comment whose line is slightly off. */
export function nearestDiffLine(
  files: FileDiff[],
  path: string,
  line: number
): { line: number; side: "LEFT" | "RIGHT" } | null {
  const file = files.find((f) => f.newPath === path || f.oldPath === path);
  if (!file) return null;
  let best: { line: number; side: "LEFT" | "RIGHT"; dist: number } | null = null;
  for (const l of file.lines) {
    if (l.newNum !== null) {
      const dist = Math.abs(l.newNum - line);
      if (!best || dist < best.dist) best = { line: l.newNum, side: "RIGHT", dist };
    }
  }
  return best && best.dist <= 20 ? { line: best.line, side: best.side } : null;
}
