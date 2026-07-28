// Adapted from amicro's fade-up (https://github.com/Subhan-code/Amicro--Micro-transitions-), MIT.

import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

interface FadeUpProps {
  children: ReactNode;
  duration?: number;
  delay?: number;
  yOffset?: number;
  className?: string;
  style?: CSSProperties;
}

export function FadeUp({ children, duration = 0.6, delay = 0, yOffset = 20, className, style }: FadeUpProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: yOffset }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1], // easeOutExpo
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
