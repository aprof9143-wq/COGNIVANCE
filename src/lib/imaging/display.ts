/**
 * Display stage: modality values on a reslice → screen RGBA.
 *
 *   value → VOI (window) → [display enhancements] → MONOCHROME1 inversion → grey
 *
 * Enhancements operate on the windowed display image only. They never touch a
 * source value, the probe, a measurement or an export's numbers, and all of
 * them are off by default. None is generative: each is a fixed, local,
 * reversible filter (gamma, unsharp mask, local-contrast unsharp, bilateral).
 */

import { presentation, voi } from "./voi";
import type { SegmentClass, VoiFunction } from "./types";

export type Enhancement = {
  /** Output = input^gamma. 1 = off. */
  gamma: number;
  /** Unsharp mask amount, radius 1 px. 0 = off. */
  sharpen: number;
  /** Large-radius unsharp mask (local contrast), radius 8 px. 0 = off. */
  localContrast: number;
  /** Bilateral (edge-preserving) smoothing strength 0–1. 0 = off. */
  denoise: number;
};

export const NO_ENHANCEMENT: Enhancement = { gamma: 1, sharpen: 0, localContrast: 0, denoise: 0 };

export const enhancementActive = (e: Enhancement) =>
  e.gamma !== 1 || e.sharpen > 0 || e.localContrast > 0 || e.denoise > 0;

/** Window a reslice to display values in [0, 1]; NaN (no data) stays NaN. */
export function windowed(
  values: Float32Array,
  center: number,
  width: number,
  fn: VoiFunction,
  out = new Float32Array(values.length),
) {
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    out[i] = Number.isNaN(v) ? Number.NaN : voi(v, center, width, fn);
  }
  return out;
}

/** Separable box blur on a [0,1] image, ignoring NaN (no-data) pixels. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        const v = src[y * w + xx]!;
        if (Number.isNaN(v)) continue;
        s += v;
        n++;
      }
      tmp[y * w + x] = n ? s / n : Number.NaN;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        const v = tmp[yy * w + x]!;
        if (Number.isNaN(v)) continue;
        s += v;
        n++;
      }
      out[y * w + x] = n ? s / n : Number.NaN;
    }
  }
  return out;
}

function bilateral(src: Float32Array, w: number, h: number, strength: number): Float32Array {
  const out = new Float32Array(src.length);
  const r = 2;
  const sigmaS = 1.5;
  const sigmaR = 0.02 + 0.13 * strength;
  const spatial: number[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = src[y * w + x]!;
      if (Number.isNaN(c)) {
        out[y * w + x] = c;
        continue;
      }
      let s = 0;
      let n = 0;
      let k = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++, k++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const v = src[yy * w + xx]!;
          if (Number.isNaN(v)) continue;
          const d = v - c;
          const wt = spatial[k]! * Math.exp(-(d * d) / (2 * sigmaR * sigmaR));
          s += v * wt;
          n += wt;
        }
      }
      // Blend toward the filtered value by strength: mild at low settings.
      out[y * w + x] = c + (s / n - c) * Math.min(1, strength);
    }
  }
  return out;
}

/** Apply display enhancements to a windowed [0,1] image. Returns a new array. */
export function enhance(img: Float32Array, w: number, h: number, e: Enhancement): Float32Array {
  let cur = img;
  if (e.denoise > 0) cur = bilateral(cur, w, h, e.denoise);
  if (e.localContrast > 0) {
    const blur = boxBlur(cur, w, h, 8);
    const next = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) next[i] = cur[i]! + e.localContrast * (cur[i]! - blur[i]!);
    cur = next;
  }
  if (e.sharpen > 0) {
    const blur = boxBlur(cur, w, h, 1);
    const next = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) next[i] = cur[i]! + e.sharpen * (cur[i]! - blur[i]!);
    cur = next;
  }
  if (e.gamma !== 1) {
    const next = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++)
      next[i] = Math.pow(Math.min(1, Math.max(0, cur[i]!)), e.gamma);
    cur = next;
  }
  if (cur === img) return img;
  for (let i = 0; i < cur.length; i++)
    if (!Number.isNaN(cur[i]!)) cur[i] = Math.min(1, Math.max(0, cur[i]!));
  return cur;
}

export type OverlayStyle = { opacity: number; outline: boolean };

/**
 * Compose the final RGBA. `split` (0–1) shows `original` left of that fraction
 * of the width and `enhanced` to the right — the before/after comparison.
 */
export function toRgba(
  original: Float32Array,
  enhanced: Float32Array | null,
  w: number,
  h: number,
  photometric: "MONOCHROME1" | "MONOCHROME2",
  rgba: Uint8ClampedArray,
  opts: {
    split?: number | null | undefined;
    labels?: Uint16Array | null | undefined;
    classes?: SegmentClass[] | undefined;
    hidden?: Set<number> | undefined;
    overlay?: OverlayStyle | undefined;
  } = {},
) {
  const splitX =
    opts.split !== null && opts.split !== undefined && enhanced
      ? Math.round(opts.split * w)
      : enhanced
        ? 0
        : w;
  const colour = new Map<number, [number, number, number]>();
  for (const c of opts.classes ?? []) if (!opts.hidden?.has(c.label)) colour.set(c.label, c.colour);
  const labels = opts.labels;
  const ov = opts.overlay ?? { opacity: 0.3, outline: true };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const src = x < splitX ? original : enhanced!;
      const v = src[i]!;
      let r: number;
      let g: number;
      let b: number;
      if (Number.isNaN(v)) {
        r = g = b = 0;
      } else {
        r = g = b = Math.round(presentation(v, photometric) * 255);
      }
      if (labels) {
        const l = labels[i]!;
        const c = l ? colour.get(l) : undefined;
        if (c) {
          const edge =
            (x > 0 && labels[i - 1] !== l) ||
            (x < w - 1 && labels[i + 1] !== l) ||
            (y > 0 && labels[i - w] !== l) ||
            (y < h - 1 && labels[i + w] !== l);
          const a = edge && ov.outline ? 1 : ov.opacity;
          r = r * (1 - a) + c[0] * a;
          g = g * (1 - a) + c[1] * a;
          b = b * (1 - a) + c[2] * a;
        }
      }
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
}
