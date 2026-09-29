/**
 * Derived regional results for display: one row per region pair and metric,
 * at the latest visit, with ICV normalisation, asymmetry, norm lookup and
 * longitudinal change. Every cell is a `Value` or a norm result, so the UI can
 * show *why* a number is absent.
 */

import { region } from "./atlas";
import {
  annualisedChange,
  asymmetryIndex,
  icvPercent,
  normLookup,
  orderVisits,
  usable,
  type NormResult,
  type Value,
} from "./calc";
import type { CaseFile, RegionalMeasurement, Visit } from "./schema";

export type SideResult = {
  measurement: RegionalMeasurement | undefined;
  value: Value;
  icv: Value;
  norm: NormResult;
  change: ReturnType<typeof annualisedChange>;
};

export type RegionRow = {
  key: string;
  name: string;
  metric: RegionalMeasurement["metric"];
  unit: string;
  left: SideResult | null;
  right: SideResult | null;
  /** Midline / bilateral structures have one value. */
  single: SideResult | null;
  asymmetry: Value | null;
  visit: Visit;
};

export function regionRows(c: CaseFile, normalisation: "raw" | "icv-ratio"): RegionRow[] {
  if (!c.visits.length) return [];
  const visits = orderVisits(c.visits);
  const latest = visits[visits.length - 1]!;
  const groups = new Map<string, RegionalMeasurement[]>();
  for (const m of c.measurements) {
    const r = region(m.regionId);
    if (!r) continue;
    const k = `${r.key}|${m.metric}`;
    const list = groups.get(k) ?? [];
    list.push(m);
    groups.set(k, list);
  }
  const rows: RegionRow[] = [];
  for (const [k, list] of groups) {
    const [key, metric] = k.split("|") as [string, RegionalMeasurement["metric"]];
    const r = region(list[0]!.regionId)!;
    const side = (hemi: "left" | "right" | "midline"): SideResult | null => {
      const series = list.filter((m) => region(m.regionId)?.hemisphere === hemi);
      if (!series.length) return null;
      const at = series.find((m) => m.visitId === latest.id);
      const value = usable(at);
      const icv =
        metric === "thickness"
          ? {
              state: "unavailable" as const,
              reason: "ICV normalisation applies to volumes, not thickness.",
            }
          : icvPercent(value, latest.icvMm3);
      const used = normalisation === "icv-ratio" && metric !== "thickness" ? icv : value;
      const norm = at
        ? normLookup(
            at,
            used,
            metric === "thickness" ? "raw" : normalisation,
            latest,
            c.sex,
            c.norms,
          )
        : { state: "no-compatible-norm" as const, reasons: ["Not measured at the latest visit."] };
      const change = annualisedChange(
        visits.map((v) => ({
          date: v.date,
          value: usable(series.find((m) => m.visitId === v.id)),
        })),
      );
      return { measurement: at, value, icv, norm, change };
    };
    const left = side("left");
    const right = side("right");
    const single = side("midline");
    rows.push({
      key,
      name: r.name,
      metric,
      unit: list[0]!.unit === "mm" ? "mm" : "mm³",
      left,
      right,
      single,
      asymmetry: left && right ? asymmetryIndex(left.value, right.value) : null,
      visit: latest,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.metric.localeCompare(b.metric));
}

/** Whether any side of a row is outside ±`zLimit` of a compatible reference. */
export function outsideRange(row: RegionRow, zLimit: number): boolean {
  return [row.left, row.right, row.single].some(
    (s) => s?.norm.state === "value" && Math.abs(s.norm.z) >= zLimit,
  );
}
