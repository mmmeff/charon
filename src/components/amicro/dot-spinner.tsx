// Adapted from amicro's dot-spinner (https://github.com/Subhan-code/Amicro--Micro-transitions-), MIT.
// Tailwind classes rewritten as inline styles; framer-motion swapped for motion/react.

import { motion, useReducedMotion } from "motion/react";

const DOT_COUNT = 8;
const DURATION = 0.9;

/**
 * Inline loading spinner: eight dots chasing a fade around a circle.
 * Sized to sit in text flow like the old `.spin` CSS square; inherits the
 * surrounding text color unless told otherwise.
 */
export function DotSpinner({ size = 10, color = "currentColor" }: { size?: number; color?: string }) {
 const reduce = useReducedMotion();
 const dot = Math.max(1.5, Math.round(size * 0.22 * 2) / 2);
 return (
  <span
   aria-hidden
   style={{
    position: "relative",
    display: "inline-block",
    width: size,
    height: size,
    verticalAlign: "-0.12em",
    flex: "none",
   }}
  >
   {Array.from({ length: DOT_COUNT }, (_, i) => (
    <motion.span
     key={i}
     style={{
      position: "absolute",
      top: 0,
      left: "50%",
      width: dot,
      height: dot,
      marginLeft: -dot / 2,
      borderRadius: "50%",
      background: color,
      rotate: (i * 360) / DOT_COUNT,
      transformOrigin: `${dot / 2}px ${size / 2}px`,
     }}
     animate={reduce ? undefined : { opacity: [1, 0.15] }}
     transition={{ duration: DURATION, repeat: Infinity, delay: (i * DURATION) / DOT_COUNT, ease: "linear" }}
    />
   ))}
  </span>
 );
}
