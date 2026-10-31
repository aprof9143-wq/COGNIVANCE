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
    "Cognivance is building one traceable model of the nervous system from genome, imaging and EEG, so that therapies can one day be tested in silico, from the gene to the visual cortex, before they are tested in a person.",
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
  { name: "Saad Saqib", role: "Chief Growth Officer", img: "/team/saad-saqib.jpg" },
  {
    name: "Nabeel Shahzad",
    role: "Director, Partnerships & Collaborations",
    img: "/nabeel.jpeg",
  },
  { name: "Momina Zafar", role: "Founding Integration Engineer" },
];

export type ModuleKey =
  | "home"
  | "vision"
  | "genomics"
  | "therapy"
  | "eye"
  | "simulation"
  | "research"
  | "viewer"
  | "neuro"
  | "nimble"
  | "benchmarks";

/**
 * How far a feature is real, in four words used everywhere it is listed:
 * - working: runs on what it says it runs on, and the result is labelled
 *   (a model's output is a model's output, not a measurement);
 * - limited: connected to real sources, with stated limits;
 * - sample: runs on demo or simulated data only;
 * - planned: designed or written down, not built.
 */
export type FeatureStatus = "working" | "limited" | "sample" | "planned";

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  working: "Working",
  limited: "Connected but limited",
  sample: "Sample/demo",
  planned: "Planned",
};

export type Module = {
  key: Exclude<ModuleKey, "home">;
  to: string;
  group: "Genome & Vision" | "Brain" | "Platform";
  name: string;
  blurb: string;
  status: FeatureStatus;
  /** What it runs on, in a few words. */
  data: string;
  /** How its data is updated; "" when nothing is fetched. */
  refresh: string;
  /** For captured data: the manifest whose capture time is shown as "data as of". */
  manifest?: string;
};

/** Every feature of the platform, as the app shell, the workspace and the landing page list them. */
export const MODULES: Module[] = [
  {
    key: "vision",
    to: "/vision",
    group: "Genome & Vision",
    name: "Gene & protein evidence",
    blurb:
      "RPE65 from gene to structure: Ensembl, UniProt and AlphaFold DB, every value traced to its source.",
    status: "limited",
    data: "Public reference data, RPE65 only; ClinVar withheld",
    refresh: "Captured snapshot; Live check reads the sources from your browser on request",
    manifest: "/vision/display/rpe65/manifest.json",
  },
  {
    key: "genomics",
    to: "/genomics",
    group: "Genome & Vision",
    name: "Gene library",
    blurb:
      "Genes ClinGen's curations link to autism or Alzheimer disease, compared across eight species, with the record behind every value.",
    status: "limited",
    data: "ClinGen, HGNC, Ensembl Compara and HPO; ClinVar withheld",
    refresh: "Captured snapshot; Check now re-reads HGNC and Ensembl on the server",
    manifest: "/genomics/library.json",
  },
  {
    key: "therapy",
    to: "/vision/therapy",
    group: "Genome & Vision",
    name: "Gene therapy simulator",
    blurb:
      "Genotype to vector to photoreceptors to visual cortex, on a labelled hypothetical model.",
    status: "working",
    data: "Hypothetical model with illustrative, unfitted parameters",
    refresh: "",
  },
  {
    key: "eye",
    to: "/vision/eye",
    group: "Genome & Vision",
    name: "Eye simulation",
    blurb: "A ray-traced schematic eye that focuses and adapts to light as you watch.",
    status: "working",
    data: "Population-average schematic eye model",
    refresh: "",
  },
  {
    key: "simulation",
    to: "/simulation",
    group: "Brain",
    name: "CIRCUIT simulation",
    blurb: "Assemble and run closed-loop neural circuits for six conditions in a 3D brain.",
    status: "working",
    data: "Reduced network model",
    refresh: "",
  },
  {
    key: "research",
    to: "/research",
    group: "Brain",
    name: "Research console",
    blurb: "MRI, EEG, tractography and lesion volumes fused in one coordinate frame.",
    status: "sample",
    data: "Demo recordings and templates; no patient data",
    refresh: "",
  },
  {
    key: "viewer",
    to: "/viewer",
    group: "Brain",
    name: "Imaging workstation",
    blurb:
      "An imaging viewer for research: MPR, window/level, measurements and fibre tracts on MNI152.",
    status: "sample",
    data: "MNI152 template and demo volumes",
    refresh: "",
  },
  {
    key: "neuro",
    to: "/neurodegeneration",
    group: "Brain",
    name: "Neurodegeneration tracking",
    blurb:
      "Structural change, symptoms and assessments over time, with no diagnosis or probability.",
    status: "sample",
    data: "Demo timeline; no patient data",
    refresh: "",
  },
  {
    key: "nimble",
    to: "/nimble",
    group: "Platform",
    name: "NIMBLE core",
    blurb: "One acquisition contract for every signal source, simulated or real.",
    status: "sample",
    data: "Simulated signal sources",
    refresh: "",
  },
  {
    key: "benchmarks",
    to: "/benchmarks",
    group: "Platform",
    name: "Benchmarks",
    blurb: "The benchmark protocol and its acceptance gates. No result is published yet.",
    status: "planned",
    data: "Protocol only",
    refresh: "",
  },
];

export type WorkflowItem = {
  name: string;
  status: FeatureStatus;
  detail: string;
  /** A page to open, when there is one. */
  to?: string;
};

/**
 * The platform as one workflow: where data comes from, what is done with it,
 * what it produces, how it is traced, and what a person can do next. Every
 * item names what actually happens, not what is hoped for.
 */
export const WORKFLOW: { key: string; title: string; items: WorkflowItem[] }[] = [
  {
    key: "input",
    title: "Data in",
    items: [
      {
        name: "Public reference capture",
        status: "limited",
        detail:
          "A person starts a capture in GitHub Actions; Ensembl, UniProt, AlphaFold DB, ClinGen, HGNC and HPO are fetched with a SHA-256 manifest.",
      },
      {
        name: "Demo imaging and EEG",
        status: "sample",
        detail: "MNI152 templates and demo recordings. No patient data is loaded or stored.",
        to: "/research",
      },
      {
        name: "Variant records (ClinVar)",
        status: "planned",
        detail: "Withheld until NCBI's required notice is in place and legal review is done.",
      },
    ],
  },
  {
    key: "analysis",
    title: "Analysis",
    items: [
      {
        name: "Source policy",
        status: "working",
        detail:
          "Decides per source whether it may be fetched, stored, shown or shared; refuses by default.",
        to: "/vision#status",
      },
      {
        name: "Cross-checks and orthology",
        status: "limited",
        detail: "Identifiers compared across sources; orthologues set against a stated baseline.",
        to: "/genomics/compare",
      },
      {
        name: "Labelled models",
        status: "working",
        detail:
          "Gene therapy time course, schematic eye and neural circuits, each marked as a model.",
        to: "/vision/therapy",
      },
    ],
  },
  {
    key: "results",
    title: "Results",
    items: [
      {
        name: "Gene and protein records",
        status: "limited",
        detail: "RPE65 gene, transcript, protein and predicted structure.",
        to: "/vision",
      },
      {
        name: "Gene library",
        status: "limited",
        detail:
          "Autism-related genes with ClinGen curations; ClinGen had none for Alzheimer disease.",
        to: "/genomics",
      },
      {
        name: "Imaging and tracking views",
        status: "sample",
        detail: "Fused imaging, EEG and longitudinal tracking on demo data.",
        to: "/viewer",
      },
    ],
  },
  {
    key: "evidence",
    title: "Evidence",
    items: [
      {
        name: "Provenance on every value",
        status: "working",
        detail: "Source, release, retrieval time and file digest, one click from the value.",
        to: "/genomics",
      },
      {
        name: "Product status and governance",
        status: "working",
        detail: "Intended use, requirements, risks and the clinical release gate, kept as records.",
        to: "/vision#status",
      },
    ],
  },
  {
    key: "export",
    title: "Export and next step",
    items: [
      {
        name: "Evidence export",
        status: "working",
        detail: "JSON of what was shown, with its sources and the not-for-clinical-use statement.",
        to: "/vision",
      },
      {
        name: "Benchmark gates",
        status: "planned",
        detail: "Protocol written; no result is published until it clears its gate.",
        to: "/benchmarks",
      },
    ],
  },
];
