/**
 * CONCEPT, not science output: what a scene might show if an eye could also
 * register ultraviolet and near-infrared light. Used by the enhanced-vision
 * concept view, which is kept apart from every benchmark result.
 *
 * A screen can only emit visible light, so extra bands can only be shown by
 * translating them into visible colours (false colour). The translation used
 * here is stated in BAND_CODES and on the page.
 *
 * The scene is drawn by this code. Its layer values are chosen to illustrate
 * three well-documented effects (many flowers carry ultraviolet patterns that
 * insects see; healthy leaves reflect near-infrared strongly; water absorbs
 * near-infrared). They are illustrative, not measured spectra.
 */

import type { Pixels } from "./retinalImage";

export type SpectralScene = {
  width: number;
  height: number;
  /** Visible appearance, RGBA. */
  rgb: Uint8ClampedArray;
  /** Ultraviolet reflectance, 0–1, illustrative. */
  uv: Float32Array;
  /** Near-infrared reflectance, 0–1, illustrative. */
  nir: Float32Array;
};

export type SpectrumMode = "human" | "uv" | "nir" | "both";

export const BANDS = [
  {
    key: "uv",
    name: "Ultraviolet",
    nm: [300, 380] as const,
    plain:
      "Shorter than violet. Bees and many birds see some of it; in people, the lens filters most of it out.",
  },
  {
    key: "visible",
    name: "Visible light",
    nm: [380, 750] as const,
    plain: "The only part human eyes see, from violet to red.",
  },
  {
    key: "nir",
    name: "Near-infrared",
    nm: [750, 1000] as const,
    plain: "Just beyond red. Night-vision cameras use it; human cones barely respond to it.",
  },
] as const;

/** How each extra band is translated into a colour a screen can show. */
export const BAND_CODES = {
  uv: { colour: [193, 60, 255] as const, text: "Ultraviolet is shown as a violet-pink glow." },
  nir: {
    text: "Near-infrared is shown as red, and real red and green shift down to green and blue, as in false-colour infrared photos.",
  },
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The concept view of a scene in the chosen mode. */
export function composite(scene: SpectralScene, mode: SpectrumMode): Pixels {
  const { width, height, rgb, uv, nir } = scene;
  const out = new Uint8ClampedArray(rgb.length);
  const [ur, ug, ub] = BAND_CODES.uv.colour;
  for (let i = 0, n = width * height; i < n; i++) {
    let r = rgb[i * 4]!;
    let g = rgb[i * 4 + 1]!;
    let b = rgb[i * 4 + 2]!;
    if (mode === "nir" || mode === "both") {
      // False-colour infrared: NIR → red, red → green, green → blue.
      b = g;
      g = r;
      r = nir[i]! * 255;
    }
    if (mode === "uv" || mode === "both") {
      const a = 0.85 * uv[i]!;
      r = mix(r, ur, a);
      g = mix(g, ug, a);
      b = mix(b, ub, a);
    }
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = rgb[i * 4 + 3]!;
  }
  return { width, height, data: out };
}

type Paint = { rgb: [number, number, number]; uv: number; nir: number };

/** One named region of the drawn scene, for the inspector. */
export type Region =
  "sky" | "hills" | "grass" | "pond" | "trunk" | "leaves" | "petal" | "flower centre";

export const REGION_NOTES: Partial<Record<Region, string>> = {
  petal:
    "Petals reflect ultraviolet at their tips but absorb it near the centre: a target pattern insects can see.",
  "flower centre": "The centre absorbs ultraviolet, completing the pattern.",
  leaves: "Healthy leaves reflect near-infrared strongly, so they glow in false-colour infrared.",
  grass: "Grass, like leaves, reflects near-infrared strongly.",
  pond: "Water absorbs near-infrared, so the pond turns almost black in it.",
  sky: "The sky scatters short wavelengths most, so it is bright in ultraviolet.",
};

const FLOWERS: [number, number][] = [
  [0.38, 0.7],
  [0.52, 0.77],
  [0.29, 0.85],
  [0.6, 0.66],
];

/** What is at a point of the drawn scene (u, v in 0–1, v down). */
export function regionAt(u: number, v: number): { region: Region; paint: Paint } {
  for (const [cx, cy] of FLOWERS) {
    const d = Math.hypot(u - cx, (v - cy) * 1.1);
    if (d < 0.013)
      return { region: "flower centre", paint: { rgb: [140, 90, 30], uv: 0.02, nir: 0.4 } };
    if (d < 0.045) {
      // Five petals: a little scalloped at the edge.
      const a = Math.atan2(v - cy, u - cx);
      if (d < 0.045 * (0.78 + 0.22 * Math.abs(Math.cos(2.5 * a))))
        return {
          region: "petal",
          paint: { rgb: [246, 206, 44], uv: d > 0.022 ? 0.9 : 0.04, nir: 0.6 },
        };
    }
  }
  if ((u - 0.18) ** 2 / 0.13 ** 2 + (v - 0.36) ** 2 / 0.11 ** 2 < 1)
    return { region: "leaves", paint: { rgb: [48, 118, 62], uv: 0.04, nir: 0.88 } };
  if (u > 0.165 && u < 0.2 && v > 0.42 && v < 0.62)
    return { region: "trunk", paint: { rgb: [112, 80, 50], uv: 0.05, nir: 0.35 } };
  if ((u - 0.74) ** 2 / 0.2 ** 2 + (v - 0.8) ** 2 / 0.075 ** 2 < 1)
    return { region: "pond", paint: { rgb: [72, 124, 172], uv: 0.28, nir: 0.03 } };
  const hill = 0.43 + 0.045 * Math.sin(u * 7 + 1);
  if (v < hill) {
    const t = v / hill;
    return {
      region: "sky",
      paint: {
        rgb: [mix(118, 205, t), mix(176, 228, t), mix(238, 250, t)],
        uv: mix(0.6, 0.45, t),
        nir: 0.12,
      },
    };
  }
  if (v < 0.53) return { region: "hills", paint: { rgb: [112, 152, 112], uv: 0.1, nir: 0.55 } };
  const jitter = 8 * Math.sin(u * 90) * Math.sin(v * 70);
  return { region: "grass", paint: { rgb: [98 + jitter, 168 + jitter, 78], uv: 0.05, nir: 0.76 } };
}

export function makeConceptScene(size = 256): SpectralScene {
  const rgb = new Uint8ClampedArray(size * size * 4);
  const uv = new Float32Array(size * size);
  const nir = new Float32Array(size * size);
  // Four samples per pixel, averaged, so shape edges are smooth.
  const offsets = [0.25, 0.75];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let u = 0;
      let n = 0;
      for (const oy of offsets)
        for (const ox of offsets) {
          const { paint } = regionAt((x + ox) / size, (y + oy) / size);
          r += paint.rgb[0] / 4;
          g += paint.rgb[1] / 4;
          b += paint.rgb[2] / 4;
          u += paint.uv / 4;
          n += paint.nir / 4;
        }
      const i = y * size + x;
      rgb.set([r, g, b, 255], i * 4);
      uv[i] = u;
      nir[i] = n;
    }
  return { width: size, height: size, rgb, uv, nir };
}
