/**
 * The optics are checked against the Le Grand eye's published values
 * (relaxed 59.94 D, focusing at 24.197 mm; accommodated 67.68 D) and against
 * physics that must hold whatever the model. Image inputs are synthetic.
 */
import { describe, expect, it } from "vitest";
import {
  EMMETROPIC_LENGTH,
  LE_GRAND_ACCOMMODATED,
  LE_GRAND_RELAXED,
  imageZ,
  makeEye,
  power,
  rayFan,
  refract,
  rmsSpotDiameter,
  simulateEye,
  surfacesAt,
  traceRay,
  vergenceForRetina,
} from "./optics";
import {
  blur,
  boxRadiusForSigma,
  invert,
  retinalPosition,
  sigmaPx,
  type Pixels,
} from "./retinalImage";

describe("Le Grand schematic eye, paraxial", () => {
  it("reproduces the published powers and focus", () => {
    expect(power(LE_GRAND_RELAXED)).toBeCloseTo(59.94, 2);
    expect(imageZ(LE_GRAND_RELAXED, 0)).toBeCloseTo(EMMETROPIC_LENGTH, 2);
    expect(power(LE_GRAND_ACCOMMODATED)).toBeCloseTo(67.68, 1);
  });

  it("blends between relaxed and accommodated", () => {
    expect(power(surfacesAt(0))).toBeCloseTo(power(LE_GRAND_RELAXED), 6);
    expect(power(surfacesAt(1))).toBeCloseTo(power(LE_GRAND_ACCOMMODATED), 6);
    const mid = power(surfacesAt(0.5));
    expect(mid).toBeGreaterThan(power(LE_GRAND_RELAXED));
    expect(mid).toBeLessThan(power(LE_GRAND_ACCOMMODATED));
  });

  it("finds the vergence that focuses on a given retina", () => {
    const s = surfacesAt(0);
    expect(vergenceForRetina(s, EMMETROPIC_LENGTH)).toBeCloseTo(0, 2);
    const v = vergenceForRetina(s, 25.2);
    expect(v).toBeLessThan(0); // a long eye focuses near objects, not distant ones
    expect(imageZ(s, v)).toBeCloseTo(25.2, 6);
  });
});

describe("exact ray trace", () => {
  it("leaves an axial ray undeviated", () => {
    const r = traceRay(makeEye(0, 4, EMMETROPIC_LENGTH), [-5, 0], [1, 0]);
    expect(r.status).toBe("retina");
    expect(r.retinaY).toBeCloseTo(0, 9);
  });

  it("obeys Snell's law", () => {
    const d = refract([Math.sin(0.5), Math.cos(0.5)], [0, -1], 1, 1.5)!;
    expect(Math.sin(0.5)).toBeCloseTo(1.5 * d[0], 9);
  });

  it("stops rays outside the pupil", () => {
    const eye = makeEye(0, 2, EMMETROPIC_LENGTH);
    const fan = rayFan(eye, { distance: Infinity, angleDeg: 0 }, Infinity);
    expect(fan.length).toBeGreaterThan(10);
    for (const r of fan) expect(Math.abs(r.pupilY!)).toBeLessThanOrEqual(1);
    expect(traceRay(eye, [-5, 2.5], [1, 0]).status).toBe("blocked");
  });

  it("brings distant light to a small spot on the model's retina through a small pupil", () => {
    expect(rmsSpotDiameter(makeEye(0, 1, EMMETROPIC_LENGTH), Infinity)!).toBeLessThan(0.005);
  });

  it("blurs more with a bigger pupil when out of focus", () => {
    const small = rmsSpotDiameter(makeEye(0, 2, 25.2), Infinity)!;
    const big = rmsSpotDiameter(makeEye(0, 6, 25.2), Infinity)!;
    expect(big).toBeGreaterThan(2 * small);
  });

  it("forms an inverted image", () => {
    const eye = makeEye(0, 3, EMMETROPIC_LENGTH);
    const top = rayFan(eye, { distance: Infinity, angleDeg: 5 }, 5);
    for (const r of top) expect(r.retinaY!).toBeLessThan(0);
  });
});

describe("simulateEye", () => {
  const base = { pupilDiameter: 3, axialLength: EMMETROPIC_LENGTH } as const;

  it("focuses a distant object without effort", () => {
    const r = simulateEye({ ...base, distance: Infinity, accommodation: "auto" });
    expect(r.accommodation).toBe(0);
    expect(Math.abs(r.focusErrorD)).toBeLessThan(0.01);
    expect(r.farPointMm).toBe(Infinity);
  });

  it("accommodates for a near object within range, and not beyond it", () => {
    const r = simulateEye({ ...base, distance: 500, accommodation: "auto" });
    expect(r.accommodation).toBeGreaterThan(0);
    expect(Math.abs(r.focusErrorD)).toBeLessThan(0.01);
    const tooClose = simulateEye({ ...base, distance: 60, accommodation: "auto" });
    expect(tooClose.accommodation).toBe(1);
    expect(tooClose.focusErrorD).toBeLessThan(-1); // focus falls behind the retina
    expect(r.nearPointMm).toBeGreaterThan(60);
  });

  it("models axial short sight: a long eye cannot focus far away", () => {
    const r = simulateEye({
      ...base,
      axialLength: 25.2,
      distance: Infinity,
      accommodation: "auto",
    });
    expect(r.accommodation).toBe(0);
    expect(r.focusErrorD).toBeGreaterThan(1); // image in front of the retina
    expect(r.imageZ).toBeLessThan(25.2);
    expect(Number.isFinite(r.farPointMm)).toBe(true);
  });

  it("reports retinal scale near 0.29 mm per degree", () => {
    expect(simulateEye({ ...base, distance: Infinity, accommodation: 0 }).mmPerDegree).toBeCloseTo(
      0.29,
      2,
    );
  });
});

const img = (w: number, h: number, f: (x: number, y: number) => number): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = f(x, y);
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
};

describe("retinal image (synthetic test patterns)", () => {
  it("inverts top-left to bottom-right, and twice is identity", () => {
    const a = img(4, 3, (x, y) => x * 10 + y);
    const b = invert(a);
    expect(b.data[0]).toBe(a.data[(3 * 4 - 1) * 4]);
    expect(Array.from(invert(b).data)).toEqual(Array.from(a.data));
  });

  it("blurs without changing overall brightness, and zero blur is identity", () => {
    const a = img(32, 32, (x) => (x === 16 ? 255 : 0));
    const mean = (p: Pixels) => p.data.reduce((s, v, i) => (i % 4 === 0 ? s + v : s), 0);
    const b = blur(a, 3);
    expect(Math.abs(mean(b) - mean(a)) / mean(a)).toBeLessThan(0.02);
    expect(b.data[16 * 4]).toBeLessThan(255);
    expect(Array.from(blur(a, 0).data)).toEqual(Array.from(a.data));
    expect(boxRadiusForSigma(0)).toBe(0);
  });

  it("converts retinal spot size to image pixels", () => {
    // 290 µm ≈ 1° at 0.29 mm/°; 1° of a 10° scene is 25.6 px of 256.
    expect(sigmaPx(290, 0.29, 256) * 2 * Math.SQRT2).toBeCloseTo(25.6, 1);
  });

  it("puts the scene centre on the fovea and mirrors positions", () => {
    const c = retinalPosition(127.5, 127.5, 256, 0.29);
    expect(Math.abs(c.degX) < 0.05 && Math.abs(c.degY) < 0.05).toBe(true);
    const tl = retinalPosition(0, 0, 256, 0.29);
    expect(tl.degX).toBeLessThan(0);
    expect(tl.mmX).toBeGreaterThan(0);
    expect(tl.mmY).toBeLessThan(0);
  });
});
