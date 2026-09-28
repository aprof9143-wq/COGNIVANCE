/**
 * Segmentation measurements and alignment.
 *
 * Volume = voxel count × voxel volume, where the voxel volume is |det| of the
 * segmentation's own affine — computed at the segmentation's native grid, never
 * after resampling for display. A label map holds one label per voxel, so its
 * classes are mutually exclusive and their volumes add up without overlap.
 */

import { apply, voxelVolumeMm3, worldBounds } from "./geometry";
import type { ImageVolume, SegmentationVolume, Vec3 } from "./types";

export type ClassVolume = { label: number; name: string; voxels: number; mm3: number; mL: number };

export function classVolumes(seg: SegmentationVolume): ClassVolume[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < seg.labels.length; i++) {
    const l = seg.labels[i]!;
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const v = voxelVolumeMm3(seg.ijkToLps);
  return seg.classes.map((c) => {
    const voxels = counts.get(c.label) ?? 0;
    return { label: c.label, name: c.name, voxels, mm3: voxels * v, mL: (voxels * v) / 1000 };
  });
}

/** Centroid of one label, in patient space. */
export function classCentroid(seg: SegmentationVolume, label: number): Vec3 | null {
  const [nx, ny] = seg.dims;
  let n = 0;
  let si = 0;
  let sj = 0;
  let sk = 0;
  for (let idx = 0; idx < seg.labels.length; idx++) {
    if (seg.labels[idx] !== label) continue;
    const i = idx % nx;
    const j = Math.floor(idx / nx) % ny;
    const k = Math.floor(idx / (nx * ny));
    si += i;
    sj += j;
    sk += k;
    n++;
  }
  return n ? apply(seg.ijkToLps, [si / n, sj / n, sk / n]) : null;
}

export type Alignment =
  | { status: "same-grid" }
  | { status: "different-grid"; overlap: number }
  | { status: "no-overlap" };

/**
 * How a segmentation relates to an image. Same grid: shown voxel for voxel.
 * Different grid but overlapping in patient space: resampled
 * nearest-neighbour for display (volumes still come from the native grid).
 * No overlap: a registration failure — not displayed.
 */
export function alignment(seg: SegmentationVolume, img: ImageVolume, tolMm = 0.01): Alignment {
  const same =
    seg.dims.every((d, i) => d === img.dims[i]) &&
    seg.ijkToLps.every((v, i) => Math.abs(v - img.ijkToLps[i]!) <= tolMm);
  if (same) return { status: "same-grid" };
  const a = worldBounds(seg.ijkToLps, seg.dims);
  const b = worldBounds(img.ijkToLps, img.dims);
  let inter = 1;
  let own = 1;
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(a.min[i]!, b.min[i]!);
    const hi = Math.min(a.max[i]!, b.max[i]!);
    inter *= Math.max(0, hi - lo);
    own *= Math.max(1e-6, a.max[i]! - a.min[i]!);
  }
  const overlap = inter / own;
  return overlap > 0.05 ? { status: "different-grid", overlap } : { status: "no-overlap" };
}
