/**
 * Product decisions for the Vision module, recorded as they were made, and the
 * targets it can load. A decision not yet made is "open" and carries no answer:
 * the module must not behave as if it had one.
 */

export type Target =
  | {
      key: string;
      status: "ready";
      label: string;
      geneSymbol: string;
      /** NCBI taxonomy id; 9606 is Homo sapiens. */
      taxonId: number;
      condition: string;
      note: string;
    }
  | { key: string; status: "unresolved"; label: string; note: string };

export const TARGETS: Target[] = [
  {
    key: "rpe65",
    status: "ready",
    label: "RPE65",
    geneSymbol: "RPE65",
    taxonId: 9606,
    condition: "RPE65-associated inherited retinal dystrophy",
    note: "First use case, chosen 2026-10-19. A product decision, not a diagnosis.",
  },
];

export function targetByKey(key: string): Target | undefined {
  return TARGETS.find((t) => t.key === key);
}

export type DecisionStatus = "decided" | "partial" | "open";

export type Decision = {
  n: number;
  question: string;
  status: DecisionStatus;
  answer?: string;
  decidedOn?: string;
};

/** The fourteen benchmark-definition questions from the project brief. */
export const DECISIONS: Decision[] = [
  {
    n: 1,
    question: "First vision-related condition",
    status: "decided",
    answer: "RPE65-associated inherited retinal dystrophy",
    decidedOn: "2026-10-19",
  },
  { n: 2, question: "Precise clinical or therapeutic question", status: "open" },
  { n: 3, question: "Intended user", status: "open" },
  { n: 4, question: "Intended population", status: "open" },
  {
    n: 5,
    question: "Input data and quality requirements",
    status: "partial",
    answer:
      "Public reference databases only (Ensembl, UniProt, AlphaFold DB, PDB). Quality requirements not set.",
    decidedOn: "2026-10-19",
  },
  { n: 6, question: "Reference standard or comparator", status: "open" },
  { n: 7, question: "Output or endpoint being benchmarked", status: "open" },
  { n: 8, question: "Performance metrics and acceptance criteria", status: "open" },
  { n: 9, question: "Independent validation dataset", status: "open" },
  {
    n: 10,
    question: "Data access, privacy, consent and licensing",
    status: "partial",
    answer: "Public data only; no patient data. Source licences listed on this page.",
    decidedOn: "2026-10-19",
  },
  {
    n: 11,
    question: "Meaning of “VIN loss”",
    status: "decided",
    answer:
      "Vision loss: the outcome RPE65-associated dystrophy causes, not a separate gene, protein or variant. It is what the benchmark is ultimately about; how it is measured is still open (question 7).",
    decidedOn: "2026-10-19",
  },
  {
    n: 12,
    question: "Meaning of “degeneracy”",
    status: "decided",
    answer:
      "Two separate topics: degeneration, and genetic redundancy. Long-term modelling covers both retinal degeneration (what RPE65 disease causes) and optic-nerve degeneration.",
    decidedOn: "2026-10-19",
  },
  {
    n: 13,
    question: "Meaning of “radiations”",
    status: "decided",
    answer:
      "Two separate use cases: non-visible wavelengths (false-colour visualisation) and radiation exposure. Plus a MetaHuman conceptual-vision mode, kept apart from benchmark output.",
    decidedOn: "2026-10-19",
  },
  { n: 14, question: "Desired clinical benchmark output", status: "open" },
];

export type StageStatus = "live" | "not-built" | "needs-decision";

export type Stage = {
  key: string;
  label: string;
  source: string;
  status: StageStatus;
  /** The kind of evidence the stage carries. */
  kind: "reference" | "computed" | "hypothetical";
};

/** The brief's workflow. Every stage runs on the RPE65 snapshot or live data. */
export const PIPELINE: Stage[] = [
  { key: "gene", label: "Gene & transcript", source: "Ensembl", status: "live", kind: "reference" },
  {
    key: "variant",
    label: "Genomic variants",
    source: "ClinVar",
    status: "live",
    kind: "reference",
  },
  { key: "protein", label: "Protein", source: "UniProt", status: "live", kind: "reference" },
  {
    key: "structure",
    label: "3D structure",
    source: "AlphaFold DB",
    status: "live",
    kind: "computed",
  },
  {
    key: "cell",
    label: "Retinal cell & pathway",
    source: "UniProt · Reactome",
    status: "live",
    kind: "reference",
  },
  {
    key: "hypothesis",
    label: "Intervention hypothesis",
    source: "Gene augmentation model",
    status: "live",
    kind: "hypothetical",
  },
  {
    key: "reference",
    label: "Reference comparison",
    source: "Phase 3 trial, 2017",
    status: "live",
    kind: "reference",
  },
];

export type Licence = { source: string; terms: string; url: string };

/** As each provider publishes them. Confirm before redistributing any data. */
export const LICENCES: Licence[] = [
  {
    source: "Ensembl",
    terms: "No restrictions on data use",
    url: "https://www.ensembl.org/info/about/legal/disclaimer.html",
  },
  {
    source: "UniProt",
    terms: "CC BY 4.0",
    url: "https://www.uniprot.org/help/license",
  },
  {
    source: "AlphaFold DB",
    terms: "CC BY 4.0",
    url: "https://alphafold.ebi.ac.uk/faq",
  },
  {
    source: "RCSB PDB",
    terms: "CC0 1.0",
    url: "https://www.rcsb.org/pages/usage-policy",
  },
];
