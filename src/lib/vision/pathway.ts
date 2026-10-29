import * as THREE from "three";
import type { AnatomyMesh } from "@/lib/sim/anatomy";

/**
 * Geometry of the visual pathway in MNI152 space, shared by the therapy
 * page's pathway view and the landing page hero: eye → optic nerve → chiasm →
 * optic tract → LGN → optic radiation → V1.
 *
 * LGN and V1 come from the atlas meshes in public/sim. The eyes, the chiasm
 * and the waypoints of the tracts are schematic, placed by standard anatomy.
 */

export type V3 = [number, number, number];

/** MNI RAS mm → three.js world (y up, anterior toward −z). */
export const w = ([x, y, z]: V3) => new THREE.Vector3(x, z, -y);

export const SCHEMATIC: { eyeL: V3; eyeR: V3; chiasm: V3 } = {
  eyeL: [-32, 62, -36],
  eyeR: [32, 62, -36],
  chiasm: [0, 4, -14],
};

/** Fallback centroids (MNI mm) for when the label map does not resolve a side. */
export const FALLBACK = {
  lgnL: [-24, -24, -8] as V3,
  lgnR: [24, -24, -7] as V3,
  v1L: [-8, -88, 1] as V3,
  v1R: [11, -80, 4] as V3,
};

/** Left or right centroid of a region, or the fallback. */
export function sideOf(m: AnatomyMesh | null | undefined, s: "left" | "right", fb: V3): V3 {
  const p = m?.sides?.[s];
  return p ? [p[0], p[1], p[2]] : fb;
}

export function meshGeometry(m: AnatomyMesh) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(m.positions.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    p[i] = m.positions[i]!;
    p[i + 1] = m.positions[i + 2]!;
    p[i + 2] = -m.positions[i + 1]!;
  }
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  return g;
}

export type Path = { curve: THREE.CatmullRomCurve3; stage: "retina" | "cortex" };

export function pathways(lgnL: V3, lgnR: V3, v1L: V3, v1R: V3): Path[] {
  const out: Path[] = [];
  for (const side of [-1, 1] as const) {
    const eye = side < 0 ? SCHEMATIC.eyeL : SCHEMATIC.eyeR;
    const lgn = side < 0 ? lgnL : lgnR;
    const v1 = side < 0 ? v1L : v1R;
    // Each eye sends fibres to both sides; the nasal half crosses at the chiasm.
    for (const toSide of [-1, 1] as const) {
      const target = toSide < 0 ? lgnL : lgnR;
      out.push({
        stage: "retina",
        curve: new THREE.CatmullRomCurve3(
          [
            eye,
            [side * 22, 40, -30],
            [side * 9, 14, -20],
            SCHEMATIC.chiasm,
            [toSide * 12, -6, -12],
            [toSide * 19, -16, -10],
            target,
          ].map((p) => w(p as V3)),
        ),
      });
    }
    out.push({
      stage: "cortex",
      curve: new THREE.CatmullRomCurve3(
        [lgn, [side * 33, -34, -2], [side * 31, -58, 2], [side * 20, -76, 3], v1].map((p) =>
          w(p as V3),
        ),
      ),
    });
  }
  return out;
}
