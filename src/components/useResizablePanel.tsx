import { useRef, useState } from "react";

/**
 * Drag-to-resize for side panels. `edge` is where the handle sits on the
 * panel: "right" for a left-docked panel (drag right = wider), "left" for a
 * right-docked panel (drag left = wider). Width persists per storage key.
 * Own module (hook-only) so component files keep Fast Refresh-safe exports.
 */
export function useResizablePanel(
  storageKey: string,
  def: number,
  min: number,
  max: number,
  edge: "left" | "right"
) {
  const clamp = (w: number) => Math.min(max, Math.max(min, w));
  const [width, setWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(storageKey) ?? "", 10);
    return clamp(Number.isFinite(saved) ? saved : def);
  });
  const widthRef = useRef(width);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const w = clamp(edge === "right" ? startW + delta : startW - delta);
      widthRef.current = w;
      setWidth(w);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(false);
      localStorage.setItem(storageKey, String(widthRef.current));
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const handle = (
    <div
      className={`resize-handle handle-${edge} ${dragging ? "active" : ""}`}
      onMouseDown={onMouseDown}
      title="Drag to resize"
    />
  );

  return { width, handle };
}
