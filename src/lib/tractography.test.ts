import { describe, expect, it } from "vitest";
import { axisCodes, gridToLps, parseTck, parseTrk, type Tractogram } from "./tractography";
import { affineFromDicom } from "./imaging/geometry";

/** Minimal TrackVis v2 file: one streamline, no scalars or properties. */
function writeTrk(
  points: number[][],
  opts: { voxelSize: number[]; v2r: number[] | null; voxelOrder?: string },
) {
  const buf = new ArrayBuffer(1000 + 4 + points.length * 12);
  const dv = new DataView(buf);
  "TRACK".split("").forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  opts.voxelSize.forEach((v, i) => dv.setFloat32(12 + i * 4, v, true));
  if (opts.v2r) opts.v2r.forEach((v, i) => dv.setFloat32(440 + i * 4, v, true));
  (opts.voxelOrder ?? "").split("").forEach((c, i) => dv.setUint8(948 + i, c.charCodeAt(0)));
  dv.setInt32(988, 1, true);
  dv.setInt32(992, 2, true);
  dv.setInt32(996, 1000, true);
  dv.setInt32(1000, points.length, true);
  points.forEach((p, i) => p.forEach((v, j) => dv.setFloat32(1004 + i * 12 + j * 4, v, true)));
  return buf;
}

const pts = (tg: Tractogram) => Array.from(tg.points).map((v) => Math.round(v * 1000) / 1000);

describe(".trk placement", () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  it("maps voxmm through vox_to_ras (half-voxel corner convention) into LPS", () => {
    // 2 mm voxels. voxmm (1, 3, 5) → voxel (0, 1, 2) → RAS with v2r scaling 2 mm and offset.
    const v2r = [2, 0, 0, 10, 0, 2, 0, 20, 0, 0, 2, 30, 0, 0, 0, 1];
    const tg = parseTrk(
      writeTrk(
        [
          [1, 3, 5],
          [3, 3, 5],
        ],
        { voxelSize: [2, 2, 2], v2r, voxelOrder: "RAS" },
      ),
    );
    expect(tg.space).toBe("lps");
    // RAS (10, 22, 34) → LPS (−10, −22, 34); second point one voxel along +x RAS.
    expect(pts(tg)).toEqual([-10, -22, 34, -12, -22, 34]);
  });

  it("refuses to place a file with no vox_to_ras", () => {
    const tg = parseTrk(
      writeTrk(
        [
          [0, 0, 0],
          [1, 1, 1],
        ],
        { voxelSize: [1, 1, 1], v2r: null },
      ),
    );
    expect(tg.space).toBe("unplaced");
    expect(tg.warnings[0]).toMatch(/cannot be placed/);
  });

  it("refuses when voxel_order contradicts the affine", () => {
    const tg = parseTrk(
      writeTrk(
        [
          [0, 0, 0],
          [1, 1, 1],
        ],
        { voxelSize: [1, 1, 1], v2r: identity, voxelOrder: "LAS" },
      ),
    );
    expect(tg.space).toBe("unplaced");
    expect(axisCodes(identity)).toBe("RAS");
  });
});

describe(".tck placement", () => {
  it("converts scanner RAS to LPS and keeps the header's tracking parameters", () => {
    const header =
      "mrtrix tracks\nmethod: iFOD2\nstep_size: 0.625\ncount: 1\ndatatype: Float32LE\nfile: . 128\nEND\n";
    const buf = new ArrayBuffer(128 + 4 * 12);
    new Uint8Array(buf).set(new TextEncoder().encode(header));
    const dv = new DataView(buf);
    [1, 2, 3, 4, 5, 6, Number.NaN, Number.NaN, Number.NaN, Infinity, Infinity, Infinity].forEach(
      (v, i) => dv.setFloat32(128 + i * 4, v, true),
    );
    const tg = parseTck(buf);
    expect(tg.space).toBe("lps");
    expect(pts(tg)).toEqual([-1, -2, 3, -4, -5, 6]);
    expect(tg.parameters).toMatchObject({ method: "iFOD2", step_size: "0.625" });
  });
});

describe("grid → LPS", () => {
  it("places grid coordinates with the registered volume's affine", () => {
    const tg: Tractogram = {
      points: Float32Array.from([0, 0, 0, 1, 1, 1]),
      offsets: Uint32Array.from([0, 2]),
      count: 1,
      totalInFile: 1,
      format: "bundled",
      description: "",
      space: "grid",
      parameters: {},
      warnings: [],
    };
    const m = affineFromDicom([5, 6, 7], [1, 0, 0, 0, 1, 0], [2, 2], [0, 0, 2]);
    const out = gridToLps(tg, m, [11, 11, 11]);
    expect(out.space).toBe("lps");
    expect(pts(out)).toEqual([5, 6, 7, 25, 26, 27]);
  });
});
