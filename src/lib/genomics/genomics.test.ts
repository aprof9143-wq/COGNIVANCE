/**
 * The research gene library's data layer: the sample is synthetic and says
 * so, the loader never mixes sample and captured data, search and the
 * comparison maths, and the live check's handling of failures and the source
 * policy. Fixtures are synthetic; no network access.
 */
import { describe, expect, it } from "vitest";
import { LICENCES } from "@/lib/genome/config";
import {
  baseline,
  cell,
  classificationTone,
  curationsFor,
  deviation,
  facets,
  hasConflict,
  isStale,
  leafOrder,
  MIN_BASELINE_N,
  searchGenes,
  speciesTree,
} from "./library";
import { liveCheck, orthologuesFromResponse } from "./live";
import { loadLibrary } from "./load";
import { SAMPLE_LIBRARY } from "./sample";
import { parseLibrary, type Library, type Species } from "./schema";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SNAPSHOT: Library = {
  ...structuredClone(SAMPLE_LIBRARY),
  mode: "snapshot",
  sampleNote: undefined,
};
delete (SNAPSHOT as Partial<Library>).sampleNote;

describe("sample data", () => {
  it("is synthetic, labelled, valid and has no made-up taxonomy", () => {
    const lib = parseLibrary(SAMPLE_LIBRARY);
    expect(lib.mode).toBe("sample");
    expect(lib.sampleNote).toMatch(/synthetic/);
    for (const g of lib.genes) {
      expect(g.symbol).toMatch(/^SAMPLE-/);
      expect(g.hgnc?.hgncId).toMatch(/^SAMPLE:/);
      for (const c of g.curations) {
        expect(c.mondoId).toMatch(/^SAMPLE:/);
        expect(c.reportUrl).toBeNull();
      }
      for (const o of g.orthologues ?? []) expect(o.geneId).toMatch(/^SAMPLE:/);
    }
    expect(lib.species.every((s) => s.ancestors === null)).toBe(true);
    expect(lib.sources).toEqual([]);
  });
});

describe("loading the library", () => {
  it("shows the sample, saying why, when nothing has been captured", async () => {
    const r = await loadLibrary(async () => new Response("", { status: 404 }));
    expect(r.kind).toBe("sample");
    if (r.kind === "sample") {
      expect(r.lib.mode).toBe("sample");
      expect(r.reason).toMatch(/No library has been captured/);
    }
  });

  it("shows a captured snapshot as it is, with no sample genes mixed in", async () => {
    const r = await loadLibrary(async () => json(SNAPSHOT));
    expect(r.kind).toBe("snapshot");
    if (r.kind === "snapshot") expect(r.lib).toEqual(parseLibrary(SNAPSHOT));
  });

  it("reports a broken, unreachable or mislabelled file as an error, not as sample data", async () => {
    expect((await loadLibrary(async () => json({ nope: 1 }))).kind).toBe("error");
    expect((await loadLibrary(async () => new Response("", { status: 503 }))).kind).toBe("error");
    expect((await loadLibrary(async () => Promise.reject(new Error("offline")))).kind).toBe(
      "error",
    );
    const mislabelled = await loadLibrary(async () => json(SAMPLE_LIBRARY));
    expect(mislabelled).toMatchObject({ kind: "error" });
  });
});

describe("search, filters and classifications", () => {
  it("finds genes by symbol, name, identifier and disease label", () => {
    expect(searchGenes(SAMPLE_LIBRARY, { q: "sample-c" }).map((g) => g.symbol)).toEqual([
      "SAMPLE-C",
    ]);
    expect(searchGenes(SAMPLE_LIBRARY, { q: "SAMPLE:MONDO-0050" }).map((g) => g.symbol)).toEqual([
      "SAMPLE-E",
    ]);
    expect(searchGenes(SAMPLE_LIBRARY, { q: "zzz" })).toEqual([]);
  });

  it("filters by condition, classification, inheritance and species", () => {
    const alz = searchGenes(SAMPLE_LIBRARY, { condition: "alzheimer" }).map((g) => g.symbol);
    expect(alz).toEqual(["SAMPLE-E", "SAMPLE-F", "SAMPLE-G", "SAMPLE-H"]);
    expect(
      searchGenes(SAMPLE_LIBRARY, { condition: "autism", classification: "Limited" }).map(
        (g) => g.symbol,
      ),
    ).toEqual(["SAMPLE-D", "SAMPLE-G"]);
    expect(searchGenes(SAMPLE_LIBRARY, { moi: "XL" }).map((g) => g.symbol)).toEqual(["SAMPLE-D"]);
    const fish = searchGenes(SAMPLE_LIBRARY, { orthologueIn: "danio_rerio" }).map((g) => g.symbol);
    expect(fish).not.toContain("SAMPLE-G");
  });

  it("keeps conflicting curations apart and flags the conflict", () => {
    const c = SAMPLE_LIBRARY.genes.find((g) => g.symbol === "SAMPLE-C")!;
    expect(curationsFor(c, "autism").map((x) => x.classification)).toEqual([
      "Definitive",
      "Disputed",
    ]);
    expect(hasConflict(c, "autism")).toBe(true);
    expect(hasConflict(SAMPLE_LIBRARY.genes[0]!)).toBe(false);
    expect(classificationTone("Refuted")).toBe("contested");
    expect(classificationTone("Something new")).toBe("other");
    expect(facets(SAMPLE_LIBRARY).classifications[0]).toBe("Definitive");
  });
});

describe("orthology and the comparison baseline", () => {
  it("tells 'not retrieved' from 'none reported'", () => {
    const g = structuredClone(SAMPLE_LIBRARY.genes.find((x) => x.symbol === "SAMPLE-D")!);
    expect(cell(g, "danio_rerio").kind).toBe("none-reported");
    expect(cell(g, "mus_musculus")).toMatchObject({ kind: "orthologue", best: { percId: 71.3 } });
    g.orthologues = null;
    expect(cell(g, "mus_musculus").kind).toBe("not-retrieved");
  });

  it("computes the baseline from one-to-one orthologues only, and needs enough of them", () => {
    const b = baseline(SAMPLE_LIBRARY, "mus_musculus")!;
    expect(b.n).toBe(9);
    expect(b.median).toBe(91.0);
    expect(b.low).toBeLessThan(b.q1);
    // Zebrafish: one is one-to-many and two report none, leaving 6.
    expect(baseline(SAMPLE_LIBRARY, "danio_rerio")).toBeNull();
    expect(MIN_BASELINE_N).toBe(8);
  });

  it("places a gene against the baseline, and refuses to compare what is not comparable", () => {
    const lib = SAMPLE_LIBRARY;
    const d = lib.genes.find((g) => g.symbol === "SAMPLE-D")!;
    expect(deviation(lib, d, "mus_musculus")).toMatchObject({ kind: "below", value: 71.3 });
    expect(deviation(lib, lib.genes[0]!, "mus_musculus").kind).toBe("within");
    expect(deviation(lib, d, "danio_rerio").kind).toBe("no-baseline");
  });
});

describe("species tree", () => {
  const sp = (ensembl: string, ancestors: string[]): Species => ({
    ensembl,
    taxonId: 0,
    scientificName: ensembl,
    commonName: ensembl,
    role: "comparison",
    ancestors: ancestors.map((a) => ({ id: a, name: `taxon ${a}` })),
  });

  it("groups species by the ancestors they share, whatever order a source lists them in", () => {
    const tree = speciesTree([
      sp("human", ["1", "2", "3", "4"]),
      sp("chimp", ["4", "3", "2", "1"]),
      sp("mouse", ["1", "2", "5"]),
      sp("fish", ["1"]),
    ])!;
    expect(tree.sharedTaxa).toEqual(["taxon 1"]);
    expect(leafOrder(tree)).toEqual(["chimp", "human", "mouse", "fish"]);
    const mammals = tree.children[0]!;
    expect(mammals.species).toEqual(["chimp", "human", "mouse"]);
    expect(mammals.sharedTaxa).toEqual(["taxon 2"]);
    expect(mammals.children[0]!.sharedTaxa).toEqual(["taxon 3", "taxon 4"]);
  });

  it("draws no tree when any species has no ancestors on record", () => {
    expect(speciesTree(SAMPLE_LIBRARY.species)).toBeNull();
  });
});

describe("freshness", () => {
  it("marks a snapshot older than 90 days as out of date, and never the sample", () => {
    const at = new Date("2026-10-31T00:00:00Z");
    expect(isStale({ ...SNAPSHOT, capturedAt: "2026-06-01T00:00:00Z" }, at)).toBe(true);
    expect(isStale({ ...SNAPSHOT, capturedAt: "2026-10-01T00:00:00Z" }, at)).toBe(false);
    expect(isStale({ ...SAMPLE_LIBRARY, capturedAt: "2020-01-01T00:00:00Z" }, at)).toBe(false);
  });
});

// ------------------------------------------------------------ live check

const HGNC = {
  response: {
    docs: [
      {
        symbol: "TESTG",
        name: "test gene",
        status: "Approved",
        hgnc_id: "HGNC:1",
        entrez_id: "11",
        ensembl_gene_id: "ENSG1",
        uniprot_ids: ["P1"],
      },
    ],
  },
};
const HOMOLOGY = {
  data: [
    {
      homologies: [
        {
          type: "ortholog_one2one",
          taxonomy_level: "Euarchontoglires",
          source: { perc_id: 90.123 },
          target: { id: "ENSMUSG1", species: "mus_musculus", taxon_id: 10090, perc_id: 89.456 },
        },
        { type: "within_species_paralog", target: { id: "ENSG2", species: "homo_sapiens" } },
      ],
    },
  ],
};

function net(routes: Record<string, (() => Response | Promise<Response>)[]>) {
  const calls: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const next = key ? routes[key]!.shift() : undefined;
    if (!next) return new Response("", { status: 404 });
    if (init?.signal?.aborted) throw new Error("aborted");
    return next();
  };
  return { fetcher, calls };
}
const fast = { sleep: async () => {}, now: () => new Date("2026-10-31T12:00:00Z") };

describe("live check", () => {
  it("reads HGNC then Ensembl and labels the result live, with its time", async () => {
    const { fetcher, calls } = net({
      genenames: [() => json(HGNC)],
      ensembl: [() => json(HOMOLOGY)],
    });
    const r = await liveCheck("TESTG", { fetcher, ...fast });
    expect(r.mode).toBe("live");
    expect(r.checkedAt).toBe("2026-10-31T12:00:00.000Z");
    expect(r.sources.map((s) => s.status)).toEqual(["ok", "ok"]);
    expect(r.hgnc?.ensemblGeneId).toBe("ENSG1");
    expect(r.orthologues).toEqual([
      expect.objectContaining({ species: "mus_musculus", percId: 89.46 }),
    ]);
    expect(calls.some((u) => u.includes("ncbi"))).toBe(false);
  });

  it("retries a 503 and a 429, but not a 404", async () => {
    const a = net({
      genenames: [() => new Response("", { status: 503 }), () => json(HGNC)],
      ensembl: [
        () => new Response("", { status: 429, headers: { "Retry-After": "1" } }),
        () => json(HOMOLOGY),
      ],
    });
    const r = await liveCheck("TESTG", { fetcher: a.fetcher, ...fast });
    expect(r.sources.map((s) => s.status)).toEqual(["ok", "ok"]);
    const b = net({ genenames: [() => new Response("", { status: 404 }), () => json(HGNC)] });
    const r2 = await liveCheck("TESTG", { fetcher: b.fetcher, ...fast });
    expect(b.calls).toHaveLength(1);
    expect(r2.sources[0]).toMatchObject({ status: "failed", detail: "HTTP 404" });
    expect(r2.sources[1]).toMatchObject({ status: "skipped" });
  });

  it("reports a partial outage per source and keeps what did arrive", async () => {
    const { fetcher } = net({
      genenames: [() => json(HGNC)],
      ensembl: [
        () => new Response("", { status: 502 }),
        () => new Response("", { status: 502 }),
        () => new Response("", { status: 502 }),
      ],
    });
    const r = await liveCheck("TESTG", { fetcher, ...fast });
    expect(r.hgnc?.symbol).toBe("TESTG");
    expect(r.orthologues).toBeNull();
    expect(r.sources[1]).toMatchObject({
      id: "ensembl-compara",
      status: "failed",
      detail: "HTTP 502",
    });
  });

  it("gives up on a source that does not answer in time", async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    const r = await liveCheck("TESTG", { fetcher: hang, timeoutMs: 5, retries: 0, ...fast });
    expect(r.sources[0]).toMatchObject({ status: "failed", detail: "no answer within 0.005 s" });
  });

  it("asks nothing of a source the policy refuses", async () => {
    const lic = structuredClone(LICENCES);
    lic.items.find((i) => i.id === "ensembl-compara")!.permissions!.research.fetch = "denied";
    const { fetcher, calls } = net({
      genenames: [() => json(HGNC)],
      ensembl: [() => json(HOMOLOGY)],
    });
    const r = await liveCheck("TESTG", { fetcher, licences: lic, ...fast });
    expect(r.sources[1]).toMatchObject({ status: "withheld" });
    expect(calls.some((u) => u.includes("ensembl"))).toBe(false);
  });

  it("rejects an invalid symbol before any request", async () => {
    await expect(liveCheck("bad symbol!", { ...fast })).rejects.toThrow(/not a valid/);
  });

  it("reduces Ensembl's response the same way as the capture tool", () => {
    expect(() => orthologuesFromResponse({ nope: 1 })).toThrow(/unexpected/);
    expect(orthologuesFromResponse(HOMOLOGY)).toHaveLength(1);
  });
});
