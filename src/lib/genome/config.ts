/**
 * Genome v1 configuration: the gene registry, the versioned panels and the
 * licence inventory, read from config/genome/ (the same files the capture tool
 * reads). Nothing else in the app should carry its own gene list.
 *
 * Registration is not panel membership; panel membership is not clinical
 * approval. A panel is authoritative only when it is approved AND its decision
 * is resolved; the first IRD panel is neither (decision D5).
 */

import { z } from "zod";
import genesJson from "../../../config/genome/genes.json";
import licencesJson from "../../../config/genome/licences.json";

export class GenomeConfigError extends Error {
  override name = "GenomeConfigError";
}

export const ASSEMBLY = "GRCh38" as const;

/** HGNC-style approved symbol: starts with a capital or digit; letters, digits, hyphens. */
export const SYMBOL_PATTERN = /^[A-Z0-9][A-Za-z0-9-]{0,29}$/;

const GeneEntry = z.object({
  symbol: z.string().regex(SYMBOL_PATTERN),
  hgncId: z.string().regex(/^HGNC:\d+$/),
  ensemblGeneId: z.string().regex(/^ENSG\d{11}$/),
  uniprotAccession: z.string().regex(/^[A-Z0-9]{6,10}$/),
  taxonId: z.literal(9606),
  role: z.enum(["current-focus", "test-gene", "panel-candidate"]),
  idsVerified: z.object({ on: z.string(), how: z.string() }).nullable(),
  note: z.string().optional(),
});
export type GeneEntry = z.infer<typeof GeneEntry>;

const Registry = z.object({
  schemaVersion: z.literal(1),
  registryVersion: z.string(),
  assembly: z.literal(ASSEMBLY),
  genes: z.array(GeneEntry),
});
export type Registry = z.infer<typeof Registry>;

const Panel = z.object({
  schemaVersion: z.literal(1),
  panelId: z.string(),
  panelVersion: z.string(),
  title: z.string(),
  assembly: z.literal(ASSEMBLY),
  reviewStatus: z.enum(["proposed", "under-review", "approved", "retired"]),
  decision: z.string(),
  decisionStatus: z.enum(["unresolved", "resolved"]),
  members: z.array(z.string()),
  note: z.string(),
});
export type Panel = z.infer<typeof Panel>;

const LicenceItem = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["data-source", "library", "tool", "predictor"]),
  used: z.boolean(),
  version: z.string().nullable(),
  supplies: z.string(),
  softwareLicence: z.string(),
  dataTerms: z.string(),
  termsUrls: z.array(z.string()),
  commercialUse: z.enum(["permitted", "restricted", "unclear", "unverified"]),
  attribution: z.string(),
  redistribution: z.string(),
  reviewStatus: z.string(),
  termsCheckedOn: z.string().nullable(),
  commercialPilot: z.enum(["approved", "not-approved"]),
  followUp: z.string(),
});
export type LicenceItem = z.infer<typeof LicenceItem>;

const Licences = z.object({
  schemaVersion: z.literal(1),
  inventoryVersion: z.string(),
  reviewedOn: z.string(),
  items: z.array(LicenceItem),
});
export type Licences = z.infer<typeof Licences>;

export function parseRegistry(raw: unknown): Registry {
  const r = Registry.parse(raw);
  const seen = new Map<string, string>();
  for (const g of r.genes) {
    for (const key of [g.symbol.toUpperCase(), g.hgncId, g.ensemblGeneId]) {
      if (seen.has(key))
        throw new GenomeConfigError(
          `Registry lists ${key} twice (${seen.get(key)} and ${g.symbol}).`,
        );
      seen.set(key, g.symbol);
    }
  }
  return r;
}

export function parsePanel(raw: unknown, registry: Registry): Panel {
  const p = Panel.parse(raw);
  const known = new Set(registry.genes.map((g) => g.symbol));
  const missingGenes = p.members.filter((m) => !known.has(m));
  if (missingGenes.length)
    throw new GenomeConfigError(
      `Panel ${p.panelId} lists genes not in the registry: ${missingGenes.join(", ")}.`,
    );
  if (new Set(p.members).size !== p.members.length)
    throw new GenomeConfigError(`Panel ${p.panelId} lists a gene twice.`);
  if (p.reviewStatus === "approved" && p.decisionStatus !== "resolved")
    throw new GenomeConfigError(
      `Panel ${p.panelId} cannot be approved while decision ${p.decision} is unresolved.`,
    );
  return p;
}

export const parseLicences = (raw: unknown): Licences => Licences.parse(raw);

export const REGISTRY = parseRegistry(genesJson);
export const LICENCES = parseLicences(licencesJson);
export const PANELS: Panel[] = Object.values(
  import.meta.glob<unknown>("/config/genome/panels/*.json", { eager: true, import: "default" }),
).map((raw) => parsePanel(raw, REGISTRY));

/** A registered gene, or a clear error. Matching is exact: symbols are case-sensitive. */
export function getGene(symbol: string, registry: Registry = REGISTRY): GeneEntry {
  if (!SYMBOL_PATTERN.test(symbol))
    throw new GenomeConfigError(`"${symbol}" is not a valid HGNC gene symbol.`);
  const g = registry.genes.find((x) => x.symbol === symbol);
  if (!g)
    throw new GenomeConfigError(
      `${symbol} is not in the gene registry (config/genome/genes.json). Register it before use.`,
    );
  return g;
}

/** Whether a panel may be treated as the authoritative gene list. */
export const isAuthoritative = (p: Panel) =>
  p.reviewStatus === "approved" && p.decisionStatus === "resolved";

/** Where a gene's captured snapshot is served; one folder per gene. */
export const snapshotDir = (symbol: string) =>
  `/vision/snapshot/${getGene(symbol).symbol.toLowerCase()}/`;

export type UseMode = "research" | "commercial-pilot";

/**
 * Refuse a source, library or predictor in commercial-pilot mode unless the
 * licence inventory marks it approved. Unknown ids are refused in every mode.
 */
export function assertSourceAllowed(id: string, mode: UseMode, licences: Licences = LICENCES) {
  const item = licences.items.find((i) => i.id === id);
  if (!item) throw new GenomeConfigError(`${id} is not in the licence inventory.`);
  if (mode === "commercial-pilot" && item.commercialPilot !== "approved")
    throw new GenomeConfigError(
      `${item.name} is not approved for commercial-pilot use (review status: ${item.reviewStatus}).`,
    );
  return item;
}
