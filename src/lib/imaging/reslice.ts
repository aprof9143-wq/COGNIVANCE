/**
 * Multiplanar reconstruction: sample the source volume on a plane in patient
 * space. Each canvas pixel's centre is mapped to world, then to voxel indices,
 * and the source is sampled there — nothing is stretched from another image.
 *
 * "nearest" returns exact source voxel values (the raw-pixels mode); "linear"
 * is trilinear interpolation for smoother zoomed display. Pixels outside the
 * volume are NaN, so the display can distinguish "no data" from "value 0".
 */

import { apply, applyLinear, canvasToWorld, PLANE_AXES, type ViewState } from "./geometry";
import type { ImageVolume, Interpolation, SegmentationVolume, Vec3 } from "./types";

/** Modality value at a voxel index (applies the stored rescale). */
export function voxelValue(
  vol: Pick<ImageVolume, "data" | "valueScale" | "dims">,
  i: number,
  j: number,
  k: number,
): number {
  const [nx, ny, nz] = vol.dims;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return Number.NaN;
  const raw = vol.data[i + nx * (j + ny * k)]!;
  return vol.valueScale ? raw * vol.valueScale.slope + vol.valueScale.intercept : raw;
}

/** Modality value at a world point: nearest voxel, or NaN outside the volume. */
export function valueAtWorld(vol: ImageVolume, p: Vec3): { value: number; ijk: Vec3 } {
  const f = apply(vol.lpsToIjk, p);
  const ijk: Vec3 = [Math.round(f[0]), Math.round(f[1]), Math.round(f[2])];
  return { value: voxelValue(vol, ijk[0], ijk[1], ijk[2]), ijk };
}

export function reslice(
  vol: ImageVolume,
  view: ViewState,
  width: number,
  height: number,
  interpolation: Interpolation,
  out: Float32Array = new Float32Array(width * height),
): Float32Array {
  const { right, down } = PLANE_AXES[view.plane];
  const origin = canvasToWorld(view, width, height, 0.5, 0.5);
  const o = apply(vol.lpsToIjk, origin);
  const du = applyLinear(vol.lpsToIjk, [
    right[0] * view.mmPerPixel,
    right[1] * view.mmPerPixel,
    right[2] * view.mmPerPixel,
  ]);
  const dv = applyLinear(vol.lpsToIjk, [
    down[0] * view.mmPerPixel,
    down[1] * view.mmPerPixel,
    down[2] * view.mmPerPixel,
  ]);
  const [nx, ny, nz] = vol.dims;
  const nxy = nx * ny;
  const data = vol.data;
  const slope = vol.valueScale?.slope ?? 1;
  const intercept = vol.valueScale?.intercept ?? 0;

  for (let y = 0; y < height; y++) {
    let fi = o[0] + dv[0] * y;
    let fj = o[1] + dv[1] * y;
    let fk = o[2] + dv[2] * y;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let v = Number.NaN;
      if (interpolation === "nearest") {
        const i = Math.round(fi);
        const j = Math.round(fj);
        const k = Math.round(fk);
        if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz)
          v = data[i + nx * j + nxy * k]! * slope + intercept;
      } else if (
        fi > -0.5 &&
        fj > -0.5 &&
        fk > -0.5 &&
        fi < nx - 0.5 &&
        fj < ny - 0.5 &&
        fk < nz - 0.5
      ) {
        // Trilinear, clamped at the edges so the outermost half-voxel keeps
        // its own value instead of blending with "outside".
        const ci = Math.min(nx - 1, Math.max(0, fi));
        const cj = Math.min(ny - 1, Math.max(0, fj));
        const ck = Math.min(nz - 1, Math.max(0, fk));
        const i0 = Math.floor(ci);
        const j0 = Math.floor(cj);
        const k0 = Math.floor(ck);
        const i1 = Math.min(nx - 1, i0 + 1);
        const j1 = Math.min(ny - 1, j0 + 1);
        const k1 = Math.min(nz - 1, k0 + 1);
        const ti = ci - i0;
        const tj = cj - j0;
        const tk = ck - k0;
        const a = i0 + nx * j0;
        const b = i1 + nx * j0;
        const c = i0 + nx * j1;
        const d = i1 + nx * j1;
        const z0 = nxy * k0;
        const z1 = nxy * k1;
        const c00 = data[a + z0]! * (1 - ti) + data[b + z0]! * ti;
        const c10 = data[c + z0]! * (1 - ti) + data[d + z0]! * ti;
        const c01 = data[a + z1]! * (1 - ti) + data[b + z1]! * ti;
        const c11 = data[c + z1]! * (1 - ti) + data[d + z1]! * ti;
        const c0 = c00 * (1 - tj) + c10 * tj;
        const c1 = c01 * (1 - tj) + c11 * tj;
        v = (c0 * (1 - tk) + c1 * tk) * slope + intercept;
      }
      out[row + x] = v;
      fi += du[0];
      fj += du[1];
      fk += du[2];
    }
  }
  return out;
}

/**
 * Reslice a label map onto the same view, always nearest-neighbour: blending
 * integer labels would invent classes that are not in the data. Works when the
 * segmentation is on a different grid from the image — both are placed through
 * their own patient-space affines.
 */
export function resliceLabels(
  seg: SegmentationVolume,
  view: ViewState,
  width: number,
  height: number,
  out: Uint16Array = new Uint16Array(width * height),
): Uint16Array {
  const { right, down } = PLANE_AXES[view.plane];
  const o = apply(seg.lpsToIjk, canvasToWorld(view, width, height, 0.5, 0.5));
  const du = applyLinear(seg.lpsToIjk, [
    right[0] * view.mmPerPixel,
    right[1] * view.mmPerPixel,
    right[2] * view.mmPerPixel,
  ]);
  const dv = applyLinear(seg.lpsToIjk, [
    down[0] * view.mmPerPixel,
    down[1] * view.mmPerPixel,
    down[2] * view.mmPerPixel,
  ]);
  const [nx, ny, nz] = seg.dims;
  for (let y = 0; y < height; y++) {
    let fi = o[0] + dv[0] * y;
    let fj = o[1] + dv[1] * y;
    let fk = o[2] + dv[2] * y;
    for (let x = 0; x < width; x++) {
      const i = Math.round(fi);
      const j = Math.round(fj);
      const k = Math.round(fk);
      out[y * width + x] =
        i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz
          ? seg.labels[i + nx * (j + ny * k)]!
          : 0;
      fi += du[0];
      fj += du[1];
      fk += du[2];
    }
  }
  return out;
}
