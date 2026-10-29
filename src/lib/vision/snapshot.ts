/**
 * The captured reference snapshot, as the website may show it.
 *
 * tools/vision-snapshot/capture.py saves the raw responses, unchanged, in
 * data/genome/snapshot/<gene>/ with a manifest of request URL, status,
 * retrieval time, size and SHA-256. That folder is not served: no source's
 * redistribution is permitted. tools/genome-display builds the display-only
 * copy served from public/vision/display/<gene>/, which this module reads: only
 * the fields the parsers below read, only from sources whose display the source
 * policy permits, each file traced to the raw response it came from.
 *
 * The loader asks the source policy (lib/genome/policy.ts) before reading any
 * file, and never requests a withheld source: ClinVar is withheld while its app
 * use is blocked, so no ClinVar record is loaded or shown.
 *
 * The Vision pages read this first, so the evidence pipeline works the same
 * on any network and every number is reproducible; they can then check the
 * live databases. The same parsers read both.
 */

import { z } from "zod";
import { gunzip } from "@/lib/sim/anatomy";
import { displayDir } from "@/lib/genome/config";
import { decide } from "@/lib/genome/policy";
import { missing, sourced, withheld, type Provenance, type Sourced } from "./evidence";
import {
  modelProvenance,
  parseAlphaFold,
  parseEnsemblGene,
  parseUniProtSearch,
  type Fetcher,
  type GeneRecord,
  type ModelRecord,
  type ProteinRecord,
} from "./sources";

/** RPE65's display folder; every registered gene has its own (displayDir). */
export const SNAPSHOT_BASE = displayDir("RPE65");

const ManifestFile = z.object({
  file: z.string(),
  url: z.string(),
  status: z.number(),
  retrievedAt: z.string(),
  bytes: z.number(),
  sha256: z.string(),
  gzip: z.boolean(),
  headers: z.record(z.string()).default({}),
  note: z.string().optional(),
  /** Manifest v2: digest of the file as stored (gzip included). */
  storedSha256: z.string().optional(),
});
export type ManifestFile = z.infer<typeof ManifestFile>;

const Manifest = z.object({
  /** Absent in version 1 manifests. */
  schemaVersion: z.number().optional(),
  gene: z.string(),
  hgncId: z.string().optional(),
  taxonId: z.number(),
  assembly: z.string().optional(),
  capturedAt: z.string(),
  complete: z.boolean().optional(),
  sources: z
    .array(
      z.object({
        step: z.string(),
        licenceId: z.string(),
        status: z.enum(["ok", "failed", "skipped", "withheld"]),
        reason: z.string().optional(),
      }),
    )
    .optional(),
  files: z.array(ManifestFile),
});
export const parseManifest = (raw: unknown) => Manifest.parse(raw);
export type Manifest = z.infer<typeof Manifest>;

/** The display copy's manifest (tools/genome-display/build_display.py). */
const DisplayManifest = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("display-only"),
  notice: z.string(),
  gene: z.string(),
  hgncId: z.string().nullish(),
  taxonId: z.number(),
  assembly: z.string(),
  capturedAt: z.string(),
  rawManifestSha256: z.string(),
  inventoryVersion: z.string(),
  files: z.array(ManifestFile.extend({ licenceId: z.string(), storedSha256: z.string() })),
  withheld: z.array(z.object({ licenceId: z.string(), reason: z.string() })),
});
export const parseDisplayManifest = (raw: unknown) => DisplayManifest.parse(raw);
export type DisplayManifest = z.infer<typeof DisplayManifest>;

// ---------------------------------------------------------------- ClinVar

export type VariantGroup = "pathogenic" | "uncertain" | "benign" | "conflicting" | "other";

export type Variant = {
  uid: string;
  accession: string;
  /** e.g. NM_000329.3(RPE65):c.271C>T (p.Arg91Trp) */
  title: string;
  cdna?: string | undefined;
  /** Protein change on the MANE transcript, from the title. */
  protein?: { ref: string; pos: number; change: string; short: string } | undefined;
  classification: string;
  group: VariantGroup;
  reviewStatus?: string | undefined;
  lastEvaluated?: string | undefined;
  conditions: string[];
  consequences: string[];
  type?: string | undefined;
  /** GRCh38 position on chromosome 1. */
  grch38?: { start: number; stop: number } | undefined;
};

const AA3: Record<string, string> = {
  Ala: "A",
  Arg: "R",
  Asn: "N",
  Asp: "D",
  Cys: "C",
  Gln: "Q",
  Glu: "E",
  Gly: "G",
  His: "H",
  Ile: "I",
  Leu: "L",
  Lys: "K",
  Met: "M",
  Phe: "F",
  Pro: "P",
  Ser: "S",
  Thr: "T",
  Trp: "W",
  Tyr: "Y",
  Val: "V",
  Ter: "*",
};

export function groupOf(classification: string): VariantGroup {
  const c = classification.toLowerCase();
  if (c.startsWith("conflicting")) return "conflicting";
  if (c === "pathogenic" || c === "likely pathogenic" || c === "pathogenic/likely pathogenic")
    return "pathogenic";
  if (c === "uncertain significance") return "uncertain";
  if (c === "benign" || c === "likely benign" || c === "benign/likely benign") return "benign";
  return "other";
}

/** p.Arg91Trp → { ref: "R", pos: 91, change: "Trp", short: "R91W" } */
export function parseProteinChange(title: string): Variant["protein"] {
  const m = /\(p\.([A-Z][a-z]{2})(\d+)([^)]*)\)/.exec(title);
  if (!m) return undefined;
  const ref = AA3[m[1]!] ?? "?";
  const pos = Number(m[2]);
  const change = m[3] ?? "";
  const alt = AA3[change] ?? (change === "=" ? ref : change);
  return { ref, pos, change, short: `${ref}${pos}${alt}` };
}

const Esummary = z.object({
  result: z.object({ uids: z.array(z.string()) }).catchall(z.unknown()),
});

const Record_ = z.object({
  uid: z.string(),
  accession: z.string(),
  title: z.string(),
  obj_type: z.string().optional(),
  genes: z.array(z.object({ symbol: z.string() })).default([]),
  germline_classification: z
    .object({
      description: z.string().default(""),
      review_status: z.string().optional(),
      last_evaluated: z.string().optional(),
      trait_set: z.array(z.object({ trait_name: z.string() })).default([]),
    })
    .optional(),
  molecular_consequence_list: z.array(z.string()).default([]),
  variation_set: z
    .array(
      z.object({
        cdna_change: z.string().optional(),
        variation_loc: z
          .array(
            z.object({
              assembly_name: z.string(),
              status: z.string().optional(),
              start: z.string(),
              stop: z.string(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

export type VariantSet = {
  variants: Variant[];
  /** Records ClinVar returned that span other genes too (large deletions etc.). */
  multiGene: number;
  /** IDs ClinVar listed but returned no summary for (missing, or an error document). */
  unavailable: number;
  total: number;
};

/** Records that name `gene` alone; multi-gene events are counted, not mapped. */
export function parseClinVar(batches: unknown[], gene: string): VariantSet {
  const variants: Variant[] = [];
  let multiGene = 0;
  let unavailable = 0;
  let total = 0;
  for (const raw of batches) {
    const { result } = Esummary.parse(raw);
    for (const uid of result.uids) {
      total++;
      const doc = result[uid];
      if (doc === undefined || (typeof doc === "object" && doc !== null && "error" in doc)) {
        unavailable++;
        continue;
      }
      // A summary that is present but malformed throws: it is not patched up.
      const r = Record_.parse(doc);
      if (r.genes.length !== 1 || r.genes[0]!.symbol !== gene) {
        multiGene++;
        continue;
      }
      const g = r.germline_classification;
      const vs = r.variation_set[0];
      // GRCh38 only (Genome v1); ClinVar's GRCh37 locations are ignored, not converted.
      const loc = vs?.variation_loc.find(
        (l) => l.assembly_name === "GRCh38" && (l.status ?? "current") === "current",
      );
      const classification = g?.description || "not provided";
      variants.push({
        uid: r.uid,
        accession: r.accession,
        title: r.title,
        cdna: vs?.cdna_change || undefined,
        protein: parseProteinChange(r.title),
        classification,
        group: groupOf(classification),
        reviewStatus: g?.review_status,
        lastEvaluated: g?.last_evaluated?.slice(0, 10).replaceAll("/", "-"),
        conditions: [...new Set((g?.trait_set ?? []).map((t) => t.trait_name))],
        consequences: r.molecular_consequence_list,
        type: r.obj_type,
        grch38: loc ? { start: Number(loc.start), stop: Number(loc.stop) } : undefined,
      });
    }
  }
  return { variants, multiGene, unavailable, total };
}

// ---------------------------------------------------------------- DNA

const CODONS: Record<string, string> = {};
{
  const bases = "TCAG";
  const aa = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
  let i = 0;
  for (const a of bases) for (const b of bases) for (const c of bases) CODONS[a + b + c] = aa[i++]!;
}

/** Standard genetic code. Stops at the first stop codon, which is not included. */
export function translate(cds: string): string {
  let out = "";
  for (let i = 0; i + 3 <= cds.length; i += 3) {
    const aa = CODONS[cds.slice(i, i + 3).toUpperCase()] ?? "X";
    if (aa === "*") break;
    out += aa;
  }
  return out;
}

export type Sequences = {
  /** Coding sequence of the canonical transcript, 5'→3'. */
  cds: string;
  transcript: string;
  /** Whole gene region, on the gene's strand. */
  gene: string;
  region: string;
};

// ---------------------------------------------------------------- loader

export type SnapshotRecord = {
  manifest: DisplayManifest;
  gene: Sourced<GeneRecord>;
  protein: Sourced<ProteinRecord>;
  model: Sourced<ModelRecord>;
  variants: Sourced<VariantSet>;
  sequences: Sourced<Sequences>;
  /** The AlphaFold coordinate file, as text. */
  structure: () => Promise<string>;
};

async function readFile(
  base: string,
  name: string,
  m: DisplayManifest,
  fetcher: Fetcher,
): Promise<string> {
  const meta = m.files.find((f) => f.file === name);
  if (!meta) throw new Error(`${name} is not in the snapshot`);
  // Checked again here, whatever the manifest says: a file from a source whose
  // display is not permitted is never requested.
  const d = decide(meta.licenceId, "display");
  if (!d.allowed) throw new Error(d.reason);
  const res = await fetcher(base + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder().decode(meta.gzip ? await gunzip(buf) : buf);
}

function prov(
  m: DisplayManifest,
  name: string,
  source: string,
  extra: Partial<Provenance> = {},
): Provenance {
  const f = m.files.find((x) => x.file === name)!;
  return {
    source,
    url: f.url,
    retrievedAt: f.retrievedAt,
    note: `From the snapshot of the raw response (SHA-256 ${f.sha256.slice(0, 12)}…), as displayed.`,
    ...extra,
  };
}

async function attempt<T>(fn: () => Promise<Sourced<T>>): Promise<Sourced<T>> {
  try {
    return await fn();
  } catch (e) {
    return missing(`Snapshot could not be read: ${(e as Error).message}`);
  }
}

export async function loadSnapshot(fetcher: Fetcher, symbol = "RPE65"): Promise<SnapshotRecord> {
  const base = displayDir(symbol);
  const res = await fetcher(base + "manifest.json");
  if (!res.ok) throw new Error(`Snapshot manifest: HTTP ${res.status}`);
  const m = DisplayManifest.parse(await res.json());
  if (m.gene !== symbol)
    throw new Error(`The snapshot in ${base} is for ${m.gene}, not ${symbol}.`);
  const json = async (name: string) =>
    JSON.parse(await readFile(base, name, m, fetcher)) as unknown;

  const gene = attempt<GeneRecord>(async () => {
    const g = parseEnsemblGene(await json("ensembl_lookup.json"));
    const rel = z
      .object({ releases: z.array(z.number()) })
      .parse(await json("ensembl_release.json"));
    return sourced(
      g,
      "reference",
      prov(m, "ensembl_lookup.json", "Ensembl REST", {
        recordId: g.version ? `${g.ensemblId}.${g.version}` : g.ensemblId,
        release: `Ensembl ${rel.releases.join(", ")}`,
      }),
    );
  });

  const protein = attempt<ProteinRecord>(async () => {
    const hits = parseUniProtSearch(await json("uniprot_search.json"));
    if (hits.length !== 1)
      return missing(`${hits.length} reviewed UniProt entries in the snapshot; none was chosen.`);
    const p = hits[0]!;
    const h = m.files.find((f) => f.file === "uniprot_search.json")!.headers;
    return sourced(
      p,
      "reference",
      prov(m, "uniprot_search.json", "UniProtKB REST", {
        recordId: p.sequenceVersion
          ? `${p.accession} (sequence v${p.sequenceVersion})`
          : p.accession,
        release: [
          h["X-UniProt-Release"] && `UniProt ${h["X-UniProt-Release"]}`,
          p.entryVersion && `entry v${p.entryVersion}`,
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    );
  });

  const model = protein.then((p) =>
    attempt<ModelRecord>(async () => {
      if (p.state !== "value")
        return missing("No single UniProt accession to look up a model for.");
      const mod = parseAlphaFold(await json("alphafold_prediction.json"), p.value.accession);
      if (!mod) return missing(`The snapshot has no AlphaFold model for ${p.value.accession}.`);
      const f = m.files.find((x) => x.file === "alphafold_prediction.json")!;
      return sourced(mod, "computed", {
        ...modelProvenance(mod, f.url, f.retrievedAt),
        note: `Predicted by AlphaFold. A model, not a measurement. Snapshot (SHA-256 ${f.sha256.slice(0, 12)}…).`,
      });
    }),
  );

  const variants = attempt<VariantSet>(async () => {
    // Asked first: while ClinVar's display is refused nothing below runs, so no
    // ClinVar file is requested even if one were listed.
    const policy = decide("clinvar-eutils", "display");
    if (!policy.allowed) return withheld<VariantSet>("clinvar-eutils", policy.reason);
    const names = m.files
      .map((f) => f.file)
      .filter((n) => n.startsWith("clinvar_esummary_"))
      .sort();
    const batches = await Promise.all(names.map(json));
    const set = parseClinVar(batches, m.gene);
    const first = m.files.find((f) => f.file === "clinvar_esearch.json")!;
    return sourced(
      set,
      "reference",
      prov(m, "clinvar_esearch.json", "NCBI ClinVar (E-utilities)", {
        recordId: `${set.total} records for ${m.gene}[gene]`,
        release: `retrieved ${first.retrievedAt.slice(0, 10)}`,
      }),
    );
  });

  const sequences = attempt<Sequences>(async () => {
    const S = z.object({ id: z.string(), seq: z.string() });
    const cds = S.parse(await json("ensembl_cds.json"));
    const reg = S.parse(await json("ensembl_gene_region.json"));
    return sourced(
      { cds: cds.seq, transcript: cds.id, gene: reg.seq, region: reg.id },
      "reference",
      prov(m, "ensembl_cds.json", "Ensembl REST (sequence)", { recordId: cds.id }),
    );
  });

  const [g, p, mo, v, s] = await Promise.all([gene, protein, model, variants, sequences]);
  return {
    manifest: m,
    gene: g,
    protein: p,
    model: mo,
    variants: v,
    sequences: s,
    structure: () => readFile(base, "alphafold_model.pdb.gz", m, fetcher),
  };
}
