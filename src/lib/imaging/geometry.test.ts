import { describe, expect, it } from "vitest";
import {
  affineFromDicom,
  affineFromQuaternion,
  apply,
  canvasToWorld,
  dot,
  edgeLabels,
  invert,
  mat4,
  multiply,
  orientationLabel,
  PLANE_AXES,
  rasToLps,
  sliceGeometry,
  sub,
  throughPoint,
  voxelVolumeMm3,
  worldToCanvas,
  type ViewState,
} from "./geometry";
import type { Vec3 } from "./types";

const near = (a: Vec3, b: Vec3, d = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, d));

describe("DICOM affine", () => {
  // Axial slice: rows run patient-left (+x), columns run posterior (+y).
  const ipp: Vec3 = [-120, -100, 50];
  const iop: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];
  const m = affineFromDicom(ipp, iop, [0.5, 0.8], [0, 0, 3]);

  it("puts voxel (0,0,0) at Image Position (Patient)", () => {
    near(apply(m, [0, 0, 0]), ipp);
  });
  it("steps along a row by the column spacing, down a column by the row spacing", () => {
    // Pixel Spacing is [row spacing, column spacing]; i moves between columns.
    near(apply(m, [1, 0, 0]), [-119.2, -100, 50]);
    near(apply(m, [0, 1, 0]), [-120, -99.5, 50]);
    near(apply(m, [0, 0, 1]), [-120, -100, 53]);
  });
  it("round-trips world ↔ voxel", () => {
    const inv = invert(m);
    for (const p of [
      [3, 7, 11],
      [0.5, 0.25, 2.75],
      [100, 200, 9],
    ] as Vec3[])
      near(apply(inv, apply(m, p)), p);
    const id = multiply(m, inv);
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((v, i) =>
      expect(id[i]).toBeCloseTo(v, 9),
    );
  });
  it("computes voxel volume from the affine", () => {
    expect(voxelVolumeMm3(m)).toBeCloseTo(0.5 * 0.8 * 3, 12);
  });
});

describe("NIfTI RAS → LPS", () => {
  it("negates x and y", () => {
    const ras = mat4([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1]);
    near(apply(rasToLps(ras), [0, 0, 0]), [-10, -20, 30]);
    near(apply(rasToLps(ras), [1, 0, 0]), [-11, -20, 30]);
  });
  it("qform with identity quaternion and qfac −1 flips k", () => {
    const q = affineFromQuaternion(0, 0, 0, 5, 6, 7, [2, 2, 3], -1);
    near(apply(q, [1, 1, 1]), [7, 8, 4]);
  });
});

describe("orientation labels", () => {
  it("labels patient axes in LPS", () => {
    expect(orientationLabel([1, 0, 0])).toBe("L");
    expect(orientationLabel([-1, 0, 0])).toBe("R");
    expect(orientationLabel([0, -1, 0])).toBe("A");
    expect(orientationLabel([0, 1, 0])).toBe("P");
    expect(orientationLabel([0, 0, 1])).toBe("S");
    expect(orientationLabel([0, 0, -1])).toBe("I");
  });
  it("gives oblique directions two letters, dominant first", () => {
    expect(orientationLabel([0.8, 0.6, 0])).toBe("LP");
    expect(orientationLabel([-0.3, 0, 0.95])).toBe("SR");
  });
  it("uses radiological edges for axial: A top, L right", () => {
    const { right, down } = PLANE_AXES.axial;
    expect(edgeLabels(right, down)).toEqual(["A", "L", "P", "R"]);
  });
  it("coronal: S top, L right; sagittal: S top, P right", () => {
    expect(edgeLabels(PLANE_AXES.coronal.right, PLANE_AXES.coronal.down)).toEqual([
      "S",
      "L",
      "I",
      "R",
    ]);
    expect(edgeLabels(PLANE_AXES.sagittal.right, PLANE_AXES.sagittal.down)).toEqual([
      "S",
      "P",
      "I",
      "A",
    ]);
  });
});

describe("viewports and crosshair synchronisation", () => {
  const W = 300;
  const H = 200;
  const views: Record<"axial" | "coronal" | "sagittal", ViewState> = {
    axial: { plane: "axial", focal: [0, 0, 0], mmPerPixel: 0.7, pan: [12, -5] },
    coronal: { plane: "coronal", focal: [4, -9, 2], mmPerPixel: 1.1, pan: [0, 0] },
    sagittal: { plane: "sagittal", focal: [-3, 1, 8], mmPerPixel: 0.5, pan: [-20, 7] },
  };

  it("canvas → world → canvas is the identity", () => {
    for (const v of Object.values(views)) {
      const p = canvasToWorld(v, W, H, 37.5, 121.25);
      const [u, w] = worldToCanvas(v, W, H, p);
      expect(u).toBeCloseTo(37.5, 9);
      expect(w).toBeCloseTo(121.25, 9);
    }
  });

  it("a point picked on one view lies on the other two views' planes after sync", () => {
    const p = canvasToWorld(views.axial, W, H, 200, 50);
    for (const plane of ["coronal", "sagittal"] as const) {
      const synced = throughPoint(views[plane], p);
      const n = PLANE_AXES[plane].normal;
      expect(dot(sub(p, synced.focal), n)).toBeCloseTo(0, 9);
      // In-plane framing is unchanged: only the normal component moved.
      expect(dot(sub(synced.focal, views[plane].focal), PLANE_AXES[plane].right)).toBeCloseTo(0, 9);
      expect(dot(sub(synced.focal, views[plane].focal), PLANE_AXES[plane].down)).toBeCloseTo(0, 9);
      // And the crosshair drawn there maps back to the same world point.
      const [u, w] = worldToCanvas(synced, W, H, p);
      near(canvasToWorld(synced, W, H, u, w), p);
    }
  });
});

describe("slice geometry", () => {
  it("steps by the voxel spacing along the most aligned axis", () => {
    const m = affineFromDicom([0, 0, 0], [1, 0, 0, 0, 1, 0], [0.5, 0.5], [0, 0, 2.5]);
    const g = sliceGeometry(m, [10, 10, 20], [0, 0, 1]);
    expect(g.step).toBeCloseTo(2.5, 12);
    expect(g.count).toBe(20);
    expect(sliceGeometry(m, [10, 10, 20], [1, 0, 0]).step).toBeCloseTo(0.5, 12);
  });
});
