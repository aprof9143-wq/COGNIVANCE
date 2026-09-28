/**
 * Calculations over supplied measurements. Nothing here measures a brain: it
 * transforms numbers that segmentation software produced, and each function
 * refuses (returns a reason, never a zero) when its inputs cannot support it.
 */

import { homologue } from "./atlas";
import type { NormativeReference, RegionalMeasurement, Visit } from "./schema";

export type Value =
  | { state: "value"; value: number }
  | {
      state:
        "not-measured" | "unavailable" | "failed-qc" | "no-compatible-norm" | "insufficient-data";
      reason: string;
    };

export const STATE_LABEL: Record<Exclude<Value["state"], "value">, string> = {
  "not-measured": "Not measured",
  unavailable: "Unavailable",
  "failed-qc": "Failed quality control",
  "no-compatible-norm": "No compatible norm",
  "insufficient-data": "Insufficient data",
};

/** The usable value of a measurement, or why there is none. QC failures are excluded. */
export function usable(m: RegionalMeasurement | undefined): Value {
  if (!m) return { state: "not-measured", reason: "No measurement for this region at this visit." };
  if (m.qc.status === "fail" || m.status === "failed-qc")
    return { state: "failed-qc", reason: m.qc.notes || "Rejected at quality control." };
  if (m.status === "not-measured")
    return { state: "not-measured", reason: "Recorded as not measured." };
  if (m.status === "unavailable" || m.value === null)
    return { state: "unavailable", reason: "Recorded without a value." };
  return { state: "value", value: m.value };
}

/** Volume as a percentage of intracranial volume. */
export function icvPercent(volumeMm3: Value, icvMm3: number | null): Value {
  if (volumeMm3.state !== "value") return volumeMm3;
  if (icvMm3 === null || !(icvMm3 > 0))
    return { state: "unavailable", reason: "No intracranial volume recorded for this visit." };
  return { state: "value", value: (volumeMm3.value / icvMm3) * 100 };
}

/**
 * Asymmetry index, % = (L − R) / ((L + R) / 2) × 100. Positive means the left
 * is larger. Defined only for a region and its contralateral homologue.
 */
export function asymmetryIndex(left: Value, right: Value): Value {
  if (left.state !== "value") return left;
  if (right.state !== "value") return right;
  const mean = (left.value + right.value) / 2;
  if (!(mean > 0))
    return { state: "unavailable", reason: "Asymmetry needs positive values on both sides." };
  return { state: "value", value: ((left.value - right.value) / mean) * 100 };
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Visits in date order; equal dates are an error, not an arbitrary order. */
export function orderVisits(visits: Visit[]): Visit[] {
  const sorted = [...visits].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  for (let i = 1; i < sorted.length; i++) {
    if (Date.parse(sorted[i]!.date) === Date.parse(sorted[i - 1]!.date)) {
      throw new Error(`Two visits share the date ${sorted[i]!.date}; merge or re-date them.`);
    }
    if (!Number.isFinite(Date.parse(sorted[i]!.date)))
      throw new Error(`Visit date "${sorted[i]!.date}" is not a date.`);
  }
  return sorted;
}

/**
 * Annualised change from dated values. Two points: the straight difference.
 * More: the least-squares slope. Percent is relative to the fitted baseline.
 * Visits whose value is missing or failed QC are left out, and the result says
 * how many points it rests on.
 */
export function annualisedChange(
  points: { date: string; value: Value }[],
): Value & { n?: number; percentPerYear?: number } {
  const usableP = points
    .filter((p) => p.value.state === "value")
    .map((p) => ({ t: Date.parse(p.date) / YEAR_MS, v: (p.value as { value: number }).value }))
    .sort((a, b) => a.t - b.t);
  if (usableP.length < 2)
    return { state: "insufficient-data", reason: "Needs at least two usable time points." };
  const span = usableP[usableP.length - 1]!.t - usableP[0]!.t;
  if (span < 0.25)
    return { state: "insufficient-data", reason: "Time points span less than three months." };
  const n = usableP.length;
  const tm = usableP.reduce((s, p) => s + p.t, 0) / n;
  const vm = usableP.reduce((s, p) => s + p.v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of usableP) {
    sxy += (p.t - tm) * (p.v - vm);
    sxx += (p.t - tm) ** 2;
  }
  const slope = sxy / sxx;
  const baseline = vm + slope * (usableP[0]!.t - tm);
  return {
    state: "value",
    value: slope,
    n,
    percentPerYear: baseline !== 0 ? (slope / baseline) * 100 : Number.NaN,
  };
}

/* ------------------------------------------------------------ norms */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation, |ε| < 1.5e−7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export type NormResult =
  | { state: "value"; z: number; percentile: number; bin: string; reference: string }
  | { state: "no-compatible-norm"; reasons: string[] };

/**
 * z-score and percentile against a reference — only when the reference is
 * compatible: same atlas and software, field strength if the reference
 * specifies one, the subject's age inside a bin, sex matched if bins are
 * sex-specific, and the same normalisation. Otherwise, say which condition
 * failed. No generic threshold is ever substituted.
 */
export function normLookup(
  m: RegionalMeasurement,
  valueUsed: Value,
  normalisation: "raw" | "icv-ratio",
  visit: Visit,
  sex: "female" | "male" | "unknown",
  refs: NormativeReference[],
): NormResult {
  if (valueUsed.state !== "value")
    return { state: "no-compatible-norm", reasons: [STATE_LABEL[valueUsed.state]] };
  if (!refs.length)
    return { state: "no-compatible-norm", reasons: ["No normative reference loaded."] };
  const reasons: string[] = [];
  for (const ref of refs) {
    const why: string[] = [];
    if (ref.atlas !== m.atlas) why.push(`atlas ${ref.atlas} ≠ ${m.atlas}`);
    if (ref.software.toLowerCase() !== m.provenance.software.toLowerCase())
      why.push(`software ${ref.software} ≠ ${m.provenance.software}`);
    if (ref.normalisation !== normalisation)
      why.push(`reference is ${ref.normalisation}, value is ${normalisation}`);
    if (
      ref.fieldStrength !== null &&
      visit.scanner.fieldStrength !== null &&
      ref.fieldStrength !== visit.scanner.fieldStrength
    ) {
      why.push(`field strength ${ref.fieldStrength} T ≠ ${visit.scanner.fieldStrength} T`);
    }
    if (ref.fieldStrength !== null && visit.scanner.fieldStrength === null)
      why.push("visit field strength unknown");
    const entry = ref.entries.find(
      (e) => e.regionId === m.regionId && e.hemisphere === m.hemisphere && e.metric === m.metric,
    );
    if (!entry) why.push("region/metric not in reference");
    if (visit.ageYears === null) why.push("age at visit unknown");
    let bin: (typeof entry & object)["bins"][number] | undefined;
    if (entry && visit.ageYears !== null) {
      const sexed = entry.bins.some((b) => b.sex !== "any");
      if (sexed && sex === "unknown") why.push("reference is sex-specific; sex unknown");
      bin = entry.bins.find(
        (b) =>
          visit.ageYears! >= b.ageMin &&
          visit.ageYears! <= b.ageMax &&
          (b.sex === "any" || b.sex === sex),
      );
      if (!bin) why.push(`age ${visit.ageYears} outside the reference's bins`);
    }
    if (!why.length && bin) {
      const z = (valueUsed.value - bin.mean) / bin.sd;
      return {
        state: "value",
        z,
        percentile: normalCdf(z) * 100,
        bin: `${bin.ageMin}–${bin.ageMax} y, ${bin.sex}, n = ${bin.n}`,
        reference: ref.name,
      };
    }
    reasons.push(`${ref.name}: ${why.join("; ")}`);
  }
  return { state: "no-compatible-norm", reasons };
}

/* ------------------------------------------------------------ longitudinal QC */

/** Warnings where acquisition changed between consecutive visits. */
export function scannerChangeWarnings(visits: Visit[]): string[] {
  const v = orderVisits(visits);
  const out: string[] = [];
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1]!;
    const b = v[i]!;
    const diffs: string[] = [];
    if (a.scanner.manufacturer !== b.scanner.manufacturer)
      diffs.push(
        `manufacturer ${a.scanner.manufacturer ?? "?"} → ${b.scanner.manufacturer ?? "?"}`,
      );
    if (a.scanner.model !== b.scanner.model)
      diffs.push(`model ${a.scanner.model ?? "?"} → ${b.scanner.model ?? "?"}`);
    if (a.scanner.fieldStrength !== b.scanner.fieldStrength)
      diffs.push(`field ${a.scanner.fieldStrength ?? "?"} T → ${b.scanner.fieldStrength ?? "?"} T`);
    if (a.sequence !== b.sequence)
      diffs.push(`sequence ${a.sequence ?? "?"} → ${b.sequence ?? "?"}`);
    if (a.voxelSize !== b.voxelSize)
      diffs.push(`voxel size ${a.voxelSize ?? "?"} → ${b.voxelSize ?? "?"}`);
    if (diffs.length) {
      out.push(
        `${a.date} → ${b.date}: ${diffs.join(", ")}. Change across this interval may reflect acquisition differences rather than biology.`,
      );
    }
  }
  return out;
}

/** Segmentation software or version changing between visits breaks comparability too. */
export function pipelineChangeWarnings(ms: RegionalMeasurement[], visits: Visit[]): string[] {
  const order = orderVisits(visits);
  const byVisit = order.map((v) => ({
    v,
    pipes: new Set(
      ms
        .filter((m) => m.visitId === v.id)
        .map((m) => `${m.provenance.software} ${m.provenance.version} (${m.atlas})`),
    ),
  }));
  const out: string[] = [];
  for (let i = 1; i < byVisit.length; i++) {
    const a = [...byVisit[i - 1]!.pipes].join(", ");
    const b = [...byVisit[i]!.pipes].join(", ");
    if (a && b && a !== b)
      out.push(
        `${byVisit[i - 1]!.v.date} → ${byVisit[i]!.v.date}: processing changed (${a} → ${b}). Segmentation drift is possible.`,
      );
  }
  return out;
}

/** Left and right values of a homologous pair at one visit. */
export function pairAt(
  ms: RegionalMeasurement[],
  visitId: string,
  regionId: number,
  metric: RegionalMeasurement["metric"],
) {
  const other = homologue(regionId);
  const find = (id: number | null) =>
    ms.find((m) => m.visitId === visitId && m.regionId === id && m.metric === metric);
  const a = find(regionId);
  const b = find(other);
  const left = a?.hemisphere === "left" ? a : b?.hemisphere === "left" ? b : undefined;
  const right = a?.hemisphere === "right" ? a : b?.hemisphere === "right" ? b : undefined;
  return { left, right };
}
