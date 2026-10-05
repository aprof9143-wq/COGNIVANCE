/**
 * The component library for the Simulation Window.
 *
 * Two kinds of number live here and are never mixed:
 *
 *   SPEC        a design target from the Cognivance Simulation Window design
 *               document v1.0 (§3) / NIMBLE whitepaper. Not a measurement of
 *               built hardware.
 *   ASSUMPTION  a literature-typical value the document does not give, needed
 *               to run the physics. Each is editable in the UI and says where
 *               it comes from.
 *
 * Every port is typed; the AutoConnector wires components by port type the
 * way Proteus builds a netlist from pin types.
 */

export type PortType =
  | "electrode" // tissue contacts -> amplifier inputs
  | "neural-data" // digitised channels
  | "prediction" // Synapse Atlas state + proposed intent
  | "intent" // PRISM-verified stimulation intent
  | "gate" // PRISM enable line: write-back is impossible without it
  | "drive" // per-element phase/amplitude drive
  | "acoustic" // focused ultrasound into tissue
  | "payload" // nanorobot agent release
  | "power";

export type Port = {
  id: string;
  type: PortType;
  dir: "in" | "out";
  /** An unconnected required input is a design-rule error. */
  required: boolean;
  /** Maximum nets on an output port. */
  fanout?: number;
  label: string;
};

export type Layer = "sense" | "process" | "verify" | "stimulate" | "modulate" | "power";

export type SpecValue = {
  key: string;
  value: string;
  kind: "spec" | "assumption";
  source: string;
};

export type ComponentSpec = {
  id: string;
  part: string;
  name: string;
  program: "NIMBLE" | "Synapse Atlas" | "PRISM" | "ECHO";
  layer: Layer;
  summary: string;
  values: SpecValue[];
  ports: Port[];
  /** Power draw, mW (assumption unless stated), or harvested if negative. */
  powerMw: number;
  /** Worst-case stage latency budget, ms; null if not on the loop's path. */
  latencyBudgetMs: number | null;
};

const DOC = "Simulation Window design doc v1.0 §3 (design target)";

export const ASSUMPTIONS = {
  /** Soft-tissue sound speed, m/s. Duck, Physical Properties of Tissue (1990). */
  soundSpeed: 1540,
  /** Brain attenuation, dB/cm/MHz (≈0.6). Goss et al., JASA 1978/1980 compilations. */
  attenuationDbCmMhz: 0.6,
  /** Tissue density, kg/m³. */
  density: 1040,
  /** Tissue specific heat, J/(kg·K). */
  specificHeat: 3600,
  /** PEDOT:PSS contact impedance at 1 kHz, Ω (low-kΩ range typical of PEDOT-coated microelectrodes). */
  contactImpedanceOhm: 10_000,
  /** Recording bandwidth, Hz. */
  bandwidthHz: 7_500,
  /** Body temperature, K. */
  temperatureK: 310,
  /** Per-element surface pressure at full drive, MPa. */
  elementPressureMpa: 0.12,
  /** Recording front-end power per channel, µW (published 1024-ch ASICs: ~5–25 µW/ch). */
  frontEndUwPerChannel: 8,
  /** Harvested power available, mW (acoustic + piezo harvesting, order of magnitude). */
  harvestMw: 18,
  /** Pulse duty cycle inside each write-back burst (tFUS protocols typically use 5–50 %). */
  pulseDuty: 0.1,
} as const;

/** FDA diagnostic-ultrasound Track 3 output limits, used as PRISM's acoustic ceiling. */
export const SAFETY_LIMITS = {
  mechanicalIndex: 1.9,
  isptaMwCm2: 720,
  /** Conservative temperature-rise ceiling for neuromodulation, °C. */
  deltaTC: 2,
  /** Pressure allowed outside the focal region, fraction of the focal pressure (−6 dB). */
  offTargetFraction: 0.5,
  /** Session dose per region, seconds of insonation. */
  sessionDoseS: 120,
  /** Aggregate concurrent dose across regions, seconds. */
  aggregateDoseS: 240,
  /** Homeostatic ceiling on coupling potentiation (W / W0). */
  homeostaticCeiling: 1.6,
} as const;

export const COMPONENTS: ComponentSpec[] = [
  {
    id: "mesh",
    part: "NB-MESH-PEDOT",
    name: "PEDOT:PSS electrode mesh",
    program: "NIMBLE",
    layer: "sense",
    summary: "Conformal, mobile, biodegradable contact mesh on the cortical surface.",
    values: [
      { key: "Material", value: "PEDOT:PSS conformal mesh", kind: "spec", source: DOC },
      { key: "Properties", value: "Conformal · mobile · biodegradable", kind: "spec", source: DOC },
      {
        key: "Contact impedance @1 kHz",
        value: `${ASSUMPTIONS.contactImpedanceOhm / 1000} kΩ`,
        kind: "assumption",
        source: "Typical PEDOT-coated microelectrode range",
      },
    ],
    ports: [
      {
        id: "contacts",
        type: "electrode",
        dir: "out",
        required: true,
        fanout: 1,
        label: "1024 contacts",
      },
    ],
    powerMw: 0,
    latencyBudgetMs: null,
  },
  {
    id: "asic",
    part: "NB-ASIC-1024",
    name: "Neural signal ASIC",
    program: "NIMBLE",
    layer: "sense",
    summary: "1024-channel acquisition and digitisation.",
    values: [
      { key: "Channels", value: "1024", kind: "spec", source: DOC },
      { key: "Latency", value: "< 10 ms", kind: "spec", source: DOC },
      { key: "Acoustic link", value: "15 MHz", kind: "spec", source: DOC },
      {
        key: "Front-end power",
        value: `${ASSUMPTIONS.frontEndUwPerChannel} µW/ch`,
        kind: "assumption",
        source: "Published 1024-channel recording ASICs, ~5–25 µW/ch",
      },
    ],
    ports: [
      { id: "in", type: "electrode", dir: "in", required: true, label: "Electrode bus" },
      {
        id: "out",
        type: "neural-data",
        dir: "out",
        required: true,
        fanout: 2,
        label: "Channel stream",
      },
      { id: "pwr", type: "power", dir: "in", required: true, label: "VDD" },
    ],
    powerMw: (1024 * ASSUMPTIONS.frontEndUwPerChannel) / 1000,
    latencyBudgetMs: 10,
  },
  {
    id: "synapse",
    part: "SA-PREDICT",
    name: "Synapse Atlas predictor",
    program: "Synapse Atlas",
    layer: "process",
    summary:
      "EEG segmentation, fMRI parcellation, tractography and genomics priors → state + proposed intent.",
    values: [
      {
        key: "Inputs",
        value: "EEG seg · fMRI parcellation · tractography · genomics",
        kind: "spec",
        source: DOC,
      },
      {
        key: "Output",
        value: "Neural trajectory (current → predicted)",
        kind: "spec",
        source: DOC,
      },
      { key: "Update", value: "Every loop iteration", kind: "spec", source: DOC },
      {
        key: "Latency",
        value: "Measured in this browser",
        kind: "assumption",
        source: "The model-predictive step runs here; its wall time is the stage latency",
      },
    ],
    ports: [
      { id: "in", type: "neural-data", dir: "in", required: true, label: "Channels" },
      { id: "out", type: "prediction", dir: "out", required: true, fanout: 1, label: "Prediction" },
      { id: "pwr", type: "power", dir: "in", required: true, label: "VDD" },
    ],
    powerMw: 4,
    latencyBudgetMs: null,
  },
  {
    id: "prism",
    part: "PR-VERIFY",
    name: "PRISM verification gate",
    program: "PRISM",
    layer: "verify",
    summary: "Neurosymbolic intent verification. Unverified intent halts the loop: no write-back.",
    values: [
      { key: "Verification latency", value: "< 5 ms", kind: "spec", source: DOC },
      {
        key: "Type",
        value: "Neurosymbolic (formal rules), binary gate",
        kind: "spec",
        source: DOC,
      },
      {
        key: "Checks",
        value: "Amplitude · dose · homeostatic ceiling · multi-region",
        kind: "spec",
        source: DOC,
      },
      {
        key: "Acoustic ceiling",
        value: "MI ≤ 1.9 · ISPTA ≤ 720 mW/cm² · ΔT ≤ 2 °C",
        kind: "assumption",
        source: "FDA diagnostic ultrasound Track 3 limits; conservative ΔT",
      },
    ],
    ports: [
      { id: "in", type: "prediction", dir: "in", required: true, label: "Prediction" },
      {
        id: "intent",
        type: "intent",
        dir: "out",
        required: true,
        fanout: 1,
        label: "Verified intent",
      },
      { id: "gate", type: "gate", dir: "out", required: true, fanout: 4, label: "Write enable" },
      { id: "pwr", type: "power", dir: "in", required: true, label: "VDD" },
    ],
    powerMw: 3,
    latencyBudgetMs: 5,
  },
  {
    id: "steerer",
    part: "EC-STEER",
    name: "ECHO beam steerer",
    program: "ECHO",
    layer: "stimulate",
    summary: "Computes per-element phase delays for one or more focal targets.",
    values: [
      { key: "Steering", value: "Independent beams, multi-region", kind: "spec", source: DOC },
      {
        key: "Delay law",
        value: "Geometric focusing, φₙ = k·|r_f − rₙ|",
        kind: "assumption",
        source: "Standard phased-array focusing",
      },
    ],
    ports: [
      { id: "intent", type: "intent", dir: "in", required: true, label: "Intent" },
      { id: "gate", type: "gate", dir: "in", required: true, label: "Enable" },
      { id: "drive", type: "drive", dir: "out", required: true, fanout: 1, label: "256 × phase" },
      { id: "pwr", type: "power", dir: "in", required: true, label: "VDD" },
    ],
    powerMw: 1.5,
    latencyBudgetMs: null,
  },
  {
    id: "array",
    part: "EC-PA256",
    name: "256-element phased array",
    program: "ECHO",
    layer: "stimulate",
    summary: "15 MHz piezoelectric array, 16 × 16 elements.",
    values: [
      { key: "Elements", value: "256 (16 × 16)", kind: "spec", source: DOC },
      { key: "Frequency", value: "15 MHz", kind: "spec", source: DOC },
      { key: "Targeting", value: "mm-scale", kind: "spec", source: DOC },
      {
        key: "Pitch",
        value: "0.30 mm default (≈ 2.9 λ at 15 MHz); a design-explorer variable",
        kind: "assumption",
        source: "Not specified; trades focal gain against grating lobes",
      },
      {
        key: "Element pressure",
        value: `${ASSUMPTIONS.elementPressureMpa} MPa`,
        kind: "assumption",
        source: "Order of magnitude for miniature piezo elements",
      },
    ],
    ports: [
      { id: "gate", type: "gate", dir: "in", required: true, label: "Enable" },
      { id: "drive", type: "drive", dir: "in", required: true, label: "Phase bus" },
      {
        id: "out",
        type: "acoustic",
        dir: "out",
        required: true,
        fanout: 1,
        label: "Acoustic aperture",
      },
      { id: "pwr", type: "power", dir: "in", required: true, label: "HV" },
    ],
    powerMw: 6,
    latencyBudgetMs: null,
  },
  {
    id: "nanobots",
    part: "NB-AGENT-10",
    name: "Nanorobot agent reservoir",
    program: "NIMBLE",
    layer: "modulate",
    summary: "10 agents carrying BDNF / CNTF / lecanemab; release only on a verified gate.",
    values: [
      { key: "Agents", value: "10", kind: "spec", source: DOC },
      { key: "Payloads", value: "BDNF · CNTF · lecanemab", kind: "spec", source: DOC },
      {
        key: "Diffusion",
        value: "Visual only — no pharmacokinetics is modelled",
        kind: "assumption",
        source: "Not modelled",
      },
    ],
    ports: [
      { id: "gate", type: "gate", dir: "in", required: true, label: "Release enable" },
      { id: "out", type: "payload", dir: "out", required: false, fanout: 1, label: "Release" },
      { id: "pwr", type: "power", dir: "in", required: true, label: "VDD" },
    ],
    powerMw: 0.5,
    latencyBudgetMs: null,
  },
  {
    id: "harvester",
    part: "NB-PWR-HARV",
    name: "Energy harvesting module",
    program: "NIMBLE",
    layer: "power",
    summary: "Piezoelectric + acoustic harvesting.",
    values: [
      { key: "Sources", value: "Piezoelectric + acoustic", kind: "spec", source: DOC },
      { key: "Operation", value: "Indefinite (design goal)", kind: "spec", source: DOC },
      {
        key: "Harvested power",
        value: `${ASSUMPTIONS.harvestMw} mW`,
        kind: "assumption",
        source: "Order-of-magnitude budget; sets the duty-cycle limit",
      },
    ],
    ports: [
      { id: "out", type: "power", dir: "out", required: true, fanout: 8, label: "VDD / HV rail" },
    ],
    powerMw: -ASSUMPTIONS.harvestMw,
    latencyBudgetMs: null,
  },
];

export const componentById = (id: string) => COMPONENTS.find((c) => c.id === id);

export const LAYER_ORDER: Layer[] = [
  "sense",
  "process",
  "verify",
  "stimulate",
  "modulate",
  "power",
];

export const LAYER_LABEL: Record<Layer, string> = {
  sense: "Sense",
  process: "Process",
  verify: "Verify",
  stimulate: "Stimulate",
  modulate: "Modulate",
  power: "Power",
};

/** Thermal noise of a contact, µV rms: v = √(4kTRB). */
export function thermalNoiseUv(
  impedanceOhm = ASSUMPTIONS.contactImpedanceOhm,
  bandwidthHz = ASSUMPTIONS.bandwidthHz,
  temperatureK = ASSUMPTIONS.temperatureK,
): number {
  const k = 1.380649e-23;
  return Math.sqrt(4 * k * temperatureK * impedanceOhm * bandwidthHz) * 1e6;
}
