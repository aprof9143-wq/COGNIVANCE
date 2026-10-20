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
