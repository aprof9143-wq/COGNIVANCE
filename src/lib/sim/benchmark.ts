/**
 * Mode C — benchmark comparison on an in-silico cohort.
 *
 * Each virtual patient is the disease model with its own severity, coupling
 * and rhythm variation (seeded, so a run is reproducible). Every patient goes
 * through two arms with the same noise:
 *
 *   closed loop   NIMBLE → Synapse Atlas → PRISM → ECHO, gate enforced
 *   open loop     the same array firing a fixed protocol every iteration,
 *                 rules evaluated but not enforced (the comparison baseline)
 *
 * What is scored is what the model can actually measure: its own biomarker
 * endpoint, the verification of every delivered write-back, halts and their
 * reasons, latency, plasticity and rule breaches. Clinical outcomes (CDR-SB,
 * SRS-2, acuity, speech scores) are NOT predicted — that needs a validated
 * disease-progression model — so the clinical columns show the cited
 * reference and the NIMBLE target only.
 */

import type { ArrayDesign } from "./acoustics";
import { addressableFoci } from "./design";
import type { Disease } from "./diseases";
import { patientParams } from "./diseases";
import { CircuitSim, deliverable, type TargetBeam } from "./loop";
import { REGIONS } from "./neural";
import { mulberry32 } from "./rng";

export type Stats = { mean: number; sd: number; min: number; max: number };

export const stats = (xs: number[]): Stats => {
  const n = xs.length || 1;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  return { mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
};

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : Number.NaN;
};

export type ArmResult = {
  endpoint: Stats;
  deliveries: number;
  /** Delivered write-backs that had passed PRISM. */
  verifiedDeliveries: number;
  /** Delivered write-backs PRISM had not verified (any rule failing). */
  unverifiedDeliveries: number;
  /** Delivered write-backs that broke a safety limit (S-rules). */
  safetyBreaches: number;
  halts: number;
  haltReasons: Record<string, number>;
  plasticity: Stats;
  peakTempC: number;
};

export type CohortResult = {
  disease: Disease["key"];
  patients: number;
  loops: number;
  closed: ArmResult;
  open: ArmResult;
  latencyP50Ms: number;
  latencyP95Ms: number;
  /** Fraction of delivered closed-loop write-backs that were verified (1 by construction). */
  verificationRate: number;
  reachableTargets: number;
  totalTargets: number;
  /** Array frequency the cohort ran with, MHz. */
  designMhz: number;
  /** Paralysis: steerable-field estimate of addressable foci. */
  foci: number | null;
  endpointValue: number;
  /** "not-assessed" when the model cannot measure the endpoint. */
  verdict: "pass" | "fail" | "not-assessed";
  pass: boolean;
  why: string;
};

export type CohortOptions = {
  disease: Disease;
  design: ArrayDesign;
  beams: TargetBeam[];
  dutyLimit: number;
  patients?: number;
  loops?: number;
  seed?: number;
};

/** One virtual patient's network: severity, coupling and rhythm vary. */
export function virtualPatient(disease: Disease, seed: number) {
  const rng = mulberry32(seed * 2654435761);
  const severity = 0.6 + 0.4 * rng();
  const p = patientParams(disease, severity);
  const n = REGIONS.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const f = 1 + 0.3 * (rng() - 0.5);
      p.W[i * n + j] = p.W[i * n + j]! * f;
      p.W[j * n + i] = p.W[i * n + j]!;
    }
    p.omega[i] = p.omega[i]! * (1 + 0.1 * (rng() - 0.5));
  }
  return { params: p, severity };
}

function runArm(
  o: CohortOptions,
  params: ReturnType<typeof virtualPatient>,
  seed: number,
  gated: boolean,
  loops: number,
) {
  const sim = new CircuitSim({
    disease: o.disease,
    severity: params.severity,
    params: params.params,
    beams: o.beams,
    seed,
    dutyLimit: o.dutyLimit,
    gated,
    design: o.design,
  });
  let deliveries = 0;
  let verified = 0;
  let unverified = 0;
  let breaches = 0;
  let halts = 0;
  const reasons: Record<string, number> = {};
  const latencies: number[] = [];
  for (let i = 0; i < loops; i++) {
    const ev = sim.iterate();
    latencies.push(ev.latencyMs);
    if (ev.halted) {
      halts++;
      const r = ev.verification?.rules.find((x) => !x.pass)?.id ?? "?";
      reasons[r] = (reasons[r] ?? 0) + 1;
    }
    if (ev.delivered.length) {
      deliveries++;
      if (ev.verification?.verified) verified++;
      if (ev.verification && !ev.verification.verified) unverified++;
      if (ev.verification?.rules.some((r) => r.id.startsWith("S") && !r.pass)) breaches++;
    }
  }
  const tail = sim.events.slice(-Math.max(10, Math.floor(loops / 4)));
  return {
    endpoint: tail.reduce((s, e) => s + e.endpoint, 0) / tail.length,
    plasticity: tail[tail.length - 1]!.plasticity,
    deliveries,
    verified,
    unverified,
    breaches,
    halts,
    reasons,
    latencies,
    peakTemp: Math.max(0, ...sim.tempC.values()),
  };
}

const merge = (rs: ReturnType<typeof runArm>[]): ArmResult => {
  const reasons: Record<string, number> = {};
  for (const r of rs)
    for (const [k, v] of Object.entries(r.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
  return {
    endpoint: stats(rs.map((r) => r.endpoint)),
    deliveries: rs.reduce((s, r) => s + r.deliveries, 0),
    verifiedDeliveries: rs.reduce((s, r) => s + r.verified, 0),
    unverifiedDeliveries: rs.reduce((s, r) => s + r.unverified, 0),
    safetyBreaches: rs.reduce((s, r) => s + r.breaches, 0),
    halts: rs.reduce((s, r) => s + r.halts, 0),
    haltReasons: reasons,
    plasticity: stats(rs.map((r) => r.plasticity)),
    peakTempC: Math.max(...rs.map((r) => r.peakTemp)),
  };
};

/** Run a cohort, yielding to the event loop between patients. */
export async function runCohort(
  o: CohortOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<CohortResult> {
  const patients = o.patients ?? 50;
  const loops = o.loops ?? 120;
  const seed0 = o.seed ?? 1;
  const closed: ReturnType<typeof runArm>[] = [];
  const open: ReturnType<typeof runArm>[] = [];
  for (let k = 0; k < patients; k++) {
    const seed = seed0 + k;
    const vp = virtualPatient(o.disease, seed);
    closed.push(runArm(o, vp, seed, true, loops));
    open.push(runArm(o, vp, seed, false, loops));
    onProgress?.(k + 1, patients);
    await new Promise((r) => setTimeout(r, 0));
  }
  const c = merge(closed);
  const op = merge(open);
  const lat = closed.flatMap((r) => r.latencies);
  const reachable = o.beams.filter(deliverable).length;

  let foci: number | null = null;
  let value = c.endpoint.mean;
  if (o.disease.key === "paralysis") {
    const b = o.beams[0];
    foci = b ? addressableFoci(o.design, b.metrics.depthMm, b.metrics.lateralFwhmMm) : 0;
    value = foci;
  }
  const verificationRate = c.deliveries ? c.verifiedDeliveries / c.deliveries : 0;
  const met = o.disease.endpoint.higherIsBetter
    ? value >= o.disease.endpoint.threshold
    : value <= o.disease.endpoint.threshold;
  let why: string;
  let verdict: CohortResult["verdict"];
  if (o.disease.key === "paralysis") {
    verdict = "not-assessed";
    why =
      "The paralysis endpoint is decoded motor targets — a read-out (BCI) problem that needs recorded motor data. The model measures the write-back path only; the steerable-focus estimate is shown for reference.";
  } else if (c.deliveries === 0) {
    verdict = "fail";
    why = "PRISM verified no write-back (see halt reasons) — nothing was delivered.";
  } else if (c.unverifiedDeliveries > 0 || c.safetyBreaches > 0) {
    verdict = "fail";
    why = "A write-back was delivered without verification or broke a safety limit.";
  } else if (!met) {
    verdict = "fail";
    why = `Model endpoint ${value.toFixed(1)} ${o.disease.endpoint.unit} is below the criterion.`;
  } else {
    verdict = "pass";
    why = o.disease.endpoint.criterion;
  }
  const pass = verdict === "pass";
  return {
    disease: o.disease.key,
    patients,
    loops,
    closed: c,
    open: op,
    latencyP50Ms: quantile(lat, 0.5),
    latencyP95Ms: quantile(lat, 0.95),
    verificationRate,
    reachableTargets: reachable,
    totalTargets: o.beams.length,
    designMhz: o.design.frequencyHz / 1e6,
    foci,
    endpointValue: value,
    verdict,
    pass,
    why,
  };
}
