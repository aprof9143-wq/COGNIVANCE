/**
 * The served display copy (public/vision/display/) against the raw snapshot it
 * was built from (data/genome/snapshot/), and the loader that reads it. No
 * network: files are read from disk.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadSnapshot, parseDisplayManifest, parseManifest } from "@/lib/vision/snapshot";
import { DISPLAY_SCHEMAS, type Fetcher } from "@/lib/vision/sources";
import { displayDir } from "./config";
import { allowed } from "./policy";

const ROOT = join(__dirname, "../../..");
const PUBLIC = join(ROOT, "public");
const RAW = join(ROOT, "data/genome/snapshot");

const json = (path: string): unknown => {
  const buf = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8"));
};

/** Serves public/ from disk and logs every request. */
const disk = (log: string[] = []): Fetcher => {
  return async (url) => {
    log.push(url);
    try {
      return new Response(readFileSync(join(PUBLIC, url)));
    } catch {
      return new Response(null, { status: 404 });
    }
  };
};

describe("display copy", () => {
  const genes = readdirSync(RAW);

  it("holds, per file, exactly the fields the app's parsers read from the raw response", () => {
    for (const g of genes) {
      for (const [name, schema] of Object.entries(DISPLAY_SCHEMAS)) {
        const display = json(join(PUBLIC, "vision/display", g, name));
        const fromRaw = JSON.parse(JSON.stringify(schema.parse(json(join(RAW, g, name)))));
        expect(display, `${g}/${name}`).toEqual(fromRaw);
        // And the app reads the display copy exactly as it would the raw file.
        expect(schema.parse(display)).toEqual(schema.parse(json(join(RAW, g, name))));
      }
    }
  });

  it("traces every display file to its raw response and its source", () => {
    for (const g of genes) {
      const d = parseDisplayManifest(json(join(PUBLIC, "vision/display", g, "manifest.json")));
      const raw = parseManifest(json(join(RAW, g, "manifest.json")));
      expect(d.notice).toMatch(/not for clinical decision-making/);
      for (const f of d.files) {
        const r = raw.files.find((x) => x.file === f.file)!;
        expect(f, f.file).toMatchObject({
          url: r.url,
          sha256: r.sha256,
          retrievedAt: r.retrievedAt,
        });
        expect(allowed(f.licenceId, "display"), f.licenceId).toBe(true);
      }
      expect(d.files.some((f) => f.file === "hgnc_symbol.json")).toBe(false);
    }
  });
});

describe("snapshot loader reads only the display copy", () => {
  it("loads the gene, protein, model and sequences from /vision/display/", async () => {
    const log: string[] = [];
    const snap = await loadSnapshot(disk(log));
    expect(snap.gene.state).toBe("value");
    expect(snap.protein.state).toBe("value");
    expect(snap.model.state).toBe("value");
    expect(snap.sequences.state).toBe("value");
    expect(log.every((u) => u.startsWith(displayDir("RPE65")))).toBe(true);
  });

  it("withholds ClinVar without requesting any ClinVar file", async () => {
    const log: string[] = [];
    const snap = await loadSnapshot(disk(log));
    expect(snap.variants).toMatchObject({
      state: "withheld",
      sourceId: "clinvar-eutils",
      reason: expect.stringMatching(/disclaimer and copyright notice/),
    });
    expect(log.some((u) => /clinvar/i.test(u))).toBe(false);
  });

  it("refuses a display file whose source the policy does not permit, even if listed", async () => {
    const real = disk();
    const forged: Fetcher = async (url, init) => {
      if (url.endsWith("manifest.json")) {
        const m = json(join(PUBLIC, url)) as { files: { file: string; licenceId: string }[] };
        for (const f of m.files)
          if (f.file === "uniprot_search.json") f.licenceId = "clinvar-eutils";
        return new Response(JSON.stringify(m));
      }
      if (url.endsWith("uniprot_search.json")) throw new Error("must not be requested");
      return real(url, init);
    };
    const snap = await loadSnapshot(forged);
    expect(snap.protein).toMatchObject({
      state: "missing",
      reason: expect.stringMatching(/disclaimer/),
    });
  });
});
