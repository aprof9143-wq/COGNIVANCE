/**
 * Does what the sources report match the gene registry? Each check says
 * whether its value was reported by a source ("source-reported") or derived
 * here by comparing sources ("inferred"), so neither is mistaken for the other.
 * A disagreement is shown, never resolved by picking a side.
 */

import type { GeneRecord, ModelRecord, ProteinRecord } from "@/lib/vision/sources";
import type { GeneEntry } from "./config";

export type IdBasis = "source-reported" | "inferred";
export type IdResult = "agree" | "differ" | "not-reported";

export type IdCheck = {
  what: string;
  source: string;
  basis: IdBasis;
  expected: string;
  reported: string | null;
  result: IdResult;
};

const check = (
  what: string,
  source: string,
  basis: IdBasis,
  expected: string,
  reported: string | null | undefined,
  agrees?: boolean,
): IdCheck => ({
  what,
  source,
  basis,
  expected,
  reported: reported ?? null,
  result:
    reported == null ? "not-reported" : (agrees ?? reported === expected) ? "agree" : "differ",
});

export function identifierChecks(
  entry: GeneEntry,
  gene?: GeneRecord,
  protein?: ProteinRecord,
  model?: ModelRecord,
): IdCheck[] {
  const out: IdCheck[] = [];
  if (gene) {
    out.push(check("Gene symbol", "Ensembl", "source-reported", entry.symbol, gene.symbol));
    out.push(
      check("Ensembl gene ID", "Ensembl", "source-reported", entry.ensemblGeneId, gene.ensemblId),
    );
    out.push(check("HGNC ID", "Ensembl", "source-reported", entry.hgncId, gene.hgncId));
    out.push(check("Assembly", "Ensembl", "source-reported", "GRCh38", gene.assembly));
  }
  if (protein) {
    out.push(
      check(
        "UniProt accession",
        "UniProt",
        "source-reported",
        entry.uniprotAccession,
        protein.accession,
      ),
    );
    out.push(
      check(
        "Gene symbol",
        "UniProt",
        "source-reported",
        entry.symbol,
        protein.geneNames.join(", ") || null,
        protein.geneNames.includes(entry.symbol),
      ),
    );
    out.push(
      check(
        "HGNC ID",
        "UniProt",
        "source-reported",
        entry.hgncId,
        protein.hgncIds.join(", ") || null,
        protein.hgncIds.includes(entry.hgncId),
      ),
    );
    out.push(
      check(
        "Ensembl gene ID",
        "UniProt",
        "source-reported",
        entry.ensemblGeneId,
        protein.ensemblGeneIds.join(", ") || null,
        protein.ensemblGeneIds.includes(entry.ensemblGeneId),
      ),
    );
  }
  if (model)
    out.push(
      check(
        "UniProt accession",
        "AlphaFold DB",
        "source-reported",
        entry.uniprotAccession,
        model.accession,
      ),
    );
  if (gene && protein) {
    const tl = gene.canonical?.translation;
    out.push(
      check(
        "Protein length (Ensembl canonical vs UniProt)",
        "Ensembl + UniProt",
        "inferred",
        String(protein.length),
        tl ? String(tl.length) : null,
      ),
    );
  }
  if (model?.sequence && protein)
    out.push(
      check(
        "Model built on the current UniProt sequence",
        "AlphaFold DB + UniProt",
        "inferred",
        "same sequence",
        model.sequence === protein.sequence ? "same sequence" : "different sequence",
      ),
    );
  return out;
}

/** The registry mapping holds when every reported check agrees; missing reports do not count as agreement. */
export function mappingStatus(checks: IdCheck[]): "confirmed" | "contradicted" | "incomplete" {
  if (checks.some((c) => c.result === "differ")) return "contradicted";
  const reported = checks.filter((c) => c.basis === "source-reported");
  return reported.length > 0 && reported.every((c) => c.result === "agree")
    ? "confirmed"
    : "incomplete";
}
