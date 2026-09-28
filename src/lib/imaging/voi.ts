/**
 * Grayscale pipeline: modality LUT → VOI LUT → presentation (MONOCHROME1).
 *
 * Follows DICOM PS3.3 C.11.2.1.2 for the VOI LUT functions. Every function here
 * maps values to display grey levels; none of them alters a source value.
 */

import type { ImageVolume, VoiFunction, VoiWindow } from "./types";

/** Modality LUT as a linear rescale (PS3.3 C.11.1): out = stored × slope + intercept. */
export function modalityValue(stored: number, slope: number, intercept: number): number {
  return stored * slope + intercept;
}

/**
 * VOI LUT function (PS3.3 C.11.2.1.2), mapping a modality value to [0, 1].
 *
 * LINEAR (the default when Window Center/Width are present):
 *   x ≤ c − 0.5 − (w − 1)/2        → 0
 *   x > c − 0.5 + (w − 1)/2        → 1
 *   else ((x − (c − 0.5)) / (w − 1) + 0.5)
 *   Width must be ≥ 1.
 * LINEAR_EXACT: the same without the half-unit offsets; width > 0.
 * SIGMOID: 1 / (1 + exp(−4 (x − c) / w)).
 */
export function voi(x: number, center: number, width: number, fn: VoiFunction = "LINEAR"): number {
  if (fn === "SIGMOID") {
    const w = Math.max(width, Number.EPSILON);
    return 1 / (1 + Math.exp((-4 * (x - center)) / w));
  }
  if (fn === "LINEAR_EXACT") {
    const w = Math.max(width, Number.EPSILON);
    if (x <= center - w / 2) return 0;
    if (x > center + w / 2) return 1;
    return (x - center) / w + 0.5;
  }
  const w = Math.max(1, width);
  const lo = center - 0.5 - (w - 1) / 2;
  const hi = center - 0.5 + (w - 1) / 2;
  if (x <= lo) return 0;
  if (x > hi) return 1;
  if (w === 1) return 1;
  return (x - (center - 0.5)) / (w - 1) + 0.5;
}

/** MONOCHROME1 displays the minimum value as white: invert after VOI. */
export function presentation(y: number, photometric: "MONOCHROME1" | "MONOCHROME2"): number {
  return photometric === "MONOCHROME1" ? 1 - y : y;
}

/** Full grayscale pipeline for one modality value, to an 8-bit grey level. */
export function greyLevel(
  modality: number,
  win: Pick<VoiWindow, "center" | "width">,
  fn: VoiFunction,
  photometric: "MONOCHROME1" | "MONOCHROME2",
): number {
  return Math.round(presentation(voi(modality, win.center, win.width, fn), photometric) * 255);
}

/* ------------------------------------------------------------ histogram */

export type Histogram = {
  min: number;
  max: number;
  bins: Uint32Array;
  binWidth: number;
  total: number;
  /** Value at the given cumulative fraction, e.g. 0.005. */
  quantile: (q: number) => number;
};

/** Histogram of modality values, sampled with a stride for large volumes. */
export function histogram(
  vol: Pick<ImageVolume, "data" | "valueScale" | "range">,
  binCount = 256,
): Histogram {
  const { min, max } = vol.range;
  const bins = new Uint32Array(binCount);
  const span = max - min || 1;
  const binWidth = span / binCount;
  const n = vol.data.length;
  const stride = Math.max(1, Math.floor(n / 2_000_000));
  const s = vol.valueScale;
  let total = 0;
  for (let i = 0; i < n; i += stride) {
    const raw = vol.data[i]!;
    const v = s ? raw * s.slope + s.intercept : raw;
    if (!Number.isFinite(v)) continue;
    const b = Math.min(binCount - 1, Math.max(0, Math.floor((v - min) / binWidth)));
    bins[b]!++;
    total++;
  }
  const cumulative = new Float64Array(binCount);
  let acc = 0;
  for (let b = 0; b < binCount; b++) {
    acc += bins[b]!;
    cumulative[b] = acc;
  }
  return {
    min,
    max,
    bins,
    binWidth,
    total,
    quantile: (q) => {
      const target = q * total;
      for (let b = 0; b < binCount; b++)
        if (cumulative[b]! >= target) return min + (b + 0.5) * binWidth;
      return max;
    },
  };
}

/** Share of values the window renders fully black or fully white. */
export function clippedFractions(h: Histogram, win: Pick<VoiWindow, "center" | "width">) {
  const lo = win.center - win.width / 2;
  const hi = win.center + win.width / 2;
  let below = 0;
  let above = 0;
  for (let b = 0; b < h.bins.length; b++) {
    const v = h.min + (b + 0.5) * h.binWidth;
    if (v < lo) below += h.bins[b]!;
    else if (v > hi) above += h.bins[b]!;
  }
  return { below: h.total ? below / h.total : 0, above: h.total ? above / h.total : 0 };
}

/* ------------------------------------------------------------ presets */

/**
 * CT presets, in HU. Commonly published values (e.g. Radiopaedia, "Windowing
 * (CT)"); local protocols differ, so each is labelled a preset, not a standard.
 * Offered only when the volume is calibrated CT.
 */
export const CT_PRESETS: VoiWindow[] = [
  { label: "Brain", center: 40, width: 80, source: "preset" },
  { label: "Subdural", center: 75, width: 215, source: "preset" },
  { label: "Stroke", center: 32, width: 8, source: "preset" },
  { label: "Soft tissue", center: 50, width: 350, source: "preset" },
  { label: "Bone", center: 600, width: 2800, source: "preset" },
];

/**
 * Windows to offer for a volume. MR signal intensity has no absolute scale, so
 * no fixed MR presets exist: only the file's own windows and data-derived ones.
 * The sequence is never guessed from the image.
 */
export function windowOptions(vol: ImageVolume, h: Histogram): VoiWindow[] {
  const out: VoiWindow[] = [...vol.windows];
  if (vol.quantitative && vol.unit === "HU") out.push(...CT_PRESETS);
  const lo = h.quantile(0.005);
  const hi = h.quantile(0.995);
  out.push({
    label: "Auto (0.5–99.5 %)",
    center: (lo + hi) / 2,
    width: Math.max(1, hi - lo),
    source: "auto",
  });
  out.push({
    label: "Full range",
    center: (vol.range.min + vol.range.max) / 2,
    width: Math.max(1, vol.range.max - vol.range.min),
    source: "auto",
  });
  return out;
}

/** The window shown first: the file's own if it has one, otherwise auto. */
export function defaultWindow(vol: ImageVolume, h: Histogram): VoiWindow {
  return vol.windows[0] ?? windowOptions(vol, h).find((w) => w.source === "auto")!;
}
