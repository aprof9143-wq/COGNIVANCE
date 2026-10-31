/**
 * What the library pages compute from a library: search and filters, the
 * orthology matrix, a per-species comparison baseline, and the species tree.
 * Everything here is derived from the library's own records; nothing is added.
 */
import type { Curation, Library, LibraryGene, Orthologue, Species } from "./schema";

// ------------------------------------------------------------ classifications

/**
 * ClinGen's classification names, strongest evidence first, used only to sort
 * and group. The words themselves are always shown as the source states them;
 * a value not listed here is still shown, after these.
 */
export const CLASSIFICATION_ORDER = [
  "Definitive",
  "Strong",
  "Moderate",
  "Limited",
  "Disputed",
  "Refuted",
  "No Known Disease Relationship",
] as const;

/** How a classification is drawn: supportive, limited, contested, or none recorded. */
export type ClassificationTone = "supportive" | "limited" | "contested" | "none" | "other";

export function classificationTone(c: string): ClassificationTone {
  const k = c.trim().toLowerCase();
  if (["definitive", "strong", "moderate"].includes(k)) return "supportive";
  if (k === "limited") return "limited";
  if (["disputed", "refuted"].includes(k)) return "contested";
  if (k.startsWith("no known")) return "none";
  return "other";
}

export function classificationRank(c: string): number {
  const i = CLASSIFICATION_ORDER.findIndex((x) => x.toLowerCase() === c.trim().toLowerCase());
  return i === -1 ? CLASSIFICATION_ORDER.length : i;
}

/** The curations for one condition, strongest first; conflicting ones are kept, never merged. */
export function curationsFor(g: LibraryGene, condition?: string): Curation[] {
  return g.curations
    .filter((c) => !condition || c.condition === condition)
    .sort(
      (a, b) =>
        classificationRank(a.classification) - classificationRank(b.classification) ||
        (b.date ?? "").localeCompare(a.date ?? ""),
    );
}

/** Whether a gene's curations for a condition disagree in kind (e.g. Definitive and Disputed). */
export function hasConflict(g: LibraryGene, condition?: string): boolean {
  const tones = new Set(
    curationsFor(g, condition).map((c) => classificationTone(c.classification)),
  );
  return tones.has("contested") && (tones.has("supportive") || tones.has("limited"));
}

// ------------------------------------------------------------ search

export type GeneFilter = {
  q?: string;
  condition?: string;
  classification?: string;
  moi?: string;
  /** Ensembl species name: keep genes with a reported orthologue there. */
  orthologueIn?: string;
};

export function searchGenes(lib: Library, f: GeneFilter): LibraryGene[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return lib.genes.filter((g) => {
    const cs = curationsFor(g, f.condition);
    if (f.condition && cs.length === 0) return false;
    if (f.classification && !cs.some((c) => c.classification === f.classification)) return false;
    if (f.moi && !cs.some((c) => c.moi === f.moi)) return false;
    if (f.orthologueIn && !(g.orthologues ?? []).some((o) => o.species === f.orthologueIn))
      return false;
    if (!q) return true;
    const hay = [
      g.symbol,
      g.hgnc?.name,
      g.hgnc?.hgncId,
      g.hgnc?.ensemblGeneId,
      g.hgnc?.ncbiGeneId,
      ...g.curations.flatMap((c) => [c.diseaseLabel, c.mondoId]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Distinct values present in the library, for filter menus. */
export function facets(lib: Library) {
  const cs = lib.genes.flatMap((g) => g.curations);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    classifications: uniq(cs.map((c) => c.classification)).sort(
      (a, b) => classificationRank(a) - classificationRank(b) || a.localeCompare(b),
    ),
    mois: uniq(cs.map((c) => c.moi)).sort(),
  };
}

// ------------------------------------------------------------ orthology

export type Cell =
  | { kind: "not-retrieved" }
  | { kind: "none-reported" }
  | { kind: "orthologue"; best: Orthologue; all: Orthologue[] };

/**
 * One gene in one species. "not-retrieved" (the source was not read for this
 * gene) is different from "none-reported" (it was read and reported none):
 * neither is evidence that the gene is absent from that species' genome.
 */
export function cell(g: LibraryGene, species: string): Cell {
  if (g.orthologues === null) return { kind: "not-retrieved" };
  const all = g.orthologues.filter((o) => o.species === species);
  if (all.length === 0) return { kind: "none-reported" };
  const best = [...all].sort((a, b) => (b.percId ?? -1) - (a.percId ?? -1))[0]!;
  return { kind: "orthologue", best, all };
}

/** Plain words for Ensembl's orthology types. */
export function orthologyWords(type: string): string {
  const m: Record<string, string> = {
    ortholog_one2one: "one-to-one",
    ortholog_one2many: "one-to-many",
    ortholog_many2many: "many-to-many",
  };
  return m[type] ?? type.replace(/_/g, " ");
}

// ------------------------------------------------------------ baseline

export type Baseline = {
  species: string;
  /** Number of library genes with a one-to-one orthologue and a reported identity. */
  n: number;
  median: number;
  q1: number;
  q3: number;
  /** Tukey fences: q1 - 1.5 IQR and q3 + 1.5 IQR. */
  low: number;
  high: number;
};

/** Fewer genes than this and no baseline is drawn: the spread would mean little. */
export const MIN_BASELINE_N = 8;

function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/**
 * The comparison baseline for a species: the distribution of percent identity
 * of one-to-one orthologues across all genes in this library. It is a
 * baseline for this gene set only, not for the genome.
 */
export function baseline(lib: Library, species: string): Baseline | null {
  const xs = lib.genes
    .flatMap((g) => (g.orthologues ?? []).filter((o) => o.species === species))
    .filter((o) => o.type === "ortholog_one2one" && o.percId !== null)
    .map((o) => o.percId!)
    .sort((a, b) => a - b);
  if (xs.length < MIN_BASELINE_N) return null;
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  const iqr = q3 - q1;
  return {
    species,
    n: xs.length,
    median: quantile(xs, 0.5),
    q1,
    q3,
    low: q1 - 1.5 * iqr,
    high: q3 + 1.5 * iqr,
  };
}

export type Deviation =
  | { kind: "no-baseline"; reason: string }
  | { kind: "not-comparable"; reason: string }
  | { kind: "within" | "below" | "above"; value: number; baseline: Baseline };

/**
 * Where one gene's orthologue sits against the species baseline. Only
 * one-to-one orthologues are compared. "below" or "above" means outside the
 * Tukey fences of this gene set: a measurable deviation, not a finding about
 * biology or disease.
 */
export function deviation(lib: Library, g: LibraryGene, species: string): Deviation {
  const b = baseline(lib, species);
  if (!b)
    return {
      kind: "no-baseline",
      reason: `Fewer than ${MIN_BASELINE_N} one-to-one orthologues with a reported identity in this species.`,
    };
  const c = cell(g, species);
  if (c.kind !== "orthologue" || c.best.type !== "ortholog_one2one" || c.best.percId === null)
    return {
      kind: "not-comparable",
      reason:
        "Only a one-to-one orthologue with a reported identity is compared with the baseline.",
    };
  const v = c.best.percId;
  return { kind: v < b.low ? "below" : v > b.high ? "above" : "within", value: v, baseline: b };
}

// ------------------------------------------------------------ species tree

export type TreeNode = {
  /** Species (Ensembl names) under this node, sorted. */
  species: string[];
  /** Taxa Ensembl reports as shared by exactly these species; empty for leaves. */
  sharedTaxa: string[];
  children: TreeNode[];
};

/**
 * A cladogram from the ancestors each species shares, as Ensembl reports them.
 * Each internal node is a set of species that share an ancestor no species
 * outside the set has; nesting follows from set inclusion, so the order in
 * which a source lists ancestors does not matter. Branch lengths are not drawn:
 * this shows grouping, not time or distance. Returns null if any species has
 * no ancestors on record.
 */
export function speciesTree(species: Species[]): TreeNode | null {
  if (species.length === 0 || species.some((s) => !s.ancestors)) return null;
  const all = species.map((s) => s.ensembl).sort();
  const byTaxon = new Map<string, { name: string; members: Set<string> }>();
  for (const s of species)
    for (const a of s.ancestors!) {
      const e = byTaxon.get(a.id) ?? { name: a.name, members: new Set<string>() };
      e.members.add(s.ensembl);
      byTaxon.set(a.id, e);
    }
  // Group taxa by the exact species set they cover.
  const groups = new Map<string, { species: string[]; names: string[] }>();
  for (const { name, members } of byTaxon.values()) {
    const key = [...members].sort().join(",");
    const g = groups.get(key) ?? { species: [...members].sort(), names: [] };
    g.names.push(name);
    groups.set(key, g);
  }
  const clades = [...groups.values()]
    .filter((g) => g.species.length > 1 && g.species.length < all.length)
    .sort((a, b) => b.species.length - a.species.length);
  const shared = [...groups.values()].find((g) => g.species.length === all.length);
  const root: TreeNode = { species: all, sharedTaxa: shared?.names.sort() ?? [], children: [] };
  const place = (parent: TreeNode, node: TreeNode) => {
    const inside = parent.children.find((c) => node.species.every((s) => c.species.includes(s)));
    if (inside) place(inside, node);
    else parent.children.push(node);
  };
  for (const c of clades)
    place(root, { species: c.species, sharedTaxa: c.names.sort(), children: [] });
  const addLeaves = (n: TreeNode) => {
    n.children.forEach(addLeaves);
    const covered = new Set(n.children.flatMap((c) => c.species));
    for (const s of n.species)
      if (!covered.has(s)) n.children.push({ species: [s], sharedTaxa: [], children: [] });
    n.children.sort(
      (a, b) => b.species.length - a.species.length || a.species[0]!.localeCompare(b.species[0]!),
    );
  };
  addLeaves(root);
  return root;
}

/** Leaves of a tree in drawing order. */
export function leafOrder(n: TreeNode): string[] {
  return n.children.length === 0 ? n.species : n.children.flatMap(leafOrder);
}

// ------------------------------------------------------------ freshness

/** A snapshot older than this is shown as out of date. A product choice, recorded in docs/genome/LIBRARY.md. */
export const STALE_AFTER_DAYS = 90;

export function ageDays(iso: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

export function isStale(lib: Library, now: Date = new Date()): boolean {
  return lib.mode === "snapshot" && ageDays(lib.capturedAt, now) > STALE_AFTER_DAYS;
}
