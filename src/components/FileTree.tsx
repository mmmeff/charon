import { useMemo } from "react";
import type { FileDiff } from "../types";
import { IconAgent, IconComment } from "./icons";
import { useResizablePanel } from "./useResizablePanel";

interface TreeNode {
  name: string;
  path: string; // full path for files, prefix for dirs
  file?: FileDiff;
  children: TreeNode[];
}

export interface FileTreeMarkerState {
  comments: number;
  feedback: number;
}

export type FileTreeMarkers = Record<string, FileTreeMarkerState>;

function buildTree(files: FileDiff[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const f of files) {
    const full = f.newPath || f.oldPath;
    const parts = full.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1;
      const name = parts[i];
      let child = node.children.find((c) => c.name === name && !!c.file === isLeaf);
      if (!child) {
        child = { name, path: parts.slice(0, i + 1).join("/"), children: [] };
        if (isLeaf) child.file = f;
        node.children.push(child);
      }
      node = child;
    }
  }
  // compress single-child directory chains (a/b/c style, like GitHub)
  const compress = (node: TreeNode): TreeNode => {
    while (!node.file && node.children.length === 1 && !node.children[0].file) {
      const only = node.children[0];
      node = { ...only, name: node.name ? `${node.name}/${only.name}` : only.name };
    }
    return { ...node, children: node.children.map(compress) };
  };
  return root.children.map(compress);
}

const counts = (f: FileDiff) => {
  let adds = 0;
  let dels = 0;
  for (const l of f.lines) {
    if (l.type === "add") adds++;
    else if (l.type === "del") dels++;
  }
  return { adds, dels };
};

/**
 * File navigator docked left of the diff list (the diff shrinks to make
 * room). Highlights the file currently in view; clicking jumps to it.
 */
export function FileTree({
  files,
  activePath,
  markers = {},
  onClose,
  onSelect,
}: {
  files: FileDiff[];
  activePath: string | null;
  markers?: FileTreeMarkers;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const { width, handle } = useResizablePanel("prc-w-filetree", 248, 170, 520, "right");

  const renderNode = (node: TreeNode, depth: number) => {
    if (node.file) {
      const { adds, dels } = counts(node.file);
      const active = activePath === node.path;
      const marker = markers[node.path];
      const markerTitle = marker
        ? [
            marker.comments
              ? `${marker.comments} GitHub comment${marker.comments === 1 ? "" : "s"}`
              : "",
            marker.feedback
              ? `${marker.feedback} local review feedback item${marker.feedback === 1 ? "" : "s"}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
      return (
        <div
          key={node.path}
          className={`ft-file ${active ? "active" : ""}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          title={node.path}
          onClick={() => onSelect(node.path)}
        >
          {markerTitle && (
            <span
              className={`ft-markers ${marker.comments && marker.feedback ? "dual" : ""}`}
              style={{ left: 10 + depth * 14 - 16 }}
              title={markerTitle}
              aria-label={markerTitle}
            >
              {marker.comments > 0 && (
                <span className="ft-marker comment" aria-hidden="true">
                  <IconComment />
                </span>
              )}
              {marker.feedback > 0 && (
                <span className="ft-marker feedback" aria-hidden="true">
                  <IconAgent />
                </span>
              )}
            </span>
          )}
          <span className="ft-name">{node.name}</span>
          <span className="ft-counts">
            {node.file.isDeleted ? (
              <span style={{ color: "var(--red)" }}>deleted</span>
            ) : (
              <>
                {adds > 0 && <span style={{ color: "var(--green)" }}>+{adds}</span>}{" "}
                {dels > 0 && <span style={{ color: "var(--red)" }}>−{dels}</span>}
              </>
            )}
          </span>
        </div>
      );
    }
    return (
      <div key={`d-${node.path}-${node.name}`}>
        <div className="ft-dir" style={{ paddingLeft: 10 + depth * 14 }}>
          {node.name}/
        </div>
        {node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="filetree" style={{ width }}>
      {handle}
      <div className="filetree-inner">
        <div className="row between" style={{ marginBottom: 6, paddingLeft: 10 }}>
          <strong style={{ fontSize: 12.5 }}>{files.length} files changed</strong>
          <button className="link small" onClick={onClose}>
            ✕
          </button>
        </div>
        {tree.map((n) => renderNode(n, 0))}
      </div>
    </div>
  );
}
