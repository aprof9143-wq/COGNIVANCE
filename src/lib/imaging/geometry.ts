/**
 * Patient-space geometry.
 *
 * COORDINATE SYSTEM (used everywhere in src/lib/imaging):
 *   World = DICOM patient coordinates, LPS, millimetres.
 *     +x  toward the patient's Left
 *     +y  toward the patient's Posterior
 *     +z  toward the patient's Superior (head)
 *   Voxel = (i, j, k), i fastest in memory. For DICOM, i runs along a row
 *   (the first Image Orientation Patient vector), j down the columns (the
 *   second vector), k across slices in the order they were sorted.
 *
 *   world = ijkToLps · [i j k 1]ᵀ      voxel = lpsToIjk · [x y z 1]ᵀ
 *
 * NIfTI stores RAS (+x Right, +y Anterior); it is converted to LPS on load by
 * negating the first two rows of its affine. Nothing downstream ever sees RAS.
 *
 * DISPLAY CONVENTION: radiological. Axial and coronal views put the patient's
 * left on the screen's right. Every view carries its own screen axes as world
 * vectors, and the orientation markers are computed from those vectors — they
 * are never hard-coded.
 */

import type { Mat4, Vec3 } from "./types";

/* ------------------------------------------------------------ vectors */

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
export const distance = (a: Vec3, b: Vec3) => norm(sub(a, b));

/* ------------------------------------------------------------ matrices */

export function mat4(values: number[]): Mat4 {
  if (values.length !== 16) throw new Error("mat4 needs 16 values");
  return Float64Array.from(values);
}

export function identity(): Mat4 {
  return mat4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      o[r * 4 + c] = s;
    }
  }
  return o;
}

/** General 4×4 inverse (cofactor expansion). Throws on a singular matrix. */
export function invert(m: Mat4): Mat4 {
  const a = m;
  const inv = new Float64Array(16);
  inv[0] =
    a[5]! * a[10]! * a[15]! -
    a[5]! * a[11]! * a[14]! -
    a[9]! * a[6]! * a[15]! +
    a[9]! * a[7]! * a[14]! +
    a[13]! * a[6]! * a[11]! -
    a[13]! * a[7]! * a[10]!;
  inv[4] =
    -a[4]! * a[10]! * a[15]! +
    a[4]! * a[11]! * a[14]! +
    a[8]! * a[6]! * a[15]! -
    a[8]! * a[7]! * a[14]! -
    a[12]! * a[6]! * a[11]! +
    a[12]! * a[7]! * a[10]!;
  inv[8] =
    a[4]! * a[9]! * a[15]! -
    a[4]! * a[11]! * a[13]! -
    a[8]! * a[5]! * a[15]! +
    a[8]! * a[7]! * a[13]! +
    a[12]! * a[5]! * a[11]! -
    a[12]! * a[7]! * a[9]!;
  inv[12] =
    -a[4]! * a[9]! * a[14]! +
    a[4]! * a[10]! * a[13]! +
    a[8]! * a[5]! * a[14]! -
    a[8]! * a[6]! * a[13]! -
    a[12]! * a[5]! * a[10]! +
    a[12]! * a[6]! * a[9]!;
  inv[1] =
    -a[1]! * a[10]! * a[15]! +
    a[1]! * a[11]! * a[14]! +
    a[9]! * a[2]! * a[15]! -
    a[9]! * a[3]! * a[14]! -
    a[13]! * a[2]! * a[11]! +
    a[13]! * a[3]! * a[10]!;
  inv[5] =
    a[0]! * a[10]! * a[15]! -
    a[0]! * a[11]! * a[14]! -
    a[8]! * a[2]! * a[15]! +
    a[8]! * a[3]! * a[14]! +
    a[12]! * a[2]! * a[11]! -
    a[12]! * a[3]! * a[10]!;
  inv[9] =
    -a[0]! * a[9]! * a[15]! +
    a[0]! * a[11]! * a[13]! +
    a[8]! * a[1]! * a[15]! -
    a[8]! * a[3]! * a[13]! -
    a[12]! * a[1]! * a[11]! +
    a[12]! * a[3]! * a[9]!;
  inv[13] =
    a[0]! * a[9]! * a[14]! -
    a[0]! * a[10]! * a[13]! -
    a[8]! * a[1]! * a[14]! +
    a[8]! * a[2]! * a[13]! +
    a[12]! * a[1]! * a[10]! -
    a[12]! * a[2]! * a[9]!;
  inv[2] =
    a[1]! * a[6]! * a[15]! -
    a[1]! * a[7]! * a[14]! -
    a[5]! * a[2]! * a[15]! +
    a[5]! * a[3]! * a[14]! +
    a[13]! * a[2]! * a[7]! -
    a[13]! * a[3]! * a[6]!;
  inv[6] =
    -a[0]! * a[6]! * a[15]! +
    a[0]! * a[7]! * a[14]! +
    a[4]! * a[2]! * a[15]! -
    a[4]! * a[3]! * a[14]! -
    a[12]! * a[2]! * a[7]! +
    a[12]! * a[3]! * a[6]!;
  inv[10] =
    a[0]! * a[5]! * a[15]! -
    a[0]! * a[7]! * a[13]! -
    a[4]! * a[1]! * a[15]! +
    a[4]! * a[3]! * a[13]! +
    a[12]! * a[1]! * a[7]! -
    a[12]! * a[3]! * a[5]!;
  inv[14] =
    -a[0]! * a[5]! * a[14]! +
    a[0]! * a[6]! * a[13]! +
    a[4]! * a[1]! * a[14]! -
    a[4]! * a[2]! * a[13]! -
    a[12]! * a[1]! * a[6]! +
    a[12]! * a[2]! * a[5]!;
  inv[3] =
    -a[1]! * a[6]! * a[11]! +
    a[1]! * a[7]! * a[10]! +
    a[5]! * a[2]! * a[11]! -
    a[5]! * a[3]! * a[10]! -
    a[9]! * a[2]! * a[7]! +
    a[9]! * a[3]! * a[6]!;
  inv[7] =
    a[0]! * a[6]! * a[11]! -
    a[0]! * a[7]! * a[10]! -
    a[4]! * a[2]! * a[11]! +
    a[4]! * a[3]! * a[10]! +
    a[8]! * a[2]! * a[7]! -
    a[8]! * a[3]! * a[6]!;
  inv[11] =
    -a[0]! * a[5]! * a[11]! +
    a[0]! * a[7]! * a[9]! +
    a[4]! * a[1]! * a[11]! -
    a[4]! * a[3]! * a[9]! -
    a[8]! * a[1]! * a[7]! +
    a[8]! * a[3]! * a[5]!;
  inv[15] =
    a[0]! * a[5]! * a[10]! -
    a[0]! * a[6]! * a[9]! -
    a[4]! * a[1]! * a[10]! +
    a[4]! * a[2]! * a[9]! +
    a[8]! * a[1]! * a[6]! -
    a[8]! * a[2]! * a[5]!;
  const det = a[0]! * inv[0]! + a[1]! * inv[4]! + a[2]! * inv[8]! + a[3]! * inv[12]!;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
    throw new Error("Singular affine: the volume has no valid geometry.");
  for (let i = 0; i < 16; i++) inv[i]! /= det;
  return inv;
}

export function apply(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!,
    m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!,
    m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!,
  ];
}

/** Apply only the linear part (for direction vectors). */
export function applyLinear(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[4]! * v[0] + m[5]! * v[1] + m[6]! * v[2],
    m[8]! * v[0] + m[9]! * v[1] + m[10]! * v[2],
  ];
}

/** Column `c` of the linear part: the world step for one voxel along axis c. */
export function axisVector(m: Mat4, c: 0 | 1 | 2): Vec3 {
  return [m[c]!, m[4 + c]!, m[8 + c]!];
}

/** Volume of one voxel in mm³: |det| of the linear part. */
export function voxelVolumeMm3(m: Mat4): number {
  const a = axisVector(m, 0);
  const b = axisVector(m, 1);
  const c = axisVector(m, 2);
  return Math.abs(dot(a, cross(b, c)));
}

/* --------------------------------------------------------- constructors */

/**
 * DICOM image-plane geometry (PS3.3 C.7.6.2):
 *   world = IPP + i·Δcol·rowDir + j·Δrow·colDir + k·sliceStep
 * where Image Orientation Patient = [rowDir, colDir] and Pixel Spacing =
 * [Δrow (between rows), Δcol (between columns)].
 */
export function affineFromDicom(
  ipp: Vec3,
  iop: [number, number, number, number, number, number],
  pixelSpacing: [number, number],
  sliceStep: Vec3,
): Mat4 {
  const rowDir: Vec3 = [iop[0], iop[1], iop[2]];
  const colDir: Vec3 = [iop[3], iop[4], iop[5]];
  const [dRow, dCol] = pixelSpacing;
  const ci = scale(rowDir, dCol);
  const cj = scale(colDir, dRow);
  return mat4([
    ci[0],
    cj[0],
    sliceStep[0],
    ipp[0],
    ci[1],
    cj[1],
    sliceStep[1],
    ipp[1],
    ci[2],
    cj[2],
    sliceStep[2],
    ipp[2],
    0,
    0,
    0,
    1,
  ]);
}

/** Convert a NIfTI RAS affine (row-major) to LPS. */
export function rasToLps(m: Mat4): Mat4 {
  const o = Float64Array.from(m);
  for (let c = 0; c < 4; c++) {
    o[c] = -o[c]!;
    o[4 + c] = -o[4 + c]!;
  }
  return o;
}

/** NIfTI quaternion (qform) to a RAS affine, per the NIfTI-1 specification. */
export function affineFromQuaternion(
  b: number,
  c: number,
  d: number,
  qx: number,
  qy: number,
  qz: number,
  pixdim: Vec3,
  qfac: number,
): Mat4 {
  const a = Math.sqrt(Math.max(0, 1 - (b * b + c * c + d * d)));
  const R = [
    a * a + b * b - c * c - d * d,
    2 * (b * c - a * d),
    2 * (b * d + a * c),
    2 * (b * c + a * d),
    a * a + c * c - b * b - d * d,
    2 * (c * d - a * b),
    2 * (b * d - a * c),
    2 * (c * d + a * b),
    a * a + d * d - c * c - b * b,
  ];
  const q = qfac < 0 ? -1 : 1;
  const [sx, sy, sz] = pixdim;
  return mat4([
    R[0]! * sx,
    R[1]! * sy,
    R[2]! * sz * q,
    qx,
    R[3]! * sx,
    R[4]! * sy,
    R[5]! * sz * q,
    qy,
    R[6]! * sx,
    R[7]! * sy,
    R[8]! * sz * q,
    qz,
    0,
    0,
    0,
    1,
  ]);
}

/* ------------------------------------------------------------ orientation */

/**
 * Anatomical label for a world direction, the way DICOM viewers write them:
 * the dominant axis first, then any other axis carrying a meaningful share
 * (oblique directions get two or three letters, e.g. "LP").
 */
export function orientationLabel(v: Vec3, threshold = 0.25): string {
  const letters: [number, string][] = [
    [v[0], v[0] >= 0 ? "L" : "R"],
    [v[1], v[1] >= 0 ? "P" : "A"],
    [v[2], v[2] >= 0 ? "S" : "I"],
  ];
  const n = norm(v) || 1;
  return letters
    .map(([c, l]) => [Math.abs(c) / n, l] as const)
    .filter(([m]) => m > threshold)
    .sort((x, y) => y[0] - x[0])
    .map(([, l]) => l)
    .join("");
}

/** Which patient plane a slice with this normal lies in. */
export function planeFromNormal(
  n: Vec3,
  tolerance = 0.9,
): "axial" | "coronal" | "sagittal" | "oblique" {
  const u = normalize(n).map(Math.abs) as Vec3;
  if (u[2] >= tolerance) return "axial";
  if (u[1] >= tolerance) return "coronal";
  if (u[0] >= tolerance) return "sagittal";
  return "oblique";
}

/* ------------------------------------------------------------ views */

export type Plane = "axial" | "coronal" | "sagittal";

/**
 * Screen axes for each plane, as world (LPS) unit vectors.
 * right: the world direction pointing to the screen's right.
 * down:  the world direction pointing to the screen's bottom.
 * Radiological convention: patient Left on screen right for axial/coronal;
 * anterior on screen left for sagittal.
 */
export const PLANE_AXES: Record<Plane, { right: Vec3; down: Vec3; normal: Vec3 }> = {
  axial: { right: [1, 0, 0], down: [0, 1, 0], normal: [0, 0, 1] },
  coronal: { right: [1, 0, 0], down: [0, 0, -1], normal: [0, 1, 0] },
  sagittal: { right: [0, 1, 0], down: [0, 0, -1], normal: [1, 0, 0] },
};

/** The four screen-edge labels for a view: [top, right, bottom, left]. */
export function edgeLabels(right: Vec3, down: Vec3): [string, string, string, string] {
  return [
    orientationLabel(scale(down, -1)),
    orientationLabel(right),
    orientationLabel(down),
    orientationLabel(scale(right, -1)),
  ];
}

/** World-space bounding box of a volume's voxel centres. */
export function worldBounds(ijkToLps: Mat4, dims: Vec3): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const i of [0, dims[0] - 1]) {
    for (const j of [0, dims[1] - 1]) {
      for (const k of [0, dims[2] - 1]) {
        const p = apply(ijkToLps, [i, j, k]);
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a]!, p[a]!);
          max[a] = Math.max(max[a]!, p[a]!);
        }
      }
    }
  }
  return { min, max };
}

/** World-space centre of the volume. */
export function volumeCentre(ijkToLps: Mat4, dims: Vec3): Vec3 {
  return apply(ijkToLps, [(dims[0] - 1) / 2, (dims[1] - 1) / 2, (dims[2] - 1) / 2]);
}

/**
 * Slice geometry along a plane normal: the step between reformatted slices is
 * the voxel spacing along the most-aligned voxel axis, and the slice range is
 * the volume's extent projected onto the normal.
 */
export function sliceGeometry(ijkToLps: Mat4, dims: Vec3, normal: Vec3) {
  let best = 0;
  let step = 1;
  for (const c of [0, 1, 2] as const) {
    const a = axisVector(ijkToLps, c);
    const align = Math.abs(dot(normalize(a), normal));
    if (align > best) {
      best = align;
      step = norm(a) * align;
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of [0, dims[0] - 1]) {
    for (const j of [0, dims[1] - 1]) {
      for (const k of [0, dims[2] - 1]) {
        const t = dot(apply(ijkToLps, [i, j, k]), normal);
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    }
  }
  const count = Math.max(1, Math.round((hi - lo) / step) + 1);
  return { step, lo, hi, count };
}

/**
 * A 2D viewport onto the volume. The focal point is a world position on the
 * displayed slice; `mmPerPixel` is the physical size of one screen pixel.
 */
export type ViewState = {
  plane: Plane;
  focal: Vec3;
  mmPerPixel: number;
  /** Screen-pixel pan of the image relative to the canvas centre. */
  pan: [number, number];
};

/** Canvas pixel → world. (0,0) is the canvas's top-left corner. */
export function canvasToWorld(
  view: ViewState,
  width: number,
  height: number,
  u: number,
  v: number,
): Vec3 {
  const { right, down } = PLANE_AXES[view.plane];
  const du = (u - width / 2 - view.pan[0]) * view.mmPerPixel;
  const dv = (v - height / 2 - view.pan[1]) * view.mmPerPixel;
  return add(add(view.focal, scale(right, du)), scale(down, dv));
}

/** World → canvas pixel for a view (the point is projected onto the slice). */
export function worldToCanvas(
  view: ViewState,
  width: number,
  height: number,
  p: Vec3,
): [number, number] {
  const { right, down } = PLANE_AXES[view.plane];
  const d = sub(p, view.focal);
  return [
    dot(d, right) / view.mmPerPixel + width / 2 + view.pan[0],
    dot(d, down) / view.mmPerPixel + height / 2 + view.pan[1],
  ];
}

/**
 * Move a view's slice to pass through `p` without moving its in-plane
 * framing: only the component along the normal changes. This is what keeps
 * the three viewports on one shared crosshair.
 */
export function throughPoint(view: ViewState, p: Vec3): ViewState {
  const { normal } = PLANE_AXES[view.plane];
  const shift = dot(sub(p, view.focal), normal);
  return { ...view, focal: add(view.focal, scale(normal, shift)) };
}

/** mm-per-pixel that fits the volume's in-plane extent into the canvas. */
export function fitMmPerPixel(
  ijkToLps: Mat4,
  dims: Vec3,
  plane: Plane,
  width: number,
  height: number,
  margin = 0.92,
): number {
  const { right, down } = PLANE_AXES[plane];
  let w0 = Infinity,
    w1 = -Infinity,
    h0 = Infinity,
    h1 = -Infinity;
  for (const i of [0, dims[0] - 1]) {
    for (const j of [0, dims[1] - 1]) {
      for (const k of [0, dims[2] - 1]) {
        const p = apply(ijkToLps, [i, j, k]);
        w0 = Math.min(w0, dot(p, right));
        w1 = Math.max(w1, dot(p, right));
        h0 = Math.min(h0, dot(p, down));
        h1 = Math.max(h1, dot(p, down));
      }
    }
  }
  const spanW = w1 - w0 || 1;
  const spanH = h1 - h0 || 1;
  return Math.max(spanW / (width * margin), spanH / (height * margin));
}
