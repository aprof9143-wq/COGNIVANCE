/**
 * Company facts shown on the public pages, in one place. Everything here is
 * either a statement of intent or a description of software that exists in
 * this repository; no metric is shown that the platform has not produced.
 */

export const COMPANY = {
  name: "Cognivance",
  legal: "Cognivance Labs",
  tagline: "The simulation layer for brain and eye medicine.",
  pitch:
    "Cognivance turns a patient's genome, imaging and EEG into one traceable model of the nervous system, so a therapy can be tested in silico, from the gene to the visual cortex, before it is tested in a person.",
  disclaimer:
    "Research software. Not a medical device, not FDA-cleared or approved, and not for clinical decision-making.",
  year: 2026,
};

/** Programs the company belongs to, as stated by the founders. */
export const PROGRAMS = [
  {
    name: "NVIDIA Inception",
    detail: "Inception Program, 2026",
    src: "/brand/nvidia-inception.png",
    w: 303,
    h: 117,
  },
  {
    name: "Daytona Startup Grid",
    detail: "Startup Grid",
    src: "/brand/daytona-startup-grid.png",
    w: 1063,
    h: 108,
  },
  { name: "Freshmango", detail: "Accelerator", src: "/brand/freshmango.png", w: 1206, h: 197 },
] as const;

export type Member = { name: string; role: string; img?: string; bio?: string };

export const TEAM: Member[] = [
  {
    name: "Muhammad Ansab Butt",
    role: "Co-founder & CEO",
    img: "/Ansab-founder.jpeg",
    bio: "Sets the research agenda and holds the line on first-principles engineering.",
  },
  { name: "Saad Saqib", role: "Chief Growth Officer" },
  { name: "Nabeel Shahzad", role: "Director, Partnerships & Collaborations" },
  { name: "Momina Zafar", role: "Founding Integration Engineer" },
  { name: "Zimal Fatima", role: "Founding Research Scientist" },
];

export type ModuleKey =
  | "home"
  | "vision"
  | "therapy"
  | "eye"
  | "simulation"
  | "research"
  | "viewer"
  | "neuro"
  | "nimble"
  | "benchmarks";

/** Every feature of the platform, as the app shell and the landing page list them. */
export const MODULES: {
  key: Exclude<ModuleKey, "home">;
  to: string;
  group: "Genome & Vision" | "Brain" | "Platform";
  name: string;
  blurb: string;
  status: "Live data" | "Model" | "Demo data" | "Protocol";
}[] = [
  {
    key: "vision",
    to: "/vision",
    group: "Genome & Vision",
    name: "Gene & protein evidence",
    blurb:
      "RPE65 from gene to structure: Ensembl, UniProt, AlphaFold DB and ClinVar, every value traced to its source.",
    status: "Live data",
  },
  {
    key: "therapy",
    to: "/vision/therapy",
    group: "Genome & Vision",
    name: "Gene therapy simulator",
    blurb:
      "Genotype to vector to photoreceptors to visual cortex, on a labelled hypothetical model.",
    status: "Model",
  },
  {
    key: "eye",
    to: "/vision/eye",
    group: "Genome & Vision",
    name: "Eye simulation",
    blurb: "A ray-traced schematic eye that focuses and adapts to light in real time.",
    status: "Model",
  },
  {
    key: "simulation",
    to: "/simulation",
    group: "Brain",
    name: "CIRCUIT simulation",
    blurb: "Assemble and run closed-loop neural circuits for six conditions in a 3D brain.",
    status: "Model",
  },
  {
    key: "research",
    to: "/research",
    group: "Brain",
    name: "Research console",
    blurb: "MRI, EEG, tractography and lesion volumes fused in one coordinate frame.",
    status: "Demo data",
  },
  {
    key: "viewer",
    to: "/viewer",
    group: "Brain",
    name: "Imaging workstation",
    blurb: "A diagnostic-style viewer: MPR, window/level, measurements and fibre tracts on MNI152.",
    status: "Demo data",
  },
  {
    key: "neuro",
    to: "/neurodegeneration",
    group: "Brain",
    name: "Neurodegeneration tracking",
    blurb:
      "Structural change, symptoms and assessments over time, with no diagnosis or probability.",
    status: "Demo data",
  },
  {
    key: "nimble",
    to: "/nimble",
    group: "Platform",
    name: "NIMBLE core",
    blurb: "One acquisition contract for every signal source, simulated or real.",
    status: "Model",
  },
  {
    key: "benchmarks",
    to: "/benchmarks",
    group: "Platform",
    name: "Benchmarks",
    blurb: "The benchmark protocol and its acceptance gates.",
    status: "Protocol",
  },
];
