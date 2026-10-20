/**
 * The reference the RPE65 benchmark compares against, and the comparison.
 *
 * Reference: the phase 3 trial of voretigene neparvovec (Russell et al.,
 * Lancet 2017). Its primary endpoint was the change in multi-luminance
 * mobility test (MLMT) score, a functional-vision test. The hypothetical
 * therapy model outputs a relative photoreceptor light response instead.
 * There is no validated mapping between the two, so the comparison is
 * limited to what both can speak to: direction and timing. Magnitude is
 * reported as not comparable rather than forced.
 */

import type { TherapyPoint } from "./therapy";

export const REFERENCE = {
  citation:
    "Russell S, et al. Efficacy and safety of voretigene neparvovec (AAV2-hRPE65v2) in patients with RPE65-mediated inherited retinal dystrophy: a randomised, controlled, open-label, phase 3 trial. Lancet. 2017;390:849–860.",
  design: "31 participants randomised 2:1 to intervention or control; outcome at 1 year.",
  endpoint: "Change in bilateral multi-luminance mobility test (MLMT) score, light levels",
  intervention: { mean: 1.8, sd: 1.1 },
  control: { mean: 0.2, sd: 1.0 },
  timing: "Improvement was seen by day 30 and maintained to 1 year.",
  checked: false,
};

export type Verdict = "agrees" | "differs" | "not-comparable";

export type Comparison = {
  key: string;
  aspect: string;
  reference: string;
  model: string;
  verdict: Verdict;
};

/** Day the treated-vs-untreated difference first reaches `frac` of its final value. */
export function dayToFraction(series: TherapyPoint[], frac: number): number | null {
  const gain = (p: TherapyPoint) => p.signalRetina - p.signalNoTreatment;
  const end = gain(series[series.length - 1]!);
  if (!(end > 0)) return null;
  const hit = series.find((p) => gain(p) >= frac * end);
  return hit ? hit.day : null;
}

export function compareToReference(series: TherapyPoint[]): Comparison[] {
  const last = series[series.length - 1]!;
  const gain = last.signalRetina - last.signalNoTreatment;
  const half = dayToFraction(series, 0.5);
  const at30 = series.find((p) => p.day === 30);
  const peak = Math.max(...series.map((p) => p.signalRetina - p.signalNoTreatment));
  return [
    {
      key: "direction",
      aspect: "Direction",
      reference: `Improved: ${REFERENCE.intervention.mean} vs ${REFERENCE.control.mean} light levels (treated vs control).`,
      model:
        gain > 0
          ? `Improved: light response +${(gain * 100).toFixed(1)} points of healthy at day ${last.day}.`
          : "No improvement.",
      verdict: gain > 0 ? "agrees" : "differs",
    },
    {
      key: "onset",
      aspect: "Onset",
      reference: "Improvement present by day 30.",
      model:
        half === null || !at30
          ? "No improvement to time."
          : `Half of the final gain by day ${half}; at day 30, ${(((at30.signalRetina - at30.signalNoTreatment) / gain) * 100).toFixed(0)}% of it.`,
      verdict: half !== null && half <= 30 ? "agrees" : "differs",
    },
    {
      key: "durability",
      aspect: "Durability to 1 year",
      reference: "Maintained at 1 year.",
      model:
        last.day < 365
          ? "Simulation shorter than 1 year."
          : `${((gain / peak) * 100).toFixed(0)}% of the peak gain remains at day ${last.day}.`,
      verdict:
        last.day >= 365 && gain >= 0.9 * peak
          ? "agrees"
          : last.day < 365
            ? "not-comparable"
            : "differs",
    },
    {
      key: "magnitude",
      aspect: "Size of effect",
      reference: "1.6 light levels more than control on the MLMT.",
      model: "Relative light response; no validated mapping to MLMT light levels.",
      verdict: "not-comparable",
    },
  ];
}
