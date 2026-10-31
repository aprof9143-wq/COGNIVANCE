/**
 * The sample library: synthetic, made up for this app, and shown only when no
 * captured library is available. Gene symbols start with "SAMPLE-", every
 * identifier starts with "SAMPLE:" (no real database uses either), and no
 * value comes from any source. It exists so every screen and state can be
 * shown before a capture; it is never merged with captured data.
 */
import libraryCfg from "../../../config/genome/library.json";
import { NOT_FOR_CLINICAL_USE } from "@/lib/genome/status";
import type { Curation, Library, LibraryGene, Orthologue } from "./schema";

export const SAMPLE_NOTE =
  "Sample data: synthetic records made up for this app to show how the library works. The genes, identifiers, classifications and identities are not real and come from no source.";

const COMPARISON = libraryCfg.species.filter((s) => s.role === "comparison");

type Spec = {
  n: number;
  curations: [condition: string, classification: string, moi: string][];
  /** Percent identity per comparison species, in config order; null = none reported. */
  ident: (number | null)[];
  one2many?: string[];
};

const SPECS: Spec[] = [
  {
    n: 1,
    curations: [["autism", "Definitive", "AD"]],
    ident: [99.1, 97.0, 93.2, 92.8, 94.0, 81.5, 70.2],
  },
  {
    n: 2,
    curations: [["autism", "Moderate", "AD"]],
    ident: [98.7, 96.1, 90.4, 90.9, 91.7, 77.0, 61.3],
  },
  {
    n: 3,
    curations: [
      ["autism", "Definitive", "AD"],
      ["autism", "Disputed", "AR"],
    ],
    ident: [99.4, 97.8, 95.5, 95.1, 96.2, 86.0, 74.4],
  },
  {
    n: 4,
    curations: [["autism", "Limited", "XL"]],
    ident: [97.9, 94.2, 71.3, 70.8, 88.0, 62.5, null],
    one2many: ["danio_rerio"],
  },
  {
    n: 5,
    curations: [["alzheimer", "Definitive", "AD"]],
    ident: [99.0, 96.9, 92.1, 92.4, 93.3, 79.8, 66.0],
  },
  {
    n: 6,
    curations: [["alzheimer", "Strong", "AD"]],
    ident: [98.8, 96.0, 89.9, 90.2, 92.5, 75.1, 58.7],
  },
  {
    n: 7,
    curations: [
      ["alzheimer", "Limited", "AD"],
      ["autism", "Limited", "AD"],
    ],
    ident: [99.2, 97.1, 91.0, 91.6, 92.9, 80.3, null],
  },
  {
    n: 8,
    curations: [["alzheimer", "Refuted", "AD"]],
    ident: [98.1, 95.4, 88.2, 88.7, 90.6, 73.4, 55.9],
  },
  {
    n: 9,
    curations: [["autism", "Strong", "AR"]],
    ident: [99.3, 97.4, 94.6, 94.1, 95.0, 83.7, 69.5],
  },
];

const pad = (n: number) => String(n).padStart(4, "0");

function gene(spec: Spec): LibraryGene {
  const symbol = `SAMPLE-${String.fromCharCode(64 + spec.n)}`;
  const curations: Curation[] = spec.curations.map(([condition, classification, moi], i) => ({
    condition,
    diseaseLabel: `Sample ${condition === "autism" ? "autism-related" : "Alzheimer-related"} condition ${spec.n}.${i + 1}`,
    mondoId: `SAMPLE:MONDO-${pad(spec.n * 10 + i)}`,
    classification,
    moi,
    sop: null,
    gcep: "Sample expert panel",
    date: `2025-0${(spec.n % 9) + 1}-15`,
    reportUrl: null,
    hgncId: `SAMPLE:HGNC-${pad(spec.n)}`,
  }));
  const orthologues: Orthologue[] = COMPARISON.flatMap((s, i) => {
    const v = spec.ident[i];
    if (v === null || v === undefined) return [];
    return [
      {
        species: s.ensembl,
        taxonId: s.taxonId,
        type: spec.one2many?.includes(s.ensembl) ? "ortholog_one2many" : "ortholog_one2one",
        geneId: `SAMPLE:${s.ensembl.toUpperCase()}-${pad(spec.n)}`,
        proteinId: null,
        percId: v,
        percPos: null,
        sourcePercId: v,
        taxonomyLevel: null,
        dnDs: null,
        method: null,
      },
    ];
  });
  return {
    symbol,
    hgnc: {
      symbol,
      name: `sample gene ${String.fromCharCode(64 + spec.n)}`,
      status: null,
      hgncId: `SAMPLE:HGNC-${pad(spec.n)}`,
      ncbiGeneId: null,
      ensemblGeneId: `SAMPLE:ENSG-${pad(spec.n)}`,
      uniprotIds: [],
      locusGroup: null,
      location: null,
    },
    hgncIdCheck: null,
    curations,
    orthologues,
    orthologueStatus: "ok",
    phenotypes: [],
    files: [],
  };
}

const genes = SPECS.map(gene);

export const SAMPLE_LIBRARY: Library = {
  schemaVersion: 1,
  mode: "sample",
  notice: NOT_FOR_CLINICAL_USE,
  tool: "src/lib/genomics/sample.ts",
  libraryVersion: libraryCfg.libraryVersion,
  capturedAt: "2026-10-31T00:00:00+00:00",
  complete: true,
  releases: { ensembl: null, hpo: null },
  conditions: libraryCfg.conditions.map((c) => ({
    ...c,
    geneCount: genes.filter((g) => g.curations.some((x) => x.condition === c.key)).length,
  })),
  species: libraryCfg.species.map((s) => ({
    ...s,
    role: s.role as "reference" | "comparison",
    // No taxonomy is made up: the species tree needs captured data.
    ancestors: null,
  })),
  sources: [],
  genes,
  sampleNote: SAMPLE_NOTE,
};
