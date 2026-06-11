import type { FileDiff } from "../types";

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
