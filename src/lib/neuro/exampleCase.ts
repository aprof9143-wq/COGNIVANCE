/**
 * A synthetic example case, so the module can be shown with something in it.
 *
 * EVERY NUMBER HERE IS MADE UP. It is not a person, not a scan, and not the
 * output of any segmentation software: the values were chosen by hand to be
 * of a plausible size and to change gently over three yearly visits, so the
 * regional, longitudinal and evidence views have something to draw. It carries
 * no normative reference, so no z-score or "abnormal" flag can be computed
 * from it, and no visual ratings, because no one rated anything.
 *
 * The provenance of every value says it is synthetic, and the dashboard shows
 * a banner whenever this case is open (isExampleCase).
 */

import { ATLAS, region } from "./atlas";
import { CaseFile, type RegionalMeasurement } from "./schema";

export const EXAMPLE_SUBJECT = "EXAMPLE-SYNTHETIC";

/** True while any of the example's records are open, even if the subject code was renamed. */
export const isExampleCase = (c: CaseFile) =>
  c.subjectCode === EXAMPLE_SUBJECT ||
  c.visits.some((v) => v.id.startsWith("example-")) ||
  c.measurements.some((m) => m.id.startsWith("example-"));

const VISITS = [
  { id: "example-v1", date: "2023-03-14", age: 71 },
  { id: "example-v2", date: "2024-03-12", age: 72 },
  { id: "example-v3", date: "2025-03-18", age: 73 },
] as const;

/** Atlas ID, metric, and one value per visit. */
const SERIES: [number, "volume" | "thickness", number, number, number][] = [
  [17, "volume", 3350, 3262, 3171], // left hippocampus, mm³
  [53, "volume", 3480, 3409, 3336], // right hippocampus
  [18, "volume", 1421, 1396, 1370], // left amygdala
  [54, "volume", 1490, 1471, 1452], // right amygdala
  [4, "volume", 21040, 22610, 24290], // left lateral ventricle
  [43, "volume", 19520, 20810, 22180], // right lateral ventricle
  [1006, "thickness", 3.1, 3.02, 2.93], // left entorhinal cortex, mm
  [2006, "thickness", 3.25, 3.19, 3.12], // right entorhinal cortex
  [1025, "thickness", 2.28, 2.24, 2.19], // left precuneus, mm
  [2025, "thickness", 2.33, 2.3, 2.26], // right precuneus
];

const PROVENANCE = {
  software: "Synthetic example (not measured)",
  version: "1",
  model: null,
  atlas: ATLAS,
  parameters: "Values chosen by hand for demonstration; not produced by any software.",
  date: null,
  source: "src/lib/neuro/exampleCase.ts",
};

function measurements(): RegionalMeasurement[] {
  const out: RegionalMeasurement[] = [];
  for (const [id, metric, ...values] of SERIES) {
    const r = region(id);
    if (!r) throw new Error(`Example case: atlas ID ${id} is not in the module atlas.`);
    VISITS.forEach((v, i) => {
      out.push({
        id: `example-m-${id}-${i + 1}`,
        visitId: v.id,
        atlas: ATLAS,
        regionId: id,
        regionName: r.name,
        hemisphere: r.hemisphere,
        metric,
        value: values[i]!,
        unit: metric === "volume" ? "mm3" : "mm",
        status: "measured",
        evidence: "algorithm-derived",
        provenance: PROVENANCE,
        qc: { status: "pending", reviewer: null, date: null, notes: "Synthetic example." },
      });
    });
  }
  return out;
}

/** A fresh copy of the example case, validated like any imported case file. */
export function exampleCase(): CaseFile {
  return CaseFile.parse({
    schema: "cognivance.neuro/1",
    subjectCode: EXAMPLE_SUBJECT,
    sex: "unknown",
    educationYears: 14,
    visits: VISITS.map((v) => ({
      id: v.id,
      date: v.date,
      scanner: { manufacturer: null, model: null, fieldStrength: null },
      sequence: null,
      voxelSize: null,
      icvMm3: 1_480_000,
      ageYears: v.age,
      notes: "Synthetic example visit; no scan was acquired.",
    })),
    measurements: measurements(),
    symptoms: [
      {
        id: "example-s1",
        domain: "episodic-memory",
        present: true,
        severity: "mild",
        onset: "2022",
        progression: "progressive",
        confidence: "medium",
        source: "informant",
        notes: "Synthetic example.",
      },
      {
        id: "example-s2",
        domain: "language",
        present: true,
        severity: "mild",
        onset: "2024",
        progression: "unknown",
        confidence: "low",
        source: "patient",
        notes: "Synthetic example: word-finding pauses.",
      },
    ],
    assessments: VISITS.map((v, i) => ({
      id: `example-a${i + 1}`,
      instrument: "MoCA",
      version: "8.1",
      rawScore: [26, 24, 23][i]!,
      maxScore: 30,
      higherIsBetter: true,
      date: v.date,
      language: "English",
      examiner: "Synthetic example",
      notes: "Synthetic example score.",
    })),
  });
}
