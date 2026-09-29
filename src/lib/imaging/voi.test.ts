import { describe, expect, it } from "vitest";
import {
  clippedFractions,
  greyLevel,
  histogram,
  modalityValue,
  presentation,
  voi,
  windowOptions,
} from "./voi";
import type { ImageVolume } from "./types";

describe("modality LUT", () => {
  it("applies slope and intercept (CT stored 1000, intercept −1024 → −24 HU)", () => {
    expect(modalityValue(1000, 1, -1024)).toBe(-24);
    expect(modalityValue(10, 2.5, 3)).toBe(28);
  });
});

describe("VOI LUT — LINEAR (PS3.3 C.11.2.1.2.1)", () => {
  // c = 40, w = 80 → lower bound c − 0.5 − (w − 1)/2 = 0, upper c − 0.5 + (w − 1)/2 = 79
  it("maps at and below the lower bound to 0", () => {
    expect(voi(0, 40, 80)).toBe(0);
    expect(voi(-500, 40, 80)).toBe(0);
  });
  it("maps above the upper bound to 1", () => {
    expect(voi(79.0001, 40, 80)).toBe(1);
    expect(voi(3000, 40, 80)).toBe(1);
  });
  it("is 0.5 at c − 0.5 and linear between", () => {
    expect(voi(39.5, 40, 80)).toBeCloseTo(0.5, 12);
    expect(voi(39.5 + 79 / 4, 40, 80)).toBeCloseTo(0.75, 12);
  });
  it("treats widths below 1 as 1 (a step at c − 0.5)", () => {
    expect(voi(39, 40, 0.2)).toBe(0);
    expect(voi(40, 40, 0.2)).toBe(1);
  });
});

describe("VOI LUT — LINEAR_EXACT and SIGMOID", () => {
  it("LINEAR_EXACT has no half-unit offsets", () => {
    expect(voi(0, 40, 80, "LINEAR_EXACT")).toBe(0);
    expect(voi(40, 40, 80, "LINEAR_EXACT")).toBe(0.5);
    expect(voi(80, 40, 80, "LINEAR_EXACT")).toBe(1);
  });
  it("SIGMOID is 0.5 at the centre and symmetric", () => {
    expect(voi(40, 40, 80, "SIGMOID")).toBeCloseTo(0.5, 12);
    expect(voi(60, 40, 80, "SIGMOID") + voi(20, 40, 80, "SIGMOID")).toBeCloseTo(1, 12);
  });
});

describe("photometric interpretation", () => {
  it("MONOCHROME1 shows the minimum as white", () => {
    expect(presentation(0, "MONOCHROME1")).toBe(1);
    expect(presentation(1, "MONOCHROME1")).toBe(0);
    expect(greyLevel(-1000, { center: 40, width: 80 }, "LINEAR", "MONOCHROME1")).toBe(255);
    expect(greyLevel(-1000, { center: 40, width: 80 }, "LINEAR", "MONOCHROME2")).toBe(0);
  });
  it("MONOCHROME2 is unchanged", () => {
    expect(presentation(0.3, "MONOCHROME2")).toBe(0.3);
  });
});

function fakeVolume(values: number[], extra: Partial<ImageVolume> = {}): ImageVolume {
  const data = Float32Array.from(values);
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return {
    data,
    valueScale: null,
    range: { min, max },
    windows: [],
    quantitative: false,
    unit: "signal intensity (a.u.)",
    ...extra,
  } as ImageVolume;
}

describe("histogram", () => {
  it("counts every value and finds quantiles", () => {
    const vol = fakeVolume(Array.from({ length: 1000 }, (_, i) => i));
    const h = histogram(vol, 100);
    expect(h.total).toBe(1000);
    expect(h.quantile(0.5)).toBeGreaterThan(480);
    expect(h.quantile(0.5)).toBeLessThan(520);
  });
  it("reports clipped fractions for a window", () => {
    const vol = fakeVolume(Array.from({ length: 1000 }, (_, i) => i));
    const c = clippedFractions(histogram(vol, 100), { center: 500, width: 500 });
    expect(c.below).toBeCloseTo(0.25, 1);
    expect(c.above).toBeCloseTo(0.25, 1);
  });
});

describe("window options", () => {
  it("offers CT presets only for calibrated CT", () => {
    const ct = fakeVolume([-1000, 0, 1000], { quantitative: true, unit: "HU" });
    const mr = fakeVolume([0, 100, 400]);
    const ctOptions = windowOptions(ct, histogram(ct)).map((w) => w.label);
    const mrOptions = windowOptions(mr, histogram(mr)).map((w) => w.label);
    expect(ctOptions).toContain("Brain");
    expect(mrOptions).not.toContain("Brain");
    // MR gets only data-derived windows (plus the file's own, if any).
    expect(mrOptions.every((l) => l.startsWith("Auto") || l === "Full range")).toBe(true);
  });
});
