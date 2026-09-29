/**
 * Data model for the neurodegeneration module.
 *
 * Evidence types are kept apart all the way down: a patient's report, a
 * clinician's observation, a test score, an imaging measurement, a visual
 * rating, an algorithm's output and a literature association are different
 * kinds of thing and are never merged into one number.
 *
 * Missing is never zero. Every measured value is `number | null`, and a
 * separate `status` says why a null is null.
 *
 * Schemas are zod so imported files are validated, not trusted.
 */

import { z } from "zod";

export const EvidenceType = z.enum([
  "subjective-symptom",
  "clinician-observation",
  "cognitive-test",
  "imaging-measured",
  "imaging-rated",
  "algorithm-derived",
  "literature-association",
  "fluid-biomarker",
  "pet-biomarker",
  "eeg-measure",
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const QcDecision = z.object({
  status: z.enum(["pass", "fail", "pending"]),
  reviewer: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  notes: z.string().default(""),
});
export type QcDecision = z.infer<typeof QcDecision>;

export const Citation = z.object({
  id: z.string(),
  text: z.string(),
  doi: z.string().nullable().default(null),
});
export type Citation = z.infer<typeof Citation>;

/* ------------------------------------------------------------ clinical */

export const SymptomDomain = z.enum([
  "episodic-memory",
  "language",
  "executive",
  "visuospatial",
  "disorientation",
  "attention",
  "behaviour",
  "adl",
  "motor-gait",
]);
export type SymptomDomain = z.infer<typeof SymptomDomain>;

export const Symptom = z.object({
  id: z.string(),
  domain: SymptomDomain,
  present: z.boolean().nullable(),
  laterality: z.enum(["left", "right", "bilateral", "n/a"]).default("n/a"),
  severity: z.enum(["mild", "moderate", "severe"]).nullable().default(null),
  onset: z.string().nullable().default(null),
  progression: z
    .enum(["stable", "progressive", "fluctuating", "improving", "unknown"])
    .default("unknown"),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  /** Who reported it: the evidence type follows from this. */
  source: z.enum(["patient", "informant", "clinician"]),
  notes: z.string().default(""),
});
export type Symptom = z.infer<typeof Symptom>;

export const INSTRUMENTS = [
  "MMSE",
  "MoCA",
  "CDR (global)",
  "CDR-SB",
  "ADAS-Cog",
  "FAQ",
  "NPI",
  "Verbal memory",
  "Semantic fluency",
  "Clock drawing",
  "Other",
] as const;

export const CognitiveAssessment = z.object({
  id: z.string(),
  instrument: z.enum(INSTRUMENTS),
  /** e.g. MoCA 8.1, ADAS-Cog-13; required because versions are not interchangeable. */
  version: z.string(),
  rawScore: z.number().nullable(),
  /** Only if the instrument defines an adjustment (e.g. MoCA education point). */
  adjustedScore: z.number().nullable().default(null),
  adjustment: z.string().default(""),
  /** Maximum possible, as given by the instrument version. */
  maxScore: z.number().nullable().default(null),
  /** Whether higher scores mean better (MMSE, MoCA) or worse (CDR-SB, ADAS-Cog). */
  higherIsBetter: z.boolean().nullable().default(null),
  date: z.string(),
  language: z.string(),
  examiner: z.string(),
  normativeReference: z.string().nullable().default(null),
  notes: z.string().default(""),
});
export type CognitiveAssessment = z.infer<typeof CognitiveAssessment>;

/* ------------------------------------------------------------ imaging */

export const Visit = z.object({
  id: z.string(),
  date: z.string(),
  scanner: z.object({
    manufacturer: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
    fieldStrength: z.number().nullable().default(null),
  }),
  sequence: z.string().nullable().default(null),
  voxelSize: z.string().nullable().default(null),
  /** Intracranial volume (e.g. FreeSurfer eTIV), mm³. */
  icvMm3: z.number().nullable().default(null),
  ageYears: z.number().nullable().default(null),
  notes: z.string().default(""),
});
export type Visit = z.infer<typeof Visit>;

export const Provenance = z.object({
  software: z.string(),
  version: z.string(),
  model: z.string().nullable().default(null),
  atlas: z.string(),
  parameters: z.string().default(""),
  date: z.string().nullable().default(null),
  source: z.string().default(""),
});
export type Provenance = z.infer<typeof Provenance>;

export const MeasurementStatus = z.enum(["measured", "not-measured", "unavailable", "failed-qc"]);
export type MeasurementStatus = z.infer<typeof MeasurementStatus>;

export const RegionalMeasurement = z.object({
  id: z.string(),
  visitId: z.string(),
  /** Stable atlas identifier (e.g. FreeSurfer label 17), never the display name. */
  atlas: z.string(),
  regionId: z.number().int(),
  regionName: z.string(),
  hemisphere: z.enum(["left", "right", "bilateral", "midline"]),
  metric: z.enum(["volume", "thickness", "wmh-volume", "grey-volume"]),
  value: z.number().nullable(),
  unit: z.enum(["mm3", "mm"]),
  status: MeasurementStatus,
  evidence: z.enum(["imaging-measured", "algorithm-derived"]).default("algorithm-derived"),
  provenance: Provenance,
  qc: QcDecision,
});
export type RegionalMeasurement = z.infer<typeof RegionalMeasurement>;

export const NormBin = z.object({
  ageMin: z.number(),
  ageMax: z.number(),
  sex: z.enum(["female", "male", "any"]).default("any"),
  mean: z.number(),
  sd: z.number().positive(),
  n: z.number().int().positive(),
});

export const NormativeReference = z.object({
  id: z.string(),
  name: z.string(),
  cohort: z.string(),
  protocol: z.string(),
  citation: z.string(),
  software: z.string(),
  atlas: z.string(),
  fieldStrength: z.number().nullable().default(null),
  /** Whether the reference values are ICV-normalised (ratio) or raw. */
  normalisation: z.enum(["raw", "icv-ratio"]),
  limitations: z.string(),
  entries: z.array(
    z.object({
      regionId: z.number().int(),
      hemisphere: z.enum(["left", "right", "bilateral", "midline"]),
      metric: z.enum(["volume", "thickness", "wmh-volume", "grey-volume"]),
      bins: z.array(NormBin),
    }),
  ),
});
export type NormativeReference = z.infer<typeof NormativeReference>;

export const VISUAL_SCALES = {
  MTA: { name: "Medial temporal atrophy (Scheltens)", min: 0, max: 4, perHemisphere: true },
  PA: { name: "Posterior atrophy (Koedam)", min: 0, max: 3, perHemisphere: true },
  GCA: { name: "Global cortical atrophy (Pasquier)", min: 0, max: 3, perHemisphere: false },
  "Fazekas-PV": { name: "Fazekas periventricular", min: 0, max: 3, perHemisphere: false },
  "Fazekas-DWM": { name: "Fazekas deep white matter", min: 0, max: 3, perHemisphere: false },
} as const;
export type VisualScale = keyof typeof VISUAL_SCALES;

export const VisualRating = z.object({
  id: z.string(),
  visitId: z.string(),
  scale: z.enum(["MTA", "PA", "GCA", "Fazekas-PV", "Fazekas-DWM"]),
  hemisphere: z.enum(["left", "right", "n/a"]),
  score: z.number().int(),
  rater: z.string(),
  date: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  /** An automated suggestion is never the final rating. */
  kind: z.enum(["clinician", "automated-suggestion"]),
  method: z.string().default(""),
  notes: z.string().default(""),
});
export type VisualRating = z.infer<typeof VisualRating>;

export const BiomarkerCategory = z.enum([
  "amyloid",
  "tau",
  "neurodegeneration",
  "vascular",
  "inflammatory",
  "nonspecific",
]);

export const Biomarker = z.object({
  id: z.string(),
  modality: z.enum([
    "amyloid-PET",
    "tau-PET",
    "FDG-PET",
    "CSF",
    "plasma",
    "diffusion-MRI",
    "perfusion",
    "EEG",
  ]),
  category: BiomarkerCategory,
  analyte: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  date: z.string(),
  method: z.string(),
  tracerOrAssay: z.string(),
  referenceRegion: z.string().nullable().default(null),
  pipeline: z.string().nullable().default(null),
  /** Only a modality-specific validated cut-off, with its source. */
  cutoff: z
    .object({ value: z.number(), direction: z.enum(["above", "below"]), source: z.string() })
    .nullable()
    .default(null),
  quality: z.enum(["pass", "fail", "pending"]),
  uncertainty: z.string().nullable().default(null),
});
export type Biomarker = z.infer<typeof Biomarker>;

export const TimelineEvent = z.object({
  id: z.string(),
  date: z.string(),
  label: z.string(),
  kind: z.enum(["treatment", "event", "scanner-change", "other"]),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

/** A whole case file: what is imported and exported. Pseudonymous by design. */
export const CaseFile = z.object({
  schema: z.literal("cognivance.neuro/1"),
  /** A study code, never a name. */
  subjectCode: z.string(),
  sex: z.enum(["female", "male", "unknown"]).default("unknown"),
  educationYears: z.number().nullable().default(null),
  symptoms: z.array(Symptom).default([]),
  assessments: z.array(CognitiveAssessment).default([]),
  visits: z.array(Visit).default([]),
  measurements: z.array(RegionalMeasurement).default([]),
  ratings: z.array(VisualRating).default([]),
  biomarkers: z.array(Biomarker).default([]),
  events: z.array(TimelineEvent).default([]),
  norms: z.array(NormativeReference).default([]),
  reviewer: z
    .object({ name: z.string(), approved: z.boolean(), date: z.string().nullable() })
    .nullable()
    .default(null),
});
export type CaseFile = z.infer<typeof CaseFile>;

export const emptyCase = (): CaseFile =>
  CaseFile.parse({ schema: "cognivance.neuro/1", subjectCode: "SUBJ-001" });
