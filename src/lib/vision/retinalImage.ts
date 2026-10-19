/**
 * Turning a scene into the optical image on the retina, as far as this model
 * goes: the image is inverted, and blurred by the spot size the ray trace
 * computes. Blur is approximated by a Gaussian (three box passes) whose RMS
 * radius matches the computed spot.
 *
 * Not modelled: the eye's real (aspheric) aberrations, chromatic aberration,
 * scatter, the photoreceptor mosaic, and everything the brain does afterwards.
 * The result is an optical image, not what a person perceives.
 */

export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/** The scene covers this much of the visual field, degrees, edge to edge. */
export const SCENE_FIELD_DEG = 10;

/** Rotate 180°: the eye's optics form an upside-down, left-right reversed image. */
export function invert(img: Pixels): Pixels {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0, n = w * h; i < n; i++) {
    const j = n - 1 - i;
    out[j * 4] = data[i * 4]!;
    out[j * 4 + 1] = data[i * 4 + 1]!;
    out[j * 4 + 2] = data[i * 4 + 2]!;
    out[j * 4 + 3] = data[i * 4 + 3]!;
  }
  return { width: w, height: h, data: out };
}

/** Box radius whose three-pass blur has (approximately) this Gaussian sigma. */
export function boxRadiusForSigma(sigmaPx: number): number {
  if (!(sigmaPx > 0)) return 0;
  return Math.max(0, Math.round((Math.sqrt(4 * sigmaPx * sigmaPx + 1) - 1) / 2));
}

function boxPass(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const win = 2 * r + 1;
  for (let line = 0; line < lines; line++) {
    for (let c = 0; c < 4; c++) {
      const at = (k: number) => {
        const kk = Math.min(len - 1, Math.max(0, k));
        return horizontal ? (line * w + kk) * 4 + c : (kk * w + line) * 4 + c;
      };
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[at(k)]!;
      for (let k = 0; k < len; k++) {
        dst[at(k)] = acc / win;
        acc += src[at(k + r + 1)]! - src[at(k - r)]!;
      }
    }
  }
}

/** Gaussian-like blur with the given sigma, in pixels. Edges are clamped. */
export function blur(img: Pixels, sigmaPx: number): Pixels {
  const r = boxRadiusForSigma(sigmaPx);
  if (r === 0) return { ...img, data: new Uint8ClampedArray(img.data) };
  const { width: w, height: h } = img;
  const a = Float32Array.from(img.data);
  const b = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, w, h, r, true);
    boxPass(b, a, w, h, r, false);
  }
  return { width: w, height: h, data: Uint8ClampedArray.from(a, (v) => Math.round(v)) };
}

/**
 * Blur sigma in pixels for a spot of this RMS diameter (µm on the retina).
 * A 2D Gaussian's RMS radius is sigma·√2.
 */
export function sigmaPx(rmsDiameterUm: number, mmPerDegree: number, widthPx: number): number {
  const deg = rmsDiameterUm / 1000 / mmPerDegree;
  const px = (deg / SCENE_FIELD_DEG) * widthPx;
  return px / 2 / Math.SQRT2;
}

/** Where a scene pixel lands on the retina, relative to the fovea. */
export function retinalPosition(x: number, y: number, widthPx: number, mmPerDegree: number) {
  const degX = ((x + 0.5) / widthPx - 0.5) * SCENE_FIELD_DEG;
  const degY = (0.5 - (y + 0.5) / widthPx) * SCENE_FIELD_DEG;
  return { degX, degY, mmX: -degX * mmPerDegree, mmY: -degY * mmPerDegree };
}
