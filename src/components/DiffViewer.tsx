import { useEffect, useMemo, useState, type ReactNode } from "react";
import { hideWhitespaceChanges, snippetFor } from "../lib/diff";
import type { FileDiff, LineSelection } from "../types";
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

/**
 * Native diff renderer with GitHub-style line selection: click a line number
 * to select a line, drag across numbers to select a range, then the parent
 * renders a comment form below the selection.
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
  const [hideWs, setHideWs] = useState(true);
  const files = useMemo(
    () => (hideWs ? hideWhitespaceChanges(rawFiles) : rawFiles),
    [rawFiles, hideWs]
  );

  useEffect(() => {
    if (!drag) return;
    const up = () => {
      const file = files.find((f) => keyOf(f) === drag.path || f.newPath === drag.path);
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

  const keyOf = (f: FileDiff) => f.newPath || f.oldPath;

  return (
    <div onMouseLeave={() => drag && setDrag(null)}>
      {rawFiles.length > 0 && (
        <div className="row" style={{ marginBottom: 8 }}>
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
            {!isCollapsed && !file.isBinary && !wsOnly && (
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
                    const inDrag =
                      drag &&
                      drag.path === path &&
                      drag.side === side &&
                      num !== null &&
                      num >= Math.min(drag.anchor, drag.current) &&
                      num <= Math.max(drag.anchor, drag.current);
                    const inSel =
                      sel &&
                      sel.path === path &&
                      sel.side === side &&
                      num !== null &&
                      num >= sel.startLine &&
                      num <= sel.endLine;
                    const rowAnchors = anchors.filter(
                      (a) => a.path === path && a.side === side && a.line === num
                    );
                    const showFormHere =
                      sel && renderCommentForm && sel.path === path && sel.side === side && num === sel.endLine;
                    return (
                      <RowGroup key={i}>
                        <tr className={`${line.type} commentable ${inDrag || inSel ? "sel" : ""}`}>
                          <td
                            className="diff-num"
                            onMouseDown={(e) => {
                              if (!selectable || num === null) return;
                              e.preventDefault();
                              setSel(null);
                              setDrag({ path, side, anchor: num, current: num });
                            }}
                            onMouseEnter={() => {
                              if (drag && drag.path === path && drag.side === side && num !== null) {
                                setDrag({ ...drag, current: num });
                              }
                            }}
                            title={selectable ? "Click or drag to select lines" : undefined}
                          >
                            {line.oldNum ?? ""}
                          </td>
                          <td
                            className="diff-num"
                            onMouseDown={(e) => {
                              if (!selectable || num === null) return;
                              e.preventDefault();
                              setSel(null);
                              setDrag({ path, side, anchor: num, current: num });
                            }}
                            onMouseEnter={() => {
                              if (drag && drag.path === path && drag.side === side && num !== null) {
                                setDrag({ ...drag, current: num });
                              }
                            }}
                          >
                            {line.newNum ?? ""}
                          </td>
                          <td className="diff-text">
                            {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                            {line.text}
                          </td>
                        </tr>
                        {rowAnchors.map((a, j) => (
                          <tr key={`a${j}`} className="comment-anchor-row">
                            <td colSpan={3}>
                              <div className="inline-comment-box">{a.node}</div>
                            </td>
                          </tr>
                        ))}
                        {showFormHere && (
                          <tr className="comment-anchor-row">
                            <td colSpan={3}>
                              <div className="inline-comment-box">
                                {renderCommentForm!(sel!, () => setSel(null))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </RowGroup>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// React fragments can't be table row groups; this renders children directly.
function RowGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
