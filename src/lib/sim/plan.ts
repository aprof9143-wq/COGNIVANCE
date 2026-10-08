/**
 * Array placement and the verified plan: for each target of a programme,
 * where the array sits, which way it faces, and how much margin the planned
 * write-back keeps to each safety limit at full drive.
 *
 * Every margin is computed from the same physics and limits the PRISM gate
 * enforces in the loop (specs.ts SAFETY_LIMITS, loop.ts). The plan is the
 * worst case before the loop runs; PRISM still checks every intent.
 *
 * Measures this design has no physics for are listed as not modelled, never
 * given a number.
 *
 * Clinical deployment of this software would need a medical-device software
 * lifecycle (IEC 62304). This simulation is not developed under one.
 */

import { heatStep, type ArrayDesign, type Vec3 } from "./acoustics";
import { BURST_MS, SENSE_MS, type TargetBeam } from "./loop";
import type { RegionKey } from "./neural";
import { ASSUMPTIONS, SAFETY_LIMITS } from "./specs";

export type Margin = {
  key: "mi" | "ispta" | "deltaT" | "offTarget" | "focus";
  label: string;
  value: number;
  limit: number;
  unit: string;
  digits: number;
  /** Headroom as a fraction of the limit; negative when the limit is exceeded. */
  margin: number;
  pass: boolean;
  /** How the value is obtained. */
  basis: string;
};

export type TargetPlan = {
  region: RegionKey;
  /** Array centre on the brain surface, MNI152 RAS mm. */
  centre: Vec3;
  /** Unit normal from the array toward the target. */
  normal: Vec3;
  /** Array centre to target, mm. */
  depthMm: number;
  margins: Margin[];
  pass: boolean;
};

export const NOT_MODELLED: { label: string; reason: string }[] = [
  { label: "RF SAR", reason: "No RF emitter: write-back is focused ultrasound." },
  {
    label: "Stimulation charge density",
    reason: "No electrical stimulation: the PEDOT:PSS mesh only records.",
  },
  {
    label: "Distance to major vessels",
    reason: "No vascular map of the anatomy is loaded.",
  },
];

const margin = (
  key: Margin["key"],
  label: string,
  value: number,
  limit: number,
  unit: string,
  digits: number,
  basis: string,
): Margin => ({
  key,
  label,
  value,
  limit,
  unit,
  digits,
  margin: (limit - value) / limit,
  pass: value <= limit,
  basis,
});

/** Placement and safety margins of one target at full drive. */
export function planTarget(b: TargetBeam, design: ArrayDesign, dutyLimit: number): TargetPlan {
  const m = b.metrics;
  const burstS = (BURST_MS * dutyLimit) / 1000;
  const periodS = (SENSE_MS + BURST_MS) / 1000;
  const pd = ASSUMPTIONS.pulseDuty;
  // Same quantities as CircuitSim.acoustics() for a gain of 1.
  const isptaMwCm2 = m.isppaWcm2 * 1000 * pd * (burstS / periodS);
  // The loop heats a delivered target burst after burst; its worst case is
  // the steady state of that heating, which is what PRISM S3 approaches.
  const deltaT = heatStep(0, m.isppaWcm2 * pd, design.frequencyHz, m.lateralFwhmMm, Infinity);
  const L = SAFETY_LIMITS;
  const margins = [
    margin(
      "mi",
      "Mechanical index",
      m.mechanicalIndex,
      L.mechanicalIndex,
      "",
      3,
      "Peak pressure (MPa) / √f (MHz)",
    ),
    margin(
      "ispta",
      "I_SPTA",
      isptaMwCm2,
      L.isptaMwCm2,
      "mW/cm²",
      0,
      "Pulse and burst duty applied",
    ),
    margin("deltaT", "Focal ΔT", deltaT, L.deltaTC, "°C", 3, "Steady state, delivered every loop"),
    margin(
      "offTarget",
      "Off-target pressure",
      m.offTargetFraction,
      L.offTargetFraction,
      "× focus",
      2,
      "Highest pressure outside the focal region",
    ),
    margin(
      "focus",
      "Focus on target",
      m.focalErrorMm,
      Math.max(2, m.axialFwhmMm),
      "mm",
      2,
      "Distance from target to the field peak",
    ),
  ];
  return {
    region: b.region,
    centre: b.placement.centre,
    normal: b.placement.normal,
    depthMm: b.placement.depthMm,
    margins,
    pass: margins.every((x) => x.pass),
  };
}
