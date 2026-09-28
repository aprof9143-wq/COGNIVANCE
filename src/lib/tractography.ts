/**
 * Streamline tractography: reading, and the synthetic demo bundle.
 *
 * Tractography reconstructs white-matter pathways from diffusion MRI. The heavy
 * part — fitting a diffusion model per voxel and tracking through it — is done
 * offline by established tools (MRtrix3, DIPY, DSI Studio, TrackVis). They write
 * the result as streamlines: ordered 3D points along each reconstructed fibre.
 * This module reads those files so the console can render real tractography.
 *
 * Supported:
 *  - TrackVis `.trk` — binary, 1000-byte header, points in voxel-millimetres.
 *  - MRtrix3 `.tck` — text header, float32 triplets in scanner RAS mm,
 *    streamlines separated by NaN triplets and terminated by an Inf triplet.
 */

export type Tractogram = {
  /** x, y, z interleaved, in the file's own millimetre space. */
  points: Float32Array;
  /** Start index (in points, not floats) of each streamline; last entry = total. */
  offsets: Uint32Array;
  count: number;
  totalInFile: number;
  format: "trk" | "tck" | "synthetic" | "bundled";
  /** Honest provenance for the UI. */
  description: string;
  /**
   * "mm": points are millimetres in the file's own space, and the renderer fits
   * their extent to the loaded brain. "grid": points are already registered to
   * the bundled template, as 0–1 coordinates of its voxel grid, and are placed
   * exactly — no fitting.
   */
  space?: "mm" | "grid";
};

/**
 * Streamline and point budgets. A whole-brain tractogram can hold a million
 * streamlines; drawing all of them is neither fast nor legible. These caps keep
 * the scene interactive, and the UI reports how many were shown out of how many.
 */
export const MAX_STREAMLINES = 24_000;
const MAX_POINTS_PER_STREAMLINE = 64;

/** Evenly subsample points along a streamline to at most `max`, keeping both ends. */
function decimate(src: number[], max: number): number[] {
  const n = src.length / 3;
  if (n <= max) return src;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const k = Math.round((i * (n - 1)) / (max - 1));
    out.push(src[k * 3]!, src[k * 3 + 1]!, src[k * 3 + 2]!);
  }
  return out;
}

class Builder {
  private pts: number[] = [];
  private offs: number[] = [0];
  total = 0;
  kept = 0;
  constructor(private stride: number) {}
  add(streamline: number[]) {
    this.total++;
    // Keep every `stride`-th streamline so a large file is sampled evenly
    // across the whole brain rather than truncated to its first region.
    if ((this.total - 1) % this.stride !== 0) return;
    if (streamline.length < 6) return; // fewer than two points draws nothing
    const d = decimate(streamline, MAX_POINTS_PER_STREAMLINE);
    for (const v of d) this.pts.push(v);
    this.offs.push(this.pts.length / 3);
    this.kept++;
  }
  done(format: Tractogram["format"], description: string): Tractogram {
    return {
      points: new Float32Array(this.pts),
      offsets: new Uint32Array(this.offs),
      count: this.kept,
      totalInFile: this.total,
      format,
      description,
    };
  }
}

/* ----------------------------------------------------------------- .trk */

export function parseTrk(buffer: ArrayBuffer): Tractogram {
  const view = new DataView(buffer);
  if (buffer.byteLength < 1000) throw new Error("File is too small to be a TrackVis .trk.");
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 5));
  if (magic !== "TRACK")
    throw new Error("Not a TrackVis file — the header should start with 'TRACK'.");

  // hdr_size is 1000 in either byte order; whichever reads correctly wins.
  const little = view.getInt32(996, true) === 1000;
  if (!little && view.getInt32(996, false) !== 1000) {
    throw new Error("TrackVis header size is not 1000 — the file may be corrupt.");
  }
  const nScalars = view.getInt16(36, little);
  const nProps = view.getInt16(238, little);
  const declared = view.getInt32(988, little); // 0 means "not recorded"

  // Choose a stride from the declared count; when unknown, estimate from size.
  const estimate =
    declared > 0 ? declared : Math.max(1, Math.floor((buffer.byteLength - 1000) / 400));
  const stride = Math.max(1, Math.ceil(estimate / MAX_STREAMLINES));
  const b = new Builder(stride);

  let o = 1000;
  const perPoint = 3 + nScalars;
  while (o + 4 <= buffer.byteLength) {
    const m = view.getInt32(o, little);
    o += 4;
    if (m <= 0 || m > 1_000_000) break; // defends against a corrupt count
    const need = m * perPoint * 4 + nProps * 4;
    if (o + need > buffer.byteLength) break;
    const s: number[] = new Array(m * 3);
    for (let p = 0; p < m; p++) {
      const base = o + p * perPoint * 4;
      s[p * 3] = view.getFloat32(base, little);
      s[p * 3 + 1] = view.getFloat32(base + 4, little);
      s[p * 3 + 2] = view.getFloat32(base + 8, little);
    }
    b.add(s);
    o += need;
  }
  if (!b.kept) throw new Error("No streamlines found in this .trk file.");
  return b.done("trk", "TrackVis tractogram (voxel-mm space)");
}

/* ----------------------------------------------------------------- .tck */

export function parseTck(buffer: ArrayBuffer): Tractogram {
  const head = new TextDecoder("latin1").decode(
    new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65536)),
  );
  if (!head.startsWith("mrtrix tracks")) {
    throw new Error("Not an MRtrix .tck file — the header should start with 'mrtrix tracks'.");
  }
  const end = head.indexOf("\nEND\n");
  if (end < 0) throw new Error("MRtrix header has no END line.");

  const fields = new Map<string, string>();
  for (const line of head.slice(0, end).split("\n").slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) fields.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  const fileField = fields.get("file") ?? "";
  const offsetMatch = fileField.match(/\.\s+(\d+)/);
  if (!offsetMatch) throw new Error("MRtrix header has no data offset ('file: . <offset>').");
  const offset = Number(offsetMatch[1]);

  const datatype = (fields.get("datatype") ?? "Float32LE").toLowerCase();
  if (!datatype.startsWith("float32")) {
    throw new Error(`Unsupported .tck datatype '${datatype}'. Float32 is the MRtrix default.`);
  }
  const little = !datatype.endsWith("be");
  const declared = Number(fields.get("count") ?? 0);
  const stride = Math.max(1, Math.ceil((declared || 1) / MAX_STREAMLINES));

  const view = new DataView(buffer);
  const b = new Builder(stride);
  let cur: number[] = [];
  for (let o = offset; o + 12 <= buffer.byteLength; o += 12) {
    const x = view.getFloat32(o, little);
    const y = view.getFloat32(o + 4, little);
    const z = view.getFloat32(o + 8, little);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      // NaN triplet ends a streamline; Inf triplet ends the file.
      if (cur.length) b.add(cur);
      cur = [];
      if (x === Infinity || x === -Infinity) break;
      continue;
    }
    cur.push(x, y, z);
  }
  if (cur.length) b.add(cur);
  if (!b.kept) throw new Error("No streamlines found in this .tck file.");
  return b.done("tck", "MRtrix3 tractogram (scanner RAS mm)");
}

/* ------------------------------------------------------------- synthetic */

/**
 * A procedural demo bundle of the major white-matter systems.
 *
 * NOT derived from any data. It exists so the tractography layer shows the
 * classic shape of the tracts before a real file is loaded, and the UI labels
 * it as synthetic wherever it appears. Coordinates are in a normalised head
 * frame (−1…1, RAS), which the renderer fits to the loaded brain.
 */
export function syntheticTractogram(seed = 11): Tractogram {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const jitter = (a: number) => (rnd() - 0.5) * a;
  const b = new Builder(1);

  const curve = (pts: [number, number, number][]) => {
    // Catmull-Rom through control points gives smooth fibre-like paths.
    const out: number[] = [];
    const steps = 22;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        for (let d = 0; d < 3; d++) {
          out.push(
            0.5 *
              (2 * p1[d]! +
                (-p0[d]! + p2[d]!) * t +
                (2 * p0[d]! - 5 * p1[d]! + 4 * p2[d]! - p3[d]!) * t2 +
                (-p0[d]! + 3 * p1[d]! - 3 * p2[d]! + p3[d]!) * t3),
          );
        }
      }
    }
    const last = pts[pts.length - 1]!;
    out.push(last[0], last[1], last[2]);
    return out;
  };

  // Corpus callosum — commissural arcs crossing the midline over the ventricles.
  for (let i = 0; i < 520; i++) {
    const y = -0.62 + rnd() * 1.18;
    const spread = 0.55 + rnd() * 0.3;
    const lift = 0.2 + 0.08 * Math.cos(y * 2.4);
    b.add(
      curve([
        [-spread, y + jitter(0.08), 0.28 + jitter(0.18)],
        [-0.28, y + jitter(0.04), lift + 0.12],
        [0, y, lift + 0.16 + jitter(0.03)],
        [0.28, y + jitter(0.04), lift + 0.12],
        [spread, y + jitter(0.08), 0.28 + jitter(0.18)],
      ]),
    );
  }

  // Corticospinal tracts — projection fibres from motor cortex to brainstem.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 240; i++) {
      const top = side * (0.18 + rnd() * 0.42);
      b.add(
        curve([
          [top, -0.05 + jitter(0.3), 0.82 + jitter(0.08)],
          [side * 0.22 + jitter(0.06), -0.02 + jitter(0.08), 0.35],
          [side * 0.12 + jitter(0.03), 0.0 + jitter(0.05), -0.12],
          [side * 0.06 + jitter(0.02), -0.12 + jitter(0.03), -0.72],
        ]),
      );
    }
  }

  // Superior longitudinal / arcuate — association fibres, front to back.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 230; i++) {
      const x = side * (0.5 + rnd() * 0.18);
      b.add(
        curve([
          [x - side * 0.04, 0.6 + jitter(0.1), 0.2 + jitter(0.1)],
          [x, 0.15 + jitter(0.06), 0.4 + jitter(0.06)],
          [x, -0.3 + jitter(0.06), 0.36 + jitter(0.06)],
          [x - side * 0.05, -0.55 + jitter(0.08), 0.06 + jitter(0.08)],
          [x - side * 0.1, -0.35 + jitter(0.08), -0.25 + jitter(0.08)],
        ]),
      );
    }
  }

  // Cingulum — along the midline, above the corpus callosum.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 140; i++) {
      const x = side * (0.08 + rnd() * 0.06);
      b.add(
        curve([
          [x, 0.62 + jitter(0.06), 0.02 + jitter(0.06)],
          [x, 0.35, 0.42 + jitter(0.05)],
          [x, -0.2, 0.46 + jitter(0.05)],
          [x, -0.52 + jitter(0.06), 0.18 + jitter(0.06)],
          [x, -0.45, -0.22 + jitter(0.06)],
        ]),
      );
    }
  }

  // Inferior fronto-occipital — the long ventral association pathway.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 150; i++) {
      const x = side * (0.3 + rnd() * 0.12);
      b.add(
        curve([
          [x, 0.72 + jitter(0.06), -0.05 + jitter(0.08)],
          [x + side * 0.05, 0.25, -0.18 + jitter(0.05)],
          [x + side * 0.06, -0.3, -0.12 + jitter(0.05)],
          [x, -0.82 + jitter(0.06), 0.02 + jitter(0.08)],
        ]),
      );
    }
  }

  return b.done("synthetic", "Synthetic demo bundle — procedural, not derived from data");
}

/**
 * Direction-encoded colour, the universal tractography convention:
 * red = left–right, green = anterior–posterior, blue = superior–inferior.
 * Colour follows the local fibre direction, so a bundle's colour tells you
 * which way it runs without a legend.
 */
export function directionColour(dx: number, dy: number, dz: number): [number, number, number] {
  const len = Math.hypot(dx, dy, dz) || 1;
  return [Math.abs(dx) / len, Math.abs(dy) / len, Math.abs(dz) / len];
}

/**
 * Read the console's compact bundled tractogram (see
 * tools/demo-assets/build_tractogram.py for how it is made).
 *
 *   "CVTR2\0\0\0" · uint32 count · uint32 points · uint32 offsets[count + 1]
 *   · uint16 first[count × 3] · int8 deltas[(points − count) × 3]
 *
 * Coordinates are in 1/2048 steps across the template's voxel grid. Each
 * streamline stores its first point, then the step to each following point;
 * deltas are exact in quantised units, so decoding does not drift.
 */
export function parseBundledTractogram(buffer: ArrayBuffer, description: string): Tractogram {
  const magic = new TextDecoder("ascii").decode(
    new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)),
  );
  if (magic !== "CVTR2") throw new Error("Not a bundled tractogram.");
  const Q = 2048;
  const view = new DataView(buffer);
  const count = view.getUint32(8, true);
  const total = view.getUint32(12, true);
  const offBytes = 16;
  const firstBytes = offBytes + (count + 1) * 4;
  const deltaBytes = firstBytes + count * 6;
  if (buffer.byteLength < deltaBytes + (total - count) * 3) {
    throw new Error("Bundled tractogram is truncated.");
  }
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i <= count; i++) offsets[i] = view.getUint32(offBytes + i * 4, true);
  if (offsets[count] !== total) throw new Error("Bundled tractogram offsets are inconsistent.");

  const points = new Float32Array(total * 3);
  const deltas = new Int8Array(buffer, deltaBytes, (total - count) * 3);
  let d = 0;
  for (let s = 0; s < count; s++) {
    let x = view.getUint16(firstBytes + s * 6, true);
    let y = view.getUint16(firstBytes + s * 6 + 2, true);
    let z = view.getUint16(firstBytes + s * 6 + 4, true);
    for (let i = offsets[s]!; i < offsets[s + 1]!; i++) {
      if (i > offsets[s]!) {
        x += deltas[d]!;
        y += deltas[d + 1]!;
        z += deltas[d + 2]!;
        d += 3;
      }
      points[i * 3] = x / Q;
      points[i * 3 + 1] = y / Q;
      points[i * 3 + 2] = z / Q;
    }
  }
  return {
    points,
    offsets,
    count,
    totalInFile: count,
    format: "bundled",
    description,
    space: "grid",
  };
}
