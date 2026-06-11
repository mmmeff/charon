import { useMemo } from "react";
import type { FileDiff } from "../types";
import { useResizablePanel } from "./Panels";

interface TreeNode {
  name: string;
  path: string; // full path for files, prefix for dirs
  file?: FileDiff;
  children: TreeNode[];
}

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
  onClose,
  onSelect,
}: {
  files: FileDiff[];
  activePath: string | null;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const { width, handle } = useResizablePanel("prc-w-filetree", 248, 170, 520, "right");

  const renderNode = (node: TreeNode, depth: number) => {
    if (node.file) {
      const { adds, dels } = counts(node.file);
      const active = activePath === node.path;
      return (
        <div
          key={node.path}
          className={`ft-file ${active ? "active" : ""}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          title={node.path}
          onClick={() => onSelect(node.path)}
        >
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
