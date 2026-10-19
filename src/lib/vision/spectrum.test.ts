/** The concept view's colour translation and its drawn (illustrative) scene. */
import { describe, expect, it } from "vitest";
import { BAND_CODES, composite, makeConceptScene, regionAt, type SpectralScene } from "./spectrum";

const one = (rgb: [number, number, number], uv: number, nir: number): SpectralScene => ({
  width: 1,
  height: 1,
  rgb: new Uint8ClampedArray([...rgb, 255]),
  uv: new Float32Array([uv]),
  nir: new Float32Array([nir]),
});
const px = (s: SpectralScene, m: Parameters<typeof composite>[1]) =>
  Array.from(composite(s, m).data);

describe("concept view colour translation", () => {
  it("leaves human vision unchanged", () => {
    expect(px(one([10, 20, 30], 1, 1), "human")).toEqual([10, 20, 30, 255]);
  });

  it("adds nothing in ultraviolet where there is no ultraviolet", () => {
    expect(px(one([10, 20, 30], 0, 0.5), "uv")).toEqual([10, 20, 30, 255]);
  });

  it("tints towards the stated ultraviolet colour", () => {
    const [r, g, b] = px(one([0, 0, 0], 1, 0), "uv");
    const [ur, ug, ub] = BAND_CODES.uv.colour;
    expect([r, g, b]).toEqual([ur, ug, ub].map((c) => Math.round(0.85 * c)));
  });

  it("shows near-infrared as red and shifts red and green down", () => {
    expect(px(one([200, 100, 50], 0, 1), "nir")).toEqual([255, 200, 100, 255]);
  });

  it("combines both translations", () => {
    expect(px(one([200, 100, 50], 0, 1), "both")).toEqual(px(one([200, 100, 50], 0, 1), "nir"));
  });
});

describe("drawn concept scene (illustrative values)", () => {
  it("gives flowers an ultraviolet target pattern", () => {
    const tip = regionAt(0.38 + 0.03, 0.7);
    const centre = regionAt(0.38, 0.7);
    expect(tip.region).toBe("petal");
    expect(tip.paint.uv).toBeGreaterThan(0.5);
    expect(centre.paint.uv).toBeLessThan(0.1);
  });

  it("makes leaves bright and water dark in near-infrared", () => {
    expect(regionAt(0.18, 0.36).paint.nir).toBeGreaterThan(0.8);
    expect(regionAt(0.74, 0.8).paint.nir).toBeLessThan(0.1);
  });

  it("fills every pixel", () => {
    const s = makeConceptScene(32);
    expect(s.rgb.length).toBe(32 * 32 * 4);
    expect(Array.from(s.rgb).every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
  });
});
