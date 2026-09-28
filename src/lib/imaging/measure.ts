/**
 * Calibrated measurements. Every input is a patient-space point in mm, so a
 * result does not depend on zoom, pan, interpolation mode or screen size — the
 * canvas is only where the points were picked.
 */

import { distance, dot, PLANE_AXES, type Plane } from "./geometry";
import { reslice } from "./reslice";
import type { ImageVolume, Vec3 } from "./types";

export function lengthMm(a: Vec3, b: Vec3): number {
  return distance(a, b);
}

/** Polygon area on a view plane (shoelace formula in plane coordinates). */
export function polygonAreaMm2(points: Vec3[], plane: Plane): number {
  const { right, down } = PLANE_AXES[plane];
  const uv = points.map((p) => [dot(p, right), dot(p, down)] as const);
  let s = 0;
  for (let i = 0; i < uv.length; i++) {
    const [x0, y0] = uv[i]!;
    const [x1, y1] = uv[(i + 1) % uv.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

/** Axis-aligned ellipse on a view plane, from two opposite corners of its box. */
export function ellipseAreaMm2(a: Vec3, b: Vec3, plane: Plane): number {
  const { right, down } = PLANE_AXES[plane];
  const w = Math.abs(dot(a, right) - dot(b, right));
  const h = Math.abs(dot(a, down) - dot(b, down));
  return Math.PI * (w / 2) * (h / 2);
}

export type RoiStats = { n: number; mean: number; sd: number; min: number; max: number };

/**
 * Value statistics inside an ellipse ROI, sampled on a fixed grid at half the
 * finest voxel spacing with nearest-neighbour lookup — independent of the
 * current zoom, and made only of real voxel values.
 */
export function ellipseStats(vol: ImageVolume, plane: Plane, a: Vec3, b: Vec3): RoiStats {
  const { right, down } = PLANE_AXES[plane];
  const step = Math.min(...vol.spacing) / 2;
  const x0 = Math.min(dot(a, right), dot(b, right));
  const x1 = Math.max(dot(a, right), dot(b, right));
  const y0 = Math.min(dot(a, down), dot(b, down));
  const y1 = Math.max(dot(a, down), dot(b, down));
  const w = Math.max(1, Math.ceil((x1 - x0) / step));
  const h = Math.max(1, Math.ceil((y1 - y0) / step));
  // A view centred on the box, one sample per grid step.
  const centre: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const values = reslice(
    vol,
    { plane, focal: centre, mmPerPixel: step, pan: [0, 0] },
    w,
    h,
    "nearest",
  );
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  let n = 0;
  let sum = 0;
  let sq = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = (x + 0.5 - w / 2) * step;
      const py = (y + 0.5 - h / 2) * step;
      if (rx > 0 && ry > 0 && (px * px) / (rx * rx) + (py * py) / (ry * ry) > 1) continue;
      const v = values[y * w + x]!;
      if (Number.isNaN(v)) continue;
      n++;
      sum += v;
      sq += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const mean = n ? sum / n : Number.NaN;
  return {
    n,
    mean,
    sd: n > 1 ? Math.sqrt(Math.max(0, (sq - n * mean * mean) / (n - 1))) : Number.NaN,
    min,
    max,
  };
}
