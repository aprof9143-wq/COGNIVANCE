import { describe, expect, it } from "vitest";
import {
  apply,
  canvasToWorld,
  fitMmPerPixel,
  orientationLabel,
  PLANE_AXES,
  type ViewState,
} from "./geometry";
import { ellipseAreaMm2, ellipseStats, lengthMm, polygonAreaMm2 } from "./measure";
import { parseNiftiImage, parseNiftiSegmentation } from "./nifti";
import { reslice, resliceLabels, valueAtWorld, voxelValue } from "./reslice";
import { alignment, classCentroid, classVolumes } from "./segmentation";
import { writeNifti } from "./testing/fixtures";
import type { Vec3 } from "./types";

/** Voxel value encodes its own index so any reslicing error is visible. */
const code = (i: number, j: number, k: number) => i + 10 * j + 100 * k;

function volumeValues(
  dims: [number, number, number],
  f: (i: number, j: number, k: number) => number,
) {
  const out: number[] = [];
  for (let k = 0; k < dims[2]; k++)
    for (let j = 0; j < dims[1]; j++) for (let i = 0; i < dims[0]; i++) out.push(f(i, j, k));
  return out;
}

describe("NIfTI orientation", () => {
  const dims: [number, number, number] = [6, 5, 4];

  it("places voxels in LPS through the sform", () => {
    // RAS affine: 2 mm x, 3 mm y, 4 mm z, origin (10, 20, 30) RAS.
    const vol = parseNiftiImage(
      writeNifti({
        dims,
        values: volumeValues(dims, code),
        srow: [2, 0, 0, 10, 0, 3, 0, 20, 0, 0, 4, 30],
      }),
      "a.nii",
    );
    expect(apply(vol.ijkToLps, [0, 0, 0])).toEqual([-10, -20, 30]);
    expect(apply(vol.ijkToLps, [1, 1, 1])).toEqual([-12, -23, 34]);
    expect(vol.spacing).toEqual([2, 3, 4]);
    // +i is RAS +x = patient Right; in LPS that direction is labelled "R".
    expect(orientationLabel([vol.ijkToLps[0]!, vol.ijkToLps[4]!, vol.ijkToLps[8]!])).toBe("R");
    expect(vol.unit).toBe("voxel value (a.u.)");
    expect(vol.quantitative).toBe(false);
  });

  it("the same anatomy stored RAS and LAS reslices to identical patient-space images", () => {
    // Anatomy: value depends on patient position only. The LAS file stores the
    // i axis mirrored (radiological order) and says so in its sform.
    const anatomy = (x: number, y: number, z: number) => 7 * x + 3 * y + 11 * z;
    const ras = writeNifti({
      dims,
      values: volumeValues(dims, (i, j, k) => anatomy(i, j, k)),
      srow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    });
    const las = writeNifti({
      dims,
      values: volumeValues(dims, (i, j, k) => anatomy(dims[0] - 1 - i, j, k)),
      srow: [-1, 0, 0, dims[0] - 1, 0, 1, 0, 0, 0, 0, 1, 0],
    });
    const a = parseNiftiImage(ras, "ras.nii");
    const b = parseNiftiImage(las, "las.nii");
    // Focal on a voxel centre and a 0.4 mm pixel pitch: no sample lands exactly
    // half-way between voxels, where nearest-neighbour has no single answer.
    const centre = apply(a.ijkToLps, [2, 2, 2]);
    for (const plane of ["axial", "coronal", "sagittal"] as const) {
      const view: ViewState = { plane, focal: centre, mmPerPixel: 0.4, pan: [0, 0] };
      expect(Array.from(reslice(b, view, 16, 12, "nearest"))).toEqual(
        Array.from(reslice(a, view, 16, 12, "nearest")),
      );
    }
  });

  it("applies scl_slope/scl_inter without changing stored values", () => {
    const vol = parseNiftiImage(
      writeNifti({ dims: [2, 1, 1], values: [10, 20], slope: 0.5, intercept: -3 }),
      "s.nii",
    );
    expect(Array.from(vol.data)).toEqual([10, 20]);
    expect(voxelValue(vol, 1, 0, 0)).toBe(7);
  });

  it("warns when there is no orientation at all", () => {
    const vol = parseNiftiImage(
      writeNifti({ dims: [2, 2, 2], values: new Array(8).fill(1) }),
      "none.nii",
    );
    expect(vol.warnings.some((w) => w.includes("orientation is unknown"))).toBe(true);
    expect(vol.metadata.acquisitionPlane).toBe("unknown");
  });

  it("uses the qform when there is no sform", () => {
    const vol = parseNiftiImage(
      writeNifti({
        dims: [2, 2, 2],
        values: new Array(8).fill(1),
        pixdim: [2, 2, 2],
        qform: { b: 0, c: 0, d: 0, offset: [1, 2, 3], qfac: 1 },
      }),
      "q.nii",
    );
    expect(apply(vol.ijkToLps, [1, 0, 0])).toEqual([-3, -2, 3]);
  });
});

describe("multiplanar reconstruction", () => {
  const dims: [number, number, number] = [8, 7, 6];
  // Anisotropic: 0.5 × 1 × 2.5 mm, identity orientation (RAS → LPS flips x, y).
  const vol = parseNiftiImage(
    writeNifti({
      dims,
      values: volumeValues(dims, code),
      srow: [0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2.5, 0],
    }),
    "mpr.nii",
  );

  const viewAt = (plane: "axial" | "coronal" | "sagittal", p: Vec3, mm = 0.25): ViewState => ({
    plane,
    focal: p,
    mmPerPixel: mm,
    pan: [0, 0],
  });

  it("nearest-neighbour returns exact source voxel values on all three planes", () => {
    const p = apply(vol.ijkToLps, [3, 4, 2]);
    for (const plane of ["axial", "coronal", "sagittal"] as const) {
      const v = viewAt(plane, p);
      // The canvas centre pixel's centre sits exactly on the focal point.
      const out = reslice(vol, v, 21, 21, "nearest");
      expect(out[10 * 21 + 10]).toBe(code(3, 4, 2));
    }
  });

  it("an axial reslice walks the i/j grid in patient directions", () => {
    const p = apply(vol.ijkToLps, [3, 4, 2]);
    const v = viewAt("axial", p, 0.5);
    const out = reslice(vol, v, 21, 21, "nearest");
    // Screen right = patient Left (LPS +x). Voxel +i is patient Right (RAS),
    // so one pixel right (0.5 mm) is one voxel toward −i.
    expect(out[10 * 21 + 11]).toBe(code(2, 4, 2));
    // Screen down = Posterior. Voxel +j is Anterior, so one pixel down (1 mm
    // needs two pixels at 0.5 mm) is one voxel toward −j.
    expect(out[12 * 21 + 10]).toBe(code(3, 3, 2));
  });

  it("coronal and sagittal show superior at the top", () => {
    const p = apply(vol.ijkToLps, [3, 4, 2]);
    for (const plane of ["coronal", "sagittal"] as const) {
      const out = reslice(vol, viewAt(plane, p, 2.5), 5, 5, "nearest");
      expect(out[1 * 5 + 2]).toBe(code(3, 4, 3)); // one row up: one slice superior
      expect(out[3 * 5 + 2]).toBe(code(3, 4, 1));
    }
  });

  it("linear interpolation blends neighbours; outside the volume is NaN", () => {
    const a = apply(vol.ijkToLps, [3, 4, 2]);
    const b = apply(vol.ijkToLps, [4, 4, 2]);
    const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const out = reslice(vol, viewAt("axial", mid), 1, 1, "linear");
    expect(out[0]).toBeCloseTo((code(3, 4, 2) + code(4, 4, 2)) / 2, 6);
    const outside = reslice(vol, viewAt("axial", [1000, 1000, 1000]), 1, 1, "nearest");
    expect(Number.isNaN(outside[0]!)).toBe(true);
  });

  it("fit keeps physical aspect ratio (mm per pixel is one number for both axes)", () => {
    const mmpp = fitMmPerPixel(vol.ijkToLps, vol.dims, "coronal", 400, 400, 1);
    // Coronal spans x (7 × 0.5 = 3.5 mm) by z (5 × 2.5 = 12.5 mm): height limits.
    expect(mmpp).toBeCloseTo(12.5 / 400, 9);
  });

  it("probe returns the voxel under a world point", () => {
    const p = apply(vol.ijkToLps, [5, 1, 4]);
    expect(valueAtWorld(vol, p)).toEqual({ value: code(5, 1, 4), ijk: [5, 1, 4] });
  });
});

describe("measurements", () => {
  it("length is in mm and does not change with zoom or pan", () => {
    const focal: Vec3 = [0, 0, 0];
    const results = [0.2, 0.7, 3.1].map((mmpp, n) => {
      const v: ViewState = { plane: "axial", focal, mmPerPixel: mmpp, pan: [n * 13, -n * 7] };
      // The user clicks where the same two world points are drawn at this zoom.
      const toCanvas = (p: Vec3) =>
        [
          (p[0] - focal[0]) / mmpp + 50 + v.pan[0],
          (p[1] - focal[1]) / mmpp + 50 + v.pan[1],
        ] as const;
      const [u0, w0] = toCanvas([3, 4, 0]);
      const [u1, w1] = toCanvas([-9, 20, 0]);
      return lengthMm(canvasToWorld(v, 100, 100, u0, w0), canvasToWorld(v, 100, 100, u1, w1));
    });
    for (const r of results) expect(r).toBeCloseTo(20, 9);
  });

  it("areas in mm²", () => {
    expect(
      polygonAreaMm2(
        [
          [0, 0, 5],
          [10, 0, 5],
          [10, 4, 5],
          [0, 4, 5],
        ],
        "axial",
      ),
    ).toBeCloseTo(40, 12);
    expect(ellipseAreaMm2([0, 0, 0], [10, 4, 0], "axial")).toBeCloseTo(Math.PI * 5 * 2, 12);
    // A coronal rectangle spans x and z.
    expect(
      polygonAreaMm2(
        [
          [0, 3, 0],
          [2, 3, 0],
          [2, 3, 6],
          [0, 3, 6],
        ],
        "coronal",
      ),
    ).toBeCloseTo(12, 12);
  });

  it("ROI statistics use real voxel values only", () => {
    const dims: [number, number, number] = [10, 10, 1];
    const vol = parseNiftiImage(
      writeNifti({
        dims,
        values: new Array(100).fill(42),
        srow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      }),
      "flat.nii",
    );
    const a = apply(vol.ijkToLps, [2, 2, 0]);
    const b = apply(vol.ijkToLps, [6, 6, 0]);
    const s = ellipseStats(vol, "axial", a, b);
    expect(s.mean).toBe(42);
    expect(s.sd).toBe(0);
    expect(s.n).toBeGreaterThan(10);
  });
});

describe("segmentation", () => {
  const dims: [number, number, number] = [4, 4, 4];
  const labels = volumeValues(dims, (i, j, k) =>
    i < 2 && j < 2 && k < 2 ? 1 : i === 3 && j === 3 ? 2 : 0,
  );

  it("volume = voxel count × voxel volume, per class, from the native grid", () => {
    const seg = parseNiftiSegmentation(
      writeNifti({ dims, values: labels, srow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 3, 0] }),
      "seg.nii",
    );
    const v = classVolumes(seg);
    expect(v).toEqual([
      { label: 1, name: "Label 1", voxels: 8, mm3: 24, mL: 0.024 },
      { label: 2, name: "Label 2", voxels: 4, mm3: 12, mL: 0.012 },
    ]);
    expect(seg.mutuallyExclusive).toBe(true);
  });

  it("names classes only when a convention is given", () => {
    const seg = parseNiftiSegmentation(
      writeNifti({ dims, values: labels }),
      "s.nii",
      { 1: "Oedema" },
      "MSD Task01",
    );
    expect(seg.classes.map((c) => c.name)).toEqual(["Oedema", "Label 2"]);
    expect(seg.convention).toBe("MSD Task01");
  });

  it("rejects intensity images as label maps", () => {
    expect(() =>
      parseNiftiSegmentation(
        writeNifti({ dims: [2, 1, 1], values: [0.5, 1], datatype: 16 }),
        "x.nii",
      ),
    ).toThrow(/label map/);
    expect(() =>
      parseNiftiSegmentation(writeNifti({ dims: [2, 1, 1], values: [-1, 1] }), "x.nii"),
    ).toThrow(/label map/);
  });

  it("aligns a segmentation on a different grid through patient space", () => {
    // Image: 1 mm grid. Segmentation: 2 mm grid, same origin. Label 1 at seg
    // voxel (1,1,1) covers image voxels (2..3, 2..3, 2..3).
    const img = parseNiftiImage(
      writeNifti({
        dims: [8, 8, 8],
        values: new Array(512).fill(0),
        srow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      }),
      "img.nii",
    );
    const segVals = volumeValues([4, 4, 4], (i, j, k) => (i === 1 && j === 1 && k === 1 ? 1 : 0));
    const seg = parseNiftiSegmentation(
      writeNifti({ dims: [4, 4, 4], values: segVals, srow: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0] }),
      "seg.nii",
    );
    expect(alignment(seg, img).status).toBe("different-grid");
    const p = apply(img.ijkToLps, [2, 2, 2]);
    const out = resliceLabels(seg, { plane: "axial", focal: p, mmPerPixel: 1, pan: [0, 0] }, 1, 1);
    expect(out[0]).toBe(1);
    const centroid = classCentroid(seg, 1)!;
    expect(centroid).toEqual(apply(seg.ijkToLps, [1, 1, 1]));
    // The label's volume is measured on its own grid: one 2 mm voxel = 8 mm³.
    expect(classVolumes(seg)[0]!.mm3).toBe(8);
  });

  it("flags a segmentation with no overlap as a registration failure", () => {
    const img = parseNiftiImage(
      writeNifti({
        dims: [4, 4, 4],
        values: new Array(64).fill(0),
        srow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      }),
      "img.nii",
    );
    const seg = parseNiftiSegmentation(
      writeNifti({ dims, values: labels, srow: [1, 0, 0, 500, 0, 1, 0, 0, 0, 0, 1, 0] }),
      "far.nii",
    );
    expect(alignment(seg, img).status).toBe("no-overlap");
    const same = parseNiftiSegmentation(
      writeNifti({
        dims: [4, 4, 4],
        values: new Array(64).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
        srow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      }),
      "same.nii",
    );
    expect(alignment(same, img).status).toBe("same-grid");
  });
});

describe("plane axes", () => {
  it("are orthonormal right-handed triads", () => {
    for (const { right, down, normal } of Object.values(PLANE_AXES)) {
      const dotp = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dotp(right, down)).toBe(0);
      expect(Math.abs(dotp(right, normal))).toBe(0);
      expect(Math.abs(dotp(down, normal))).toBe(0);
    }
  });
});
