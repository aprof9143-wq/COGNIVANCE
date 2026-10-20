/** Properties the hypothetical therapy model must have, whatever its parameters. */
import { describe, expect, it } from "vitest";
import { PARAMS, simulateTherapy, transducedFraction } from "./therapy";

const base = { dose: 1, treatedArea: 0.3, viableAtStart: 0.7, days: 365 };
const last = <T>(a: T[]) => a[a.length - 1]!;

describe("gene augmentation model (hypothetical)", () => {
  it("does nothing without vector", () => {
    const r = simulateTherapy({ ...base, dose: 0 });
    for (const p of r) {
      expect(p.expression).toBe(0);
      expect(p.signalRetina).toBeCloseTo(p.signalNoTreatment, 12);
    }
  });

  it("expresses nothing before the onset lag", () => {
    const r = simulateTherapy(base);
    for (const p of r.filter((x) => x.day <= PARAMS.onsetLag.value)) expect(p.expression).toBe(0);
    expect(last(r).expression).toBeGreaterThan(0.5);
  });

  it("keeps every quantity a fraction between 0 and 1", () => {
    for (const p of simulateTherapy({
      ...base,
      dose: 2,
      treatedArea: 1,
      viableAtStart: 1,
      days: 3650,
    }))
      for (const v of Object.values(p).slice(1)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
  });

  it("saturates with dose and never decreases", () => {
    const f = [0, 0.5, 1, 1.5, 2].map(transducedFraction);
    for (let i = 1; i < f.length; i++) expect(f[i]!).toBeGreaterThan(f[i - 1]!);
    expect(f[4]! - f[3]!).toBeLessThan(f[1]! - f[0]!);
  });

  it("improves the treated retina over the untreated one", () => {
    const end = last(simulateTherapy(base));
    expect(end.signalRetina).toBeGreaterThan(end.signalNoTreatment);
    expect(end.signalTreated).toBeGreaterThan(end.signalRetina);
  });

  it("is limited by how many photoreceptors are left", () => {
    const early = last(simulateTherapy({ ...base, viableAtStart: 0.9 }));
    const late = last(simulateTherapy({ ...base, viableAtStart: 0.3 }));
    expect(late.signalTreated).toBeLessThan(early.signalTreated);
    expect(late.signalTreated).toBeLessThanOrEqual(0.3);
  });

  it("slows degeneration where the cycle is restored", () => {
    const end = last(simulateTherapy({ ...base, days: 3650 }));
    expect(end.viable).toBeGreaterThan(end.viableUntreated);
    expect(end.viableUntreated).toBeLessThan(base.viableAtStart);
  });
});

describe("comparison with the trial reference", async () => {
  const { compareToReference, dayToFraction } = await import("./reference");

  it("compares direction and timing, and never magnitude", () => {
    const c = compareToReference(simulateTherapy(base));
    expect(c.find((x) => x.key === "direction")!.verdict).toBe("agrees");
    expect(c.find((x) => x.key === "magnitude")!.verdict).toBe("not-comparable");
    expect(c.find((x) => x.key === "durability")!.verdict).toBe("agrees");
  });

  it("reports no onset when nothing is given", () => {
    const r = simulateTherapy({ ...base, dose: 0 });
    expect(dayToFraction(r, 0.5)).toBeNull();
    expect(compareToReference(r).find((x) => x.key === "direction")!.verdict).toBe("differs");
  });

  it("flags a too-short simulation as not comparable on durability", () => {
    const c = compareToReference(simulateTherapy({ ...base, days: 90 }));
    expect(c.find((x) => x.key === "durability")!.verdict).toBe("not-comparable");
  });
});

describe("retina to visual cortex (existing network model)", async () => {
  const { cortexCurve, cortexAt } = await import("./cortex");
  const curve = cortexCurve();

  it("spans full loss to healthy", () => {
    expect(curve[0]!.v1).toBeCloseTo(0, 6);
    expect(curve[curve.length - 1]!.v1).toBeCloseTo(1, 6);
  });

  it("gives more cortical response for more retinal signal", () => {
    expect(cortexAt(curve, 0.8)).toBeGreaterThan(cortexAt(curve, 0.2));
    expect(cortexAt(curve, 0.5)).toBeGreaterThan(0.05);
  });

  it("is reproducible for a seed", () => {
    expect(cortexCurve(7, 5)).toEqual(cortexCurve(7, 5));
  });
});
