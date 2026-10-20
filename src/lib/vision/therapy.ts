/**
 * HYPOTHETICAL MODEL. A mechanistic sketch of RPE65 gene augmentation, for
 * exploring how the pieces depend on each other. It is not fitted to trial
 * data, does not predict any patient's outcome, and its output is not a
 * clinical endpoint. Every parameter is in PARAMS, with what it stands for.
 *
 * Chain (per day, in the treated part of the retina):
 *   vector dose ──► fraction of RPE cells transduced
 *   transduction ──► RPE65 enzyme activity (after an onset lag, then a ramp)
 *   RPE65 activity ──► supply of 11-cis-retinal, the light-catching molecule
 *   11-cis supply × surviving photoreceptors ──► light response
 * and over years, photoreceptors are lost faster where the molecule is short.
 *
 * The untreated rest of the retina follows the same equations with no vector.
 */

export type TherapyInputs = {
  /** Relative vector dose: 0 = none, 1 = reference dose, up to 2. */
  dose: number;
  /** Share of the retina the injection bleb covers, 0–1. */
  treatedArea: number;
  /** Share of photoreceptors still alive at treatment, 0–1 (disease stage). */
  viableAtStart: number;
  /** Days to simulate. */
  days: number;
};

export type Param = { value: number; unit: string; what: string };

/** Illustrative values chosen for plausible shapes, not fitted. */
export const PARAMS = {
  transductionK: {
    value: 1.6,
    unit: "per dose unit",
    what: "Steepness of transduction versus dose (saturating: 1 − e^(−k·dose)).",
  },
  onsetLag: { value: 4, unit: "days", what: "Delay before the delivered gene is expressed." },
  expressionTau: {
    value: 14,
    unit: "days",
    what: "Time constant of expression rising to its plateau.",
  },
  residualActivity: {
    value: 0.02,
    unit: "of normal",
    what: "RPE65 activity left by the disease-causing variants, untreated.",
  },
  chromophoreTau: {
    value: 3,
    unit: "days",
    what: "Time for the 11-cis-retinal supply to follow a change in RPE65 activity.",
  },
  degenerationHalfLife: {
    value: 6,
    unit: "years",
    what: "Photoreceptor half-life when the light-catching molecule is fully missing; slower in proportion to supply.",
  },
} satisfies Record<string, Param>;

export type TherapyPoint = {
  day: number;
  /** Treated area: fraction of RPE cells expressing the delivered gene. */
  expression: number;
  /** Treated area: RPE65 activity, fraction of normal. */
  rpe65: number;
  /** Treated area: 11-cis-retinal supply, fraction of normal. */
  chromophore: number;
  /** Treated area: surviving photoreceptors, fraction of a healthy retina. */
  viable: number;
  /** Untreated area, for comparison. */
  viableUntreated: number;
  chromophoreUntreated: number;
  /** Light response of the treated area, fraction of healthy. */
  signalTreated: number;
  /** Whole retina: treated and untreated areas weighted by size. */
  signalRetina: number;
  /** Same retina had it not been treated. */
  signalNoTreatment: number;
};

export function transducedFraction(dose: number): number {
  return 1 - Math.exp(-PARAMS.transductionK.value * Math.max(0, dose));
}

export function simulateTherapy(inp: TherapyInputs): TherapyPoint[] {
  const p = PARAMS;
  const tMax = transducedFraction(inp.dose);
  const area = Math.min(1, Math.max(0, inp.treatedArea));
  const lambda = Math.LN2 / (p.degenerationHalfLife.value * 365);
  const res = p.residualActivity.value;

  let chrom = res;
  let chromU = res;
  let viable = Math.min(1, Math.max(0, inp.viableAtStart));
  let viableU = viable;
  const out: TherapyPoint[] = [];

  for (let day = 0; day <= inp.days; day++) {
    const ramp =
      day > p.onsetLag.value ? 1 - Math.exp(-(day - p.onsetLag.value) / p.expressionTau.value) : 0;
    const expression = tMax * ramp;
    const rpe65 = res + (1 - res) * expression;

    const sT = viable * chrom;
    const sU = viableU * chromU;
    out.push({
      day,
      expression,
      rpe65,
      chromophore: chrom,
      viable,
      viableUntreated: viableU,
      chromophoreUntreated: chromU,
      signalTreated: sT,
      signalRetina: area * sT + (1 - area) * sU,
      signalNoTreatment: sU,
    });

    // One-day Euler steps; stable because every time constant is ≥ 3 days.
    chrom += (rpe65 - chrom) / p.chromophoreTau.value;
    chromU += (res - chromU) / p.chromophoreTau.value;
    viable -= lambda * (1 - chrom) * viable;
    viableU -= lambda * (1 - chromU) * viableU;
  }
  return out;
}
