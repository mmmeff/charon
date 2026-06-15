import { type ReactNode } from "react";
import { useUiStore } from "../lib/store";
import { useResizablePanel } from "./useResizablePanel";

/** The PR-list sidebar used by Drafts / Open / Review — one shared width. */
export function Sidebar({ children }: { children: ReactNode }) {
  const { width, handle } = useResizablePanel("prc-w-sidebar", 340, 230, 600, "right");
  const open = useUiStore((s) => s.prSidebarOpen);
  if (!open) return null;
  return (
    <div className="sidebar" style={{ width, minWidth: width }}>
      {children}
      {handle}
    </div>
  );
}
