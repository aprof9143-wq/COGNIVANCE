import { describe, expect, it } from "vitest";
import { enhance, enhancementActive, NO_ENHANCEMENT, toRgba, windowed } from "./display";
import { greyLevel } from "./voi";

describe("display stage", () => {
  const values = Float32Array.from([-1000, 0, 40, 79, 200, Number.NaN]);

  it("with no enhancement reproduces the DICOM grayscale pipeline exactly", () => {
    const w = windowed(values, 40, 80, "LINEAR");
    expect(enhance(w, 6, 1, NO_ENHANCEMENT)).toBe(w);
    const rgba = new Uint8ClampedArray(6 * 4);
    toRgba(w, null, 6, 1, "MONOCHROME2", rgba);
    for (let i = 0; i < 5; i++)
      expect(rgba[i * 4]).toBe(
        greyLevel(values[i]!, { center: 40, width: 80 }, "LINEAR", "MONOCHROME2"),
      );
    // No data is black, not "value 0 windowed".
    expect(rgba[5 * 4]).toBe(0);
  });

  it("MONOCHROME1 inverts at presentation", () => {
    const w = windowed(values, 40, 80, "LINEAR");
    const rgba = new Uint8ClampedArray(6 * 4);
    toRgba(w, null, 6, 1, "MONOCHROME1", rgba);
    expect(rgba[0]).toBe(255);
    expect(rgba[4 * 4]).toBe(0);
  });

  it("enhancements never modify their input and stay within [0,1]", () => {
    const w = 16;
    const h = 16;
    const img = Float32Array.from({ length: w * h }, (_, i) => ((i * 37) % 100) / 100);
    const copy = img.slice();
    const e = enhance(img, w, h, { gamma: 0.7, sharpen: 1.5, localContrast: 0.8, denoise: 0.6 });
    expect(Array.from(img)).toEqual(Array.from(copy));
    expect(e).not.toBe(img);
    for (const v of e) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("reports whether any enhancement is active", () => {
    expect(enhancementActive(NO_ENHANCEMENT)).toBe(false);
    expect(enhancementActive({ ...NO_ENHANCEMENT, sharpen: 0.1 })).toBe(true);
  });

  it("split view shows the original left of the divider", () => {
    const orig = Float32Array.from([0, 0, 0, 0]);
    const enh = Float32Array.from([1, 1, 1, 1]);
    const rgba = new Uint8ClampedArray(16);
    toRgba(orig, enh, 4, 1, "MONOCHROME2", rgba, { split: 0.5 });
    expect([rgba[0], rgba[4], rgba[8], rgba[12]]).toEqual([0, 0, 255, 255]);
  });

  it("segmentation outline is opaque at class edges, translucent inside", () => {
    const img = Float32Array.from(new Array(9).fill(0));
    const labels = Uint16Array.from([0, 0, 0, 0, 1, 1, 0, 1, 1]);
    const rgba = new Uint8ClampedArray(36);
    toRgba(img, null, 3, 3, "MONOCHROME2", rgba, {
      labels,
      classes: [{ label: 1, name: "a", colour: [200, 100, 0] }],
      overlay: { opacity: 0.25, outline: true },
    });
    // (1,1) touches unlabelled neighbours → edge → full colour.
    expect(rgba[4 * 4]).toBe(200);
    // Hidden classes are not drawn.
    const hidden = new Uint8ClampedArray(36);
    toRgba(img, null, 3, 3, "MONOCHROME2", hidden, {
      labels,
      classes: [{ label: 1, name: "a", colour: [200, 100, 0] }],
      hidden: new Set([1]),
    });
    expect(hidden[4 * 4]).toBe(0);
  });
});
