import { describe, expect, it } from "vitest";
import {
  GenomeConfigError,
  LICENCES,
  PANELS,
  REGISTRY,
  assertSourceAllowed,
  getGene,
  isAuthoritative,
  parsePanel,
  parseRegistry,
  snapshotDir,
} from "./config";

const gene = (symbol: string, n: number) => ({
  symbol,
  hgncId: `HGNC:${n}`,
  ensemblGeneId: `ENSG${String(n).padStart(11, "0")}`,
  uniprotAccession: "P00000",
  taxonId: 9606,
  role: "test-gene",
  idsVerified: null,
});

describe("gene registry", () => {
  it("loads, GRCh38 only, with RPE65 and a second gene", () => {
    expect(REGISTRY.assembly).toBe("GRCh38");
    expect(getGene("RPE65").hgncId).toBe("HGNC:10294");
    expect(getGene("RPE65").ensemblGeneId).toBe("ENSG00000116745");
    expect(getGene("RHO").symbol).toBe("RHO");
  });

  it("marks identifiers unverified until a capture has confirmed them", () => {
    expect(getGene("RPE65").idsVerified).not.toBeNull();
    expect(getGene("RHO").idsVerified).toBeNull();
  });

  it("fails clearly for invalid and unknown symbols", () => {
    expect(() => getGene("rpe 65")).toThrow(/not a valid HGNC gene symbol/);
    expect(() => getGene("")).toThrow(GenomeConfigError);
    expect(() => getGene("NOTAGENE1")).toThrow(/not in the gene registry/);
    expect(() => getGene("rpe65")).toThrow(GenomeConfigError);
  });

  it("refuses duplicates, including symbols that differ only in case", () => {
    const base = { schemaVersion: 1, registryVersion: "t", assembly: "GRCh38" };
    expect(() => parseRegistry({ ...base, genes: [gene("ABC1", 1), gene("ABC1", 2)] })).toThrow(
      /twice/,
    );
    expect(() => parseRegistry({ ...base, genes: [gene("C1orf1", 1), gene("C1ORF1", 2)] })).toThrow(
      /twice/,
    );
    expect(() => parseRegistry({ ...base, assembly: "GRCh37", genes: [] })).toThrow();
  });

  it("gives every gene its own snapshot folder", () => {
    const dirs = REGISTRY.genes.map((g) => snapshotDir(g.symbol));
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(snapshotDir("RPE65")).toBe("/vision/snapshot/rpe65/");
  });
});

describe("panels", () => {
  it("the first IRD panel is proposed, D5 unresolved, and not authoritative", () => {
    const ird = PANELS.find((p) => p.panelId === "ird-first-panel")!;
    expect(ird.reviewStatus).toBe("proposed");
    expect(ird.decision).toBe("D5");
    expect(ird.decisionStatus).toBe("unresolved");
    expect(isAuthoritative(ird)).toBe(false);
    expect(ird.members).toEqual(["RPE65"]);
  });

  it("no panel is authoritative yet", () => {
    expect(PANELS.length).toBeGreaterThan(0);
    expect(PANELS.some(isAuthoritative)).toBe(false);
  });

  const panel = {
    schemaVersion: 1,
    panelId: "t",
    panelVersion: "0.0.1",
    title: "t",
    assembly: "GRCh38",
    reviewStatus: "proposed",
    decision: "D5",
    decisionStatus: "unresolved",
    members: ["RPE65"],
    note: "",
  };

  it("rejects members that are not registered, and duplicates", () => {
    expect(() => parsePanel({ ...panel, members: ["RPE65", "XYZ9"] }, REGISTRY)).toThrow(
      /not in the registry: XYZ9/,
    );
    expect(() => parsePanel({ ...panel, members: ["RPE65", "RPE65"] }, REGISTRY)).toThrow(/twice/);
  });

  it("cannot be approved while its decision is unresolved", () => {
    expect(() => parsePanel({ ...panel, reviewStatus: "approved" }, REGISTRY)).toThrow(
      /unresolved/,
    );
  });
});

describe("licence inventory and the commercial-pilot safeguard", () => {
  it("covers the four Genome v1 sources and HGNC", () => {
    const ids = LICENCES.items.map((i) => i.id);
    for (const id of [
      "ensembl-rest",
      "uniprot-rest",
      "alphafold-db",
      "clinvar-eutils",
      "hgnc-rest",
    ])
      expect(ids).toContain(id);
  });

  it("approves nothing for commercial pilots until reviewed", () => {
    expect(LICENCES.items.filter((i) => i.commercialPilot === "approved")).toEqual([]);
    for (const i of LICENCES.items.filter((x) => x.commercialUse !== "permitted"))
      expect(i.commercialPilot).toBe("not-approved");
  });

  it("records no unused predictor as used", () => {
    for (const p of LICENCES.items.filter((i) => i.kind === "predictor"))
      expect(p.used).toBe(false);
  });

  it("allows research use and refuses commercial-pilot use of unapproved sources", () => {
    expect(assertSourceAllowed("clinvar-eutils", "research").id).toBe("clinvar-eutils");
    expect(() => assertSourceAllowed("clinvar-eutils", "commercial-pilot")).toThrow(
      /not approved for commercial-pilot use/,
    );
    expect(() => assertSourceAllowed("no-such-source", "research")).toThrow(/not in the licence/);
  });

  it("allows an approved item in commercial-pilot mode", () => {
    const approved = {
      ...LICENCES,
      items: [{ ...LICENCES.items[0]!, commercialPilot: "approved" as const }],
    };
    expect(assertSourceAllowed(LICENCES.items[0]!.id, "commercial-pilot", approved)).toBeTruthy();
  });
});

describe("licence inventory document", () => {
  it("lists exactly the items in licences.json, with the same commercial-pilot status", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const md = readFileSync(join(__dirname, "../../../docs/genome/LICENCES.md"), "utf8");
    const listed = [...md.matchAll(/^### .*\(`([^`]+)`\)$/gm)].map((m) => m[1]);
    expect(listed).toEqual(LICENCES.items.map((i) => i.id));
    for (const i of LICENCES.items) expect(md).toContain(`| ${i.name} (\`${i.id}\`) | ${i.kind} |`);
    expect(md).not.toMatch(/\*\*approved\*\*/);
  });
});
