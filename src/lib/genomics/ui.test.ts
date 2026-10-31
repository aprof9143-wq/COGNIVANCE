/**
 * The genomics pages' states, rendered to markup on the server: loading,
 * error, sample and out-of-date notices, the empty condition, the baseline
 * label, and the export. No browser and no network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BaselineBar } from "@/components/genomics/GenePage";
import { LibraryView } from "@/components/genomics/LibraryPage";
import { DataBadge, ModeNotice, PageState } from "@/components/genomics/shared";
import { NOT_FOR_CLINICAL_USE } from "@/lib/genome/status";
import { geneExport } from "./export";
import { deviation } from "./library";
import { SAMPLE_LIBRARY } from "./sample";
import { parseLibrary, type Library } from "./schema";

const ROOT = join(__dirname, "../../..");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** Links need a router; a bare in-memory one is enough to render them. */
const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/genomics"] }),
});
const routed = (el: ReactElement) => createElement(RouterContextProvider, { router, children: el });

const CAPTURED: Library = parseLibrary(
  JSON.parse(readFileSync(join(ROOT, "public/genomics/library.json"), "utf8")),
);

describe("the committed library", () => {
  it("is a valid snapshot, with the notice and no sample data in it", () => {
    expect(CAPTURED.mode).toBe("snapshot");
    expect(CAPTURED.notice).toContain(NOT_FOR_CLINICAL_USE);
    expect(CAPTURED.genes.some((g) => g.symbol.startsWith("SAMPLE-"))).toBe(false);
    expect(CAPTURED.sampleNote).toBeUndefined();
    for (const g of CAPTURED.genes) expect(g.curations.length, g.symbol).toBeGreaterThan(0);
  });

  it("keeps ClinGen's classification words and a report link on every curation", () => {
    for (const g of CAPTURED.genes)
      for (const c of g.curations) {
        expect(c.classification.trim(), g.symbol).not.toBe("");
        expect(c.reportUrl, g.symbol).toMatch(/^https:\/\/search\.clinicalgenome\.org\//);
      }
  });
});

describe("page states", () => {
  it("announces loading, and shows a load error without substituting anything", () => {
    expect(html(createElement(PageState, { loaded: null }))).toContain('role="status"');
    const err = html(createElement(PageState, { loaded: { kind: "error", message: "HTTP 503" } }));
    expect(err).toContain('role="alert"');
    expect(err).toContain("HTTP 503");
    expect(err).toContain("Nothing has been substituted");
  });

  it("labels sample data as synthetic, everywhere it appears", () => {
    const notice = html(
      createElement(ModeNotice, {
        loaded: { kind: "sample", lib: SAMPLE_LIBRARY, reason: "No capture." },
      }),
    );
    expect(notice).toContain("Sample data.");
    expect(notice).toContain("synthetic");
    expect(html(createElement(DataBadge, { lib: SAMPLE_LIBRARY }))).toContain(
      "Sample data · synthetic",
    );
    expect(html(createElement(DataBadge, { lib: CAPTURED }))).toContain("Snapshot");
  });

  it("says when a snapshot is out of date or incomplete", () => {
    const old = { ...CAPTURED, capturedAt: "2025-01-01T00:00:00+00:00", complete: false };
    const out = html(createElement(ModeNotice, { loaded: { kind: "snapshot", lib: old } }));
    expect(out).toMatch(/Captured \d+ days ago/);
    expect(out).toContain("incomplete");
    expect(html(createElement(DataBadge, { lib: old }))).toContain("out of date");
    expect(
      html(
        createElement(ModeNotice, {
          loaded: { kind: "snapshot", lib: { ...CAPTURED, capturedAt: new Date().toISOString() } },
        }),
      ),
    ).toBe("");
  });

  it("explains a condition with no curated gene instead of filling it", () => {
    const lib = structuredClone(CAPTURED);
    lib.conditions = lib.conditions.map((c) => ({
      ...c,
      geneCount: c.key === "alzheimer" ? 0 : c.geneCount,
    }));
    const out = html(routed(createElement(LibraryView, { lib })));
    expect(out).toContain("has no curation whose disease label names this condition");
    expect(out).toContain("None is added by hand");
  });

  it("lists every captured gene with its classification", () => {
    const out = html(routed(createElement(LibraryView, { lib: CAPTURED })));
    for (const g of CAPTURED.genes) expect(out).toContain(`>${g.symbol}<`);
    expect(out).toContain(`${CAPTURED.genes.length} of ${CAPTURED.genes.length} genes`);
  });

  it("names a deviation in words, with its baseline and count", () => {
    const g = SAMPLE_LIBRARY.genes.find((x) => x.symbol === "SAMPLE-D")!;
    const out = html(
      createElement(BaselineBar, { d: deviation(SAMPLE_LIBRARY, g, "mus_musculus") }),
    );
    expect(out).toMatch(/aria-label="Below the baseline: 71.3% against a median of 91.0%/);
    expect(out).toContain("n=9");
    const none = html(
      createElement(BaselineBar, { d: deviation(SAMPLE_LIBRARY, g, "danio_rerio") }),
    );
    expect(none).toContain("Too few genes");
  });
});

describe("export", () => {
  it("carries the statement, the mode and the sources, and says when data is a sample", () => {
    const s = geneExport(SAMPLE_LIBRARY, SAMPLE_LIBRARY.genes[0]!, "t");
    expect(s.mode).toBe("sample");
    expect(s.notice).toContain(NOT_FOR_CLINICAL_USE);
    expect(s.notice).toContain("synthetic");
    const c = geneExport(CAPTURED, CAPTURED.genes[0]!, "t");
    expect(c.mode).toBe("snapshot");
    expect(c.notice).not.toContain("synthetic");
    expect(c.sources.map((x) => x.id)).toEqual([
      "clingen-gene-validity",
      "hgnc-rest",
      "ensembl-compara",
      "hpo-annotations",
    ]);
  });
});
