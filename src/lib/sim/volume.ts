/**
 * Voxel-grid geometry for building a subject's anatomy in the browser: flood
 * fill, morphological closing, boundary points and surface meshes (naive
 * surface nets, smoothed like the build script's marching-cubes meshes).
 *
 * Volumes are stored i fastest, as NIfTI lays them out. `ijkToRas` is the
 * row-major voxel-to-world affine in MNI152 RAS millimetres.
 */

import type { Vec3 } from "./acoustics";

export type Grid = { dims: Vec3; ijkToRas: Float64Array };

const at = (m: Float64Array, i: number, j: number, k: number): Vec3 => [
  m[0]! * i + m[1]! * j + m[2]! * k + m[3]!,
  m[4]! * i + m[5]! * j + m[6]! * k + m[7]!,
  m[8]! * i + m[9]! * j + m[10]! * k + m[11]!,
];

/** Voxels of `mask == 0` connected to the volume border (6-connectivity). */
export function outsideOf(mask: Uint8Array, dims: Vec3): Uint8Array {
  const [nx, ny, nz] = dims;
  const sxy = nx * ny;
  const out = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  const seed = (idx: number) => {
    if (!mask[idx] && !out[idx]) {
      out[idx] = 1;
      queue[tail++] = idx;
    }
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1)
          seed(i + j * nx + k * sxy);
  while (head < tail) {
    const idx = queue[head++]!;
    const i = idx % nx;
    const j = Math.floor(idx / nx) % ny;
    const k = Math.floor(idx / sxy);
    if (i > 0) seed(idx - 1);
    if (i < nx - 1) seed(idx + 1);
    if (j > 0) seed(idx - nx);
    if (j < ny - 1) seed(idx + nx);
    if (k > 0) seed(idx - sxy);
    if (k < nz - 1) seed(idx + sxy);
  }
  return out;
}

/** One 6-neighbour dilation (grow) or erosion (shrink) step, `times` times. */
function morph(mask: Uint8Array, dims: Vec3, times: number, grow: boolean): Uint8Array {
  const [nx, ny, nz] = dims;
  const sxy = nx * ny;
  // Neighbours outside the volume never count: dilation does not grow from
  // them and erosion does not shrink toward them, so a closing leaves a mask
  // that runs into the field-of-view edge (a head cut at the neck) intact.
  // Hot loop: no allocation per voxel.
  let cur = mask;
  for (let t = 0; t < times; t++) {
    const next = new Uint8Array(cur.length);
    let idx = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++, idx++) {
          const c = cur[idx]!;
          if (grow ? c : !c) {
            next[idx] = c;
            continue;
          }
          // Growing an empty voxel: any set neighbour sets it. Shrinking a set
          // voxel: any empty neighbour clears it.
          const want = grow ? 1 : 0;
          const hit =
            (i > 0 && cur[idx - 1] === want) ||
            (i < nx - 1 && cur[idx + 1] === want) ||
            (j > 0 && cur[idx - nx] === want) ||
            (j < ny - 1 && cur[idx + nx] === want) ||
            (k > 0 && cur[idx - sxy] === want) ||
            (k < nz - 1 && cur[idx + sxy] === want);
          next[idx] = grow ? (hit ? 1 : 0) : hit ? 0 : 1;
        }
    cur = next;
  }
  return cur;
}

export const dilate = (m: Uint8Array, d: Vec3, r: number) => morph(m, d, r, true);
export const erode = (m: Uint8Array, d: Vec3, r: number) => morph(m, d, r, false);
/** Closing: bridges gaps narrower than about 2r voxels (sulci, for a brain mask). */
export const closeMask = (m: Uint8Array, d: Vec3, r: number) => erode(dilate(m, d, r), d, r);

/**
 * Fill the holes of every slice across `axis` (4-connectivity in the slice).
 * For a head, filling axial slices seals the airway, which otherwise opens to
 * the outside where the image cuts through the neck.
 */
export function fillSlices(mask: Uint8Array, dims: Vec3, axis: 0 | 1 | 2): Uint8Array {
  const out = Uint8Array.from(mask);
  const [u, v] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const nu = dims[u]!;
  const nv = dims[v]!;
  const stride = [1, dims[0], dims[0] * dims[1]];
  const reached = new Uint8Array(nu * nv);
  const queue = new Int32Array(nu * nv);
  for (let w = 0; w < dims[axis]!; w++) {
    const base = w * stride[axis]!;
    const at = (a: number, b: number) => base + a * stride[u]! + b * stride[v]!;
    reached.fill(0);
    let head = 0;
    let tail = 0;
    const seed = (a: number, b: number) => {
      const q = a + b * nu;
      if (!reached[q] && !mask[at(a, b)]) {
        reached[q] = 1;
        queue[tail++] = q;
      }
    };
    for (let a = 0; a < nu; a++) {
      seed(a, 0);
      seed(a, nv - 1);
    }
    for (let b = 0; b < nv; b++) {
      seed(0, b);
      seed(nu - 1, b);
    }
    while (head < tail) {
      const q = queue[head++]!;
      const a = q % nu;
      const b = (q - a) / nu;
      if (a > 0) seed(a - 1, b);
      if (a < nu - 1) seed(a + 1, b);
      if (b > 0) seed(a, b - 1);
      if (b < nv - 1) seed(a, b + 1);
    }
    for (let b = 0; b < nv; b++)
      for (let a = 0; a < nu; a++) if (!reached[a + b * nu]) out[at(a, b)] = 1;
  }
  return out;
}

/**
 * Points on the boundary between a solid and its outside, at the midpoint of
 * each solid/outside voxel pair. With `dropEdge`, solid voxels on the volume
 * border are skipped: there the boundary is the field of view, not anatomy.
 */
export function boundaryPoints(
  solid: Uint8Array,
  outside: Uint8Array,
  grid: Grid,
  dropEdge: boolean,
): Float32Array {
  const [nx, ny, nz] = grid.dims;
  const sxy = nx * ny;
  const m = grid.ijkToRas;
  const out: number[] = [];
  const steps: [number, number, number, number][] = [
    [-1, 0, 0, -1],
    [1, 0, 0, 1],
    [0, -1, 0, -nx],
    [0, 1, 0, nx],
    [0, 0, -1, -sxy],
    [0, 0, 1, sxy],
  ];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const idx = i + j * nx + k * sxy;
        if (!solid[idx]) continue;
        const edge = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
        if (edge && dropEdge) continue;
        for (const [di, dj, dk, d] of steps) {
          const ii = i + di;
          const jj = j + dj;
          const kk = k + dk;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
          if (!outside[idx + d]) continue;
          const p = at(m, i + di / 2, j + dj / 2, k + dk / 2);
          out.push(p[0], p[1], p[2]);
        }
      }
  return Float32Array.from(out);
}

/** Bounding box of the non-zero voxels, or null if there are none. */
export function bbox(mask: Uint8Array, dims: Vec3): { lo: Vec3; hi: Vec3 } | null {
  const [nx, ny] = dims;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-1, -1, -1];
  for (let idx = 0; idx < mask.length; idx++) {
    if (!mask[idx]) continue;
    const i = idx % nx;
    const j = Math.floor(idx / nx) % ny;
    const k = Math.floor(idx / (nx * ny));
    if (i < lo[0]) lo[0] = i;
    if (j < lo[1]) lo[1] = j;
    if (k < lo[2]) lo[2] = k;
    if (i > hi[0]) hi[0] = i;
    if (j > hi[1]) hi[1] = j;
    if (k > hi[2]) hi[2] = k;
  }
  return hi[0] < 0 ? null : { lo, hi };
}

/** Sub-volume [lo, hi] (inclusive) with `pad` voxels of margin, and its grid. */
export function crop(
  mask: Uint8Array,
  grid: Grid,
  lo: Vec3,
  hi: Vec3,
  pad: number,
): { mask: Uint8Array; grid: Grid } {
  const [nx, ny, nz] = grid.dims;
  const a: Vec3 = [Math.max(0, lo[0] - pad), Math.max(0, lo[1] - pad), Math.max(0, lo[2] - pad)];
  const b: Vec3 = [
    Math.min(nx - 1, hi[0] + pad),
    Math.min(ny - 1, hi[1] + pad),
    Math.min(nz - 1, hi[2] + pad),
  ];
  const dims: Vec3 = [b[0] - a[0] + 1, b[1] - a[1] + 1, b[2] - a[2] + 1];
  const out = new Uint8Array(dims[0] * dims[1] * dims[2]);
  for (let k = 0; k < dims[2]; k++)
    for (let j = 0; j < dims[1]; j++) {
      const src = a[0] + (a[1] + j) * nx + (a[2] + k) * nx * ny;
      out.set(mask.subarray(src, src + dims[0]), j * dims[0] + k * dims[0] * dims[1]);
    }
  const m = Float64Array.from(grid.ijkToRas);
  const o = at(grid.ijkToRas, a[0], a[1], a[2]);
  m[3] = o[0];
  m[7] = o[1];
  m[11] = o[2];
  return { mask: out, grid: { dims, ijkToRas: m } };
}

/** Halve the resolution: a coarse voxel is set when half or more of its 2×2×2 block is. */
export function downsample2(mask: Uint8Array, grid: Grid): { mask: Uint8Array; grid: Grid } {
  const [nx, ny, nz] = grid.dims;
  const dims: Vec3 = [Math.ceil(nx / 2), Math.ceil(ny / 2), Math.ceil(nz / 2)];
  const out = new Uint8Array(dims[0] * dims[1] * dims[2]);
  for (let k = 0; k < dims[2]; k++)
    for (let j = 0; j < dims[1]; j++)
      for (let i = 0; i < dims[0]; i++) {
        let s = 0;
        let n = 0;
        for (let c = 0; c < 8; c++) {
          const ii = 2 * i + (c & 1);
          const jj = 2 * j + ((c >> 1) & 1);
          const kk = 2 * k + ((c >> 2) & 1);
          if (ii >= nx || jj >= ny || kk >= nz) continue;
          s += mask[ii + jj * nx + kk * nx * ny]!;
          n++;
        }
        out[i + j * dims[0] + k * dims[0] * dims[1]] = 2 * s >= n ? 1 : 0;
      }
  // Coarse voxel centre = mean of its fine block's centres.
  const m = grid.ijkToRas;
  const s = Float64Array.from(m);
  for (const r of [0, 4, 8]) {
    s[r] = 2 * m[r]!;
    s[r + 1] = 2 * m[r + 1]!;
    s[r + 2] = 2 * m[r + 2]!;
    s[r + 3] = m[r + 3]! + 0.5 * (m[r]! + m[r + 1]! + m[r + 2]!);
  }
  return { mask: out, grid: { dims, ijkToRas: s } };
}

/** Signed volume enclosed by a triangle mesh, mm³ (negative when wound inward). */
export function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  const p = positions;
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3;
    const b = indices[t + 1]! * 3;
    const c = indices[t + 2]! * 3;
    v +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return v / 6;
}

/**
 * Surface mesh of a binary mask (naive surface nets): one vertex per cell
 * the surface crosses, one quad per voxel face it separates, then Laplacian
 * smoothing. Triangles are wound like the shipped anatomy meshes (inward),
 * so the scene renders both the same way.
 */
export function surfaceNets(
  mask: Uint8Array,
  grid: Grid,
  smoothPasses = 4,
): { positions: Float32Array; indices: Uint32Array } {
  // Pad by one voxel so the surface closes at the volume border.
  const [nx0, ny0, nz0] = grid.dims;
  const nx = nx0 + 2;
  const ny = ny0 + 2;
  const nz = nz0 + 2;
  const v = (i: number, j: number, k: number) =>
    i < 1 || j < 1 || k < 1 || i > nx0 || j > ny0 || k > nz0
      ? 0
      : mask[i - 1 + (j - 1) * nx0 + (k - 1) * nx0 * ny0]!;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const vert = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const corner = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ] as const;
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const;
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        const c = corner.map(([a, b, d]) => v(i + a, j + b, k + d));
        if (c.every((x) => x === c[0])) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of edges) {
          if (c[a] === c[b]) continue;
          sx += i + (corner[a]![0] + corner[b]![0]) / 2;
          sy += j + (corner[a]![1] + corner[b]![1]) / 2;
          sz += k + (corner[a]![2] + corner[b]![2]) / 2;
          n++;
        }
        vert[i + j * cx + k * cx * cy] = pos.length / 3;
        // Back to the unpadded grid (-1), then to world.
        const w = at(grid.ijkToRas, sx / n - 1, sy / n - 1, sz / n - 1);
        pos.push(w[0], w[1], w[2]);
      }
  const tri: number[] = [];
  const cell = (i: number, j: number, k: number) => vert[i + j * cx + k * cx * cy]!;
  const quad = (a: number, b: number, c: number, d: number, inside: boolean) => {
    if (inside) tri.push(a, b, c, a, c, d);
    else tri.push(a, c, b, a, d, c);
  };
  // A voxel face separating inside from outside becomes a quad over the four
  // cells sharing its edge. Ordered so the normal points from inside to
  // outside in voxel space; the affine's handedness is fixed up below.
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const here = v(i, j, k);
        if (j > 0 && k > 0 && here !== v(i + 1, j, k))
          quad(
            cell(i, j - 1, k - 1),
            cell(i, j, k - 1),
            cell(i, j, k),
            cell(i, j - 1, k),
            here === 1,
          );
        if (i > 0 && k > 0 && here !== v(i, j + 1, k))
          quad(
            cell(i - 1, j, k - 1),
            cell(i - 1, j, k),
            cell(i, j, k),
            cell(i, j, k - 1),
            here === 1,
          );
        if (i > 0 && j > 0 && here !== v(i, j, k + 1))
          quad(
            cell(i - 1, j - 1, k),
            cell(i, j - 1, k),
            cell(i, j, k),
            cell(i - 1, j, k),
            here === 1,
          );
      }

  let positions: Float32Array = Float32Array.from(pos);
  const indices = Uint32Array.from(tri);
  positions = smooth(positions, indices, smoothPasses);
  // Match the shipped meshes' winding (negative signed volume).
  if (signedVolume(positions, indices) > 0) {
    for (let t = 0; t < indices.length; t += 3) {
      const b = indices[t + 1]!;
      indices[t + 1] = indices[t + 2]!;
      indices[t + 2] = b;
    }
  }
  return { positions, indices };
}

/** Laplacian smoothing over the triangle graph (λ = 0.5), as in the build script. */
function smooth(p: Float32Array, ix: Uint32Array, passes: number): Float32Array {
  const n = p.length / 3;
  let cur = p;
  for (let s = 0; s < passes; s++) {
    const sum = new Float64Array(n * 3);
    const deg = new Float64Array(n);
    const add = (a: number, b: number) => {
      sum[a * 3]! += cur[b * 3]!;
      sum[a * 3 + 1]! += cur[b * 3 + 1]!;
      sum[a * 3 + 2]! += cur[b * 3 + 2]!;
      deg[a]!++;
    };
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t]!;
      const b = ix[t + 1]!;
      const c = ix[t + 2]!;
      add(a, b);
      add(b, a);
      add(b, c);
      add(c, b);
      add(c, a);
      add(a, c);
    }
    const next = new Float32Array(cur.length);
    for (let q = 0; q < n; q++) {
      for (let d = 0; d < 3; d++) {
        const x = cur[q * 3 + d]!;
        next[q * 3 + d] = deg[q] ? x + 0.5 * (sum[q * 3 + d]! / deg[q]! - x) : x;
      }
    }
    cur = next;
  }
  return cur;
}
