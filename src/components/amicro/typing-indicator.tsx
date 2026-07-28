// Adapted from amicro's typing-indicator (https://github.com/Subhan-code/Amicro--Micro-transitions-), MIT.
// Chrome removed for inline use: transparent background, CSS-var dot color.

import { motion, useReducedMotion } from "motion/react";

/** Three gently bouncing dots — softer than a spinner for "thinking" states. */
export function TypingIndicator({ dot = 4, color = "var(--fg-subtle)" }: { dot?: number; color?: string }) {
  const reduce = useReducedMotion();
  return (
    <span aria-hidden style={{ display: "inline-flex", alignItems: "center", gap: dot * 0.75, flex: "none" }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          style={{ width: dot, height: dot, borderRadius: "50%", background: color }}
          animate={reduce ? undefined : { y: [0, -dot * 0.8, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}
