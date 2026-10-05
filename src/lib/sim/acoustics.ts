/**
 * ECHO acoustic field: a 16 × 16 phased array focusing continuous-wave
 * ultrasound into attenuating tissue.
 *
 * Physics (no fitted constants):
 *   - Each element is a baffled square piston of side a. Its on-axis far field
 *     at distance d is p_e · k a² / (2π d) (Rayleigh integral for a small
 *     piston, p_e = ρ c u), weighted by the piston directivity
 *     sinc(k a sinθx / 2) · sinc(k a sinθy / 2).
 *   - Tissue attenuation α = α₀ · f, α₀ ≈ 0.6 dB/cm/MHz for brain.
 *   - Focusing: element n is driven with phase k·|r_f − r_n|, so all
 *     contributions arrive in phase at the focus.
 *   - Safety metrics: MI = p_r[MPa] / √f[MHz]; I_SPPA = p² / (2ρc);
 *     I_SPTA = I_SPPA · duty; heating rate upper bound 2αI / (ρ C).
 *
 * The field is evaluated on a plane through the beam axis, which is what the
 * renderer draws and what the off-target check reads.
 */

import { ASSUMPTIONS } from "./specs";

export type Vec3 = [number, number, number];

export type ArrayDesign = {
  frequencyHz: number;
  /** Element pitch, m. */
  pitchM: number;
  /** Fraction of the pitch that is active piezo (kerf removes the rest). */
  fill: number;
  elementsPerSide: number;
  /** Per-element surface pressure at full drive, MPa. */
  elementPressureMpa: number;
};

export const DEFAULT_ARRAY: ArrayDesign = {
  frequencyHz: 15e6,
  pitchM: 0.3e-3,
  fill: 0.9,
  elementsPerSide: 16,
  elementPressureMpa: ASSUMPTIONS.elementPressureMpa,
};

export const wavelengthM = (f: number, c: number = ASSUMPTIONS.soundSpeed) => c / f;

/** Amplitude attenuation coefficient, Np/m. */
export function alphaNpM(f: number, dbCmMhz: number = ASSUMPTIONS.attenuationDbCmMhz): number {
  return (dbCmMhz * (f / 1e6) * 100) / 8.686;
}

const sinc = (x: number) => (Math.abs(x) < 1e-6 ? 1 : Math.sin(x) / x);

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => mul(a, 1 / (norm(a) || 1));

/** Orthonormal frame with w along the array normal. */
export function frame(normal: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const w = unit(normal);
  const helper: Vec3 = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(helper, w));
  const v = cross(w, u);
  return { u, v, w };
}

/** Element centres, metres, in world space. */
export function elementPositions(design: ArrayDesign, centre: Vec3, normal: Vec3): Vec3[] {
  const { u, v } = frame(normal);
  const n = design.elementsPerSide;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = (i - (n - 1) / 2) * design.pitchM;
      const y = (j - (n - 1) / 2) * design.pitchM;
      out.push(add(centre, add(mul(u, x), mul(v, y))));
    }
  }
  return out;
}

export type Drive = { phase: Float64Array; amplitude: Float64Array };

/** Focusing law for one or more foci; amplitude is shared equally between foci. */
export function focusDrive(design: ArrayDesign, elements: Vec3[], foci: Vec3[]): Drive {
  const k = (2 * Math.PI) / wavelengthM(design.frequencyHz);
  const re = new Float64Array(elements.length);
  const im = new Float64Array(elements.length);
  for (const f of foci) {
    elements.forEach((e, n) => {
      const ph = k * norm(sub(f, e));
      re[n] = re[n]! + Math.cos(ph) / foci.length;
      im[n] = im[n]! + Math.sin(ph) / foci.length;
    });
  }
  const phase = new Float64Array(elements.length);
  const amplitude = new Float64Array(elements.length);
  for (let n = 0; n < elements.length; n++) {
    phase[n] = Math.atan2(im[n]!, re[n]!);
    amplitude[n] = Math.min(1, Math.hypot(re[n]!, im[n]!));
  }
  return { phase, amplitude };
}

/** Complex pressure (MPa) at a point, for a drive scaled by `gain` in [0, 1]. */
export function pressureAt(
  design: ArrayDesign,
  elements: Vec3[],
  normal: Vec3,
  drive: Drive,
  point: Vec3,
  gain = 1,
): number {
  const lambda = wavelengthM(design.frequencyHz);
  const k = (2 * Math.PI) / lambda;
  const a = design.pitchM * design.fill;
  const alpha = alphaNpM(design.frequencyHz);
  const { u, v, w } = frame(normal);
  const scale = (design.elementPressureMpa * k * a * a) / (2 * Math.PI);
  let re = 0;
  let im = 0;
  for (let n = 0; n < elements.length; n++) {
    const r = sub(point, elements[n]!);
    const d = norm(r);
    if (d < 1e-6) continue;
    const cz = dot(r, w) / d;
    if (cz <= 0) continue; // behind the baffle
    const dir = sinc((k * a * (dot(r, u) / d)) / 2) * sinc((k * a * (dot(r, v) / d)) / 2);
    // The point-source form diverges inside an element's own near field; a
    // piston never exceeds twice its surface pressure, so cap it there.
    const far = (scale * dir) / d;
    const amp =
      drive.amplitude[n]! *
      Math.min(Math.abs(far), 2 * design.elementPressureMpa) *
      Math.sign(far) *
      Math.exp(-alpha * d);
    const ph = drive.phase[n]! - k * d;
    re += amp * Math.cos(ph);
    im += amp * Math.sin(ph);
  }
  return gain * Math.hypot(re, im);
}

export type FieldPlane = {
  /** |p| in MPa, row-major: rows along depth, columns across. */
  pressure: Float32Array;
  cols: number;
  rows: number;
  /** World position of a grid sample. */
  origin: Vec3;
  across: Vec3;
  depth: Vec3;
  widthM: number;
  depthM: number;
};

export type BeamMetrics = {
  peakMpa: number;
  peakAt: Vec3;
  focusMpa: number;
  /** Distance from the requested focus to the actual peak, mm. */
  focalErrorMm: number;
  lateralFwhmMm: number;
  axialFwhmMm: number;
  /** Highest pressure outside the focal region, as a fraction of the focal peak. */
  offTargetFraction: number;
  mechanicalIndex: number;
  isppaWcm2: number;
  depthMm: number;
  /** One-way tissue loss to the focus, dB. */
  pathLossDb: number;
  wavelengthMm: number;
  apertureMm: number;
  gratingLobeDeg: number | null;
};

/**
 * Field on the plane through the array centre and the focus, and the beam
 * metrics read from it. `gain` scales the drive (PRISM may reduce it).
 */
export function beamField(
  design: ArrayDesign,
  centre: Vec3,
  normal: Vec3,
  focus: Vec3,
  opts: { cols?: number; rows?: number; gain?: number; foci?: Vec3[] } = {},
): { plane: FieldPlane; metrics: BeamMetrics } {
  const cols = opts.cols ?? 56;
  const rows = opts.rows ?? 72;
  const gain = opts.gain ?? 1;
  const elements = elementPositions(design, centre, normal);
  const drive = focusDrive(design, elements, opts.foci ?? [focus]);

  const axis = unit(sub(focus, centre));
  const depthToFocus = norm(sub(focus, centre));
  const { w } = frame(normal);
  // "Across" lies in the plane of the array normal and the beam axis.
  let across = cross(axis, cross(w, axis));
  if (norm(across) < 1e-6) across = frame(axis).u;
  across = unit(across);

  const depthM = depthToFocus * 1.6;
  const widthM = Math.max(0.012, depthToFocus * 0.9);
  // Start half a millimetre in: the array face itself is not tissue.
  const z0 = 0.5e-3;
  const origin = sub(centre, mul(across, widthM / 2));
  const pressure = new Float32Array(cols * rows);
  let peak = 0;
  let peakIdx = 0;
  for (let r = 0; r < rows; r++) {
    const z = z0 + ((r + 0.5) / rows) * (depthM - z0);
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * widthM;
      const p = add(origin, add(mul(across, x), mul(axis, z)));
      const val = pressureAt(design, elements, normal, drive, p, gain);
      pressure[r * cols + c] = val;
      if (val > peak) {
        peak = val;
        peakIdx = r * cols + c;
      }
    }
  }
  const pr = Math.floor(peakIdx / cols);
  const pc = peakIdx % cols;
  const rowZ = (r: number) => z0 + ((r + 0.5) / rows) * (depthM - z0);
  const peakAt = add(origin, add(mul(across, ((pc + 0.5) / cols) * widthM), mul(axis, rowZ(pr))));
  const focusMpa = pressureAt(design, elements, normal, drive, focus, gain);

  // FWHM (−6 dB in pressure) from fine line scans through the requested focus.
  const scan = (dirV: Vec3, halfSpan: number, samples: number) => {
    const vals: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = -halfSpan + (2 * halfSpan * i) / (samples - 1);
      vals.push(pressureAt(design, elements, normal, drive, add(focus, mul(dirV, t)), gain));
    }
    const mid = (samples - 1) / 2;
    let best = mid;
    for (let i = 0; i < samples; i++) if (vals[i]! > vals[best]!) best = i;
    const half = vals[best]! / 2;
    let lo = best;
    let hi = best;
    while (lo > 0 && vals[lo - 1]! >= half) lo--;
    while (hi < samples - 1 && vals[hi + 1]! >= half) hi++;
    return ((hi - lo + 1) * (2 * halfSpan)) / (samples - 1);
  };
  const lambdaM = wavelengthM(design.frequencyHz);
  const lateralFwhmMm = scan(across, Math.max(20 * lambdaM, 3e-3), 121) * 1000;
  const axialFwhmMm =
    scan(axis, Math.min(depthToFocus * 0.9, Math.max(60 * lambdaM, 8e-3)), 121) * 1000;

  // Off-target: the strongest point outside the focal region (an ellipse of
  // twice the FWHM around the focus).
  let off = 0;
  for (let r = 0; r < rows; r++) {
    const dz = (rowZ(r) - depthToFocus) * 1000;
    for (let c = 0; c < cols; c++) {
      const dx = (((c + 0.5) / cols) * widthM - widthM / 2) * 1000;
      const e = (dz / axialFwhmMm) ** 2 + (dx / lateralFwhmMm) ** 2;
      if (e > 1) off = Math.max(off, pressure[r * cols + c]!);
    }
  }

  const lambda = wavelengthM(design.frequencyHz);
  const fMhz = design.frequencyHz / 1e6;
  const isppa = (focusMpa * 1e6) ** 2 / (2 * ASSUMPTIONS.density * ASSUMPTIONS.soundSpeed) / 1e4;
  return {
    plane: { pressure, cols, rows, origin, across, depth: axis, widthM, depthM },
    metrics: {
      peakMpa: Math.max(peak, focusMpa),
      peakAt,
      focusMpa,
      focalErrorMm: norm(sub(peakAt, focus)) * 1000,
      lateralFwhmMm,
      axialFwhmMm,
      offTargetFraction: peak > 0 ? off / Math.max(focusMpa, 1e-12) : 0,
      mechanicalIndex: Math.max(peak, focusMpa) / Math.sqrt(fMhz),
      isppaWcm2: isppa,
      depthMm: depthToFocus * 1000,
      pathLossDb: alphaNpM(design.frequencyHz) * depthToFocus * 8.686,
      wavelengthMm: lambda * 1000,
      apertureMm: design.elementsPerSide * design.pitchM * 1000,
      gratingLobeDeg:
        design.pitchM > lambda / 2
          ? (Math.asin(Math.min(1, lambda / design.pitchM)) * 180) / Math.PI
          : null,
    },
  };
}

/**
 * First-order focal heating: dT/dt = 2αI/(ρC) − T/τ, with the conduction time
 * constant of a focal spot of width w, τ = w² / (4κ), κ = 1.4e-7 m²/s.
 */
export function heatStep(
  tempRiseC: number,
  intensityWcm2: number,
  frequencyHz: number,
  fwhmMm: number,
  dtS: number,
): number {
  const kappa = 1.4e-7;
  const w = Math.max(0.2e-3, fwhmMm / 1000);
  const tau = (w * w) / (4 * kappa);
  const heating =
    (2 * alphaNpM(frequencyHz) * intensityWcm2 * 1e4) /
    (ASSUMPTIONS.density * ASSUMPTIONS.specificHeat);
  // Exact solution of the linear ODE over dt.
  const steady = heating * tau;
  return steady + (tempRiseC - steady) * Math.exp(-dtS / tau);
}

/** RAS mm -> metres. */
export const mm = (p: Vec3): Vec3 => [p[0] / 1000, p[1] / 1000, p[2] / 1000];
