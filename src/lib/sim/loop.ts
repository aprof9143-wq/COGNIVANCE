/**
 * The CIRCUIT loop in simulation:
 *
 *   NIMBLE sense → Synapse Atlas predict → PRISM verify → ECHO write → measure
 *
 * Each iteration advances the neural model through an acquisition window,
 * asks the predictor for an intent (a genuine model-predictive step: every
 * candidate stimulation is simulated ahead on a copy of the network), puts
 * that intent through the PRISM gate, and only if every rule holds delivers
 * the focused ultrasound — whose strength comes from the acoustic physics,
 * not from a slider.
 *
 * Latency per stage is reported with its provenance:
 *   spec      the design document's budget (hardware does not exist yet)
 *   measured  wall time of the computation in this browser
 *   physics   acoustic time of flight
 */

import {
  beamField,
  DEFAULT_ARRAY,
  heatStep,
  mm,
  type ArrayDesign,
  type BeamMetrics,
  type FieldPlane,
} from "./acoustics";
import type { Placement } from "./anatomy";
import type { Disease } from "./diseases";
import { patientParams } from "./diseases";
import {
  cloneNetwork,
  createNetwork,
  healthyParams,
  plasticityIndex,
  Recorder,
  REGION_INDEX,
  REGIONS,
  step,
  type NetworkParams,
  type NetworkState,
  type RegionKey,
  type Stim,
} from "./neural";
import { verify, type Intent, type Verification } from "./prism";
import { ASSUMPTIONS, SAFETY_LIMITS } from "./specs";

/** Focal intensity that gives the full modelled effect (u = 1), W/cm². tFUS neuromodulation studies use I_SPPA ≈ 1–30 W/cm². */
export const I_REF_WCM2 = 10;
/** Acquisition window per loop, ms (= the ASIC latency budget). */
export const SENSE_MS = 10;
/** Write-back burst per loop, ms, before duty-cycling. */
export const BURST_MS = 20;
const HORIZON_MS = 120;
const WINDOW = 1500;

export type TargetBeam = {
  region: RegionKey;
  placement: Placement;
  metrics: BeamMetrics;
  /** Modelled effect at full drive (0–1), from the focal intensity. */
  uMax: number;
  /** The computed field on the beam plane (for display). */
  plane?: FieldPlane;
};

/** Can the array put a focus on this target that passes PRISM's off-target rule? */
export function deliverable(b: TargetBeam): boolean {
  return (
    b.metrics.offTargetFraction <= SAFETY_LIMITS.offTargetFraction &&
    b.metrics.focalErrorMm < Math.max(2, b.metrics.axialFwhmMm)
  );
}

export function computeBeams(
  design: ArrayDesign,
  placements: { region: RegionKey; placement: Placement }[],
  opts: { keepPlane?: boolean; cols?: number; rows?: number } = {},
): TargetBeam[] {
  return placements.map(({ region, placement }) => {
    const { metrics, plane } = beamField(
      design,
      mm(placement.centre),
      placement.normal,
      mm(placement.target),
      { cols: opts.cols ?? 40, rows: opts.rows ?? 48 },
    );
    return {
      region,
      placement,
      metrics,
      uMax: Math.min(1, metrics.isppaWcm2 / I_REF_WCM2),
      ...(opts.keepPlane ? { plane } : {}),
    };
  });
}

/** Disease-specific endpoint, higher = better, plus references from reference runs. */
export type Refs = {
  healthy: Measures;
  disease: Measures;
};

export type Measures = {
  hipPower: number;
  hipVmCoh: number;
  amyPower: number;
  amyVmCoh: number;
  stnPower: number;
  v1Power: number;
  audPower: number;
  motorPower: number;
};

function measures(rec: Recorder, len: number): Measures {
  const R = REGION_INDEX;
  return {
    hipPower: rec.power(R.hippocampus, len),
    hipVmCoh: rec.coherence(R.hippocampus, R.vmpfc, len),
    amyPower: rec.power(R.amygdala, len),
    amyVmCoh: rec.coherence(R.amygdala, R.vmpfc, len),
    stnPower: rec.power(R.stn, len),
    v1Power: rec.power(R.v1, len),
    audPower: rec.power(R.auditory, len),
    motorPower: rec.power(R.motor, len),
  };
}

const frac = (x: number, from: number, to: number) =>
  Math.abs(to - from) < 1e-9 ? 0 : (x - from) / (to - from);

/** Percent of the way from the disease baseline back to healthy (or % reduction for PD). */
export function endpointValue(disease: Disease, m: Measures, refs: Refs): number {
  const h = refs.healthy;
  const d = refs.disease;
  switch (disease.key) {
    case "alzheimers":
      return (
        50 * frac(m.hipPower, d.hipPower, h.hipPower) +
        50 * frac(m.hipVmCoh, d.hipVmCoh, h.hipVmCoh)
      );
    case "autism":
      return 100 * frac(m.amyPower, d.amyPower, h.amyPower);
    case "parkinsons":
      return d.stnPower > 0 ? (100 * (d.stnPower - m.stnPower)) / d.stnPower : 0;
    case "vision":
      return 100 * frac(m.v1Power, d.v1Power, h.v1Power);
    case "hearing":
      return 100 * frac(m.audPower, d.audPower, h.audPower);
    case "paralysis":
      // Live loop: modelled motor-cortex activation gain (the benchmark uses
      // the physics measure, addressable foci, instead).
      return d.motorPower > 0 ? (100 * (m.motorPower - d.motorPower)) / d.motorPower : 0;
  }
}

export type Stage = "SENSE" | "PREDICT" | "VERIFY" | "WRITE" | "MEASURE";

export type StageTiming = {
  stage: Stage;
  ms: number;
  source: "spec" | "measured" | "physics";
  budgetMs: number | null;
};

export type LoopEvent = {
  index: number;
  tS: number;
  stages: StageTiming[];
  /** Sense → write-back latency, ms. */
  latencyMs: number;
  intent: Intent | null;
  verification: Verification | null;
  halted: boolean;
  /** Regions actually stimulated this iteration. */
  delivered: { region: RegionKey; u: number; tempC: number }[];
  endpoint: number;
  plasticity: number;
  measures: Measures;
};

export type SimOptions = {
  disease: Disease;
  severity: number;
  design?: ArrayDesign;
  beams: TargetBeam[];
  seed: number;
  /** Fraction of the burst the power budget allows. */
  dutyLimit: number;
  /** false = open-loop arm: fixed stimulation every iteration, rules logged but not enforced. */
  gated: boolean;
  /** Override the patient network (virtual cohort variation). */
  params?: NetworkParams;
  minConfidence?: number;
};

export class CircuitSim {
  readonly opts: Required<Omit<SimOptions, "params">> & { params?: NetworkParams };
  readonly net: NetworkState;
  readonly rec: Recorder;
  refs: Refs;
  index = 0;
  tempC = new Map<RegionKey, number>();
  doseS = new Map<RegionKey, number>();
  events: LoopEvent[] = [];
  private seedCounter = 0;

  constructor(opts: SimOptions) {
    this.opts = {
      design: DEFAULT_ARRAY,
      minConfidence: 0.02,
      ...opts,
    } as CircuitSim["opts"];
    const params = opts.params ?? patientParams(opts.disease, opts.severity);
    this.refs = referenceMeasures(params, opts.seed);
    this.net = createNetwork(params, opts.seed);
    this.rec = new Recorder(REGIONS.length, 4096);
    // Settle into the disease state before the loop starts (same seed and
    // length as the disease reference, so the comparison is paired).
    step(this.net, 500, [], undefined, this.rec.push);
    for (const b of opts.beams) {
      this.tempC.set(b.region, 0);
      this.doseS.set(b.region, 0);
    }
  }

  get period(): number {
    return SENSE_MS + BURST_MS;
  }

  /** One full iteration of the CIRCUIT loop. */
  iterate(): LoopEvent {
    const o = this.opts;
    const stages: StageTiming[] = [];

    // 1. SENSE — the acquisition window advances the brain.
    step(this.net, SENSE_MS, [], undefined, this.rec.push);
    stages.push({ stage: "SENSE", ms: SENSE_MS, source: "spec", budgetMs: 10 });

    // 2. PREDICT — model-predictive look-ahead over candidate intents.
    const t0 = now();
    const intent = o.gated ? this.predict() : this.fixedIntent();
    stages.push({ stage: "PREDICT", ms: now() - t0, source: "measured", budgetMs: null });

    // 3. VERIFY — the PRISM gate.
    const t1 = now();
    const burstS = (BURST_MS * o.dutyLimit) / 1000;
    const perRegion = this.acoustics(
      o.beams.map((b) => intent?.regions.find((r) => r.region === b.region)?.gain ?? 0),
    );
    const aggregate = perRegion.reduce((s, r) => s + r.doseS, 0);
    const verification = intent
      ? verify({
          intent,
          allowedRegions: o.disease.targets,
          perRegion,
          aggregateDoseS: aggregate,
          minConfidence: o.minConfidence,
        })
      : null;
    const verifyMeasured = now() - t1;
    // The rule layer runs in microseconds; the stage is budgeted at the spec,
    // which also covers PRISM's (not simulated) foundation model.
    stages.push({ stage: "VERIFY", ms: Math.max(5, verifyMeasured), source: "spec", budgetMs: 5 });

    // 4. WRITE — only a verified intent reaches tissue (open-loop arm: always).
    const deliver = intent && (o.gated ? verification?.verified === true : true);
    const delivered: LoopEvent["delivered"] = [];
    if (deliver && intent) {
      const stim: Stim = intent.regions.map((r) => ({
        region: REGION_INDEX[r.region],
        u: r.u,
        sign: intent.sign,
      }));
      step(
        this.net,
        Math.max(1, Math.round(BURST_MS * o.dutyLimit)),
        stim,
        { enabled: true, ceiling: o.gated ? SAFETY_LIMITS.homeostaticCeiling : 3 },
        this.rec.push,
      );
      step(this.net, BURST_MS - Math.round(BURST_MS * o.dutyLimit), [], undefined, this.rec.push);
      for (const r of perRegion) {
        const chosen = intent.regions.find((x) => x.region === r.region);
        if (!chosen || chosen.gain === 0) continue;
        this.tempC.set(r.region, r.predictedTempC);
        this.doseS.set(r.region, r.doseS);
        delivered.push({ region: r.region, u: chosen.u, tempC: r.predictedTempC });
      }
    } else {
      step(this.net, BURST_MS, [], undefined, this.rec.push);
    }
    // Cooling for the part of the period without insonation.
    for (const b of o.beams) {
      if (!delivered.some((d) => d.region === b.region)) {
        this.tempC.set(
          b.region,
          heatStep(
            this.tempC.get(b.region)!,
            0,
            o.design.frequencyHz,
            b.metrics.lateralFwhmMm,
            this.period / 1000,
          ),
        );
      }
    }
    const tof =
      Math.max(0, ...o.beams.map((b) => b.metrics.depthMm / 1000 / ASSUMPTIONS.soundSpeed)) * 1000;
    stages.push({ stage: "WRITE", ms: deliver ? tof : 0, source: "physics", budgetMs: null });

    // 5. MEASURE — re-sense and update.
    const m = measures(this.rec, WINDOW);
    const endpoint = endpointValue(o.disease, m, this.refs);
    const plasticity = o.beams.length
      ? o.beams.reduce((s, b) => s + plasticityIndex(this.net, REGION_INDEX[b.region]), 0) /
        o.beams.length
      : 1;
    stages.push({ stage: "MEASURE", ms: 0, source: "measured", budgetMs: null });

    const ev: LoopEvent = {
      index: this.index++,
      tS: this.net.t,
      stages,
      latencyMs: stages.filter((s) => s.stage !== "MEASURE").reduce((s, x) => s + x.ms, 0),
      intent,
      verification,
      halted: Boolean(o.gated && intent && !verification?.verified),
      delivered,
      endpoint,
      plasticity,
      measures: m,
    };
    this.events.push(ev);
    if (this.events.length > 2000) this.events.shift();
    return ev;
  }

  /** Acoustic safety quantities for a set of per-beam gains (shared by planner and gate). */
  acoustics(gains: number[]) {
    const o = this.opts;
    const burstS = (BURST_MS * o.dutyLimit) / 1000;
    const pd = ASSUMPTIONS.pulseDuty;
    return o.beams.map((b, i) => {
      const g = gains[i] ?? 0;
      const isppa = b.metrics.isppaWcm2 * g * g;
      // Pulsed inside the burst: heating follows the pulse-averaged intensity.
      const temp = heatStep(
        this.tempC.get(b.region)!,
        isppa * pd,
        o.design.frequencyHz,
        b.metrics.lateralFwhmMm,
        burstS,
      );
      return {
        region: b.region,
        mechanicalIndex: b.metrics.mechanicalIndex * g,
        isptaMwCm2: isppa * 1000 * pd * (burstS / (this.period / 1000)),
        predictedTempC: temp,
        offTargetFraction: g > 0 ? b.metrics.offTargetFraction : 0,
        doseS: this.doseS.get(b.region)! + (g > 0 ? burstS : 0),
        focalGainOk: g === 0 || b.metrics.focalErrorMm < Math.max(2, b.metrics.axialFwhmMm),
      };
    });
  }

  /**
   * Synapse Atlas: simulate each candidate ahead and pick the best. Planning
   * is constraint-aware — candidates that would break an acoustic limit are
   * not proposed — but PRISM still checks every rule independently.
   */
  private predict(): Intent | null {
    const o = this.opts;
    if (!o.beams.length) return null;
    const seed = 7919 * (this.opts.seed + 1) + this.seedCounter++;
    const run = (gains: number[]) => {
      const fork = cloneNetwork(this.net, seed);
      const rec = new Recorder(REGIONS.length, HORIZON_MS + 8);
      const stim: Stim = o.beams
        .map((b, i) => ({
          region: REGION_INDEX[b.region],
          u: b.uMax * gains[i]! * gains[i]!,
          sign: o.disease.mode,
        }))
        .filter((s) => s.u > 0);
      step(fork, HORIZON_MS, stim, { enabled: stim.length > 0, ceiling: 10 }, rec.push);
      const score = endpointValue(o.disease, measures(rec, HORIZON_MS), this.refs);
      const pl = stim.length ? Math.max(...stim.map((s) => plasticityIndex(fork, s.region))) : 1;
      return { score, pl };
    };
    // Only targets the array can actually focus on are proposed; if none can,
    // the full set is proposed and PRISM's off-target rule will say why not.
    const reachable = o.beams.map((b) => deliverable(b));
    const pool = reachable.some(Boolean) ? reachable : o.beams.map(() => true);
    const subsets: boolean[][] = [];
    for (let mask = 1; mask < 1 << o.beams.length; mask++) {
      const sub = o.beams.map((_, i) => Boolean(mask & (1 << i)) && pool[i]!);
      if (sub.some(Boolean) && !subsets.some((s) => s.every((v, k) => v === sub[k])))
        subsets.push(sub);
    }
    const hold = run(o.beams.map(() => 0));
    let best: { gains: number[]; score: number; pl: number } | null = null;
    const L = SAFETY_LIMITS;
    for (const sub of subsets) {
      for (const g of [0.35, 0.6, 0.8, 1]) {
        const gains = sub.map((on) => (on ? g : 0));
        const ac = this.acoustics(gains);
        if (
          ac.some(
            (a) =>
              a.mechanicalIndex > L.mechanicalIndex ||
              a.isptaMwCm2 > L.isptaMwCm2 ||
              a.predictedTempC > L.deltaTC,
          )
        )
          continue;
        const r = run(gains);
        if (!best || r.score > best.score) best = { gains, ...r };
      }
    }
    if (!best) return null;
    const benefit = best.score - hold.score;
    return {
      regions: o.beams
        .map((b, i) => ({
          region: b.region,
          gain: best!.gains[i]!,
          u: b.uMax * best!.gains[i]! ** 2,
        }))
        .filter((r) => r.gain > 0),
      sign: o.disease.mode,
      predictedBenefit: benefit,
      confidence: Math.max(0, Math.min(1, benefit / 25)),
      predictedPlasticity: best.pl,
    };
  }

  /** Open-loop arm: the same stimulation every iteration, no prediction. */
  private fixedIntent(): Intent {
    const o = this.opts;
    return {
      regions: o.beams.map((b) => ({ region: b.region, gain: 1, u: b.uMax })),
      sign: o.disease.mode,
      predictedBenefit: 0,
      confidence: 0,
      predictedPlasticity: Math.max(
        1,
        ...o.beams.map((b) => plasticityIndex(this.net, REGION_INDEX[b.region])),
      ),
    };
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Healthy and untreated-disease reference measures for one virtual patient. */
export function referenceMeasures(params: NetworkParams, seed: number): Refs {
  // Common random numbers: the references see the same noise as the patient.
  const runRef = (p: NetworkParams) => {
    const net = createNetwork(p, seed);
    const rec = new Recorder(REGIONS.length, 4096);
    step(net, 500);
    step(net, 3000, [], undefined, rec.push);
    return measures(rec, 3000);
  };
  const healthy = healthyParams();
  // Keep the patient's own frequencies and noise in the healthy reference.
  healthy.omega = params.omega.slice();
  healthy.noise = params.noise;
  return { healthy: runRef(healthy), disease: runRef(params) };
}
