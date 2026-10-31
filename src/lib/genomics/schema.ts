/**
 * The research gene library as the app reads it: the display copy built by
 * tools/genome-library/capture_library.py (public/genomics/library.json), or
 * the synthetic sample (./sample.ts). The UI depends on these types only,
 * never on a source's own response shape.
 */
import { z } from "zod";

/** Where a library came from. Never mixed: a page shows one library at a time. */
export const LibraryMode = z.enum(["snapshot", "sample"]);
export type LibraryMode = z.infer<typeof LibraryMode>;

const nstr = z.string().nullable();
const nnum = z.number().nullable();

export const FileRef = z.object({
  file: z.string(),
  url: z.string(),
  retrievedAt: z.string(),
  sha256: z.string(),
});
export type FileRef = z.infer<typeof FileRef>;

/** One ClinGen gene-disease validity curation, as the source states it. */
export const Curation = z.object({
  condition: z.string(),
  diseaseLabel: z.string(),
  mondoId: nstr,
  classification: z.string(),
  moi: nstr,
  sop: nstr,
  gcep: nstr,
  date: nstr,
  reportUrl: nstr,
  hgncId: nstr,
});
export type Curation = z.infer<typeof Curation>;

export const HgncRecord = z.object({
  symbol: nstr,
  name: nstr,
  status: nstr,
  hgncId: nstr,
  ncbiGeneId: nstr,
  ensemblGeneId: nstr,
  uniprotIds: z.array(z.string()),
  locusGroup: nstr,
  location: nstr,
});
export type HgncRecord = z.infer<typeof HgncRecord>;

/** One orthologue reported by Ensembl Compara. */
export const Orthologue = z.object({
  species: z.string(),
  taxonId: nnum,
  type: z.string(),
  geneId: nstr,
  proteinId: nstr,
  /** Percent of the other species' protein identical to the human one, as Ensembl reports it. */
  percId: nnum,
  percPos: nnum,
  /** Percent of the human protein identical to the other species' one. */
  sourcePercId: nnum,
  taxonomyLevel: nstr,
  dnDs: nnum,
  method: nstr,
});
export type Orthologue = z.infer<typeof Orthologue>;

export const Phenotype = z.object({
  hpoId: z.string(),
  name: z.string(),
  frequencies: z.array(z.string()),
  diseaseIds: z.array(z.string()),
});
export type Phenotype = z.infer<typeof Phenotype>;

export const LibraryGene = z.object({
  symbol: z.string(),
  hgnc: HgncRecord.nullable(),
  /** Whether HGNC's ID agrees with the one on the ClinGen curation. */
  hgncIdCheck: z.enum(["agree", "differ"]).nullable(),
  curations: z.array(Curation),
  /** null: not retrieved (failed, skipped or withheld); []: retrieved, none reported. */
  orthologues: z.array(Orthologue).nullable(),
  orthologueStatus: nstr,
  phenotypes: z.array(Phenotype).nullable(),
  files: z.array(FileRef),
});
export type LibraryGene = z.infer<typeof LibraryGene>;

export const Species = z.object({
  ensembl: z.string(),
  taxonId: z.number(),
  scientificName: z.string(),
  commonName: z.string(),
  role: z.enum(["reference", "comparison"]),
  /** Taxonomic ancestors reported by Ensembl; null when not retrieved. */
  ancestors: z.array(z.object({ id: z.string(), name: z.string() })).nullable(),
});
export type Species = z.infer<typeof Species>;

export const SourceStatus = z.enum(["ok", "partial", "failed", "withheld", "not-run"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const LibrarySource = z.object({
  id: z.string(),
  name: z.string(),
  status: SourceStatus,
  retrievedAt: nstr,
  fileCount: z.number(),
  file: FileRef.nullable(),
  reason: z.string().optional(),
});
export type LibrarySource = z.infer<typeof LibrarySource>;

export const Condition = z.object({
  key: z.string(),
  label: z.string(),
  match: z.string(),
  note: z.string(),
  geneCount: z.number(),
});
export type Condition = z.infer<typeof Condition>;

export const Library = z.object({
  schemaVersion: z.literal(1),
  mode: LibraryMode,
  notice: z.string(),
  tool: z.string(),
  libraryVersion: z.string(),
  capturedAt: z.string(),
  complete: z.boolean(),
  releases: z.object({ ensembl: nnum, hpo: nstr }),
  conditions: z.array(Condition),
  species: z.array(Species),
  sources: z.array(LibrarySource),
  genes: z.array(LibraryGene),
  /** Sample only: what the data is and where it came from. */
  sampleNote: z.string().optional(),
});
export type Library = z.infer<typeof Library>;

export function parseLibrary(raw: unknown): Library {
  return Library.parse(raw);
}
