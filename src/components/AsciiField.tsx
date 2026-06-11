import { useEffect, useRef } from "react";

const CHARS = [" ", " ", ".", ":", "-", "=", "+", "*", "#"];

/**
 * Minimal ASCII flow-field shader: a character grid whose density follows
 * layered sine waves drifting slowly. Canvas-rendered at ~12fps, trivially
 * cheap, acid-green on transparent. Used as ambient texture on empty,
 * loading and waiting states. Always animates — it IS the point (the OS
 * reduced-motion setting only disables decorative CSS loops elsewhere).
 */
export function AsciiField({
  height = 120,
  color = "207, 242, 77",
  opacity = 0.5,
  speed = 1,
}: {
  height?: number;
  color?: string;
  opacity?: number;
  /** drift multiplier — <1 for quiet background use */
  speed?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cell = 14;
    let raf = 0;
    let last = 0;
    let t = Math.random() * 100;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `11px ui-monospace, Menlo, monospace`;
      ctx.textBaseline = "top";
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 83) return; // ~12fps
      last = now;
      t += 0.045 * speed;
      const cols = Math.ceil(canvas.offsetWidth / cell);
      const rows = Math.ceil(height / cell);
      ctx.clearRect(0, 0, canvas.offsetWidth, height);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v =
            Math.sin(x * 0.23 + t) * Math.sin(y * 0.31 - t * 0.6) +
            Math.sin((x + y) * 0.12 + t * 0.4) +
            Math.sin(Math.hypot(x - cols / 2, y - rows / 2) * 0.35 - t * 0.8);
          const n = Math.max(0, Math.min(0.999, (v + 3) / 6));
          const ch = CHARS[Math.floor(n * CHARS.length)];
          if (ch === " ") continue;
          ctx.fillStyle = `rgba(${color}, ${(0.12 + n * 0.5) * opacity})`;
          ctx.fillText(ch, x * cell, y * cell);
        }
      }
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [height, color, opacity, speed]);

  return <canvas ref={ref} style={{ width: "100%", height, display: "block" }} aria-hidden />;
}
