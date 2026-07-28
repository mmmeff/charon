// Adapted from amicro's scale-in (https://github.com/Subhan-code/Amicro--Micro-transitions-), MIT.
// Spring-driven via the shared presets instead of a fixed duration.

import { motion } from "motion/react";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { presets } from "./presets";

interface ScaleInProps {
  children: ReactNode;
  from?: number;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
}

export function ScaleIn({ children, from = 0.92, delay = 0, className, style, onMouseDown }: ScaleInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: from }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...presets.snappy, delay }}
      className={className}
      style={style}
      onMouseDown={onMouseDown}
    >
      {children}
    </motion.div>
  );
}
