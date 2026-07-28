// Adapted from amicro (https://github.com/Subhan-code/Amicro--Micro-transitions-), MIT.
// Variant-propagating stagger container + item: children rise in one after
// another on mount; items added later (poll updates) fade in on their own.

import { motion, type Variants } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
};

export function Stagger({
  children,
  className,
  style,
  stagger = 0.045,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  stagger?: number;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <motion.div className={className} style={style} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
