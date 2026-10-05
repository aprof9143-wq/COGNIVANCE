/**
 * Neural field: a whole-brain network of Stuart–Landau (Hopf normal-form)
 * oscillators, one per target region — the reduced model used in
 * whole-brain modelling (Deco et al., Sci Rep 2017).
 *
 *   dz/dt = (a + iω) z − b|z|² z + G Σ_j W_ij z_j + η(t),   a → a + κ·s·u
 *
 * Rates are in s⁻¹ at EEG time scales: a = −15 s⁻¹ gives a 67 ms correlation
 * time (≈2.4 Hz bandwidth around each rhythm). a > 0 is a sustained rhythm of
 * amplitude √(a/b) — the pathological oscillations (amygdala, STN beta).
 * a sets a region's excitability,
 * ω its intrinsic rhythm, W the structural coupling. Stimulation enters as u
 * (normalised focal intensity, 0–1) with sign s: +1 excitatory, −1
 * suppressive. Coupling is additive, so losing an input (deafferentation)
 * lowers activity.
 *
 * Plasticity: a Hebbian rule on the coupling of a stimulated region,
 * ΔW_ij = η · u · (cos(θ_i − θ_j) − θ₀) · W⁰_ij, bounded below and capped by
 * the homeostatic ceiling PRISM enforces. The LTP/LTD index is W / W⁰.
 *
 * This models oscillatory dynamics, not disease. It reproduces the biomarkers
 * the design document names (coherence, band power, region activity) so the
 * loop has something real to sense, predict and change.
 */

import { mulberry32 } from "./rng";

export type RegionKey =
  | "hippocampus"
  | "amygdala"
  | "thalamus"
  | "stn"
  | "v1"
  | "dlpfc"
  | "vmpfc"
  | "insula"
  | "auditory"
  | "motor";

export const REGIONS: { key: RegionKey; hz: number; band: string }[] = [
  { key: "hippocampus", hz: 6, band: "theta" },
  { key: "amygdala", hz: 5.5, band: "theta" },
  { key: "thalamus", hz: 10, band: "alpha" },
  { key: "stn", hz: 20, band: "beta" },
  { key: "v1", hz: 10.5, band: "alpha" },
  { key: "dlpfc", hz: 6.6, band: "theta" },
  { key: "vmpfc", hz: 6.3, band: "theta" },
  { key: "insula", hz: 8, band: "theta/alpha" },
  { key: "auditory", hz: 9.5, band: "alpha" },
  { key: "motor", hz: 21, band: "beta" },
];

/** Baseline excitability, s⁻¹: damped, noise-driven rhythms (no limit cycle). */
export const A_BASE = -15;
/** Cubic saturation, sets limit-cycle amplitude √(a/b). */
const CUBIC = 50;

export const REGION_INDEX = Object.fromEntries(REGIONS.map((r, i) => [r.key, i])) as Record<
  RegionKey,
  number
>;

/** Undirected structural edges along major known pathways, with weights. */
export const EDGES: [RegionKey, RegionKey, number][] = [
  ["hippocampus", "vmpfc", 0.35],
  ["hippocampus", "dlpfc", 0.2],
  ["hippocampus", "thalamus", 0.15],
  ["hippocampus", "amygdala", 0.3],
  ["amygdala", "vmpfc", 0.35],
  ["amygdala", "insula", 0.25],
  ["amygdala", "thalamus", 0.15],
  ["thalamus", "v1", 0.3],
  ["thalamus", "auditory", 0.3],
  ["thalamus", "motor", 0.25],
  ["thalamus", "dlpfc", 0.2],
  ["stn", "motor", 0.3],
  ["stn", "thalamus", 0.25],
  ["dlpfc", "vmpfc", 0.3],
  ["dlpfc", "motor", 0.15],
  ["insula", "vmpfc", 0.2],
  ["insula", "auditory", 0.15],
];

export type NetworkParams = {
  a: Float64Array;
  omega: Float64Array;
  W: Float64Array; // n × n
  G: number;
  noise: number;
};

export function healthyParams(): NetworkParams {
  const n = REGIONS.length;
  const W = new Float64Array(n * n);
  for (const [x, y, w] of EDGES) {
    const i = REGION_INDEX[x];
    const j = REGION_INDEX[y];
    W[i * n + j] = w;
    W[j * n + i] = w;
  }
  return {
    a: new Float64Array(n).fill(A_BASE),
    omega: Float64Array.from(REGIONS, (r) => 2 * Math.PI * r.hz),
    W,
    G: 12,
    noise: 1.2,
  };
}

export const cloneParams = (p: NetworkParams): NetworkParams => ({
  a: p.a.slice(),
  omega: p.omega.slice(),
  W: p.W.slice(),
  G: p.G,
  noise: p.noise,
});

export type Stim = { region: number; u: number; sign: 1 | -1 }[];

export type NetworkState = {
  params: NetworkParams;
  /** Couplings at the start of the session, for the plasticity index. */
  W0: Float64Array;
  x: Float64Array;
  y: Float64Array;
  t: number;
  rng: () => number;
};

export function createNetwork(params: NetworkParams, seed = 1): NetworkState {
  const n = REGIONS.length;
  const rng = mulberry32(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = (rng() - 0.5) * 0.2;
    y[i] = (rng() - 0.5) * 0.2;
  }
  return { params, W0: params.W.slice(), x, y, t: 0, rng };
}

/** An independent copy (for model-predictive look-ahead). */
export function cloneNetwork(s: NetworkState, seed: number): NetworkState {
  return {
    params: cloneParams(s.params),
    W0: s.W0,
    x: s.x.slice(),
    y: s.y.slice(),
    t: s.t,
    rng: mulberry32(seed),
  };
}

const gauss = (rng: () => number) => {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

export const DT_S = 0.001;
/** κ: excitability shift at full modelled effect (u = 1), s⁻¹. */
const STIM_GAIN = 20;
const ETA_PLASTIC = 0.6;
const THETA0 = 0.3;

/**
 * Advance by `steps` × 1 ms (Euler–Maruyama). Calls `sample` each step with
 * every region's complex state (x = LFP proxy, y = quadrature).
 */
export function step(
  s: NetworkState,
  steps: number,
  stim: Stim = [],
  plasticity: { enabled: boolean; ceiling: number } = { enabled: false, ceiling: Infinity },
  sample?: (x: Float64Array, y: Float64Array) => void,
): void {
  const { a, omega, W, G, noise } = s.params;
  const n = a.length;
  const aEff = a.slice();
  for (const st of stim) aEff[st.region] = a[st.region]! + st.sign * st.u * STIM_GAIN;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const sq = Math.sqrt(DT_S) * noise;
  const cosW = Float64Array.from(omega, (w) => Math.cos(w * DT_S));
  const sinW = Float64Array.from(omega, (w) => Math.sin(w * DT_S));
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < n; i++) {
      const xi = s.x[i]!;
      const yi = s.y[i]!;
      const r2 = xi * xi + yi * yi;
      let cx = 0;
      let cy = 0;
      for (let j = 0; j < n; j++) {
        const w = W[i * n + j]!;
        if (!w) continue;
        cx += w * s.x[j]!;
        cy += w * s.y[j]!;
      }
      dx[i] = (aEff[i]! - CUBIC * r2) * xi + G * cx;
      dy[i] = (aEff[i]! - CUBIC * r2) * yi + G * cy;
    }
    for (let i = 0; i < n; i++) {
      // Split step: the rotation e^{iωdt} is applied exactly. Forward Euler on
      // the rotation alone would add a spurious growth rate of ω²dt/2 — large
      // for beta-band regions.
      const xe = s.x[i]! + DT_S * dx[i]! + sq * gauss(s.rng);
      const ye = s.y[i]! + DT_S * dy[i]! + sq * gauss(s.rng);
      const c = cosW[i]!;
      const sn = sinW[i]!;
      s.x[i] = xe * c - ye * sn;
      s.y[i] = xe * sn + ye * c;
    }
    if (plasticity.enabled) {
      for (const st of stim) {
        if (st.u <= 0) continue;
        const i = st.region;
        const thi = Math.atan2(s.y[i]!, s.x[i]!);
        for (let j = 0; j < n; j++) {
          const w0 = s.W0[i * n + j]!;
          if (!w0) continue;
          const thj = Math.atan2(s.y[j]!, s.x[j]!);
          const dw = ETA_PLASTIC * st.u * (Math.cos(thi - thj) - THETA0) * w0 * DT_S;
          const next = Math.min(w0 * plasticity.ceiling, Math.max(w0 * 0.2, W[i * n + j]! + dw));
          W[i * n + j] = next;
          W[j * n + i] = next;
        }
      }
    }
    s.t += DT_S;
    sample?.(s.x, s.y);
  }
}

/** Ring buffer of complex samples, 1 kHz, per region. */
export class Recorder {
  readonly n: number;
  readonly size: number;
  readonly re: Float32Array[];
  readonly im: Float32Array[];
  index = 0;
  filled = 0;
  constructor(n: number, size = 2048) {
    this.n = n;
    this.size = size;
    this.re = Array.from({ length: n }, () => new Float32Array(size));
    this.im = Array.from({ length: n }, () => new Float32Array(size));
  }
  push = (x: Float64Array, y: Float64Array) => {
    for (let i = 0; i < this.n; i++) {
      this.re[i]![this.index] = x[i]!;
      this.im[i]![this.index] = y[i]!;
    }
    this.index = (this.index + 1) % this.size;
    this.filled = Math.min(this.size, this.filled + 1);
  };
  /** Last `len` LFP samples (real part) of region i, oldest first. */
  last(i: number, len: number): Float32Array {
    const L = Math.min(len, this.filled);
    const out = new Float32Array(L);
    for (let k = 0; k < L; k++) out[k] = this.re[i]![(this.index - L + k + this.size) % this.size]!;
    return out;
  }
  /** Mean power |z|² of region i over the last `len` samples. */
  power(i: number, len: number): number {
    const L = Math.min(len, this.filled);
    let s = 0;
    for (let k = 0; k < L; k++) {
      const idx = (this.index - 1 - k + this.size) % this.size;
      s += this.re[i]![idx]! ** 2 + this.im[i]![idx]! ** 2;
    }
    return L ? s / L : 0;
  }
  /**
   * Coherence magnitude |⟨z_i z_j*⟩| / √(⟨|z_i|²⟩⟨|z_j|²⟩) over the last
   * `len` samples: 1 = locked in phase and amplitude ratio, 0 = unrelated.
   */
  coherence(i: number, j: number, len: number): number {
    const L = Math.min(len, this.filled);
    let cr = 0;
    let ci = 0;
    let pi = 0;
    let pj = 0;
    for (let k = 0; k < L; k++) {
      const idx = (this.index - 1 - k + this.size) % this.size;
      const ar = this.re[i]![idx]!;
      const ai = this.im[i]![idx]!;
      const br = this.re[j]![idx]!;
      const bi = this.im[j]![idx]!;
      cr += ar * br + ai * bi;
      ci += ai * br - ar * bi;
      pi += ar * ar + ai * ai;
      pj += br * br + bi * bi;
    }
    return pi > 0 && pj > 0 ? Math.hypot(cr, ci) / Math.sqrt(pi * pj) : 0;
  }
}

/** Mean coupling potentiation of a region (W / W⁰ over its edges). */
export function plasticityIndex(s: NetworkState, region: number): number {
  const n = REGIONS.length;
  let sum = 0;
  let k = 0;
  for (let j = 0; j < n; j++) {
    const w0 = s.W0[region * n + j]!;
    if (!w0) continue;
    sum += s.params.W[region * n + j]! / w0;
    k++;
  }
  return k ? sum / k : 1;
}
