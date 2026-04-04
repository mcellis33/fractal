// Runs in a Web Worker — no DOM access
import type { WorkerRequest, FractalParams } from './types';

// Use 'any' cast to avoid lib conflict between DOM and WebWorker typings.
// At runtime this file executes inside DedicatedWorkerGlobalScope.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = self as any;

// ── Color helpers ────────────────────────────────────────────────────────────

/** Returns [hue 0–360, saturation 0–100] from a CSS hex color string. */
function hexToHsl(hex: string): [number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return [h * 360, s * 100];
}

/** Converts HSL (h 0–360, s 0–100, l 0–100) to RGB (0–255 each). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360; s /= 100; l /= 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const hue2rgb = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}

// ── Smooth (continuous) iteration count ──────────────────────────────────────

/**
 * Converts a raw escape iteration count + final |z|² into a smooth float
 * using the normalized iteration count formula:
 *   smooth = iter - log₂(log₂(|z|))
 *
 * Requires |z| > 1 at escape, which is always true for bailout ≥ 2.
 * Falls back to the raw count when the condition is not met.
 */
function toSmoothIter(absZ2: number, iter: number): number {
  const logZ = Math.log(absZ2) * 0.5; // log(|z|)
  if (logZ > 0) {
    const nu = Math.log(logZ / Math.LN2) / Math.LN2; // log₂(log₂(|z|))
    return Math.max(0, iter - nu);
  }
  return iter;
}

// ── Fractal iteration loops ───────────────────────────────────────────────────

/**
 * Returns the smooth escape iteration count for the Mandelbrot set,
 * or -1 if the point did not escape within maxIter iterations.
 */
function computeMandelbrot(
  cRe: number, cIm: number,
  maxIter: number, bailout2: number,
): number {
  // Fast membership test: cardioid + period-2 bulb
  const q = (cRe - 0.25) * (cRe - 0.25) + cIm * cIm;
  if (q * (q + (cRe - 0.25)) <= 0.25 * cIm * cIm) return -1;
  if ((cRe + 1) * (cRe + 1) + cIm * cIm <= 0.0625) return -1;

  let zRe = 0, zIm = 0, zRe2 = 0, zIm2 = 0;

  for (let i = 0; i < maxIter; i++) {
    // z = z² + c  (computed in-place without a temp variable)
    zIm  = 2 * zRe * zIm + cIm;
    zRe  = zRe2 - zIm2 + cRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;

    if (zRe2 + zIm2 > bailout2) {
      return toSmoothIter(zRe2 + zIm2, i + 1);
    }
  }
  return -1;
}

/**
 * Returns the smooth escape iteration count for a Julia set with constant c,
 * or -1 if the point did not escape.
 */
function computeJulia(
  zRe: number, zIm: number,
  cRe: number, cIm: number,
  maxIter: number, bailout2: number,
): number {
  let zRe2 = zRe * zRe, zIm2 = zIm * zIm;

  for (let i = 0; i < maxIter; i++) {
    zIm  = 2 * zRe * zIm + cIm;
    zRe  = zRe2 - zIm2 + cRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;

    if (zRe2 + zIm2 > bailout2) {
      return toSmoothIter(zRe2 + zIm2, i + 1);
    }
  }
  return -1;
}

// ── Color mapping ─────────────────────────────────────────────────────────────

/**
 * Maps a smooth iteration count to an RGB color.
 *
 * Uses a cosine-based cycling function so adjacent escape-speed bands get
 * smoothly varying lightness while the hue stays fixed at the user's chosen
 * base color.  One full lightness cycle spans every 20 iterations.
 */
function iterToRgb(
  si: number,
  baseHue: number,
  baseSat: number,
): [number, number, number] {
  const t = (si * 0.05) % 1.0;                          // cycle every 20 iters
  const l = 10 + 80 * (0.5 + 0.5 * Math.cos(2 * Math.PI * t)); // 10–90 %
  const s = Math.max(baseSat, 60);                       // keep saturation vivid
  return hslToRgb(baseHue, s, l);
}

// ── Main render loop ──────────────────────────────────────────────────────────

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type !== 'render') return;

  const p: FractalParams = e.data.params;
  const { width, height, maxIterations, bailout, zoom,
          centerRe, centerIm, baseColor, type, juliaRe, juliaIm } = p;

  const bailout2 = bailout * bailout;
  const [baseHue, baseSat] = hexToHsl(baseColor);

  // pixels-per-unit: how many canvas pixels represent one unit of the complex plane
  const baseUnitsWide = type === 'mandelbrot' ? 3.5 : 4.0;
  const ppu = (width / baseUnitsWide) * zoom;

  const data = new Uint8ClampedArray(width * height * 4);

  for (let py = 0; py < height; py++) {
    const im = centerIm + (height / 2 - py) / ppu;

    for (let px = 0; px < width; px++) {
      const re = centerRe + (px - width / 2) / ppu;

      const si =
        type === 'mandelbrot'
          ? computeMandelbrot(re, im, maxIterations, bailout2)
          : computeJulia(re, im, juliaRe, juliaIm, maxIterations, bailout2);

      const idx = (py * width + px) * 4;

      if (si < 0) {
        // Inside the set: black (r/g/b already 0 in a zeroed Uint8ClampedArray)
        data[idx + 3] = 255;
      } else {
        const [r, g, b] = iterToRgb(si, baseHue, baseSat);
        data[idx]     = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    // Send progress update ~20 times across the full height
    if (py % Math.max(1, Math.floor(height / 20)) === 0) {
      ctx.postMessage({ type: 'progress', progress: py / height });
    }
  }

  // Transfer ownership of the buffer to avoid copying
  const buffer = data.buffer;
  ctx.postMessage({ type: 'done', buffer, width, height }, [buffer]);
};
