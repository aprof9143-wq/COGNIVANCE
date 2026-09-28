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
  /** x, y, z interleaved. Units and frame are given by `space`. */
  points: Float32Array;
  /** Start index (in points, not floats) of each streamline; last entry = total. */
  offsets: Uint32Array;
  count: number;
  totalInFile: number;
  format: "trk" | "tck" | "bundled";
  /** Honest provenance for the UI. */
  description: string;
  /**
   * "lps":      patient-space LPS mm, the frame every other layer uses.
   * "grid":     0–1 coordinates of the bundled template's voxel grid; converted
   *             to LPS with the template's affine before display.
   * "unplaced": the file carries no usable geometry. Never displayed — tracts
   *             are not stretched to fit a brain.
   */
  space: "lps" | "grid" | "unplaced";
  /** Tracking parameters as recorded in the file (MRtrix header keys, etc.). */
  parameters: Record<string, string>;
  warnings: string[];
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
  done(
    format: Tractogram["format"],
    description: string,
    space: Tractogram["space"],
    parameters: Record<string, string> = {},
    warnings: string[] = [],
  ): Tractogram {
    return {
      points: new Float32Array(this.pts),
      offsets: new Uint32Array(this.offs),
      count: this.kept,
      totalInFile: this.total,
      format,
      description,
      space,
      parameters,
      warnings,
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

  // Geometry (TrackVis v2): voxel size and the voxel-to-RAS affine. Points are
  // "voxmm" — voxel index × voxel size, measured from the first voxel's
  // corner — so RAS = vox_to_ras · (voxmm / voxel_size − 0.5), the convention
  // nibabel uses.
  const vs = [
    view.getFloat32(12, little),
    view.getFloat32(16, little),
    view.getFloat32(20, little),
  ];
  const v2r: number[] = [];
  for (let i = 0; i < 16; i++) v2r.push(view.getFloat32(440 + i * 4, little));
  const voxelOrder = String.fromCharCode(...new Uint8Array(buffer, 948, 3))
    .replace(/\0/g, "")
    .toUpperCase();
  const warnings: string[] = [];
  let placed = v2r[15] !== 0 && vs.every((v) => v > 0);
  if (!placed)
    warnings.push(
      "No voxel-to-RAS matrix (TrackVis v1 or unset): the tractogram cannot be placed in patient space.",
    );
  if (placed && voxelOrder.length === 3 && voxelOrder !== axisCodes(v2r)) {
    warnings.push(
      `Header voxel_order ${voxelOrder} disagrees with vox_to_ras (${axisCodes(v2r)}); refusing to guess which is right.`,
    );
    placed = false;
  }

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
      const i = view.getFloat32(base, little) / vs[0]! - 0.5;
      const j = view.getFloat32(base + 4, little) / vs[1]! - 0.5;
      const k = view.getFloat32(base + 8, little) / vs[2]! - 0.5;
      // RAS, then to LPS by negating x and y.
      s[p * 3] = -(v2r[0]! * i + v2r[1]! * j + v2r[2]! * k + v2r[3]!);
      s[p * 3 + 1] = -(v2r[4]! * i + v2r[5]! * j + v2r[6]! * k + v2r[7]!);
      s[p * 3 + 2] = v2r[8]! * i + v2r[9]! * j + v2r[10]! * k + v2r[11]!;
    }
    b.add(s);
    o += need;
  }
  if (!b.kept) throw new Error("No streamlines found in this .trk file.");
  return b.done(
    "trk",
    "TrackVis tractogram",
    placed ? "lps" : "unplaced",
    { voxel_size: vs.map((v) => v.toFixed(3)).join(" × "), voxel_order: voxelOrder || "unset" },
    warnings,
  );
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
    // MRtrix stores scanner RAS mm; LPS negates x and y.
    cur.push(-x, -y, z);
  }
  if (cur.length) b.add(cur);
  if (!b.kept) throw new Error("No streamlines found in this .tck file.");
  // Everything the header records about how the tracks were made.
  const parameters: Record<string, string> = {};
  for (const [k, v] of fields) {
    if (!["file", "datatype", "timestamp"].includes(k)) parameters[k] = v;
  }
  return b.done("tck", "MRtrix3 tractogram (scanner space)", "lps", parameters);
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
    parameters: {},
    warnings: [],
  };
}

/** Axis codes (e.g. "LAS") of a row-major 4×4 voxel-to-RAS affine. */
export function axisCodes(m: number[]): string {
  const letters = [
    ["L", "R"],
    ["P", "A"],
    ["I", "S"],
  ];
  let out = "";
  for (let c = 0; c < 3; c++) {
    const col = [m[c]!, m[4 + c]!, m[8 + c]!];
    const r = col.map(Math.abs).indexOf(Math.max(...col.map(Math.abs)));
    out += letters[r]![col[r]! >= 0 ? 1 : 0];
  }
  return out;
}

/**
 * Place a grid-space tractogram (the bundled one) in patient space using the
 * affine of the volume it was registered to.
 */
export function gridToLps(
  tg: Tractogram,
  ijkToLps: Float64Array,
  dims: [number, number, number],
): Tractogram {
  if (tg.space !== "grid") return tg;
  const out = new Float32Array(tg.points.length);
  const m = ijkToLps;
  for (let p = 0; p < tg.points.length; p += 3) {
    const i = tg.points[p]! * (dims[0] - 1);
    const j = tg.points[p + 1]! * (dims[1] - 1);
    const k = tg.points[p + 2]! * (dims[2] - 1);
    out[p] = m[0]! * i + m[1]! * j + m[2]! * k + m[3]!;
    out[p + 1] = m[4]! * i + m[5]! * j + m[6]! * k + m[7]!;
    out[p + 2] = m[8]! * i + m[9]! * j + m[10]! * k + m[11]!;
  }
  return { ...tg, points: out, space: "lps" };
}
