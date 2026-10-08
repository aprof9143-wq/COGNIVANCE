import { describe, expect, it } from "vitest";
import type { Vec3 } from "./acoustics";
import {
  bbox,
  boundaryPoints,
  closeMask,
  crop,
  downsample2,
  outsideOf,
  signedVolume,
  surfaceNets,
  type Grid,
} from "./volume";

const identity = (shift: Vec3 = [0, 0, 0]) =>
  new Float64Array([1, 0, 0, shift[0], 0, 1, 0, shift[1], 0, 0, 1, shift[2], 0, 0, 0, 1]);

/** An n³ grid with the voxels where `f` holds set. */
function volume(n: number, f: (i: number, j: number, k: number) => boolean): Uint8Array {
  const m = new Uint8Array(n * n * n);
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) m[i + j * n + k * n * n] = f(i, j, k) ? 1 : 0;
  return m;
}

const box = (lo: number, hi: number) => (i: number, j: number, k: number) =>
  i >= lo && i <= hi && j >= lo && j <= hi && k >= lo && k <= hi;

describe("voxel geometry", () => {
  it("builds a closed, consistently wound surface around a block", () => {
    const n = 10;
    const grid: Grid = { dims: [n, n, n], ijkToRas: identity() };
    const { positions, indices } = surfaceNets(volume(n, box(3, 6)), grid, 0);
    // Every edge is shared by exactly two triangles, in opposite directions.
    const edges = new Map<string, number>();
    for (let t = 0; t < indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = indices[t + e]!;
        const b = indices[t + ((e + 1) % 3)]!;
        edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1);
      }
    for (const [k, c] of edges) {
      const [a, b] = k.split(">");
      expect(c).toBe(1);
      expect(edges.get(`${b}>${a}`)).toBe(1);
    }
    // Wound inward like the shipped meshes; encloses about the 4³ block.
    const vol = signedVolume(positions, indices);
    expect(vol).toBeLessThan(0);
    expect(-vol).toBeGreaterThan(50);
    expect(-vol).toBeLessThanOrEqual(64);
  });

  it("keeps the inward winding when the affine flips handedness", () => {
    const n = 8;
    const flipped = new Float64Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const { positions, indices } = surfaceNets(
      volume(n, box(2, 5)),
      { dims: [n, n, n], ijkToRas: flipped },
      2,
    );
    expect(signedVolume(positions, indices)).toBeLessThan(0);
  });

  it("separates the outside from an enclosed cavity", () => {
    const n = 9;
    // A hollow shell: solid between 2 and 6, empty at the centre.
    const shell = volume(n, (i, j, k) => box(2, 6)(i, j, k) && !box(4, 4)(i, j, k));
    const out = outsideOf(shell, [n, n, n]);
    expect(out[0]).toBe(1);
    expect(out[4 + 4 * n + 4 * n * n]).toBe(0); // the cavity is not outside
  });

  it("puts boundary points halfway between solid and outside voxels", () => {
    const n = 6;
    const solid = volume(n, box(2, 3));
    const pts = boundaryPoints(
      solid,
      outsideOf(solid, [n, n, n]),
      { dims: [n, n, n], ijkToRas: identity() },
      false,
    );
    expect(pts.length / 3).toBe(24); // 8 voxels × 3 exposed faces
    const xs = new Set<number>();
    for (let p = 0; p < pts.length; p += 3) xs.add(pts[p]!);
    expect([...xs].sort()).toEqual([1.5, 2, 3, 3.5]);
  });

  it("drops the field-of-view edge when asked", () => {
    const n = 5;
    const solid = volume(n, (i) => i <= 2); // touches the i = 0 border
    const grid: Grid = { dims: [n, n, n], ijkToRas: identity() };
    const out = outsideOf(solid, [n, n, n]);
    const all = boundaryPoints(solid, out, grid, false);
    const kept = boundaryPoints(solid, out, grid, true);
    expect(kept.length).toBeLessThan(all.length);
    for (let p = 0; p < kept.length; p += 3) expect(kept[p]).toBe(2.5);
  });

  it("closes gaps narrower than the closing radius", () => {
    const n = 12;
    // Two slabs with a one-voxel slit between them.
    const slabs = volume(n, (i, j, k) => box(2, 9)(i, j, k) && i !== 5);
    const closed = closeMask(slabs, [n, n, n], 2);
    expect(closed[5 + 5 * n + 5 * n * n]).toBe(1);
  });

  it("crops and downsamples without moving anything in world space", () => {
    const n = 8;
    const grid: Grid = { dims: [n, n, n], ijkToRas: identity([10, 20, 30]) };
    const m = volume(n, box(2, 5));
    const b = bbox(m, grid.dims)!;
    expect(b).toEqual({ lo: [2, 2, 2], hi: [5, 5, 5] });
    const c = crop(m, grid, b.lo, b.hi, 1);
    expect(c.grid.dims).toEqual([6, 6, 6]);
    expect([c.grid.ijkToRas[3], c.grid.ijkToRas[7], c.grid.ijkToRas[11]]).toEqual([11, 21, 31]);
    const d = downsample2(m, grid);
    expect(d.grid.dims).toEqual([4, 4, 4]);
    // Coarse voxel (1,1,1) covers fine voxels 2–3: centre 2.5 + offset.
    const x = d.grid.ijkToRas[0]! * 1 + d.grid.ijkToRas[3]!;
    expect(x).toBe(12.5);
    expect(d.mask[1 + 4 + 16]).toBe(1);
    expect(d.mask[0]).toBe(0);
  });
});
