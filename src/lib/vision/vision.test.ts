/**
 * Every input in this file is synthetic and labelled as such: coordinate lines
 * built to the wwPDB column layout, and minimal records with obviously fake
 * identifiers (TEST…). None of it is, or stands in for, a captured response
 * from Ensembl, UniProt or AlphaFold DB.
 */
import { describe, expect, it } from "vitest";
import { mapSourced, missing, sourced, valueOf, type Provenance } from "./evidence";
import { parsePdbBackbone, plddtBand, summarisePlddt } from "./pdb";
import {
  crossCheck,
  fetchGene,
  fetchModel,
  fetchProtein,
  unversioned,
  type Fetcher,
  type GeneRecord,
  type ModelRecord,
  type ProteinRecord,
} from "./sources";
import { DECISIONS, PIPELINE, TARGETS, targetByKey } from "./targets";

const prov: Provenance = {
  source: "test",
  url: "https://example.test",
  retrievedAt: "2026-10-19T00:00:00Z",
};

describe("evidence", () => {
  it("refuses to label anything clinically validated without a validation record", () => {
    expect(() => sourced(1, "validated", prov)).toThrow(/validation record/);
  });

  it("keeps gaps as gaps", () => {
    const m = missing<number>("not reported");
    expect(valueOf(m)).toBeUndefined();
    expect(mapSourced(m, (x) => x * 2)).toEqual(m);
    expect(valueOf(mapSourced(sourced(2, "reference", prov), (x) => x * 2))).toBe(4);
  });
});

describe("targets and decisions", () => {
  it("records VIN loss as vision loss, an outcome, not a gene target", () => {
    expect(targetByKey("vin")).toBeUndefined();
    expect(DECISIONS.find((d) => d.n === 11)!.answer).toMatch(/^Vision loss/);
  });

  it("records all fourteen benchmark questions, with answers only where decided", () => {
    expect(DECISIONS.map((d) => d.n)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    for (const d of DECISIONS) {
      if (d.status === "open") expect(d.answer).toBeUndefined();
      else expect(d.answer && d.decidedOn).toBeTruthy();
    }
    expect(DECISIONS.find((d) => d.n === 11)!.status).toBe("decided");
  });

  it("names RPE65 in human as the first ready target", () => {
    const ready = TARGETS.filter((t) => t.status === "ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ geneSymbol: "RPE65", taxonId: 9606 });
  });

  it("runs every pipeline stage, and labels the modelled one hypothetical", () => {
    expect(PIPELINE.every((s) => s.status === "live")).toBe(true);
    expect(PIPELINE.find((s) => s.key === "hypothesis")!.kind).toBe("hypothetical");
  });
});

/** One ATOM record laid out to the wwPDB v3.3 columns. */
function atom(o: {
  serial: number;
  name: string;
  res: string;
  chain: string;
  seq: number;
  x: number;
  y: number;
  z: number;
  b: number;
  alt?: string;
  record?: string;
}) {
  const f = (n: number, w: number, d: number) => n.toFixed(d).padStart(w);
  return (
    (o.record ?? "ATOM").padEnd(6) +
    String(o.serial).padStart(5) +
    " " +
    (" " + o.name).padEnd(4) +
    (o.alt ?? " ") +
    o.res.padStart(3) +
    " " +
    o.chain +
    String(o.seq).padStart(4) +
    " " +
    "   " +
    f(o.x, 8, 3) +
    f(o.y, 8, 3) +
    f(o.z, 8, 3) +
    f(1, 6, 2) +
    f(o.b, 6, 2) +
    "          " +
    " C".padStart(2)
  );
}

describe("PDB backbone parser (synthetic, format-conformant lines)", () => {
  const ca = (seq: number, x: number, b: number, chain = "A", extra = {}) =>
    atom({ serial: seq, name: "CA", res: "ALA", chain, seq, x, y: 0, z: 0, b, ...extra });

  it("reads alpha carbons at the specified columns", () => {
    const bb = parsePdbBackbone(
      [
        atom({ serial: 1, name: "N", res: "MET", chain: "A", seq: 1, x: 0, y: 0, z: 0, b: 95 }),
        ca(1, 1.5, 95.5),
        ca(2, 5.3, 72.25),
      ].join("\n"),
    );
    expect(bb.residues).toHaveLength(2);
    expect(bb.residues[1]).toMatchObject({ chain: "A", seq: 2, name: "ALA", x: 5.3, b: 72.25 });
  });

  it("splits segments at chain changes and at gaps longer than a bond", () => {
    const bb = parsePdbBackbone(
      [ca(1, 0, 90), ca(2, 3.8, 90), ca(3, 20, 90), ca(4, 23.8, 90), ca(1, 0, 90, "B")].join("\n"),
    );
    expect(bb.segments.map((s) => s.length)).toEqual([2, 2, 1]);
    expect(bb.chains).toEqual(["A", "B"]);
  });

  it("ignores HETATM, alternate locations other than A, and every model after the first", () => {
    const bb = parsePdbBackbone(
      [
        ca(1, 0, 90),
        ca(1, 0.1, 90, "A", { alt: "B" }),
        ca(2, 3.8, 90, "A", { record: "HETATM" }),
        "ENDMDL",
        ca(3, 7.6, 90),
      ].join("\n"),
    );
    expect(bb.residues.map((r) => r.seq)).toEqual([1]);
  });
});

describe("pLDDT", () => {
  it("uses AlphaFold DB's band edges", () => {
    expect([90.01, 90, 70.01, 70, 50.01, 50, 0].map(plddtBand)).toEqual([
      "very-high",
      "confident",
      "confident",
      "low",
      "low",
      "very-low",
      "very-low",
    ]);
  });

  it("summarises only values in range, and reports nothing rather than zero", () => {
    const r = (b: number) => ({ chain: "A", seq: 1, icode: "", name: "ALA", x: 0, y: 0, z: 0, b });
    const s = summarisePlddt([r(95), r(60), r(NaN), r(-1)])!;
    expect(s.n).toBe(2);
    expect(s.mean).toBe(77.5);
    expect(s.fractions["very-high"]).toBeCloseTo(0.5);
    expect(summarisePlddt([r(NaN)])).toBeNull();
  });
});

const gene = (o: Partial<GeneRecord> = {}): GeneRecord => ({
  ensemblId: "ENSGTEST1",
  symbol: "TEST1",
  assembly: "TEST",
  chromosome: "1",
  start: 1,
  end: 100,
  strand: 1,
  transcriptCount: 1,
  canonical: {
    id: "ENSTTEST1",
    exonCount: 2,
    exons: [],
    translation: { id: "ENSPTEST1", length: 4 },
  },
  ...o,
});
const protein = (o: Partial<ProteinRecord> = {}): ProteinRecord => ({
  accession: "TEST1",
  reviewed: true,
  geneNames: ["TEST1"],
  taxonId: 9606,
  length: 4,
  sequence: "MAAA",
  reactions: [],
  pathways: [],
  locations: [],
  diseases: [],
  hgncIds: [],
  ensemblGeneIds: ["ENSGTEST1"],
  ensemblProteinIds: ["ENSPTEST1"],
  pdb: [],
  ...o,
});
const model = (o: Partial<ModelRecord> = {}): ModelRecord => ({
  entryId: "AF-TEST1-F1",
  accession: "TEST1",
  sequence: "MAAA",
  pdbUrl: "https://example.test/m.pdb",
  others: [],
  ...o,
});

describe("cross-checks", () => {
  const status = (cs: ReturnType<typeof crossCheck>) =>
    Object.fromEntries(cs.map((c) => [c.key, c.status]));

  it("agrees when the sources agree", () => {
    const s = status(crossCheck("TEST1", 9606, gene(), protein(), model()));
    expect(Object.values(s).every((v) => v === "agree")).toBe(true);
    expect(Object.keys(s)).toHaveLength(6);
  });

  it("shows disagreements instead of resolving them", () => {
    const s = status(
      crossCheck(
        "TEST1",
        9606,
        gene({ ensemblId: "ENSGTEST2" }),
        protein({ length: 5, taxonId: 10090, ensemblProteinIds: ["ENSPTEST9"] }),
        model({ sequence: "MAAAA" }),
      ),
    );
    expect(s).toMatchObject({
      "gene-id": "differ",
      translation: "differ",
      length: "differ",
      species: "differ",
      "model-sequence": "differ",
    });
  });

  it("marks checks unavailable when a source is missing, never as passed", () => {
    const s = status(crossCheck("TEST1", 9606, undefined, protein(), undefined));
    expect(s["symbol"]).toBe("unavailable");
    expect(s["length"]).toBe("unavailable");
    expect(s["model-sequence"]).toBe("unavailable");
    expect(s["species"]).toBe("agree");
  });

  it("compares Ensembl ids without their version suffix", () => {
    expect(unversioned("ENSPTEST1.4")).toBe("ENSPTEST1");
    const s = status(
      crossCheck(
        "TEST1",
        9606,
        gene({
          canonical: {
            id: "T",
            exonCount: 1,
            exons: [],
            translation: { id: "ENSPTEST1.4", length: 4 },
          },
        }),
        protein(),
        model(),
      ),
    );
    expect(s["translation"]).toBe("agree");
  });
});

describe("source failures become visible gaps", () => {
  const respond =
    (body: unknown, status = 200): Fetcher =>
    async () =>
      new Response(JSON.stringify(body), { status });

  it("network failure", async () => {
    const r = await fetchGene("TEST1", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(r).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/Could not reach rest\.ensembl\.org/),
    });
  });

  it("HTTP error", async () => {
    const r = await fetchModel("TEST1", respond({}, 503));
    expect(r).toMatchObject({ state: "missing", reason: expect.stringMatching(/HTTP 503/) });
  });

  it("an unexpected shape is reported, not patched", async () => {
    const r = await fetchGene("TEST1", respond({ unexpected: true }));
    expect(r).toMatchObject({ state: "missing", reason: expect.stringMatching(/not understood/) });
  });

  it("no match and several matches are distinct outcomes", async () => {
    expect((await fetchProtein("TEST1", 9606, respond({ results: [] }))).state).toBe("missing");
    const entry = (acc: string) => ({
      primaryAccession: acc,
      organism: { taxonId: 9606 },
      sequence: { value: "MAAA", length: 4 },
    });
    const r = await fetchProtein(
      "TEST1",
      9606,
      respond({ results: [entry("TEST1"), entry("TEST2")] }),
    );
    expect(r.state).toBe("conflict");
  });

  it("a predicted model is labelled computed, never measured", async () => {
    const r = await fetchModel(
      "TEST1",
      respond([
        { entryId: "AF-TEST1-F1", uniprotAccession: "TEST1", pdbUrl: "https://example.test/m.pdb" },
      ]),
    );
    expect(r).toMatchObject({ state: "value", kind: "computed" });
  });
});
