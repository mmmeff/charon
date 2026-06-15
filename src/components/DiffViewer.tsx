import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildSplitRows, hideWhitespaceChanges, snippetFor } from "../lib/diff";
import { highlightFileLines, langForPath } from "../lib/highlight";
import { useUiStore } from "../lib/store";
import type { FileDiff, LineSelection } from "../types";
import { Badge } from "./common";
import { FileTree, type FileTreeMarkers } from "./FileTree";

const slug = (p: string) => encodeURIComponent(p);
/** DOM id of a diff line's number cell — the target for scroll-to-line. */
const lineDomId = (path: string, side: "LEFT" | "RIGHT", num: number) =>
  `dl-${slug(path)}-${side}-${num}`;
const fileDomId = (path: string) => `df-${slug(path)}`;

export interface DiffAnchor {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  node: ReactNode;
  /** github = synced/on GitHub; local = app-only, not (yet) on GitHub */
  tone?: "github" | "local";
  /** resolved/handled — still rendered, but prev/next nav skips it */
  resolved?: boolean;
}

interface DragState {
  path: string;
  side: "LEFT" | "RIGHT";
  anchor: number;
  current: number;
}

type ViewMode = "unified" | "split";

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
  titleBar,
  viewedKey,
  remoteViewed,
  renderCommentForm,
}: {
  files: FileDiff[];
  selectable?: boolean;
  anchors?: DiffAnchor[];
  titleBar?: ReactNode;
  /** local "viewed" checkboxes; state persists under this key (own drafts) */
  viewedKey?: string;
  /** GitHub-backed viewed state (teammate reviews) — syncs with github.com */
  remoteViewed?: { map: Record<string, string>; toggle: (path: string, viewed: boolean) => void };
  renderCommentForm?: (sel: LineSelection, close: () => void) => ReactNode;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [sel, setSel] = useState<LineSelection | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // ---- per-file "viewed" state (path → content hash, persisted) ----
  // keyed by a hash of the file's diff so a file that changes after being
  // marked comes back as unviewed, GitHub-style
  const [viewed, setViewed] = useState<Record<string, string>>(() => {
    if (!viewedKey) return {};
    try {
      return JSON.parse(localStorage.getItem(viewedKey) ?? "{}");
    } catch {
      return {};
    }
  });
  const setFileViewed = (path: string, hash: string | null) => {
    setViewed((v) => {
      const next = { ...v };
      if (hash) next[path] = hash;
      else delete next[path];
      if (viewedKey) localStorage.setItem(viewedKey, JSON.stringify(next));
      return next;
    });
  };
  const viewedEnabled = !!viewedKey || !!remoteViewed;
  // remote mode: GitHub owns invalidation (DISMISSED on change); local mode:
  // the content hash plays that role
  const isViewedPath = (path: string) =>
    remoteViewed
      ? remoteViewed.map[path] === "VIEWED"
      : !!viewedKey && viewed[path] === fileHashes.get(path);
  const toggleViewed = (path: string, hash: string, next: boolean) => {
    if (remoteViewed) remoteViewed.toggle(path, next);
    else setFileViewed(path, next ? hash : null);
    setCollapsed((c) => ({ ...c, [path]: next }));
  };
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

  const fileMarkers = useMemo(() => {
    const next: FileTreeMarkers = {};
    for (const a of anchors) {
      if (a.resolved) continue;
      if (a.tone !== "github" && a.tone !== "local") continue;
      const marker = next[a.path] ?? { comments: 0, feedback: 0 };
      if (a.tone === "github") marker.comments++;
      else marker.feedback++;
      next[a.path] = marker;
    }
    return next;
  }, [anchors]);

  // cheap content hash per file (djb2 over diff lines) for viewed-tracking
  const fileHashes = useMemo(() => {
    if (!viewedKey) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const f of files) {
      let h = 5381;
      for (const l of f.lines) {
        for (let i = 0; i < l.text.length; i++) h = ((h << 5) + h + l.text.charCodeAt(i)) | 0;
        h = ((h << 5) + h + (l.type === "add" ? 43 : l.type === "del" ? 45 : 32)) | 0;
      }
      map.set(keyOf(f), String(h >>> 0));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, viewedKey]);

  // ---- file tree + scroll spy ----
  const [treeOpen, setTreeOpenState] = useState(() => localStorage.getItem("prc-diff-tree") === "on");
  const setTreeOpen = (v: boolean) => {
    localStorage.setItem("prc-diff-tree", v ? "on" : "off");
    setTreeOpenState(v);
  };
  const fileEls = useRef(new Map<string, HTMLElement>());
  const visibleFiles = useRef(new Set<string>());
  const [activePath, setActivePath] = useState<string | null>(null);
  useEffect(() => {
    visibleFiles.current.clear();
    const order = files.map(keyOf);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = (e.target as HTMLElement).dataset.path;
          if (!p) continue;
          if (e.isIntersecting) visibleFiles.current.add(p);
          else visibleFiles.current.delete(p);
        }
        const first = order.find((p) => visibleFiles.current.has(p));
        if (first) setActivePath(first);
      },
      // a file is "current" while it intersects the upper band of the viewport
      { rootMargin: "-5% 0px -55% 0px" }
    );
    for (const el of fileEls.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [files, mode, hideWs]);

  const jumpToFile = (path: string) => {
    setCollapsed((c) => ({ ...c, [path]: false }));
    requestAnimationFrame(() =>
      document.getElementById(fileDomId(path))?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  };

  // ---- prev/next comment navigation (floats top-right once scrolled) ----
  // "next actionable thing": resolved threads / handled findings are skipped
  const actionable = anchors.filter((a) => !a.resolved).length;
  const rootRef = useRef<HTMLDivElement>(null);
  const [navVisible, setNavVisible] = useState(false);
  useEffect(() => {
    if (actionable === 0) return;
    const scroller = rootRef.current?.closest(".ws-main");
    if (!scroller) return;
    const onScroll = () => setNavVisible(scroller.scrollTop > 180);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [actionable]);

  const navToComment = (dir: 1 | -1) => {
    const root = rootRef.current;
    const scroller = root?.closest(".ws-main");
    if (!root || !scroller) return;
    const rows = Array.from(
      root.querySelectorAll("tr.comment-anchor-row:not(.resolved-anchor)")
    ) as HTMLElement[];
    if (rows.length === 0) return;
    const top = scroller.getBoundingClientRect().top;
    const target =
      dir === 1
        ? rows.find((r) => r.getBoundingClientRect().top > top + 120)
        : [...rows].reverse().find((r) => r.getBoundingClientRect().top < top + 40);
    const el = target ?? (dir === 1 ? rows[rows.length - 1] : rows[0]);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1800);
  };

  // vim-style j/k between actionable comments (ignored while typing)
  const navRef = useRef(navToComment);
  navRef.current = navToComment;
  useEffect(() => {
    if (actionable === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))
        return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        navRef.current(e.key === "j" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [actionable]);

  // Escape cancels an in-progress drag or open selection/composer.
  useEffect(() => {
    if (!sel && !drag) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSel(null);
        setDrag(null);
      }
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [sel, drag]);

  // ---- scroll-to-line requests (activity stream "on file:line" links) ----
  const scrollTarget = useUiStore((s) => s.diffScrollTarget);
  useEffect(() => {
    if (!scrollTarget) return;
    setCollapsed((c) => ({ ...c, [scrollTarget.path]: false }));
    const t = setTimeout(() => {
      const el =
        document.getElementById(lineDomId(scrollTarget.path, scrollTarget.side, scrollTarget.line)) ??
        document.getElementById(fileDomId(scrollTarget.path));
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const row = el.closest("tr") ?? el;
      row.classList.add("flash");
      setTimeout(() => row.classList.remove("flash"), 1800);
    }, 80);
    return () => clearTimeout(t);
  }, [scrollTarget]);

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
            <tr
              key={`a-${e.side}-${e.num}-${j}`}
              className={`comment-anchor-row${a.resolved ? " resolved-anchor" : ""}`}
            >
              <td colSpan={colSpan}>
                <div className={`inline-comment-box ${a.tone ?? ""}`}>{a.node}</div>
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
    <div onMouseLeave={() => drag && setDrag(null)} ref={rootRef}>
      {rawFiles.length > 0 && (
        <div className="diff-title-control-bar">
          {titleBar && <div className="diff-title-control-title">{titleBar}</div>}
          <div className="diff-controls">
            <button className={`small ${treeOpen ? "primary" : ""}`} onClick={() => setTreeOpen(!treeOpen)}>
              ☰ Files
            </button>
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
            {viewedEnabled && (
              <span className="subtle">
                {files.filter((f) => isViewedPath(keyOf(f))).length}/{files.length} viewed
              </span>
            )}
          </div>
          {actionable > 0 && navVisible && (
            <div className="comment-nav diff-action-nav">
              <span className="comment-nav-count">{actionable} actionable</span>
              <button title="Previous (k)" onClick={() => navToComment(-1)}>
                ↑
              </button>
              <button title="Next (j)" onClick={() => navToComment(1)}>
                ↓
              </button>
            </div>
          )}
        </div>
      )}
      <div className="diff-area">
        {treeOpen && (
          <FileTree
            files={files}
            activePath={activePath}
            markers={fileMarkers}
            onClose={() => setTreeOpen(false)}
            onSelect={jumpToFile}
          />
        )}
        <div className="diff-list">
      {files.map((file) => {
        const path = keyOf(file);
        const hash = fileHashes.get(path) ?? "";
        const isViewed = viewedEnabled && isViewedPath(path);
        // viewed files collapse by default; an explicit expand overrides
        // without clearing the viewed mark
        const isCollapsed = collapsed[path] ?? isViewed;
        const wsOnly = hideWs && !file.isBinary && file.lines.every((l) => l.type === "context");
        return (
          <div
            className="diff-file"
            key={path}
            id={fileDomId(path)}
            data-path={path}
            ref={(el) => {
              if (el) fileEls.current.set(path, el);
              else fileEls.current.delete(path);
            }}
          >
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
              {viewedEnabled && (
                <button
                  className={`viewed-toggle-btn ${isViewed ? "on" : ""}`}
                  title="Mark as read — collapses the file; re-expanding keeps it read"
                  onClick={() => toggleViewed(path, hash, !isViewed)}
                >
                  <input type="checkbox" checked={isViewed} readOnly tabIndex={-1} />
                  viewed
                </button>
              )}
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
      </div>
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
  const lang = useMemo(() => langForPath(path), [path]);
  const html = useMemo(() => highlightFileLines(file.lines, lang), [file, lang]);
  return (
    <div className="diff-scroll">
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
              <td
                className="diff-num"
                id={line.oldNum !== null ? lineDomId(path, "LEFT", line.oldNum) : undefined}
                {...handlers}
                title="Click or drag to select lines"
              >
                {line.oldNum ?? ""}
              </td>
              <td
                className="diff-num"
                id={line.newNum !== null ? lineDomId(path, "RIGHT", line.newNum) : undefined}
                {...handlers}
              >
                {line.newNum ?? ""}
              </td>
              <td className="diff-text">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                <span dangerouslySetInnerHTML={{ __html: html.get(line) ?? "" }} />
              </td>
            </tr>,
            ...afterRow(path, [{ side, num }], 3),
          ];
        })}
      </tbody>
    </table>
    </div>
  );
}

function SplitTable({ file, path, numCellHandlers, isHighlighted, afterRow }: TableProps) {
  const rows = useMemo(() => buildSplitRows(file.lines), [file]);
  const lang = useMemo(() => langForPath(path), [path]);
  const html = useMemo(() => highlightFileLines(file.lines, lang), [file, lang]);
  return (
    <div className="diff-scroll">
    <table className="diff-table split">
      {/* width hints for the four columns (first row is a colspan-4 hunk header) */}
      <colgroup>
        <col className="col-num" />
        <col className="col-text" />
        <col className="col-num" />
        <col className="col-text" />
      </colgroup>
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
                id={lNum !== null ? lineDomId(path, "LEFT", lNum) : undefined}
                {...numCellHandlers(path, "LEFT", lNum)}
                title="Click or drag to select lines"
              >
                {lNum ?? ""}
              </td>
              <td className={`diff-text half cell-${lKind} ${lHl ? "cell-sel" : ""}`}>
                {l ? (
                  <>
                    {l.type === "del" ? "-" : " "}
                    <span dangerouslySetInnerHTML={{ __html: html.get(l) ?? "" }} />
                  </>
                ) : (
                  ""
                )}
              </td>
              <td
                className={`diff-num num-${rKind} ${rHl ? "cell-sel" : ""}`}
                id={rNum !== null ? lineDomId(path, "RIGHT", rNum) : undefined}
                {...numCellHandlers(path, "RIGHT", rNum)}
                title="Click or drag to select lines"
              >
                {rNum ?? ""}
              </td>
              <td className={`diff-text half cell-${rKind} ${rHl ? "cell-sel" : ""}`}>
                {r ? (
                  <>
                    {r.type === "add" ? "+" : " "}
                    <span dangerouslySetInnerHTML={{ __html: html.get(r) ?? "" }} />
                  </>
                ) : (
                  ""
                )}
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
    </div>
  );
}
