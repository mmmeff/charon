import { useEffect, useMemo, useState, type ReactNode } from "react";
import { hideWhitespaceChanges, snippetFor } from "../lib/diff";
import type { DiffLine, FileDiff, LineSelection } from "../types";
import { Badge } from "./common";

export interface DiffAnchor {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  node: ReactNode;
}

interface DragState {
  path: string;
  side: "LEFT" | "RIGHT";
  anchor: number;
  current: number;
}

type ViewMode = "unified" | "split";

/** A side-by-side row: a paired left/right line, or a full-width hunk header. */
interface SplitRow {
  kind: "hunk" | "pair";
  text?: string;
  left: DiffLine | null;
  right: DiffLine | null;
}

function buildSplitRows(lines: DiffLine[]): SplitRow[] {
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

/**
 * Native diff renderer with GitHub-style line selection: click a line number
 * to select a line, drag across numbers to select a range, then the parent
 * renders a comment form below the selection. Supports unified and
 * side-by-side views plus whitespace hiding (both remembered across windows).
 */
export function DiffViewer({
  files: rawFiles,
  selectable = false,
  anchors = [],
  renderCommentForm,
}: {
  files: FileDiff[];
  selectable?: boolean;
  anchors?: DiffAnchor[];
  renderCommentForm?: (sel: LineSelection, close: () => void) => ReactNode;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [sel, setSel] = useState<LineSelection | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hideWs, setHideWsState] = useState(() => localStorage.getItem("prc-diff-ws") !== "off");
  const [mode, setModeState] = useState<ViewMode>(
    () => (localStorage.getItem("prc-diff-mode") as ViewMode) || "unified"
  );
  const setHideWs = (v: boolean) => {
    localStorage.setItem("prc-diff-ws", v ? "on" : "off");
    setHideWsState(v);
  };
  const setMode = (v: ViewMode) => {
    localStorage.setItem("prc-diff-mode", v);
    setModeState(v);
  };

  const files = useMemo(
    () => (hideWs ? hideWhitespaceChanges(rawFiles) : rawFiles),
    [rawFiles, hideWs]
  );

  const keyOf = (f: FileDiff) => f.newPath || f.oldPath;

  useEffect(() => {
    if (!drag) return;
    const up = () => {
      const file = files.find((f) => keyOf(f) === drag.path);
      const start = Math.min(drag.anchor, drag.current);
      const end = Math.max(drag.anchor, drag.current);
      if (file) {
        setSel({
          path: drag.path,
          side: drag.side,
          startLine: start,
          endLine: end,
          snippet: snippetFor(file, drag.side, start, end),
        });
      }
      setDrag(null);
    };
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, [drag, files]);

  const numCellHandlers = (path: string, side: "LEFT" | "RIGHT", num: number | null) => ({
    onMouseDown: (e: React.MouseEvent) => {
      if (!selectable || num === null) return;
      e.preventDefault();
      setSel(null);
      setDrag({ path, side, anchor: num, current: num });
    },
    onMouseEnter: () => {
      if (drag && drag.path === path && drag.side === side && num !== null) {
        setDrag({ ...drag, current: num });
      }
    },
  });

  const isHighlighted = (path: string, side: "LEFT" | "RIGHT", num: number | null): boolean => {
    if (num === null) return false;
    if (drag && drag.path === path && drag.side === side) {
      return num >= Math.min(drag.anchor, drag.current) && num <= Math.max(drag.anchor, drag.current);
    }
    if (sel && sel.path === path && sel.side === side) {
      return num >= sel.startLine && num <= sel.endLine;
    }
    return false;
  };

  /** Anchor rows + comment form rendered after a diff row, for the given (side, num) identities. */
  const afterRow = (path: string, entries: { side: "LEFT" | "RIGHT"; num: number | null }[], colSpan: number) => {
    const out: ReactNode[] = [];
    for (const e of entries) {
      if (e.num === null) continue;
      anchors
        .filter((a) => a.path === path && a.side === e.side && a.line === e.num)
        .forEach((a, j) =>
          out.push(
            <tr key={`a-${e.side}-${e.num}-${j}`} className="comment-anchor-row">
              <td colSpan={colSpan}>
                <div className="inline-comment-box">{a.node}</div>
              </td>
            </tr>
          )
        );
      if (sel && renderCommentForm && sel.path === path && sel.side === e.side && e.num === sel.endLine) {
        out.push(
          <tr key={`form-${e.side}-${e.num}`} className="comment-anchor-row">
            <td colSpan={colSpan}>
              <div className="inline-comment-box">{renderCommentForm(sel, () => setSel(null))}</div>
            </td>
          </tr>
        );
      }
    }
    return out;
  };

  return (
    <div onMouseLeave={() => drag && setDrag(null)}>
      {rawFiles.length > 0 && (
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="seg">
            <button className={`small ${mode === "unified" ? "primary" : ""}`} onClick={() => setMode("unified")}>
              Unified
            </button>
            <button className={`small ${mode === "split" ? "primary" : ""}`} onClick={() => setMode("split")}>
              Side-by-side
            </button>
          </div>
          <label className="switch subtle">
            <input type="checkbox" checked={hideWs} onChange={(e) => setHideWs(e.target.checked)} />
            Hide whitespace changes
          </label>
        </div>
      )}
      {files.map((file) => {
        const path = keyOf(file);
        const isCollapsed = collapsed[path];
        const wsOnly = hideWs && !file.isBinary && file.lines.every((l) => l.type === "context");
        return (
          <div className="diff-file" key={path}>
            <div className="diff-file-header">
              <button className="link small" onClick={() => setCollapsed({ ...collapsed, [path]: !isCollapsed })}>
                {isCollapsed ? "▸" : "▾"}
              </button>
              <strong>{path}</strong>
              {file.isRename && <Badge color="purple">renamed from {file.oldPath}</Badge>}
              {file.isNew && <Badge color="green">new</Badge>}
              {file.isDeleted && <Badge color="red">deleted</Badge>}
              {file.isBinary && <Badge color="gray">binary</Badge>}
              {wsOnly && <Badge color="gray">whitespace-only changes</Badge>}
            </div>
            {!isCollapsed &&
              !file.isBinary &&
              !wsOnly &&
              (mode === "unified" ? (
                <UnifiedTable
                  file={file}
                  path={path}
                  selectable={selectable}
                  numCellHandlers={numCellHandlers}
                  isHighlighted={isHighlighted}
                  afterRow={afterRow}
                />
              ) : (
                <SplitTable
                  file={file}
                  path={path}
                  selectable={selectable}
                  numCellHandlers={numCellHandlers}
                  isHighlighted={isHighlighted}
                  afterRow={afterRow}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface TableProps {
  file: FileDiff;
  path: string;
  selectable: boolean;
  numCellHandlers: (
    path: string,
    side: "LEFT" | "RIGHT",
    num: number | null
  ) => { onMouseDown: (e: React.MouseEvent) => void; onMouseEnter: () => void };
  isHighlighted: (path: string, side: "LEFT" | "RIGHT", num: number | null) => boolean;
  afterRow: (
    path: string,
    entries: { side: "LEFT" | "RIGHT"; num: number | null }[],
    colSpan: number
  ) => ReactNode[];
}

function UnifiedTable({ file, path, numCellHandlers, isHighlighted, afterRow }: TableProps) {
  return (
    <table className="diff-table">
      <tbody>
        {file.lines.map((line, i) => {
          if (line.type === "hunk") {
            return (
              <tr key={i} className="hunk">
                <td colSpan={3}>{line.text}</td>
              </tr>
            );
          }
          const side: "LEFT" | "RIGHT" = line.type === "del" ? "LEFT" : "RIGHT";
          const num = side === "RIGHT" ? line.newNum : line.oldNum;
          const hl = isHighlighted(path, side, num);
          const handlers = numCellHandlers(path, side, num);
          return [
            <tr key={i} className={`${line.type} commentable ${hl ? "sel" : ""}`}>
              <td className="diff-num" {...handlers} title="Click or drag to select lines">
                {line.oldNum ?? ""}
              </td>
              <td className="diff-num" {...handlers}>
                {line.newNum ?? ""}
              </td>
              <td className="diff-text">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                {line.text}
              </td>
            </tr>,
            ...afterRow(path, [{ side, num }], 3),
          ];
        })}
      </tbody>
    </table>
  );
}

function SplitTable({ file, path, numCellHandlers, isHighlighted, afterRow }: TableProps) {
  const rows = useMemo(() => buildSplitRows(file.lines), [file]);
  return (
    <table className="diff-table split">
      <tbody>
        {rows.map((row, i) => {
          if (row.kind === "hunk") {
            return (
              <tr key={i} className="hunk">
                <td colSpan={4}>{row.text}</td>
              </tr>
            );
          }
          const l = row.left;
          const r = row.right;
          const lNum = l?.oldNum ?? null;
          const rNum = r?.newNum ?? null;
          const lKind = l ? (l.type === "del" ? "del" : "ctx") : "empty";
          const rKind = r ? (r.type === "add" ? "add" : "ctx") : "empty";
          const lHl = isHighlighted(path, "LEFT", lNum);
          const rHl = isHighlighted(path, "RIGHT", rNum);
          return [
            <tr key={i} className="commentable">
              <td
                className={`diff-num num-${lKind} ${lHl ? "cell-sel" : ""}`}
                {...numCellHandlers(path, "LEFT", lNum)}
                title="Click or drag to select lines"
              >
                {lNum ?? ""}
              </td>
              <td className={`diff-text half cell-${lKind} ${lHl ? "cell-sel" : ""}`}>
                {l ? (l.type === "del" ? "-" : " ") + l.text : ""}
              </td>
              <td
                className={`diff-num num-${rKind} ${rHl ? "cell-sel" : ""}`}
                {...numCellHandlers(path, "RIGHT", rNum)}
                title="Click or drag to select lines"
              >
                {rNum ?? ""}
              </td>
              <td className={`diff-text half cell-${rKind} ${rHl ? "cell-sel" : ""}`}>
                {r ? (r.type === "add" ? "+" : " ") + r.text : ""}
              </td>
            </tr>,
            ...afterRow(
              path,
              [
                { side: "LEFT", num: lNum },
                { side: "RIGHT", num: rNum },
              ],
              4
            ),
          ];
        })}
      </tbody>
    </table>
  );
}
