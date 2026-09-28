/**
 * Perceptually uniform, colour-vision-deficiency-friendly maps for quantitative
 * overlays. Anatomy itself stays grayscale.
 *
 * Viridis control points from matplotlib's viridis (van der Walt & Smith),
 * sampled at 11 stops and linearly interpolated in sRGB.
 */

const VIRIDIS: [number, number, number][] = [
  [0.267, 0.005, 0.329],
  [0.283, 0.141, 0.458],
  [0.254, 0.265, 0.53],
  [0.207, 0.372, 0.553],
  [0.164, 0.471, 0.558],
  [0.128, 0.567, 0.551],
  [0.135, 0.659, 0.518],
  [0.267, 0.749, 0.441],
  [0.478, 0.821, 0.318],
  [0.741, 0.873, 0.15],
  [0.993, 0.906, 0.144],
];

function sample(stops: [number, number, number][], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const viridis = (t: number) => sample(VIRIDIS, t);

export const toCss = ([r, g, b]: [number, number, number]) =>
  `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

/** CSS gradient for a legend bar. */
export const viridisGradient = () =>
  `linear-gradient(90deg, ${VIRIDIS.map((c, i) => `${toCss(c)} ${(i / (VIRIDIS.length - 1)) * 100}%`).join(", ")})`;

/**
 * Diverging blue ↔ red with a neutral grey midpoint (dark-surface steps of the
 * validated reference palette), for signed quantities such as z-scores or
 * percentage change. t in [−1, 1]; 0 is "no difference" and reads as grey,
 * never as a hue.
 */
export function diverging(t: number): [number, number, number] {
  const x = Math.max(-1, Math.min(1, Number.isFinite(t) ? t : 0));
  const neutral: [number, number, number] = [0x38 / 255, 0x38 / 255, 0x35 / 255];
  const neg: [number, number, number] = [0x39 / 255, 0x87 / 255, 0xe5 / 255];
  const pos: [number, number, number] = [0xe6 / 255, 0x67 / 255, 0x67 / 255];
  const end = x < 0 ? neg : pos;
  const f = Math.abs(x);
  return [
    neutral[0] + (end[0] - neutral[0]) * f,
    neutral[1] + (end[1] - neutral[1]) * f,
    neutral[2] + (end[2] - neutral[2]) * f,
  ];
}

/** Chart series colours (dark-surface categorical slots 1–3, validated). */
export const SERIES = { left: "#3987e5", right: "#d95926", third: "#199e70" } as const;
