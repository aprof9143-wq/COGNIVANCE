/**
 * Per-source parser tests for Genome v1: Ensembl, UniProt, AlphaFold DB and
 * ClinVar. RPE65 uses the real captured snapshot (public/vision/snapshot/rpe65);
 * RHO uses synthetic fixtures (./fixtures/rho.ts). No network access.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { valueOf } from "@/lib/vision/evidence";
import { loadSnapshot, parseClinVar, parseManifest } from "@/lib/vision/snapshot";
import {
  fetchGene,
  fetchModel,
  fetchProtein,
  parseAlphaFold,
  parseEnsemblGene,
  parseUniProtSearch,
  type Fetcher,
} from "@/lib/vision/sources";
import { getGene } from "./config";
import { identifierChecks, mappingStatus } from "./identifiers";
import { rhoAlphaFold, rhoClinVarBatch, rhoEnsemblLookup, rhoUniProtSearch } from "./fixtures/rho";

const PUBLIC = join(__dirname, "../../../public");
const RPE65_DIR = join(PUBLIC, "vision/snapshot/rpe65");
const real = (name: string): unknown => {
  const buf = readFileSync(join(RPE65_DIR, name));
  return JSON.parse((name.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8"));
};

/** A fetcher answering from a table of URL fragments; anything else is a 404. */
const table =
  (rows: [string, number, unknown, Record<string, string>?][]): Fetcher =>
  async (url) => {
    const row = rows.find(([frag]) => url.includes(frag));
    if (!row) return new Response(null, { status: 404 });
    const [, status, body, headers] = row;
    if (body instanceof Error) throw body;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  };

const RELEASE: [string, number, unknown] = ["/info/data", 200, { releases: [116] }];

// ---------------------------------------------------------------- Ensembl

describe("Ensembl parser", () => {
  it("maps RPE65 (real) to its stable identifiers, with HGNC as Ensembl reports it", () => {
    const g = parseEnsemblGene(real("ensembl_lookup.json"));
    expect(g).toMatchObject({
      symbol: "RPE65",
      ensemblId: "ENSG00000116745",
      hgncId: "HGNC:10294",
      assembly: "GRCh38",
    });
    expect(g.canonical?.id).toBe("ENST00000262340");
  });

  it("maps RHO (synthetic) through the same parser", () => {
    const g = parseEnsemblGene(rhoEnsemblLookup);
    expect(g).toMatchObject({ symbol: "RHO", ensemblId: "ENSG00000163914", hgncId: "HGNC:10012" });
    expect(g.canonical?.exons).toHaveLength(2);
  });

  it("does not invent an HGNC ID the response does not state", () => {
    expect(
      parseEnsemblGene({ ...rhoEnsemblLookup, description: "rhodopsin" }).hgncId,
    ).toBeUndefined();
    expect(parseEnsemblGene({ ...rhoEnsemblLookup, description: null }).hgncId).toBeUndefined();
  });

  it("rejects responses missing required fields or with wrong types", () => {
    const { display_name: _, ...noSymbol } = rhoEnsemblLookup;
    expect(() => parseEnsemblGene(noSymbol)).toThrow(ZodError);
    expect(() => parseEnsemblGene({ ...rhoEnsemblLookup, start: "1000" })).toThrow(ZodError);
    expect(() => parseEnsemblGene("not json")).toThrow(ZodError);
  });

  it("turns a missing record, an HTTP error and a network failure into gaps", async () => {
    const notFound = table([
      ["/lookup/", 400, { error: "No valid lookup found for symbol NOPE" }],
      RELEASE,
    ]);
    expect(await fetchGene("NOPE", notFound)).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/HTTP 400/),
    });
    const down = table([["/lookup/", 503, {}], RELEASE]);
    expect(await fetchGene("RHO", down)).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/HTTP 503/),
    });
    const offline = table([["/lookup/", 0, new TypeError("Failed to fetch")], RELEASE]);
    expect(await fetchGene("RHO", offline)).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/Could not reach/),
    });
    const malformed = table([["/lookup/", 200, { id: 1 }], RELEASE]);
    expect(await fetchGene("RHO", malformed)).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/Response not understood.*Nothing was filled in/),
    });
  });

  it("records provenance, and says so when the release is not reported", async () => {
    const ok = await fetchGene("RHO", table([["/lookup/", 200, rhoEnsemblLookup], RELEASE]));
    expect(ok.state).toBe("value");
    if (ok.state !== "value") return;
    expect(ok.provenance).toMatchObject({
      source: "Ensembl REST",
      recordId: "ENSG00000163914.99",
      release: "Ensembl 116",
    });
    expect(ok.provenance.url).toContain("/lookup/symbol/homo_sapiens/RHO");
    expect(Date.parse(ok.provenance.retrievedAt)).not.toBeNaN();
    const partial = await fetchGene(
      "RHO",
      table([
        ["/lookup/", 200, rhoEnsemblLookup],
        ["/info/data", 500, {}],
      ]),
    );
    expect(partial.state).toBe("value");
    if (partial.state === "value") {
      expect(partial.provenance.release).toBeUndefined();
      expect(partial.provenance.note).toMatch(/Release not reported/);
    }
  });
});

// ---------------------------------------------------------------- UniProt

describe("UniProt parser", () => {
  it("maps RPE65 (real) to Q16518 with its own HGNC and Ensembl cross-references", () => {
    const [p] = parseUniProtSearch(real("uniprot_search.json"));
    expect(p).toMatchObject({
      accession: "Q16518",
      geneNames: ["RPE65"],
      taxonId: 9606,
      reviewed: true,
    });
    expect(p!.hgncIds).toEqual(["HGNC:10294"]);
    expect(p!.ensemblGeneIds).toContain("ENSG00000116745");
  });

  it("maps RHO (synthetic) through the same parser", () => {
    const [p] = parseUniProtSearch(rhoUniProtSearch);
    expect(p).toMatchObject({ accession: "P08100", geneNames: ["RHO"], hgncIds: ["HGNC:10012"] });
    expect(p!.ensemblGeneIds).toEqual(["ENSG00000163914"]);
  });

  it("rejects malformed entries", () => {
    expect(() => parseUniProtSearch({ results: [{ primaryAccession: "P08100" }] })).toThrow(
      ZodError,
    );
    expect(() => parseUniProtSearch({})).toThrow(ZodError);
  });

  it("keeps no match, several matches and errors distinct", async () => {
    const none = table([["/uniprotkb/search", 200, { results: [] }]]);
    expect(await fetchProtein("RHO", 9606, none)).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/no reviewed entry for gene RHO/),
    });
    const two = {
      results: [
        rhoUniProtSearch.results[0],
        { ...rhoUniProtSearch.results[0], primaryAccession: "P00001" },
      ],
    };
    expect(await fetchProtein("RHO", 9606, table([["/uniprotkb/search", 200, two]]))).toMatchObject(
      { state: "conflict" },
    );
    expect(await fetchProtein("RHO", 9606, table([["/uniprotkb/search", 500, {}]]))).toMatchObject({
      state: "missing",
    });
  });

  it("records the UniProt release from its response header", async () => {
    const r = await fetchProtein(
      "RHO",
      9606,
      table([["/uniprotkb/search", 200, rhoUniProtSearch, { "X-UniProt-Release": "2026_03" }]]),
    );
    expect(r.state).toBe("value");
    if (r.state === "value") {
      expect(r.provenance.release).toMatch(/^UniProt 2026_03 · entry v1/);
      expect(r.provenance.recordId).toBe("P08100 (sequence v1)");
    }
  });
});

// ---------------------------------------------------------------- AlphaFold DB

describe("AlphaFold DB parser", () => {
  it("maps RPE65 (real) to its model, version and confidence", () => {
    const m = parseAlphaFold(real("alphafold_prediction.json"), "Q16518");
    expect(m).toMatchObject({ entryId: "AF-Q16518-F1", accession: "Q16518", version: 6 });
    expect(m!.globalPlddt).toBeGreaterThan(90);
  });

  it("maps RHO (synthetic) and ignores entries for other accessions", () => {
    const m = parseAlphaFold(rhoAlphaFold, "P08100");
    expect(m).toMatchObject({ entryId: "AF-P08100-F1", version: 9, others: [] });
    expect(parseAlphaFold(rhoAlphaFold, "P99999")).toBeNull();
  });

  it("rejects malformed entries", () => {
    expect(() =>
      parseAlphaFold(
        [{ entryId: "AF-P08100-F1", uniprotAccession: "P08100", pdbUrl: "not a url" }],
        "P08100",
      ),
    ).toThrow(ZodError);
    expect(() => parseAlphaFold({ entryId: "x" }, "P08100")).toThrow(ZodError);
  });

  it("labels a model computed, with its version, and turns absence into a gap", async () => {
    const ok = await fetchModel("P08100", table([["/api/prediction/P08100", 200, rhoAlphaFold]]));
    expect(ok).toMatchObject({ state: "value", kind: "computed" });
    if (ok.state === "value") {
      expect(ok.provenance.recordId).toBe("AF-P08100-F1 v9");
      expect(ok.provenance.note).toMatch(/A model, not a measurement/);
    }
    expect(await fetchModel("P08100", table([["/api/prediction/", 200, []]]))).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/no model for P08100/),
    });
    expect(await fetchModel("P08100", table([]))).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/HTTP 404/),
    });
  });
});

// ---------------------------------------------------------------- ClinVar

describe("ClinVar parser", () => {
  it("keeps RPE65-only records from the real snapshot", () => {
    const batches = [0, 1, 2, 3, 4, 5, 6].map((i) => real(`clinvar_esummary_00${i}.json.gz`));
    const set = parseClinVar(batches, "RPE65");
    expect(set.total).toBe(set.variants.length + set.multiGene + set.unavailable);
    expect(set.variants.every((v) => v.accession.startsWith("VCV"))).toBe(true);
  });

  it("maps RHO (synthetic): single-gene kept, multi-gene counted, missing and error documents counted", () => {
    const set = parseClinVar([rhoClinVarBatch], "RHO");
    expect(set).toMatchObject({ total: 5, multiGene: 1, unavailable: 2 });
    expect(set.variants.map((v) => v.uid)).toEqual(["9001", "9002"]);
    // The records for RHO are not counted for another gene.
    expect(parseClinVar([rhoClinVarBatch], "RPE65").variants).toEqual([]);
  });

  it("keeps the GRCh38 location only and never converts a GRCh37 one", () => {
    const [p23h, g4s] = parseClinVar([rhoClinVarBatch], "RHO").variants;
    expect(p23h!.grch38).toEqual({ start: 1068, stop: 1068 });
    expect(g4s!.grch38).toBeUndefined();
  });

  it("separates what ClinVar states from what is derived here", () => {
    const [v] = parseClinVar([rhoClinVarBatch], "RHO").variants;
    // Stated by ClinVar:
    expect(v).toMatchObject({
      classification: "Pathogenic",
      cdna: "c.68C>A",
      reviewStatus: "criteria provided, single submitter",
    });
    // Derived here, from ClinVar's title and classification text:
    expect(v!.protein).toEqual({ ref: "P", pos: 23, change: "His", short: "P23H" });
    expect(v!.group).toBe("pathogenic");
  });

  it("rejects a malformed summary instead of patching it", () => {
    const bad = { result: { uids: ["1"], "1": { uid: "1", accession: 5 } } };
    expect(() => parseClinVar([bad], "RHO")).toThrow(ZodError);
    expect(() => parseClinVar([{}], "RHO")).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------- identifiers

describe("registry identifiers: reported versus inferred", () => {
  it("confirms RPE65's registry mapping from the real snapshot", () => {
    const entry = getGene("RPE65");
    const checks = identifierChecks(
      entry,
      parseEnsemblGene(real("ensembl_lookup.json")),
      parseUniProtSearch(real("uniprot_search.json"))[0],
      parseAlphaFold(real("alphafold_prediction.json"), "Q16518") ?? undefined,
    );
    expect(checks.filter((c) => c.result !== "agree")).toEqual([]);
    expect(mappingStatus(checks)).toBe("confirmed");
    expect(checks.filter((c) => c.basis === "inferred").map((c) => c.what)).toEqual([
      "Protein length (Ensembl canonical vs UniProt)",
      "Model built on the current UniProt sequence",
    ]);
  });

  it("confirms RHO's mapping from the synthetic fixtures", () => {
    const checks = identifierChecks(
      getGene("RHO"),
      parseEnsemblGene(rhoEnsemblLookup),
      parseUniProtSearch(rhoUniProtSearch)[0],
      parseAlphaFold(rhoAlphaFold, "P08100") ?? undefined,
    );
    expect(mappingStatus(checks)).toBe("confirmed");
  });

  it("reports a contradiction and does not resolve it", () => {
    const checks = identifierChecks(
      getGene("RHO"),
      parseEnsemblGene({ ...rhoEnsemblLookup, id: "ENSG00000000001" }),
    );
    const bad = checks.find((c) => c.what === "Ensembl gene ID")!;
    expect(bad).toMatchObject({
      result: "differ",
      expected: "ENSG00000163914",
      reported: "ENSG00000000001",
    });
    expect(mappingStatus(checks)).toBe("contradicted");
  });

  it("treats an unreported identifier as incomplete, not as agreement", () => {
    const checks = identifierChecks(
      getGene("RHO"),
      parseEnsemblGene({ ...rhoEnsemblLookup, description: "rhodopsin" }),
    );
    expect(checks.find((c) => c.what === "HGNC ID")!.result).toBe("not-reported");
    expect(mappingStatus(checks)).toBe("incomplete");
  });
});

// ---------------------------------------------------------------- snapshot loading

describe("per-gene snapshot loading and manifests", () => {
  const disk =
    (missingFile?: string): Fetcher =>
    async (url) => {
      if (missingFile && url.endsWith(missingFile)) return new Response(null, { status: 404 });
      try {
        return new Response(readFileSync(join(PUBLIC, url)));
      } catch {
        return new Response(null, { status: 404 });
      }
    };

  it("records a partial failure per source and keeps the rest", async () => {
    const snap = await loadSnapshot(disk("uniprot_search.json"));
    expect(snap.gene.state).toBe("value");
    expect(snap.protein).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/HTTP 404/),
    });
    expect(snap.model.state).toBe("missing");
    expect(valueOf(snap.sequences)?.cds.length).toBeGreaterThan(0);
  });

  it("refuses a snapshot whose manifest names another gene", async () => {
    const wrong: Fetcher = async (url) =>
      url.endsWith("manifest.json")
        ? new Response(JSON.stringify({ gene: "RHO", taxonId: 9606, capturedAt: "x", files: [] }))
        : new Response(null, { status: 404 });
    await expect(loadSnapshot(wrong)).rejects.toThrow(/is for RHO, not RPE65/);
  });

  it("refuses an unregistered gene", async () => {
    await expect(loadSnapshot(disk(), "NOTAGENE1")).rejects.toThrow(/not in the gene registry/);
  });

  it("reads version 2 manifests with per-source status", () => {
    const m = parseManifest({
      schemaVersion: 2,
      gene: "RHO",
      hgncId: "HGNC:10012",
      taxonId: 9606,
      assembly: "GRCh38",
      capturedAt: "2026-10-27T00:00:00+00:00",
      complete: false,
      sources: [
        {
          step: "clinvar",
          licenceId: "clinvar-eutils",
          status: "failed",
          reason: "HTTP 500",
          files: [],
        },
      ],
      files: [],
    });
    expect(m.sources?.[0]).toMatchObject({ status: "failed", reason: "HTTP 500" });
    expect(m.complete).toBe(false);
  });
});
