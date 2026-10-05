/**
 * Disease programmes: how each condition perturbs the network model, which
 * regions the implant targets, what the closed loop tries to change, and the
 * clinical reference it will eventually be judged against.
 *
 * The perturbations reproduce published biomarker directions, not disease
 * mechanisms:
 *   Alzheimer's  hippocampal–prefrontal disconnection and hippocampal hypoactivity
 *   Autism       amygdala hyperreactivity, weak amygdala–vmPFC coupling
 *                (the design document's novel benchmark, §5.4)
 *   Parkinson's  exaggerated subthalamic beta
 *   Vision loss  deafferented V1
 *   Hearing loss deafferented auditory cortex
 *   Paralysis    intact motor cortex; the measure is how many independent
 *                foci the array can address there (physics, not physiology)
 */

import {
  A_BASE,
  cloneParams,
  healthyParams,
  REGION_INDEX,
  type NetworkParams,
  type RegionKey,
} from "./neural";

export type DiseaseKey =
  "alzheimers" | "autism" | "parkinsons" | "vision" | "hearing" | "paralysis";

export type Endpoint = {
  /** What the model measures. */
  label: string;
  unit: string;
  /** Pass criterion on the model endpoint (defined here, shown in the UI). */
  criterion: string;
  threshold: number;
  higherIsBetter: boolean;
};

export type ClinicalReference = {
  baseline: string;
  nimbleTarget: string;
  /** "verified" = checked against the cited publication; "design-doc" = as stated in the design document only. */
  status: "verified" | "design-doc" | "none";
  citation: string;
};

export type Disease = {
  key: DiseaseKey;
  name: string;
  implant: string;
  targets: RegionKey[];
  mode: 1 | -1;
  payload: string | null;
  endpoint: Endpoint;
  clinical: ClinicalReference;
  perturb: (p: NetworkParams, severity: number) => NetworkParams;
};

const edge = (p: NetworkParams, a: RegionKey, b: RegionKey, f: number) => {
  const n = p.a.length;
  const i = REGION_INDEX[a];
  const j = REGION_INDEX[b];
  p.W[i * n + j] = p.W[i * n + j]! * f;
  p.W[j * n + i] = p.W[j * n + i]! * f;
};

export const DISEASES: Disease[] = [
  {
    key: "alzheimers",
    name: "Alzheimer's disease",
    implant: "Neural degeneration implant",
    targets: ["hippocampus", "dlpfc"],
    mode: 1,
    payload: "lecanemab / BDNF",
    endpoint: {
      label: "Hippocampus–vmPFC theta coupling restored",
      unit: "% of healthy gap closed",
      criterion: "≥ 40 % of the gap to the healthy model closed, with every write-back verified",
      threshold: 40,
      higherIsBetter: true,
    },
    clinical: {
      baseline: "Lecanemab: CDR-SB −0.45 vs placebo at 18 months",
      nimbleTarget: "CDR-SB improvement > 1.0",
      status: "verified",
      citation: "van Dyck et al., N Engl J Med 2023;388:9–21 (Clarity AD)",
    },
    perturb: (p0, s) => {
      const p = cloneParams(p0);
      p.a[REGION_INDEX.hippocampus] = A_BASE - 15 * s;
      edge(p, "hippocampus", "vmpfc", 1 - 0.7 * s);
      edge(p, "hippocampus", "dlpfc", 1 - 0.7 * s);
      for (let i = 0; i < p.omega.length; i++) p.omega[i] = p.omega[i]! * (1 - 0.12 * s);
      return p;
    },
  },
  {
    key: "autism",
    name: "Autism spectrum",
    implant: "Cortical stimulation implant",
    targets: ["amygdala", "vmpfc"],
    mode: -1,
    payload: null,
    endpoint: {
      label: "Amygdala hyperactivity normalised",
      unit: "% toward healthy",
      criterion: "≥ 30 % toward healthy, no homeostatic-ceiling breach, 100 % verified",
      threshold: 30,
      higherIsBetter: true,
    },
    clinical: {
      baseline: "No approved neuromodulation benchmark",
      nimbleTarget: "SRS-2 improvement > 30 % (novel benchmark, design doc §5.4)",
      status: "none",
      citation: "Design document §5.4 — benchmark created here",
    },
    perturb: (p0, s) => {
      const p = cloneParams(p0);
      p.a[REGION_INDEX.amygdala] = A_BASE + 20 * s;
      p.a[REGION_INDEX.insula] = A_BASE + 5 * s;
      edge(p, "amygdala", "vmpfc", 1 - 0.6 * s);
      return p;
    },
  },
  {
    key: "parkinsons",
    name: "Parkinson's disease",
    implant: "Cortical / subcortical stimulation implant",
    targets: ["stn"],
    mode: -1,
    payload: null,
    endpoint: {
      label: "Subthalamic beta power reduced",
      unit: "% reduction",
      criterion: "≥ 30 % beta reduction with every write-back verified",
      threshold: 30,
      higherIsBetter: true,
    },
    clinical: {
      baseline: "ADAPT-PD adaptive DBS (UPDRS-III −39 %, per design doc)",
      nimbleTarget: "Motor score improvement + verified write-back",
      status: "design-doc",
      citation:
        "Design document §5.3 — confirm against the ADAPT-PD publication before external use",
    },
    perturb: (p0, s) => {
      const p = cloneParams(p0);
      p.a[REGION_INDEX.stn] = A_BASE + 20 * s;
      p.a[REGION_INDEX.motor] = A_BASE + 3 * s;
      edge(p, "stn", "motor", 1 + 0.6 * s);
      return p;
    },
  },
  {
    key: "vision",
    name: "Vision loss",
    implant: "Cortical visual implant",
    targets: ["v1"],
    mode: 1,
    payload: null,
    endpoint: {
      label: "V1 activity restored",
      unit: "% of healthy activity",
      criterion: "≥ 50 % of healthy V1 activity, every write-back verified",
      threshold: 50,
      higherIsBetter: true,
    },
    clinical: {
      baseline: "Orion cortical prosthesis: light perception (6 subjects, per design doc)",
      nimbleTarget: "Form vision (acuity > 20/1000)",
      status: "design-doc",
      citation: "Design document §5.3 — confirm against Orion feasibility publications",
    },
    perturb: (p0, s) => {
      const p = cloneParams(p0);
      p.a[REGION_INDEX.v1] = A_BASE - 15 * s;
      edge(p, "thalamus", "v1", 1 - 0.85 * s);
      return p;
    },
  },
  {
    key: "hearing",
    name: "Hearing loss",
    implant: "Cortical auditory implant",
    targets: ["auditory"],
    mode: 1,
    payload: null,
    endpoint: {
      label: "Auditory cortex activity restored",
      unit: "% of healthy activity",
      criterion: "≥ 50 % of healthy activity, every write-back verified",
      threshold: 50,
      higherIsBetter: true,
    },
    clinical: {
      baseline: "MED-EL: 20 % open-set speech (per design doc)",
      nimbleTarget: "> 60 % open-set speech",
      status: "design-doc",
      citation: "Design document §5.3 — confirm the device and study before external use",
    },
    perturb: (p0, s) => {
      const p = cloneParams(p0);
      p.a[REGION_INDEX.auditory] = A_BASE - 15 * s;
      edge(p, "thalamus", "auditory", 1 - 0.85 * s);
      return p;
    },
  },
  {
    key: "paralysis",
    name: "Paralysis",
    implant: "Motor cortex interface",
    targets: ["motor"],
    mode: 1,
    payload: null,
    endpoint: {
      label: "Independently addressable foci in motor cortex",
      unit: "foci",
      criterion: "> 20 foci separated by ≥ 2 × focal width (design target)",
      threshold: 20,
      higherIsBetter: true,
    },
    clinical: {
      baseline: "Stentrode: 2 patients, 8 targets (per design doc)",
      nimbleTarget: "> 20 targets + verified intent",
      status: "design-doc",
      citation: "Design document §5.3 — confirm against the SWITCH study publications",
    },
    perturb: (p0) => cloneParams(p0),
  },
];

export const diseaseByKey = (k: DiseaseKey) => DISEASES.find((d) => d.key === k)!;

export const patientParams = (d: Disease, severity: number) => d.perturb(healthyParams(), severity);
