/**
 * Public reference sources for the Vision module: Ensembl (gene, transcript),
 * UniProt (protein) and AlphaFold DB (predicted structure). Requests go from
 * the browser straight to each provider; nothing is proxied or cached here.
 *
 * Responses are validated with zod, not trusted. A response that does not
 * match becomes a "missing" value that says so; it is never patched up.
 *
 * Field names follow each provider's documented REST schema. They have not yet
 * been checked against captured live responses (the build environment cannot
 * reach these hosts); the first live run will show any mismatch as "response
 * not understood".
 */

import { z } from "zod";
import { missing, sourced, valueOf, type Provenance, type Sourced } from "./evidence";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export const ENSEMBL = "https://rest.ensembl.org";
export const UNIPROT = "https://rest.uniprot.org";
export const ALPHAFOLD = "https://alphafold.ebi.ac.uk";
export const RCSB_FILES = "https://files.rcsb.org";

type Fetched<T> =
  { ok: true; data: T; headers: Headers; retrievedAt: string } | { ok: false; reason: string };

async function get<T>(
  url: string,
  parse: (raw: unknown) => T,
  as: "json" | "text",
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<Fetched<T>> {
  let res: Response;
  try {
    res = await fetcher(url, {
      ...(signal ? { signal } : {}),
      headers: as === "json" ? { Accept: "application/json" } : {},
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return {
      ok: false,
      reason: `Could not reach ${new URL(url).host}: offline, blocked, or refused by the browser.`,
    };
  }
  if (!res.ok) return { ok: false, reason: `${new URL(url).host} answered HTTP ${res.status}.` };
  const retrievedAt = new Date().toISOString();
  let raw: unknown;
  try {
    raw = as === "json" ? await res.json() : await res.text();
  } catch {
    return { ok: false, reason: `${new URL(url).host} sent a body that could not be read.` };
  }
  try {
    return { ok: true, data: parse(raw), headers: res.headers, retrievedAt };
  } catch (e) {
    const detail = e instanceof z.ZodError ? e.issues[0]?.path.join(".") : (e as Error).message;
    return {
      ok: false,
      reason: `Response not understood (${detail || "unexpected shape"}). Nothing was filled in.`,
    };
  }
}

/** Ensembl and UniProt ids carry a ".version" suffix in some fields and not others. */
export const unversioned = (id: string) => id.replace(/\.\d+$/, "");

// ---------------------------------------------------------------- Ensembl

export type GeneRecord = {
  ensemblId: string;
  version?: number | undefined;
  symbol: string;
  description?: string | undefined;
  biotype?: string | undefined;
  assembly: string;
  chromosome: string;
  start: number;
  end: number;
  strand: number;
  transcriptCount: number;
  canonical?:
    | {
        id: string;
        version?: number | undefined;
        biotype?: string | undefined;
        exonCount: number;
        /** Genomic coordinates, in transcript order. */
        exons: { id: string; start: number; end: number }[];
        translation?: { id: string; length: number } | undefined;
      }
    | undefined;
};

const EnsemblTranscript = z.object({
  id: z.string(),
  version: z.number().optional(),
  biotype: z.string().optional(),
  is_canonical: z.number().optional(),
  Exon: z.array(z.object({ id: z.string(), start: z.number(), end: z.number() })).optional(),
  Translation: z.object({ id: z.string(), length: z.number() }).optional(),
});

const EnsemblGene = z.object({
  id: z.string(),
  version: z.number().optional(),
  display_name: z.string(),
  description: z.string().nullish(),
  biotype: z.string().optional(),
  assembly_name: z.string(),
  seq_region_name: z.string(),
  start: z.number(),
  end: z.number(),
  strand: z.number(),
  canonical_transcript: z.string().optional(),
  Transcript: z.array(EnsemblTranscript).optional(),
});

export function toGeneRecord(g: z.infer<typeof EnsemblGene>): GeneRecord {
  const ts = g.Transcript ?? [];
  const canon =
    ts.find((t) => t.is_canonical === 1) ??
    (g.canonical_transcript
      ? ts.find((t) => t.id === unversioned(g.canonical_transcript!))
      : undefined);
  return {
    ensemblId: g.id,
    version: g.version,
    symbol: g.display_name,
    description: g.description ?? undefined,
    biotype: g.biotype,
    assembly: g.assembly_name,
    chromosome: g.seq_region_name,
    start: g.start,
    end: g.end,
    strand: g.strand,
    transcriptCount: ts.length,
    canonical: canon && {
      id: canon.id,
      version: canon.version,
      biotype: canon.biotype,
      exonCount: canon.Exon?.length ?? 0,
      exons: (canon.Exon ?? []).map(({ id, start, end }) => ({ id, start, end })),
      translation: canon.Translation,
    },
  };
}

/** Parse a raw Ensembl lookup (expand=1) response. Throws on an unexpected shape. */
export const parseEnsemblGene = (raw: unknown): GeneRecord => toGeneRecord(EnsemblGene.parse(raw));

export async function fetchGene(
  symbol: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<Sourced<GeneRecord>> {
  const url = `${ENSEMBL}/lookup/symbol/homo_sapiens/${encodeURIComponent(symbol)}?content-type=application/json;expand=1`;
  const releaseUrl = `${ENSEMBL}/info/data?content-type=application/json`;
  const [gene, rel] = await Promise.all([
    get(url, parseEnsemblGene, "json", fetcher, signal),
    get(
      releaseUrl,
      (raw) => z.object({ releases: z.array(z.number()) }).parse(raw),
      "json",
      fetcher,
      signal,
    ),
  ]);
  if (!gene.ok) return missing(gene.reason);
  const g = gene.data;
  return sourced(g, "reference", {
    source: "Ensembl REST",
    url,
    recordId: g.version ? `${g.ensemblId}.${g.version}` : g.ensemblId,
    release: rel.ok ? `Ensembl ${rel.data.releases.join(", ")}` : undefined,
    retrievedAt: gene.retrievedAt,
    note: rel.ok ? undefined : "Release not reported: " + rel.reason,
  });
}

// ---------------------------------------------------------------- UniProt

export type ProteinRecord = {
  accession: string;
  entryName?: string | undefined;
  reviewed: boolean;
  name?: string | undefined;
  geneNames: string[];
  organism?: string | undefined;
  taxonId: number;
  length: number;
  sequence: string;
  entryVersion?: number | undefined;
  sequenceVersion?: number | undefined;
  lastUpdated?: string | undefined;
  functionText?: string | undefined;
  /** Where the protein is made, as UniProt states it. */
  tissue?: string | undefined;
  /** Reactions it catalyses, with EC numbers. */
  reactions: { name: string; ec?: string | undefined }[];
  /** Reactome pathways it takes part in. */
  pathways: { id: string; name: string }[];
  locations: string[];
  diseases: { id: string; acronym?: string | undefined; mim?: string | undefined }[];
  ensemblGeneIds: string[];
  ensemblProteinIds: string[];
  pdb: {
    id: string;
    method?: string | undefined;
    resolution?: string | undefined;
    chains?: string | undefined;
  }[];
};

const Text = z.object({ value: z.string() });
const Property = z.object({ key: z.string(), value: z.string() });

const UniProtEntry = z.object({
  primaryAccession: z.string(),
  uniProtkbId: z.string().optional(),
  entryType: z.string().optional(),
  entryAudit: z
    .object({
      lastAnnotationUpdateDate: z.string().optional(),
      entryVersion: z.number().optional(),
      sequenceVersion: z.number().optional(),
    })
    .optional(),
  organism: z.object({ scientificName: z.string().optional(), taxonId: z.number() }),
  proteinDescription: z
    .object({ recommendedName: z.object({ fullName: Text }).optional() })
    .optional(),
  genes: z.array(z.object({ geneName: Text.optional() })).optional(),
  comments: z
    .array(
      z.object({
        commentType: z.string(),
        texts: z.array(Text).optional(),
        reaction: z.object({ name: z.string(), ecNumber: z.string().optional() }).optional(),
        subcellularLocations: z.array(z.object({ location: Text.optional() })).optional(),
        disease: z
          .object({
            diseaseId: z.string().optional(),
            acronym: z.string().optional(),
            diseaseCrossReference: z.object({ database: z.string(), id: z.string() }).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  uniProtKBCrossReferences: z
    .array(
      z.object({
        database: z.string(),
        id: z.string(),
        properties: z.array(Property).optional(),
      }),
    )
    .optional(),
  sequence: z.object({ value: z.string(), length: z.number() }),
});

export function toProteinRecord(e: z.infer<typeof UniProtEntry>): ProteinRecord {
  const comments = e.comments ?? [];
  const xrefs = e.uniProtKBCrossReferences ?? [];
  const prop = (x: (typeof xrefs)[number], key: string) =>
    x.properties?.find((p) => p.key === key)?.value;
  const ensembl = xrefs.filter((x) => x.database === "Ensembl");
  return {
    accession: e.primaryAccession,
    entryName: e.uniProtkbId,
    reviewed: /reviewed/i.test(e.entryType ?? "") && !/unreviewed/i.test(e.entryType ?? ""),
    name: e.proteinDescription?.recommendedName?.fullName.value,
    geneNames: (e.genes ?? []).flatMap((g) => (g.geneName ? [g.geneName.value] : [])),
    organism: e.organism.scientificName,
    taxonId: e.organism.taxonId,
    length: e.sequence.length,
    sequence: e.sequence.value,
    entryVersion: e.entryAudit?.entryVersion,
    sequenceVersion: e.entryAudit?.sequenceVersion,
    lastUpdated: e.entryAudit?.lastAnnotationUpdateDate,
    functionText:
      comments
        .filter((c) => c.commentType === "FUNCTION")
        .flatMap((c) => c.texts ?? [])
        .map((t) => t.value)
        .join(" ") || undefined,
    tissue:
      comments
        .filter((c) => c.commentType === "TISSUE SPECIFICITY")
        .flatMap((c) => c.texts ?? [])
        .map((t) => t.value)
        .join(" ") || undefined,
    reactions: comments
      .filter((c) => c.commentType === "CATALYTIC ACTIVITY" && c.reaction)
      .map((c) => ({ name: c.reaction!.name, ec: c.reaction!.ecNumber })),
    pathways: xrefs
      .filter((x) => x.database === "Reactome")
      .map((x) => ({ id: x.id, name: prop(x, "PathwayName") ?? x.id })),
    locations: comments
      .filter((c) => c.commentType === "SUBCELLULAR LOCATION")
      .flatMap((c) => c.subcellularLocations ?? [])
      .flatMap((l) => (l.location ? [l.location.value] : [])),
    diseases: comments
      .filter((c) => c.commentType === "DISEASE" && c.disease?.diseaseId)
      .map((c) => ({
        id: c.disease!.diseaseId!,
        acronym: c.disease!.acronym,
        mim:
          c.disease!.diseaseCrossReference?.database === "MIM"
            ? c.disease!.diseaseCrossReference.id
            : undefined,
      })),
    ensemblGeneIds: [...new Set(ensembl.flatMap((x) => prop(x, "GeneId") ?? []).map(unversioned))],
    ensemblProteinIds: [
      ...new Set(ensembl.flatMap((x) => prop(x, "ProteinId") ?? []).map(unversioned)),
    ],
    pdb: xrefs
      .filter((x) => x.database === "PDB")
      .map((x) => ({
        id: x.id,
        method: prop(x, "Method"),
        resolution: prop(x, "Resolution"),
        chains: prop(x, "Chains"),
      })),
  };
}

/** Parse a raw UniProtKB search response into its entries. Throws on an unexpected shape. */
export const parseUniProtSearch = (raw: unknown): ProteinRecord[] =>
  z
    .object({ results: z.array(UniProtEntry) })
    .parse(raw)
    .results.map(toProteinRecord);

export async function fetchProtein(
  symbol: string,
  taxonId: number,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<Sourced<ProteinRecord>> {
  const query = `gene_exact:${symbol} AND organism_id:${taxonId} AND reviewed:true`;
  const url = `${UNIPROT}/uniprotkb/search?query=${encodeURIComponent(query)}&format=json&size=5`;
  const res = await get(url, parseUniProtSearch, "json", fetcher, signal);
  if (!res.ok) return missing(res.reason);
  const prov = (p: ProteinRecord): Provenance => ({
    source: "UniProtKB REST",
    url,
    recordId: p.sequenceVersion ? `${p.accession} (sequence v${p.sequenceVersion})` : p.accession,
    release:
      [
        res.headers.get("X-UniProt-Release") && `UniProt ${res.headers.get("X-UniProt-Release")}`,
        p.entryVersion && `entry v${p.entryVersion}`,
        p.lastUpdated && `annotation updated ${p.lastUpdated}`,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    retrievedAt: res.retrievedAt,
  });
  const hits = res.data;
  if (hits.length === 0)
    return missing(`UniProt has no reviewed entry for gene ${symbol} in taxon ${taxonId}.`);
  if (hits.length > 1)
    return {
      state: "conflict",
      reason: `${hits.length} reviewed UniProt entries match gene ${symbol}; none was chosen.`,
      values: hits.map((p) => ({ value: p, provenance: prov(p) })),
    };
  return sourced(hits[0]!, "reference", prov(hits[0]!));
}

// ---------------------------------------------------------------- AlphaFold DB

export type ModelRecord = {
  entryId: string;
  accession: string;
  version?: number | undefined;
  created?: string | undefined;
  start?: number | undefined;
  end?: number | undefined;
  sequence?: string | undefined;
  pdbUrl: string;
  /** Mean pLDDT as AlphaFold DB reports it. */
  globalPlddt?: number | undefined;
  /** Other entries the API returned for this accession (fragments, isoforms). */
  others: string[];
};

const AlphaFoldEntry = z.object({
  entryId: z.string(),
  uniprotAccession: z.string(),
  uniprotStart: z.number().optional(),
  uniprotEnd: z.number().optional(),
  uniprotSequence: z.string().optional(),
  modelCreatedDate: z.string().optional(),
  latestVersion: z.number().optional(),
  pdbUrl: z.string().url(),
  globalMetricValue: z.number().optional(),
});

/** The model for `accession` from a raw AlphaFold DB prediction response, or null if none. */
export function parseAlphaFold(raw: unknown, accession: string): ModelRecord | null {
  const mine = z
    .array(AlphaFoldEntry)
    .parse(raw)
    .filter((e) => e.uniprotAccession === accession);
  const e = mine.find((x) => x.entryId === `AF-${accession}-F1`) ?? mine[0];
  if (!e) return null;
  return {
    entryId: e.entryId,
    accession,
    version: e.latestVersion,
    created: e.modelCreatedDate,
    start: e.uniprotStart,
    end: e.uniprotEnd,
    sequence: e.uniprotSequence,
    pdbUrl: e.pdbUrl,
    globalPlddt: e.globalMetricValue,
    others: mine.filter((x) => x !== e).map((x) => x.entryId),
  };
}

export const modelProvenance = (m: ModelRecord, url: string, retrievedAt: string): Provenance => ({
  source: "AlphaFold DB API",
  url,
  recordId: m.version ? `${m.entryId} v${m.version}` : m.entryId,
  release: m.created ? `model created ${m.created.slice(0, 10)}` : undefined,
  retrievedAt,
  note: "Predicted by AlphaFold. A model, not a measurement.",
});

export async function fetchModel(
  accession: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<Sourced<ModelRecord>> {
  const url = `${ALPHAFOLD}/api/prediction/${encodeURIComponent(accession)}`;
  const res = await get(url, (raw) => parseAlphaFold(raw, accession), "json", fetcher, signal);
  if (!res.ok) return missing(res.reason);
  if (!res.data) return missing(`AlphaFold DB returned no model for ${accession}.`);
  return sourced(res.data, "computed", modelProvenance(res.data, url, res.retrievedAt));
}

/** A coordinate file as text, for parsePdbBackbone. */
export async function fetchStructureText(
  url: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<Fetched<string>> {
  return get(url, (raw) => String(raw), "text", fetcher, signal);
}

export const rcsbPdbUrl = (id: string) => `${RCSB_FILES}/download/${encodeURIComponent(id)}.pdb`;

// ---------------------------------------------------------------- the record

export type VisionRecord = {
  gene: Sourced<GeneRecord>;
  protein: Sourced<ProteinRecord>;
  model: Sourced<ModelRecord>;
};

export async function loadVisionRecord(
  symbol: string,
  taxonId: number,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<VisionRecord> {
  const [gene, protein] = await Promise.all([
    fetchGene(symbol, fetcher, signal),
    fetchProtein(symbol, taxonId, fetcher, signal),
  ]);
  const p = valueOf(protein);
  const model = p
    ? await fetchModel(p.accession, fetcher, signal)
    : missing<ModelRecord>("No single UniProt accession to look up a predicted model for.");
  return { gene, protein, model };
}

// ---------------------------------------------------------------- cross-checks

export type CheckStatus = "agree" | "differ" | "unavailable";

export type Check = { key: string; label: string; status: CheckStatus; detail: string };

/**
 * Do the sources agree with each other? Computed here, from the values above;
 * a "differ" is shown, never resolved by picking a side.
 */
export function crossCheck(
  symbol: string,
  taxonId: number,
  gene: GeneRecord | undefined,
  protein: ProteinRecord | undefined,
  model: ModelRecord | undefined,
): Check[] {
  const na = (key: string, label: string, what: string): Check => ({
    key,
    label,
    status: "unavailable",
    detail: `Not checked: ${what} missing.`,
  });
  const checks: Check[] = [];

  checks.push(
    gene && protein
      ? (() => {
          const ok = gene.symbol === symbol && protein.geneNames.includes(symbol);
          return {
            key: "symbol",
            label: "Gene symbol",
            status: ok ? "agree" : "differ",
            detail: `Asked for ${symbol}; Ensembl: ${gene.symbol}; UniProt: ${protein.geneNames.join(", ") || "none"}.`,
          };
        })()
      : na("symbol", "Gene symbol", gene ? "UniProt record" : "Ensembl record"),
  );

  checks.push(
    protein
      ? {
          key: "species",
          label: "Species",
          status: protein.taxonId === taxonId ? "agree" : "differ",
          detail: `Requested taxon ${taxonId}; UniProt entry is taxon ${protein.taxonId}${protein.organism ? ` (${protein.organism})` : ""}.`,
        }
      : na("species", "Species", "UniProt record"),
  );

  checks.push(
    gene && protein
      ? protein.ensemblGeneIds.length === 0
        ? {
            key: "gene-id",
            label: "Ensembl gene ↔ UniProt",
            status: "unavailable",
            detail: "UniProt lists no Ensembl gene cross-reference.",
          }
        : {
            key: "gene-id",
            label: "Ensembl gene ↔ UniProt",
            status: protein.ensemblGeneIds.includes(gene.ensemblId) ? "agree" : "differ",
            detail: `Ensembl ${gene.ensemblId}; UniProt cross-references ${protein.ensemblGeneIds.join(", ")}.`,
          }
      : na("gene-id", "Ensembl gene ↔ UniProt", "a record"),
  );

  const tl = gene?.canonical?.translation;
  checks.push(
    tl && protein
      ? {
          key: "translation",
          label: "Canonical protein ↔ UniProt",
          status: protein.ensemblProteinIds.includes(unversioned(tl.id)) ? "agree" : "differ",
          detail: protein.ensemblProteinIds.includes(unversioned(tl.id))
            ? `Ensembl canonical translation ${tl.id} is cross-referenced by ${protein.accession}.`
            : `Ensembl canonical translation ${tl.id} is not among UniProt's Ensembl protein cross-references (${protein.ensemblProteinIds.join(", ") || "none"}). The two may describe different isoforms.`,
        }
      : na(
          "translation",
          "Canonical protein ↔ UniProt",
          tl ? "UniProt record" : "Ensembl canonical translation",
        ),
  );

  checks.push(
    tl && protein
      ? {
          key: "length",
          label: "Protein length",
          status: tl.length === protein.length ? "agree" : "differ",
          detail: `Ensembl canonical translation ${tl.length} aa; UniProt ${protein.length} aa.`,
        }
      : na("length", "Protein length", tl ? "UniProt record" : "Ensembl canonical translation"),
  );

  checks.push(
    model && protein
      ? model.sequence
        ? {
            key: "model-sequence",
            label: "Model sequence ↔ UniProt",
            status: model.sequence === protein.sequence ? "agree" : "differ",
            detail:
              model.sequence === protein.sequence
                ? `AlphaFold model ${model.entryId} was built on the current UniProt sequence (${protein.length} aa).`
                : `AlphaFold model ${model.entryId} was built on a sequence that differs from the current UniProt sequence (${model.sequence.length} vs ${protein.length} aa).`,
          }
        : {
            key: "model-sequence",
            label: "Model sequence ↔ UniProt",
            status: "unavailable",
            detail: "AlphaFold DB did not report the sequence its model was built on.",
          }
      : na(
          "model-sequence",
          "Model sequence ↔ UniProt",
          model ? "UniProt record" : "AlphaFold model",
        ),
  );

  return checks;
}
