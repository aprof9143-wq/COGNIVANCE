/**
 * From retina to visual cortex, using the existing network model
 * (lib/sim/neural.ts) that the CIRCUIT simulator runs.
 *
 * The network's "vision loss" condition (lib/sim/diseases.ts) deafferents V1:
 * it weakens the thalamus → V1 coupling and V1's own drive in proportion to a
 * severity from 0 (healthy) to 1. Here the severity is set by how much light
 * response reaches the brain: severity = 1 − retinal signal (fraction of
 * healthy). V1 activity is then measured exactly as the simulator measures its
 * vision endpoint: band power, placed between the full-loss and healthy runs.
 *
 * Computed by a model; not a measurement of any brain.
 */

import { diseaseByKey, patientParams } from "@/lib/sim/diseases";
import { Recorder, REGION_INDEX, REGIONS, createNetwork, step } from "@/lib/sim/neural";

const WARMUP = 1000;
const WINDOW = 2000;

function v1Power(severity: number, seed: number): number {
  const s = createNetwork(patientParams(diseaseByKey("vision"), severity), seed);
  step(s, WARMUP);
  const rec = new Recorder(REGIONS.length, WINDOW);
  step(s, WINDOW, [], undefined, rec.push);
  return rec.power(REGION_INDEX.v1, WINDOW);
}

/** V1 response for retinal inputs 0, 0.1, …, 1: fraction of the way from full loss to healthy. */
export function cortexCurve(seed = 7, points = 11): { input: number; v1: number }[] {
  const healthy = v1Power(0, seed);
  const lost = v1Power(1, seed);
  return Array.from({ length: points }, (_, i) => {
    const input = i / (points - 1);
    const p = v1Power(1 - input, seed);
    const v1 = Math.abs(healthy - lost) < 1e-12 ? 0 : (p - lost) / (healthy - lost);
    return { input, v1: Math.min(1, Math.max(0, v1)) };
  });
}

/** Linear interpolation on a precomputed curve. */
export function cortexAt(curve: { input: number; v1: number }[], input: number): number {
  const x = Math.min(1, Math.max(0, input));
  const i = Math.min(curve.length - 2, Math.floor(x * (curve.length - 1)));
  const a = curve[i]!;
  const b = curve[i + 1]!;
  return a.v1 + ((b.v1 - a.v1) * (x - a.input)) / (b.input - a.input);
}
