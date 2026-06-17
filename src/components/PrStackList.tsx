import type { CSSProperties, ReactNode } from "react";
import type { PrStackRenderItem } from "../lib/pr-stacks";

export function PrStackCard({
  item,
  selected,
  onClick,
  children,
}: {
  item: PrStackRenderItem;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        "card selectable pr-stack-card",
        selected ? "selected" : "",
        item.parentVisible ? "stack-child" : "",
        item.hasVisibleChildren ? "stack-parent" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--stack-depth": Math.min(item.depth, 6) } as CSSProperties}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
