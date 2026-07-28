// Adapted from amicro's fade-in (https://github.com/Subhan-code/Amicro--Micro-transitions-), MIT.

import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

interface FadeInProps {
  children: ReactNode;
  duration?: number;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}

export function FadeIn({ children, duration = 0.5, delay = 0, className, style }: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        duration,
        delay,
        ease: [0.215, 0.61, 0.355, 1], // easeOutCubic
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
