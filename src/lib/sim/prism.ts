/**
 * PRISM safety gate — the hard constraint of the CIRCUIT loop.
 *
 * The neurosymbolic layer is represented by explicit, named predicates over a
 * formal intent. Every predicate must hold or the loop HALTS and nothing is
 * written to tissue. The gate is deterministic: the same intent and state
 * always give the same decision, and there is no override.
 *
 * (The design document's PRISM also includes a brain foundation model that
 * decodes intent from multimodal recordings. That model is not part of this
 * simulation; its <5 ms latency budget is carried as a spec.)
 */

import { SAFETY_LIMITS } from "./specs";
import type { RegionKey } from "./neural";

export type Intent = {
  regions: { region: RegionKey; gain: number; u: number }[];
  sign: 1 | -1;
  /** Predicted endpoint change if delivered (model units, > 0 = better). */
  predictedBenefit: number;
  /** Margin of the chosen intent over holding (0–1). */
  confidence: number;
  /** Predicted plasticity index of each target after the write. */
  predictedPlasticity: number;
};

export type GateInputs = {
  intent: Intent;
  allowedRegions: RegionKey[];
  perRegion: {
    region: RegionKey;
    mechanicalIndex: number;
    isptaMwCm2: number;
    predictedTempC: number;
    offTargetFraction: number;
    doseS: number;
    focalGainOk: boolean;
  }[];
  aggregateDoseS: number;
  minConfidence: number;
};

export type Rule = {
  id: string;
  label: string;
  pass: boolean;
  value: string;
  limit: string;
};

export type Verification = {
  verified: boolean;
  rules: Rule[];
  reason: string | null;
};

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");

export function verify(g: GateInputs): Verification {
  const L = SAFETY_LIMITS;
  const rules: Rule[] = [];
  const worst = <K extends keyof GateInputs["perRegion"][number]>(k: K) =>
    g.perRegion.reduce((m, r) => Math.max(m, Number(r[k])), 0);

  rules.push({
    id: "P1",
    label: "Intent well-formed: every target is a placed, allowed region",
    pass:
      g.intent.regions.length > 0 &&
      g.intent.regions.every((r) => g.allowedRegions.includes(r.region) && Number.isFinite(r.gain)),
    value: g.intent.regions.map((r) => r.region).join(", ") || "none",
    limit: g.allowedRegions.join(", "),
  });
  rules.push({
    id: "P2",
    label: "Decoder confidence above threshold",
    pass: g.intent.confidence >= g.minConfidence,
    value: f(g.intent.confidence),
    limit: `≥ ${f(g.minConfidence)}`,
  });
  rules.push({
    id: "P3",
    label: "Predicted benefit is positive (intent coherent with goal)",
    pass: g.intent.predictedBenefit > 0,
    value: f(g.intent.predictedBenefit, 3),
    limit: "> 0",
  });
  rules.push({
    id: "S1",
    label: "Mechanical index",
    pass: worst("mechanicalIndex") <= L.mechanicalIndex,
    value: f(worst("mechanicalIndex"), 3),
    limit: `≤ ${L.mechanicalIndex}`,
  });
  rules.push({
    id: "S2",
    label: "I_SPTA (time-averaged intensity)",
    pass: worst("isptaMwCm2") <= L.isptaMwCm2,
    value: `${f(worst("isptaMwCm2"), 1)} mW/cm²`,
    limit: `≤ ${L.isptaMwCm2} mW/cm²`,
  });
  rules.push({
    id: "S3",
    label: "Predicted focal temperature rise",
    pass: worst("predictedTempC") <= L.deltaTC,
    value: `${f(worst("predictedTempC"), 3)} °C`,
    limit: `≤ ${L.deltaTC} °C`,
  });
  rules.push({
    id: "S4",
    label: "Off-target pressure (outside the focal region)",
    pass: g.perRegion.every((r) => r.offTargetFraction <= L.offTargetFraction && r.focalGainOk),
    value: `${f(worst("offTargetFraction"))} × focus`,
    limit: `≤ ${L.offTargetFraction} × focus`,
  });
  rules.push({
    id: "S5",
    label: "Session dose per region",
    pass: worst("doseS") <= L.sessionDoseS,
    value: `${f(worst("doseS"), 1)} s`,
    limit: `≤ ${L.sessionDoseS} s`,
  });
  rules.push({
    id: "S6",
    label: "Concurrent multi-region dose",
    pass: g.aggregateDoseS <= L.aggregateDoseS,
    value: `${f(g.aggregateDoseS, 1)} s`,
    limit: `≤ ${L.aggregateDoseS} s`,
  });
  rules.push({
    id: "S7",
    label: "Homeostatic plasticity ceiling",
    pass: g.intent.predictedPlasticity <= L.homeostaticCeiling,
    value: `${f(g.intent.predictedPlasticity, 3)} × W₀`,
    limit: `≤ ${L.homeostaticCeiling} × W₀`,
  });

  const failed = rules.find((r) => !r.pass);
  return {
    verified: !failed,
    rules,
    reason: failed ? `${failed.id} ${failed.label}: ${failed.value} (limit ${failed.limit})` : null,
  };
}
