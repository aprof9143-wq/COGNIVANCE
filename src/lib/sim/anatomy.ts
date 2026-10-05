/**
 * Anatomy for the Simulation Window (public/sim/anatomy.bin.gz), built from
 * public MNI152 atlases by tools/demo-assets/build_sim_anatomy.py. Positions
 * are MNI152 RAS millimetres.
 */

import type { Vec3 } from "./acoustics";

export type AnatomyMesh = {
  key: string;
  name: string;
  colour: string;
  positions: Float32Array; // xyz, mm
  indices: Uint32Array;
  volumeMm3?: number;
  centroid?: Vec3;
  sides?: { left?: Vec3; right?: Vec3 };
  source?: string;
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
    volumeMm3?: number;
    centroid?: Vec3;
    sides?: { left?: Vec3; right?: Vec3 };
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
      ...(m.volumeMm3 !== undefined ? { volumeMm3: m.volumeMm3 } : {}),
      ...(m.centroid ? { centroid: m.centroid } : {}),
      ...(m.sides ? { sides: m.sides } : {}),
      ...(m.source ? { source: m.source } : {}),
    });
  }
  return { meshes };
}

export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const h = new Uint8Array(buf, 0, 2);
  if (!(h[0] === 0x1f && h[1] === 0x8b)) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function loadAnatomy(url = "/sim/anatomy.bin.gz"): Promise<Anatomy> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`anatomy: HTTP ${res.status}`);
  return parseAnatomy(await gunzip(await res.arrayBuffer()));
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
  const p = outer.positions;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const d =
      (p[i]! - target[0]) ** 2 + (p[i + 1]! - target[1]) ** 2 + (p[i + 2]! - target[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const centre: Vec3 = [p[best]!, p[best + 1]!, p[best + 2]!];
  const dist = Math.sqrt(bestD);
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
