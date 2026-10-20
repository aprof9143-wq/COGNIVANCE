/**
 * Placing a ClinVar coding substitution on Ensembl's coding sequence, and
 * checking the two sources agree: the reference base ClinVar names must be
 * the base at that position, and the codon change must give the amino-acid
 * change ClinVar reports. Computed here; a mismatch is shown, not hidden.
 */

import { translate } from "./snapshot";

export type CodingSnv = { pos: number; ref: string; alt: string };

/** c.271C>T → { pos: 271, ref: "C", alt: "T" }; anything else → null. */
export function parseCodingSnv(cdna: string | undefined): CodingSnv | null {
  const m = /^c\.(\d+)([ACGT])>([ACGT])$/.exec(cdna ?? "");
  return m ? { pos: Number(m[1]), ref: m[2]!, alt: m[3]! } : null;
}

export type SnvOnCds = {
  snv: CodingSnv;
  /** The base Ensembl has at that position. */
  cdsBase: string;
  refAgrees: boolean;
  codonIndex: number;
  codon: string;
  mutantCodon: string;
  aaBefore: string;
  aaAfter: string;
  /** Up to `flank` bases each side, uppercase, with the variant base at `at`. */
  context: string;
  at: number;
};

export function placeOnCds(cds: string, snv: CodingSnv, flank = 15): SnvOnCds | null {
  const i = snv.pos - 1;
  if (i < 0 || i >= cds.length) return null;
  const c = Math.floor(i / 3);
  const codon = cds.slice(c * 3, c * 3 + 3).toUpperCase();
  const k = i - c * 3;
  const mutantCodon = codon.slice(0, k) + snv.alt + codon.slice(k + 1);
  const from = Math.max(0, i - flank);
  return {
    snv,
    cdsBase: cds[i]!.toUpperCase(),
    refAgrees: cds[i]!.toUpperCase() === snv.ref,
    codonIndex: c + 1,
    codon,
    mutantCodon,
    aaBefore: translate(codon) || "*",
    aaAfter: translate(mutantCodon) || "*",
    context: cds.slice(from, i + flank + 1).toUpperCase(),
    at: i - from,
  };
}
