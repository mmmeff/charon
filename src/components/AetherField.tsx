import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

const TARGET_FRAME_MS = 1000 / 16;
const MIN_PIXEL_SIZE = 3;
const MAX_LOGICAL_PIXELS = 24_000;
const NOISE_SIZE = 128;
const NOISE_MASK = NOISE_SIZE - 1;

const BAYER_4 = new Uint8Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

const PALETTE = [
  [5, 6, 7, 0],
  [7, 15, 39, 92],
  [12, 42, 110, 148],
  [33, 109, 255, 210],
  [117, 182, 255, 224],
  [255, 87, 77, 242],
  [255, 201, 92, 255],
] as const;

function makeNoise(): Float32Array {
  let state = 0x6d2b79f5;
  const noise = new Float32Array(NOISE_SIZE * NOISE_SIZE);

  for (let index = 0; index < noise.length; index += 1) {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    noise[index] = ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  }

  return noise;
}

const NOISE = makeNoise();

function interpolate(a: number, b: number, amount: number): number {
  const smoothed = amount * amount * (3 - 2 * amount);
  return a + (b - a) * smoothed;
}

function sampleNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const left = x0 & NOISE_MASK;
  const right = (x0 + 1) & NOISE_MASK;
  const top = y0 & NOISE_MASK;
  const bottom = (y0 + 1) & NOISE_MASK;
  const upper = interpolate(
    NOISE[top * NOISE_SIZE + left],
    NOISE[top * NOISE_SIZE + right],
    tx,
  );
  const lower = interpolate(
    NOISE[bottom * NOISE_SIZE + left],
    NOISE[bottom * NOISE_SIZE + right],
    tx,
  );

  return interpolate(upper, lower, ty);
}

function fbm(x: number, y: number): number {
  return (
    sampleNoise(x, y) * 0.57
    + sampleNoise(x * 2.03 + 19.1, y * 2.03 - 7.7) * 0.29
    + sampleNoise(x * 4.07 - 11.4, y * 4.07 + 23.8) * 0.14
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function writeColor(
  pixels: Uint8ClampedArray,
  offset: number,
  color: (typeof PALETTE)[number],
): void {
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

type FieldState = {
  context: CanvasRenderingContext2D;
  image: ImageData;
  width: number;
  height: number;
};

function renderField(field: FieldState, time: number, seed: number): void {
  const { context, image, width, height } = field;
  const pixels = image.data;
  const scale = 3.35 / Math.max(height, 1);
  const seedX = seed * 0.071;
  const seedY = seed * -0.053;

  for (let y = 0; y < height; y += 1) {
    const baseY = y * scale + seedY;

    for (let x = 0; x < width; x += 1) {
      const baseX = x * scale + seedX;
      const warpX = sampleNoise(
        baseX * 0.66 + time * 0.035,
        baseY * 0.66 - time * 0.023,
      ) - 0.5;
      const warpY = sampleNoise(
        baseX * 0.66 - 31.7 - time * 0.019,
        baseY * 0.66 + 17.9 + time * 0.03,
      ) - 0.5;
      const warpedX = baseX + warpX * 2.25;
      const warpedY = baseY + warpY * 2.25;
      const cloud = fbm(warpedX * 0.86 + time * 0.052, warpedY * 0.86 - time * 0.031);
      const ridgeNoise = fbm(warpedX * 1.31 - time * 0.044, warpedY * 1.31 + time * 0.026);
      const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
      const shimmer = 0.5 + Math.sin(
        warpedX * 2.2 + warpedY * 0.62 + warpY * 4.8 - time * 0.62,
      ) * 0.5;
      const energy = clamp((cloud * 0.5 + ridge * 0.38 + shimmer * 0.12 - 0.54) / 0.36, 0, 1);
      const scaled = energy * (PALETTE.length - 1);
      const lower = Math.floor(scaled);
      const fraction = scaled - lower;
      const threshold = (BAYER_4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const paletteIndex = Math.min(
        PALETTE.length - 1,
        lower + (fraction > threshold ? 1 : 0),
      );

      writeColor(pixels, (y * width + x) * 4, PALETTE[paletteIndex]);
    }
  }

  context.putImageData(image, 0, 0);
}

export function AetherField({
  seed = 0,
  active = true,
}: {
  seed?: number;
  active?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  const scheduleRef = useRef<() => void>(() => undefined);
  const stopRef = useRef<() => void>(() => undefined);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    let animationFrame = 0;
    let field: FieldState | undefined;
    let inViewport = true;
    let lastFrameAt = Number.NEGATIVE_INFINITY;

    const draw = (time: number) => {
      if (!field) return;
      renderField(field, time, seed);
    };

    const resize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;

      const pixelSize = Math.max(
        MIN_PIXEL_SIZE,
        Math.ceil(Math.sqrt((width * height) / MAX_LOGICAL_PIXELS)),
      );
      const logicalWidth = Math.max(1, Math.ceil(width / pixelSize));
      const logicalHeight = Math.max(1, Math.ceil(height / pixelSize));

      if (
        field
        && canvas.width === logicalWidth
        && canvas.height === logicalHeight
      ) {
        return;
      }

      canvas.width = logicalWidth;
      canvas.height = logicalHeight;
      canvas.dataset.pixelSize = String(pixelSize);
      field = {
        context,
        image: context.createImageData(logicalWidth, logicalHeight),
        width: logicalWidth,
        height: logicalHeight,
      };
      draw(reducedMotion ? 17.4 : performance.now() / 1000);
      schedule();
    };

    const schedule = () => {
      if (
        animationFrame
        || reducedMotion
        || !activeRef.current
        || !field
        || !inViewport
        || document.hidden
      ) {
        return;
      }
      animationFrame = requestAnimationFrame(animate);
    };

    const animate = (now: number) => {
      animationFrame = 0;
      if (
        reducedMotion
        || !activeRef.current
        || !inViewport
        || document.hidden
      ) {
        return;
      }

      if (now - lastFrameAt >= TARGET_FRAME_MS) {
        lastFrameAt = now;
        draw(now / 1000);
      }
      schedule();
    };
    const stop = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry?.isIntersecting ?? false;
      if (inViewport) schedule();
    });
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      resize(entry.contentRect.width, entry.contentRect.height);
    });
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      schedule();
    };

    scheduleRef.current = schedule;
    stopRef.current = stop;
    const bounds = canvas.getBoundingClientRect();
    resize(bounds.width, bounds.height);
    visibilityObserver.observe(canvas);
    resizeObserver.observe(canvas);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    schedule();

    return () => {
      stop();
      visibilityObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      scheduleRef.current = () => undefined;
      stopRef.current = () => undefined;
    };
  }, [reducedMotion, seed]);

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      scheduleRef.current();
      return;
    }
    stopRef.current();
  }, [active]);

  return (
    <div className="aether-field" aria-hidden>
      <canvas
        ref={canvasRef}
        className="aether-field-canvas"
        data-motion={reducedMotion || !active ? "still" : "live"}
      />
    </div>
  );
}
