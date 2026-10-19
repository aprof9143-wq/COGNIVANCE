/**
 * The protein backbone from a PDB-format coordinate file: one point per
 * residue (its alpha carbon), split into continuous segments.
 *
 * Column positions follow the wwPDB format v3.3, ATOM record. In AlphaFold DB
 * model files the B-factor column holds pLDDT, the model's per-residue
 * confidence (0–100). In experimental files it is a crystallographic
 * temperature factor and means something else entirely, so callers say which
 * they are reading.
 */

export type Residue = {
  chain: string;
  seq: number;
  /** Insertion code, "" when absent. */
  icode: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** B-factor column: pLDDT for AlphaFold models. */
  b: number;
};

export type Backbone = {
  /** Residues per continuous segment, in file order. */
  segments: Residue[][];
  residues: Residue[];
  chains: string[];
};

/** A CA–CA distance above this (Å) is a chain break, not a bond. 3.8 Å is typical. */
export const BREAK_DISTANCE = 4.2;

export function parsePdbBackbone(text: string): Backbone {
  const residues: Residue[] = [];
  for (const line of text.split(/\r?\n/)) {
    // First model only: NMR ensembles repeat every atom per model.
    if (line.startsWith("ENDMDL")) break;
    if (!line.startsWith("ATOM  ")) continue;
    if (line.slice(12, 16).trim() !== "CA") continue;
    const alt = line[16] ?? " ";
    if (alt !== " " && alt !== "A") continue;
    const x = Number(line.slice(30, 38));
    const y = Number(line.slice(38, 46));
    const z = Number(line.slice(46, 54));
    const seq = Number(line.slice(22, 26));
    if (![x, y, z, seq].every(Number.isFinite)) continue;
    const b = Number(line.slice(60, 66));
    residues.push({
      chain: line[21]?.trim() || "_",
      seq,
      icode: (line[26] ?? " ").trim(),
      name: line.slice(17, 20).trim(),
      x,
      y,
      z,
      b: Number.isFinite(b) ? b : NaN,
    });
  }

  const segments: Residue[][] = [];
  let cur: Residue[] = [];
  for (const r of residues) {
    const prev = cur[cur.length - 1];
    if (prev && (prev.chain !== r.chain || dist(prev, r) > BREAK_DISTANCE)) {
      segments.push(cur);
      cur = [];
    }
    cur.push(r);
  }
  if (cur.length) segments.push(cur);

  return { segments, residues, chains: [...new Set(residues.map((r) => r.chain))] };
}

function dist(a: Residue, b: Residue) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export type PlddtBand = "very-high" | "confident" | "low" | "very-low";

/** AlphaFold DB's published bands and colours. Colour is never shown without the label. */
export const PLDDT_BANDS: { band: PlddtBand; label: string; range: string; colour: string }[] = [
  { band: "very-high", label: "Very high", range: "pLDDT > 90", colour: "#0053D6" },
  { band: "confident", label: "Confident", range: "90 ≥ pLDDT > 70", colour: "#65CBF3" },
  { band: "low", label: "Low", range: "70 ≥ pLDDT > 50", colour: "#FFDB13" },
  { band: "very-low", label: "Very low", range: "pLDDT ≤ 50", colour: "#FF7D45" },
];

export function plddtBand(p: number): PlddtBand {
  if (p > 90) return "very-high";
  if (p > 70) return "confident";
  if (p > 50) return "low";
  return "very-low";
}

/** Chain identity, in fixed order; always shown beside its chain label. */
export const CHAIN_COLOURS = ["#6a58e0", "#0f8f7e", "#d0507c", "#2f6fd6", "#b57d12", "#5f6b7a"];

export type PlddtSummary = {
  n: number;
  mean: number;
  /** Fraction of residues in each band, 0–1. */
  fractions: Record<PlddtBand, number>;
};

/** Null when no residue carries a usable value. */
export function summarisePlddt(residues: Residue[]): PlddtSummary | null {
  const vals = residues.map((r) => r.b).filter((b) => Number.isFinite(b) && b >= 0 && b <= 100);
  if (!vals.length) return null;
  const fractions: Record<PlddtBand, number> = {
    "very-high": 0,
    confident: 0,
    low: 0,
    "very-low": 0,
  };
  for (const v of vals) fractions[plddtBand(v)] += 1 / vals.length;
  return { n: vals.length, mean: vals.reduce((a, b) => a + b, 0) / vals.length, fractions };
}
