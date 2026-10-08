/**
 * Anatomy for the Simulation Window, built from public MNI152 atlases by
 * tools/demo-assets/build_sim_anatomy.py (regions defined in
 * tools/demo-assets/sim_regions.json):
 *
 *   public/sim/anatomy.bin.gz   surface meshes, and the scalp as a point set
 *   public/sim/regions.nii.gz   label map of the target regions
 *
 * Positions are MNI152 RAS millimetres. Region centroids and volumes are not
 * stored in either file; they are computed from the label map at load time.
 */

import { apply, rasToLps, voxelVolumeMm3 } from "../imaging/geometry";
import { parseNiftiSegmentation } from "../imaging/nifti";
import type { Vec3 } from "./acoustics";

export type AnatomyMesh = {
  key: string;
  name: string;
  colour: string;
  positions: Float32Array; // xyz, mm
  indices: Uint32Array;
  /** Value of this region in regions.nii.gz. */
  label?: number;
  /** Atlas the region comes from: "aseg", "massp" or "schaefer2018". */
  source?: string;
  /** Computed from the label map at load time (see attachRegionMeasures). */
  volumeMm3?: number;
  centroid?: Vec3;
  sides?: { left?: Vec3; right?: Vec3 };
};

export type Anatomy = { meshes: Map<string, AnatomyMesh> };

type Header = {
  quant: number;
  meshes: {
    key: string;
    name: string;
    colour: string;
    vertexCount: number;
    indexCount: number;
    vertexOffset: number;
    indexOffset: number;
    label?: number;
    source?: string;
  }[];
};

export function parseAnatomy(buffer: ArrayBuffer): Anatomy {
  const head = new Uint8Array(buffer, 0, 8);
  const magic = String.fromCharCode(...head.subarray(0, 5));
  if (magic !== "CVSA1") throw new Error("Not a simulation anatomy file.");
  const dv = new DataView(buffer);
  const hlen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, hlen))) as Header;
  const base = 12 + hlen;
  const meshes = new Map<string, AnatomyMesh>();
  for (const m of header.meshes) {
    const q = new Int16Array(
      buffer.slice(base + m.vertexOffset, base + m.vertexOffset + m.vertexCount * 6),
    );
    const positions = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) positions[i] = q[i]! / header.quant;
    const indices = new Uint32Array(
      buffer.slice(base + m.indexOffset, base + m.indexOffset + m.indexCount * 4),
    );
    meshes.set(m.key, {
      key: m.key,
      name: m.name,
      colour: m.colour,
      positions,
      indices,
      ...(m.label !== undefined ? { label: m.label } : {}),
      ...(m.source ? { source: m.source } : {}),
    });
  }
  return { meshes };
}

export type RegionMeasures = {
  voxels: number;
  volumeMm3: number;
  /** Centre of mass of the region's voxels, MNI RAS mm. */
  centroid: Vec3;
  /** Per hemisphere, by the sign of MNI x (left is negative). */
  sides: { left?: Vec3; right?: Vec3 };
};

/**
 * Volume, centroid and per-hemisphere centroids of every label in a label
 * map, in one pass. `ijkToRas` is the row-major voxel-to-MNI affine; voxels
 * are stored i fastest, as NIfTI lays them out.
 */
export function regionMeasures(
  labels: ArrayLike<number>,
  dims: Vec3,
  ijkToRas: Float64Array,
): Map<number, RegionMeasures> {
  const [nx, ny, nz] = dims;
  const m = ijkToRas;
  // Per label: [count, Σi, Σj, Σk] for the left then the right hemisphere.
  const acc = new Map<number, Float64Array>();
  let idx = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++, idx++) {
        const l = labels[idx]!;
        if (!l) continue;
        let a = acc.get(l);
        if (!a) acc.set(l, (a = new Float64Array(8)));
        const o = m[0]! * i + m[1]! * j + m[2]! * k + m[3]! < 0 ? 0 : 4;
        a[o]!++;
        a[o + 1]! += i;
        a[o + 2]! += j;
        a[o + 3]! += k;
      }
    }
  }
  const voxelMm3 = voxelVolumeMm3(m);
  const mean = (a: Float64Array, o: number, n: number): Vec3 =>
    apply(m, [a[o + 1]! / n, a[o + 2]! / n, a[o + 3]! / n]);
  const out = new Map<number, RegionMeasures>();
  for (const [l, a] of acc) {
    const n = a[0]! + a[4]!;
    const both = new Float64Array([n, a[1]! + a[5]!, a[2]! + a[6]!, a[3]! + a[7]!]);
    out.set(l, {
      voxels: n,
      volumeMm3: n * voxelMm3,
      centroid: mean(both, 0, n),
      sides: {
        ...(a[0]! ? { left: mean(a, 0, a[0]!) } : {}),
        ...(a[4]! ? { right: mean(a, 4, a[4]!) } : {}),
      },
    });
  }
  return out;
}

/** Parse public/sim/regions.nii.gz (already gunzipped) into per-label measures. */
export function parseRegionLabels(buffer: ArrayBuffer): Map<number, RegionMeasures> {
  const seg = parseNiftiSegmentation(buffer, "regions.nii.gz");
  // The parser works in LPS; the same row flip takes it back to MNI RAS.
  return regionMeasures(seg.labels, seg.dims, rasToLps(seg.ijkToLps));
}

/** Give every labelled mesh the centroid, hemisphere centroids and volume of its region. */
export function attachRegionMeasures(an: Anatomy, measures: Map<number, RegionMeasures>) {
  for (const mesh of an.meshes.values()) {
    if (mesh.label === undefined) continue;
    const r = measures.get(mesh.label);
    if (!r) throw new Error(`regions: no voxels labelled ${mesh.label} (${mesh.key}).`);
    mesh.volumeMm3 = r.volumeMm3;
    mesh.centroid = r.centroid;
    mesh.sides = r.sides;
  }
}

export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const h = new Uint8Array(buf, 0, 2);
  if (!(h[0] === 0x1f && h[1] === 0x8b)) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function fetchGz(url: string, what: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
  return gunzip(await res.arrayBuffer());
}

export async function loadAnatomy(
  url = "/sim/anatomy.bin.gz",
  labelsUrl = "/sim/regions.nii.gz",
): Promise<Anatomy> {
  const [meshes, labels] = await Promise.all([
    fetchGz(url, "anatomy"),
    fetchGz(labelsUrl, "regions"),
  ]);
  const an = parseAnatomy(meshes);
  attachRegionMeasures(an, parseRegionLabels(labels));
  return an;
}

/** The vertex of a mesh (or point set) nearest to `p`, and its distance in mm. */
export function nearestVertex(mesh: AnatomyMesh, p: Vec3): { point: Vec3; distMm: number } {
  const v = mesh.positions;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < v.length; i += 3) {
    const d = (v[i]! - p[0]) ** 2 + (v[i + 1]! - p[1]) ** 2 + (v[i + 2]! - p[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { point: [v[best]!, v[best + 1]!, v[best + 2]!], distMm: Math.sqrt(bestD) };
}

export type Placement = {
  /** Array centre on the outer brain surface, mm. */
  centre: Vec3;
  /** Unit normal pointing into the brain, toward the target. */
  normal: Vec3;
  /** Focal target, mm. */
  target: Vec3;
  depthMm: number;
};

/**
 * Closest-approach placement: the outer-surface vertex nearest the target,
 * with the array facing the target — a subdural placement, as used for
 * strip electrodes. The outer surface excludes ventricle walls.
 */
export function placeArray(outer: AnatomyMesh, target: Vec3): Placement {
  const { point: centre, distMm: dist } = nearestVertex(outer, target);
  const normal: Vec3 = [
    (target[0] - centre[0]) / dist,
    (target[1] - centre[1]) / dist,
    (target[2] - centre[2]) / dist,
  ];
  return { centre, normal, target, depthMm: dist };
}

export function targetPoint(mesh: AnatomyMesh, side: "left" | "right"): Vec3 {
  return mesh.sides?.[side] ?? mesh.centroid ?? [0, 0, 0];
}
