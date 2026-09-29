/**
 * Import and export. Importers validate and report what they skipped; they
 * never invent a value for something the file did not contain.
 */

import { ATLAS, DK_SHORT, region } from "./atlas";
import { CaseFile, type RegionalMeasurement, type Provenance } from "./schema";

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export type ImportResult = {
  measurements: RegionalMeasurement[];
  icvMm3: number | null;
  skipped: string[];
};

const qcPending = { status: "pending" as const, reviewer: null, date: null, notes: "" };

/**
 * FreeSurfer aseg.stats: "# Measure EstimatedTotalIntraCranialVol, eTIV, …,
 * <value>, mm^3" and a table whose ColHeaders include SegId, Volume_mm3 and
 * StructName. Only structures in the module's atlas are imported.
 */
export function parseAsegStats(text: string, visitId: string, version = "unknown"): ImportResult {
  const lines = text.split(/\r?\n/);
  const skipped: string[] = [];
  let icv: number | null = null;
  let cols: string[] = [];
  const measurements: RegionalMeasurement[] = [];
  const prov: Provenance = {
    software: "FreeSurfer",
    version,
    model: null,
    atlas: ATLAS,
    parameters: "aseg.stats",
    date: null,
    source: "aseg.stats",
  };
  for (const line of lines) {
    const m = line.match(
      /^#\s*Measure\s+EstimatedTotalIntraCranialVol\s*,[^,]*,[^,]*,\s*([\d.eE+-]+)/,
    );
    if (m) icv = Number.parseFloat(m[1]!);
    const v = line.match(/^#\s*BuildStamp\s+\S*?(\d+\.\d+\.\d+)/);
    if (v && prov.version === "unknown") prov.version = v[1]!;
    if (line.startsWith("# ColHeaders"))
      cols = line.replace("# ColHeaders", "").trim().split(/\s+/);
    if (line.startsWith("#") || !line.trim() || !cols.length) continue;
    const f = line.trim().split(/\s+/);
    const seg = Number.parseInt(f[cols.indexOf("SegId")] ?? "", 10);
    const vol = Number.parseFloat(f[cols.indexOf("Volume_mm3")] ?? "");
    const r = region(seg);
    if (!r) {
      skipped.push(`${f[cols.indexOf("StructName")] ?? seg} (not in the module atlas)`);
      continue;
    }
    measurements.push({
      id: uid("m"),
      visitId,
      atlas: ATLAS,
      regionId: seg,
      regionName: r.name,
      hemisphere: r.hemisphere,
      metric: seg === 77 ? "wmh-volume" : "volume",
      value: Number.isFinite(vol) ? vol : null,
      unit: "mm3",
      status: Number.isFinite(vol) ? "measured" : "unavailable",
      evidence: "algorithm-derived",
      provenance: prov,
      qc: qcPending,
    });
  }
  if (!cols.length) throw new Error("Not an aseg.stats file: no '# ColHeaders' line.");
  return { measurements, icvMm3: icv, skipped };
}

/** FreeSurfer ?h.aparc.stats: cortical thickness (ThickAvg) and grey volume (GrayVol). */
export function parseAparcStats(text: string, visitId: string, version = "unknown"): ImportResult {
  const lines = text.split(/\r?\n/);
  const hemiLine = lines.find((l) => /^#\s*hemi\s+/.test(l));
  const hemi = hemiLine?.match(/hemi\s+(lh|rh)/)?.[1];
  if (!hemi)
    throw new Error("aparc.stats has no '# hemi lh|rh' line; hemisphere cannot be assumed.");
  let cols: string[] = [];
  const out: RegionalMeasurement[] = [];
  const skipped: string[] = [];
  const stamp = text.match(/^#\s*BuildStamp\s+\S*?(\d+\.\d+\.\d+)/m)?.[1];
  const prov: Provenance = {
    software: "FreeSurfer",
    version: stamp ?? version,
    model: null,
    atlas: ATLAS,
    parameters: `${hemi}.aparc.stats`,
    date: null,
    source: `${hemi}.aparc.stats`,
  };
  for (const line of lines) {
    if (line.startsWith("# ColHeaders"))
      cols = line.replace("# ColHeaders", "").trim().split(/\s+/);
    if (line.startsWith("#") || !line.trim() || !cols.length) continue;
    const f = line.trim().split(/\s+/);
    const name = f[cols.indexOf("StructName")] ?? "";
    const idx = DK_SHORT[name];
    if (!idx) {
      skipped.push(name);
      continue;
    }
    const id = (hemi === "lh" ? 1000 : 2000) + idx;
    const r = region(id)!;
    for (const [col, metric, unit] of [
      ["ThickAvg", "thickness", "mm"],
      ["GrayVol", "grey-volume", "mm3"],
    ] as const) {
      const val = Number.parseFloat(f[cols.indexOf(col)] ?? "");
      out.push({
        id: uid("m"),
        visitId,
        atlas: ATLAS,
        regionId: id,
        regionName: r.name,
        hemisphere: r.hemisphere,
        metric,
        value: Number.isFinite(val) ? val : null,
        unit,
        status: Number.isFinite(val) ? "measured" : "unavailable",
        evidence: "algorithm-derived",
        provenance: prov,
        qc: qcPending,
      });
    }
  }
  if (!cols.length) throw new Error("Not an aparc.stats file: no '# ColHeaders' line.");
  return { measurements: out, icvMm3: null, skipped };
}

/**
 * Generic measurement CSV/TSV with columns:
 * visit_id, region_id, metric, value, unit, software, software_version[, qc_status]
 * Blank or "n/a" values are imported as "not measured", never as zero.
 */
export function parseMeasurementTable(text: string): ImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0]?.includes("\t") ? "\t" : ",";
  const head = lines[0]?.split(sep).map((h) => h.trim().toLowerCase()) ?? [];
  const col = (n: string) => head.indexOf(n);
  for (const need of [
    "visit_id",
    "region_id",
    "metric",
    "value",
    "unit",
    "software",
    "software_version",
  ]) {
    if (col(need) < 0) throw new Error(`Measurement table is missing the '${need}' column.`);
  }
  const out: RegionalMeasurement[] = [];
  const skipped: string[] = [];
  lines.slice(1).forEach((line, n) => {
    const f = line.split(sep).map((x) => x.trim());
    const id = Number.parseInt(f[col("region_id")] ?? "", 10);
    const r = region(id);
    const metric = f[col("metric")] as RegionalMeasurement["metric"];
    if (!r || !["volume", "thickness", "wmh-volume", "grey-volume"].includes(metric)) {
      skipped.push(`row ${n + 2}: unknown region ${f[col("region_id")]} or metric ${metric}`);
      return;
    }
    const raw = f[col("value")] ?? "";
    const val = raw === "" || raw.toLowerCase() === "n/a" ? null : Number.parseFloat(raw);
    const qc = (f[col("qc_status")] ?? "pending").toLowerCase();
    out.push({
      id: uid("m"),
      visitId: f[col("visit_id")] ?? "",
      atlas: ATLAS,
      regionId: id,
      regionName: r.name,
      hemisphere: r.hemisphere,
      metric,
      value: val !== null && Number.isFinite(val) ? val : null,
      unit: f[col("unit")] === "mm" ? "mm" : "mm3",
      status:
        val === null
          ? "not-measured"
          : Number.isFinite(val)
            ? qc === "fail"
              ? "failed-qc"
              : "measured"
            : "unavailable",
      evidence: "algorithm-derived",
      provenance: {
        software: f[col("software")] ?? "",
        version: f[col("software_version")] ?? "",
        model: null,
        atlas: ATLAS,
        parameters: "",
        date: null,
        source: "measurement table",
      },
      qc: {
        status: qc === "pass" || qc === "fail" ? qc : "pending",
        reviewer: null,
        date: null,
        notes: "",
      },
    });
  });
  return { measurements: out, icvMm3: null, skipped };
}

export function parseCaseFile(text: string): CaseFile {
  const json = JSON.parse(text) as unknown;
  const r = CaseFile.safeParse(json);
  if (!r.success) {
    throw new Error(
      `Case file is invalid: ${r.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return r.data;
}

export function exportCaseFile(c: CaseFile): string {
  return JSON.stringify(CaseFile.parse(c), null, 2);
}

/** BIDS-Derivatives-style TSV of regional measurements, one row per value. */
export function exportMeasurementsTsv(c: CaseFile): string {
  const head = [
    "visit_id",
    "visit_date",
    "atlas",
    "region_id",
    "region_name",
    "hemisphere",
    "metric",
    "value",
    "unit",
    "status",
    "qc_status",
    "software",
    "software_version",
  ];
  const date = new Map(c.visits.map((v) => [v.id, v.date]));
  const rows = c.measurements.map((m) =>
    [
      m.visitId,
      date.get(m.visitId) ?? "",
      m.atlas,
      m.regionId,
      m.regionName,
      m.hemisphere,
      m.metric,
      m.value ?? "n/a",
      m.unit,
      m.status,
      m.qc.status,
      m.provenance.software,
      m.provenance.version,
    ].join("\t"),
  );
  return [head.join("\t"), ...rows].join("\n") + "\n";
}

/** Sidecar describing the derivative, in the spirit of BIDS dataset_description.json. */
export function exportProvenanceJson(c: CaseFile): string {
  const pipes = [
    ...new Set(c.measurements.map((m) => `${m.provenance.software} ${m.provenance.version}`)),
  ];
  return JSON.stringify(
    {
      Name: "Cognivance neurodegeneration tracking export",
      BIDSVersion: "1.9.0",
      DatasetType: "derivative",
      GeneratedBy: [
        {
          Name: "Cognivance research viewer",
          Description: "Aggregation of imported measurements; no segmentation performed.",
        },
      ],
      SourcePipelines: pipes,
      Atlas: ATLAS,
      SubjectCode: c.subjectCode,
      Disclaimer: "Research/educational decision support. Not a diagnosis.",
    },
    null,
    2,
  );
}
