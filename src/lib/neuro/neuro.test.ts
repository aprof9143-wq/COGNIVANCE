import { describe, expect, it } from "vitest";
import { homologue, idsForKey, region } from "./atlas";
import {
  annualisedChange,
  asymmetryIndex,
  icvPercent,
  normalCdf,
  normLookup,
  orderVisits,
  pairAt,
  pipelineChangeWarnings,
  scannerChangeWarnings,
  usable,
  type Value,
} from "./calc";
import {
  exportMeasurementsTsv,
  parseAparcStats,
  parseAsegStats,
  parseCaseFile,
  parseMeasurementTable,
  exportCaseFile,
} from "./io";
import { emptyCase, type NormativeReference, type RegionalMeasurement, type Visit } from "./schema";
import { associationRegionIds, CITATIONS, DEFAULT_ASSOCIATIONS } from "./symptomMap";

const v = (value: number): Value => ({ state: "value", value });

const visit = (id: string, date: string, extra: Partial<Visit> = {}): Visit => ({
  id,
  date,
  scanner: { manufacturer: "Siemens", model: "Prisma", fieldStrength: 3 },
  sequence: "MPRAGE",
  voxelSize: "1×1×1",
  icvMm3: 1_500_000,
  ageYears: 70,
  notes: "",
  ...extra,
});

const meas = (over: Partial<RegionalMeasurement> = {}): RegionalMeasurement => ({
  id: "m1",
  visitId: "v1",
  atlas: "FreeSurfer aseg + Desikan-Killiany (aparc)",
  regionId: 17,
  regionName: "Hippocampus",
  hemisphere: "left",
  metric: "volume",
  value: 3500,
  unit: "mm3",
  status: "measured",
  evidence: "algorithm-derived",
  provenance: {
    software: "FreeSurfer",
    version: "7.4.1",
    model: null,
    atlas: "FreeSurfer aseg + Desikan-Killiany (aparc)",
    parameters: "",
    date: null,
    source: "",
  },
  qc: { status: "pass", reviewer: null, date: null, notes: "" },
  ...over,
});

describe("missing values", () => {
  it("are never zero: each reason has its own state", () => {
    expect(usable(undefined).state).toBe("not-measured");
    expect(usable(meas({ value: null, status: "unavailable" })).state).toBe("unavailable");
    expect(usable(meas({ status: "not-measured", value: null })).state).toBe("not-measured");
    expect(
      usable(meas({ qc: { status: "fail", reviewer: "A", date: null, notes: "motion" } })).state,
    ).toBe("failed-qc");
    expect(usable(meas())).toEqual({ state: "value", value: 3500 });
  });
});

describe("ICV normalisation", () => {
  it("expresses volume as a percentage of intracranial volume", () => {
    expect(icvPercent(v(3000), 1_500_000)).toEqual({ state: "value", value: 0.2 });
  });
  it("refuses without an ICV instead of dividing by a default", () => {
    expect(icvPercent(v(3000), null).state).toBe("unavailable");
  });
  it("passes a missing volume through unchanged", () => {
    expect(icvPercent({ state: "failed-qc", reason: "x" }, 1e6).state).toBe("failed-qc");
  });
});

describe("asymmetry index", () => {
  it("is (L − R) / mean × 100, positive when left is larger", () => {
    const r = asymmetryIndex(v(3300), v(3000));
    expect(r.state).toBe("value");
    expect((r as { value: number }).value).toBeCloseTo((300 / 3150) * 100, 10);
  });
  it("propagates a missing side", () => {
    expect(asymmetryIndex(v(1), { state: "not-measured", reason: "" }).state).toBe("not-measured");
  });
});

describe("laterality and atlas mapping", () => {
  it("maps stable IDs to regions and pairs homologues", () => {
    expect(region(17)).toMatchObject({ name: "Hippocampus", hemisphere: "left" });
    expect(region(2006)).toMatchObject({ name: "Entorhinal", hemisphere: "right" });
    expect(homologue(17)).toBe(53);
    expect(homologue(2025)).toBe(1025);
    expect(homologue(16)).toBeNull();
    expect(idsForKey("hippocampus")).toEqual([17, 53]);
  });
  it("finds left and right values of a pair by hemisphere, not by ID order", () => {
    const ms = [
      meas({ regionId: 53, hemisphere: "right", value: 3100, id: "b" }),
      meas({ id: "a" }),
    ];
    const { left, right } = pairAt(ms, "v1", 53, "volume");
    expect(left?.value).toBe(3500);
    expect(right?.value).toBe(3100);
  });
});

describe("visits and annualised change", () => {
  it("orders visits by date and rejects duplicate dates", () => {
    expect(
      orderVisits([visit("b", "2024-06-01"), visit("a", "2023-06-01")]).map((x) => x.id),
    ).toEqual(["a", "b"]);
    expect(() => orderVisits([visit("a", "2024-01-01"), visit("b", "2024-01-01")])).toThrow(
      /share the date/,
    );
  });
  it("two points: straight annual difference and percent of baseline", () => {
    const r = annualisedChange([
      { date: "2022-01-01", value: v(4000) },
      { date: "2024-01-01", value: v(3800) },
    ]);
    expect(r.state).toBe("value");
    expect((r as { value: number }).value).toBeCloseTo(-100, 0);
    expect(r.percentPerYear!).toBeCloseTo(-2.5, 1);
    expect(r.n).toBe(2);
  });
  it("more points: least-squares slope; QC-failed points are excluded", () => {
    const r = annualisedChange([
      { date: "2020-01-01", value: v(4000) },
      { date: "2021-01-01", value: v(3950) },
      { date: "2021-06-01", value: { state: "failed-qc", reason: "motion" } },
      { date: "2022-01-01", value: v(3900) },
    ]);
    expect(r.n).toBe(3);
    expect((r as { value: number }).value).toBeCloseTo(-50, 0);
  });
  it("refuses with too few points or too short a span", () => {
    expect(annualisedChange([{ date: "2020-01-01", value: v(1) }]).state).toBe("insufficient-data");
    expect(
      annualisedChange([
        { date: "2020-01-01", value: v(1) },
        { date: "2020-02-01", value: v(2) },
      ]).state,
    ).toBe("insufficient-data");
  });
});

describe("scanner and pipeline change warnings", () => {
  it("flags acquisition changes between consecutive visits", () => {
    const w = scannerChangeWarnings([
      visit("a", "2022-01-01"),
      visit("b", "2023-01-01", {
        scanner: { manufacturer: "GE", model: "Premier", fieldStrength: 3 },
      }),
    ]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/manufacturer Siemens → GE/);
    expect(scannerChangeWarnings([visit("a", "2022-01-01"), visit("b", "2023-01-01")])).toEqual([]);
  });
  it("flags a change of segmentation software version", () => {
    const vs = [visit("v1", "2022-01-01"), visit("v2", "2023-01-01")];
    const w = pipelineChangeWarnings(
      [meas(), meas({ visitId: "v2", provenance: { ...meas().provenance, version: "6.0" } })],
      vs,
    );
    expect(w[0]).toMatch(/processing changed/);
  });
});

describe("normative lookup", () => {
  const ref: NormativeReference = {
    id: "r1",
    name: "Example reference",
    cohort: "test cohort",
    protocol: "3 T MPRAGE",
    citation: "test",
    software: "FreeSurfer",
    atlas: "FreeSurfer aseg + Desikan-Killiany (aparc)",
    fieldStrength: 3,
    normalisation: "raw",
    limitations: "synthetic test values",
    entries: [
      {
        regionId: 17,
        hemisphere: "left",
        metric: "volume",
        bins: [{ ageMin: 65, ageMax: 75, sex: "any", mean: 4000, sd: 400, n: 200 }],
      },
    ],
  };

  it("returns z and percentile when compatible", () => {
    const r = normLookup(meas(), v(3500), "raw", visit("v1", "2024-01-01"), "unknown", [ref]);
    expect(r.state).toBe("value");
    if (r.state === "value") {
      expect(r.z).toBeCloseTo(-1.25, 12);
      expect(r.percentile).toBeCloseTo(10.56, 1);
    }
  });

  it("says why when no reference is compatible — never falls back to a threshold", () => {
    const tooYoung = normLookup(
      meas(),
      v(3500),
      "raw",
      visit("v1", "2024-01-01", { ageYears: 50 }),
      "unknown",
      [ref],
    );
    expect(tooYoung.state).toBe("no-compatible-norm");
    if (tooYoung.state === "no-compatible-norm")
      expect(tooYoung.reasons[0]).toMatch(/age 50 outside/);
    const wrongField = normLookup(
      meas(),
      v(3500),
      "raw",
      visit("v1", "2024-01-01", { scanner: { manufacturer: "x", model: "y", fieldStrength: 1.5 } }),
      "unknown",
      [ref],
    );
    expect(
      wrongField.state === "no-compatible-norm" &&
        wrongField.reasons[0]!.includes("field strength"),
    ).toBe(true);
    const wrongNorm = normLookup(
      meas(),
      v(0.2),
      "icv-ratio",
      visit("v1", "2024-01-01"),
      "unknown",
      [ref],
    );
    expect(wrongNorm.state).toBe("no-compatible-norm");
    expect(normLookup(meas(), v(3500), "raw", visit("v1", "2024-01-01"), "unknown", []).state).toBe(
      "no-compatible-norm",
    );
  });

  it("normal CDF is accurate", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 4);
  });
});

describe("symptom–region matrix provenance", () => {
  it("every association has a citation that exists, a confidence and a caveat", () => {
    const ids = new Set(CITATIONS.map((c) => c.id));
    for (const a of DEFAULT_ASSOCIATIONS) {
      expect(a.citations.length).toBeGreaterThan(0);
      for (const c of a.citations) expect(ids.has(c)).toBe(true);
      expect(["low", "medium", "high"]).toContain(a.confidence);
      expect(a.caveat.length).toBeGreaterThan(10);
      // Every region key resolves to real atlas IDs.
      expect(associationRegionIds(a).length).toBeGreaterThan(0);
    }
  });
  it("honours laterality (language: dominant/left only)", () => {
    const lang = DEFAULT_ASSOCIATIONS.find((a) => a.id === "lang-tp")!;
    expect(associationRegionIds(lang).every((id) => region(id)?.hemisphere === "left")).toBe(true);
  });
  it("motor symptoms are flagged as not specific to typical Alzheimer's", () => {
    expect(DEFAULT_ASSOCIATIONS.find((a) => a.domain === "motor-gait")!.caveat).toMatch(
      /Not specific/,
    );
  });
});

describe("import and export", () => {
  const aseg = [
    "# Title Segmentation Statistics",
    "# BuildStamp freesurfer-linux-centos7_x86_64-7.1.1-20200723-8b40551",
    "# Measure EstimatedTotalIntraCranialVol, eTIV, Estimated Total Intracranial Volume, 1548654.270385, mm^3",
    "# ColHeaders  Index SegId NVoxels Volume_mm3 StructName normMean normStdDev normMin normMax normRange",
    "  1  17  4100  4012.3  Left-Hippocampus  80 10 20 110 90",
    "  2  53  4200  4150.8  Right-Hippocampus 80 10 20 110 90",
    "  3  24  1200  1180.0  CSF 30 10 0 60 60",
  ].join("\n");

  it("reads aseg.stats: volumes by SegId, eTIV, version; skips structures outside the atlas", () => {
    const r = parseAsegStats(aseg, "v1");
    expect(r.icvMm3).toBeCloseTo(1548654.27, 2);
    expect(r.measurements.map((m) => [m.regionId, m.hemisphere, m.value])).toEqual([
      [17, "left", 4012.3],
      [53, "right", 4150.8],
    ]);
    expect(r.measurements[0]!.provenance.version).toBe("7.1.1");
    expect(r.skipped[0]).toMatch(/CSF/);
    expect(r.measurements.every((m) => m.qc.status === "pending")).toBe(true);
  });

  it("reads aparc.stats thickness with the hemisphere from the header", () => {
    const text = [
      "# hemi rh",
      "# ColHeaders StructName NumVert SurfArea GrayVol ThickAvg ThickStd MeanCurv GausCurv FoldInd CurvInd",
      "entorhinal 800 500 2100 3.21 0.7 0.1 0.2 5 0.5",
    ].join("\n");
    const r = parseAparcStats(text, "v1");
    const t = r.measurements.find((m) => m.metric === "thickness")!;
    expect(t).toMatchObject({ regionId: 2006, hemisphere: "right", value: 3.21, unit: "mm" });
    expect(() => parseAparcStats("# ColHeaders StructName\n", "v1")).toThrow(/hemisphere/);
  });

  it("reads a measurement table; blanks become 'not measured', never 0", () => {
    const csv =
      "visit_id,region_id,metric,value,unit,software,software_version,qc_status\nv1,17,volume,,mm3,FastSurfer,2.2,pass\nv1,53,volume,3900,mm3,FastSurfer,2.2,fail\nv1,9999,volume,1,mm3,x,y,pass";
    const r = parseMeasurementTable(csv);
    expect(r.measurements[0]).toMatchObject({ value: null, status: "not-measured" });
    expect(r.measurements[1]).toMatchObject({ status: "failed-qc" });
    expect(r.skipped).toHaveLength(1);
  });

  it("round-trips a case file and rejects invalid ones", () => {
    const c = { ...emptyCase(), measurements: [meas()] };
    expect(parseCaseFile(exportCaseFile(c)).measurements[0]!.value).toBe(3500);
    expect(() => parseCaseFile('{"schema":"other"}')).toThrow(/invalid/);
    expect(exportMeasurementsTsv(c).split("\n")[1]).toContain(
      "\t17\tHippocampus\tleft\tvolume\t3500\t",
    );
  });
});

describe("visual ratings", () => {
  it("reports disagreement between clinician raters only", async () => {
    const { disagreements } = await import("./ratings");
    const base = {
      visitId: "v1",
      scale: "MTA" as const,
      hemisphere: "left" as const,
      date: "2024-01-01",
      confidence: "medium" as const,
      method: "",
      notes: "",
    };
    expect(
      disagreements([
        { ...base, id: "1", score: 2, rater: "R1", kind: "clinician" },
        { ...base, id: "2", score: 3, rater: "R2", kind: "clinician" },
        { ...base, id: "3", score: 4, rater: "auto", kind: "automated-suggestion" },
      ]),
    ).toEqual(["MTA left: R1 2 vs R2 3"]);
    expect(disagreements([{ ...base, id: "1", score: 2, rater: "R1", kind: "clinician" }])).toEqual(
      [],
    );
  });
});
