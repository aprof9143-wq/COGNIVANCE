/**
 * The snapshot loader and parsers, run against the served display copy of the
 * real captured responses (public/vision/display/rpe65, built from
 * data/genome/snapshot/rpe65; see their manifests for sources and times).
 * ClinVar is withheld by the source policy, so no ClinVar record is loaded.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { valueOf } from "./evidence";
import {
  groupOf,
  loadSnapshot,
  parseProteinChange,
  translate,
  type SnapshotRecord,
} from "./snapshot";
import { crossCheck } from "./sources";

const DIR = join(__dirname, "../../../public");
const diskFetch = async (url: string) => {
  try {
    return new Response(readFileSync(join(DIR, url)));
  } catch {
    return new Response(null, { status: 404 });
  }
};

let snap: SnapshotRecord;
beforeAll(async () => {
  snap = await loadSnapshot(diskFetch);
});

describe("snapshot manifest", () => {
  it("records every file with its request, status, time and checksum", () => {
    expect(snap.manifest.gene).toBe("RPE65");
    for (const f of snap.manifest.files) {
      expect(f.status).toBe(200);
      expect(f.url).toMatch(/^https:\/\//);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Date.parse(f.retrievedAt)).not.toBeNaN();
    }
  });
});

describe("real Ensembl, UniProt and AlphaFold records", () => {
  it("parses the gene, its canonical transcript and exons", () => {
    const g = valueOf(snap.gene)!;
    expect(g).toMatchObject({
      ensemblId: "ENSG00000116745",
      symbol: "RPE65",
      assembly: "GRCh38",
      chromosome: "1",
      strand: -1,
    });
    expect(g.canonical!.exons).toHaveLength(g.canonical!.exonCount);
    for (const e of g.canonical!.exons) {
      expect(e.start).toBeGreaterThanOrEqual(g.start);
      expect(e.end).toBeLessThanOrEqual(g.end);
    }
  });

  it("parses the protein, where it is made, and the reaction it runs", () => {
    const p = valueOf(snap.protein)!;
    expect(p).toMatchObject({ accession: "Q16518", length: 533, reviewed: true });
    expect(p.tissue).toMatch(/retinal pigment epithelium/i);
    expect(p.reactions.some((r) => r.ec === "3.1.1.64")).toBe(true);
    expect(p.pathways.map((x) => x.id)).toContain("R-HSA-2453902");
    expect(p.pdb).toEqual([]);
  });

  it("parses the AlphaFold model and its coordinates", async () => {
    const m = valueOf(snap.model)!;
    expect(m.entryId).toBe("AF-Q16518-F1");
    const pdb = await snap.structure();
    expect(
      pdb.split("\n").filter((l) => l.startsWith("ATOM") && l.slice(12, 16).trim() === "CA"),
    ).toHaveLength(533);
  });

  it("agrees across sources on every cross-check", () => {
    const checks = crossCheck(
      "RPE65",
      9606,
      valueOf(snap.gene),
      valueOf(snap.protein),
      valueOf(snap.model),
    );
    expect(checks.map((c) => c.status)).toEqual(Array(6).fill("agree"));
  });

  it("translates Ensembl's coding sequence into exactly UniProt's protein", () => {
    const s = valueOf(snap.sequences)!;
    const p = valueOf(snap.protein)!;
    expect(s.cds.length).toBe(p.length * 3 + 3);
    expect(translate(s.cds)).toBe(p.sequence);
    const g = valueOf(snap.gene)!;
    expect(s.gene.length).toBe(g.end - g.start + 1);
  });
});

describe("ClinVar", () => {
  it("is withheld by the source policy: no record is loaded", () => {
    expect(snap.variants.state).toBe("withheld");
    expect(valueOf(snap.variants)).toBeUndefined();
  });
});

describe("parsing helpers", () => {
  it("reads protein changes", () => {
    expect(parseProteinChange("NM_000329.3(RPE65):c.271C>T (p.Arg91Trp)")).toEqual({
      ref: "R",
      pos: 91,
      change: "Trp",
      short: "R91W",
    });
    expect(parseProteinChange("x (p.Tyr368Ter)")!.short).toBe("Y368*");
    expect(parseProteinChange("x (p.Arg44fs)")!.short).toBe("R44fs");
    expect(parseProteinChange("NM_000329.3(RPE65):c.-5A>G")).toBeUndefined();
  });

  it("groups classifications", () => {
    expect(groupOf("Pathogenic/Likely pathogenic")).toBe("pathogenic");
    expect(groupOf("Conflicting classifications of pathogenicity")).toBe("conflicting");
    expect(groupOf("Uncertain significance")).toBe("uncertain");
    expect(groupOf("Likely benign")).toBe("benign");
    expect(groupOf("not provided")).toBe("other");
  });

  it("uses the standard genetic code", () => {
    expect(translate("ATGTGGTAA")).toBe("MW");
  });
});

describe("placing coding substitutions on Ensembl's coding sequence (real Ensembl data)", async () => {
  const { parseCodingSnv, placeOnCds } = await import("./genome");

  // The substitution is a hand-written test input, not a record loaded from any source.
  it("places c.271C>T: codon 91 CGG becomes TGG, Arg becomes Trp", () => {
    const cds = valueOf(snap.sequences)!.cds;
    const p = placeOnCds(cds, parseCodingSnv("c.271C>T")!)!;
    expect(p).toMatchObject({
      codonIndex: 91,
      codon: "CGG",
      mutantCodon: "TGG",
      aaBefore: "R",
      aaAfter: "W",
      refAgrees: true,
    });
    expect(p.context[p.at]).toBe("C");
  });

  it("rejects what it cannot place", () => {
    expect(parseCodingSnv("c.127_128delinsTT")).toBeNull();
    expect(parseCodingSnv(undefined)).toBeNull();
    expect(placeOnCds("ATG", { pos: 10, ref: "A", alt: "G" })).toBeNull();
  });
});
