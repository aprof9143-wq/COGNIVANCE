/**
 * Array design exploration: does a design reach every target of a programme,
 * and if not, which design does?
 *
 * Auto-design searches frequency × element pitch for the design whose weakest
 * target gets the most modelled effect while every target passes PRISM's
 * off-target rule and keeps a mm-scale focus. It changes only what the
 * physics needs; every other spec stays as the design document gives it.
 */

import { DEFAULT_ARRAY, wavelengthM, type ArrayDesign } from "./acoustics";
import type { Placement } from "./anatomy";
import { computeBeams, deliverable, type TargetBeam } from "./loop";
import type { RegionKey } from "./neural";

export const FREQUENCIES_MHZ = [15, 10, 7.5, 5, 3, 2];
export const PITCH_WAVELENGTHS = [0.5, 1, 1.5, 2, 3];
/** Largest aperture considered implantable here, mm. */
export const MAX_APERTURE_MM = 12;
/** "mm-scale targeting": lateral focal width at most this, mm. */
export const MAX_LATERAL_FWHM_MM = 1.5;

export type DesignCandidate = {
  design: ArrayDesign;
  beams: TargetBeam[];
  ok: boolean;
  /** Smallest modelled effect over the programme's targets. */
  minU: number;
};

export function evaluateDesign(
  design: ArrayDesign,
  placements: { region: RegionKey; placement: Placement }[],
): DesignCandidate {
  const beams = computeBeams(design, placements);
  const ok = beams.every(
    (b) =>
      deliverable(b) &&
      b.metrics.lateralFwhmMm <= MAX_LATERAL_FWHM_MM &&
      b.metrics.apertureMm <= MAX_APERTURE_MM,
  );
  return { design, beams, ok, minU: Math.min(...beams.map((b) => b.uMax)) };
}

/** Every (frequency, pitch) the search will try, in a stable order. */
export function designSpace(base: ArrayDesign = DEFAULT_ARRAY): ArrayDesign[] {
  const out: ArrayDesign[] = [];
  for (const f of FREQUENCIES_MHZ) {
    for (const k of PITCH_WAVELENGTHS) {
      const d = { ...base, frequencyHz: f * 1e6, pitchM: k * wavelengthM(f * 1e6) };
      if (d.pitchM * d.elementsPerSide * 1000 <= MAX_APERTURE_MM) out.push(d);
    }
  }
  return out;
}

/**
 * Pick the best candidate: all targets reachable, highest weakest-target
 * effect; ties go to the higher frequency (smaller, finer focus).
 */
export function pickBest(candidates: DesignCandidate[]): DesignCandidate | null {
  const ok = candidates.filter((c) => c.ok);
  if (!ok.length) return null;
  return ok.reduce((a, b) =>
    b.minU > a.minU + 1e-6 ||
    (Math.abs(b.minU - a.minU) <= 1e-6 && b.design.frequencyHz > a.design.frequencyHz)
      ? b
      : a,
  );
}

/** Chunked search so the UI stays responsive; reports progress 0–1. */
export async function autoDesign(
  placements: { region: RegionKey; placement: Placement }[],
  onProgress?: (p: number) => void,
  base: ArrayDesign = DEFAULT_ARRAY,
): Promise<DesignCandidate | null> {
  const space = designSpace(base);
  const results: DesignCandidate[] = [];
  for (let i = 0; i < space.length; i++) {
    results.push(evaluateDesign(space[i]!, placements));
    onProgress?.((i + 1) / space.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return pickBest(results);
}

/**
 * Steerable-field estimate of independently addressable foci at depth d:
 * the array can steer without grating lobes up to sin θ = λ/p − 1 (and no
 * further than an element's −3 dB half-angle, sin θ ≈ 0.44 λ/a); foci need a
 * separation of 2 × the lateral focal width.
 */
export function addressableFoci(
  design: ArrayDesign,
  depthMm: number,
  lateralFwhmMm: number,
): number {
  const lambda = wavelengthM(design.frequencyHz);
  const a = design.pitchM * design.fill;
  const sinGl = Math.max(0, Math.min(1, lambda / design.pitchM - 1));
  const sinEl = Math.min(1, (0.44 * lambda) / a);
  const theta = Math.asin(Math.min(sinGl, sinEl));
  const side = 2 * depthMm * Math.tan(theta);
  const spacing = 2 * Math.max(lateralFwhmMm, 1e-3);
  return Math.floor((side / spacing) ** 2);
}
