/**
 * What the Vision evidence export can contain. Built from the real display
 * copy (no network): the not-for-clinical-use statement, the policy's withheld
 * list, and no content from a withheld source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEvidenceExport } from "./export";
import { loadSnapshot } from "./snapshot";
import type { Fetcher } from "./sources";

const PUBLIC = join(__dirname, "../../../public");
const disk: Fetcher = async (url) => {
  try {
    return new Response(readFileSync(join(PUBLIC, url)));
  } catch {
    return new Response(null, { status: 404 });
  }
};

describe("evidence export", () => {
  it("carries the statement, the withheld list, and nothing from ClinVar", async () => {
    const snap = await loadSnapshot(disk);
    const out = buildEvidenceExport({
      exportedAt: "2026-10-29T00:00:00.000Z",
      target: { gene: "RPE65", taxonId: 9606, condition: "c" },
      record: { gene: snap.gene, protein: snap.protein, model: snap.model },
      structure: null,
      crossChecks: [],
      decisions: [],
    });
    expect(out.notice).toMatch(/not for clinical decision-making/);
    expect(out.sourcePolicy.withheld.map((w) => w.id)).toEqual(["clinvar-eutils"]);
    expect(Object.keys(out)).not.toContain("variants");
    // Outside the withheld list's own explanation, nothing names or carries ClinVar content.
    const { sourcePolicy, ...rest } = out;
    const text = JSON.stringify(rest);
    expect(text).not.toMatch(/clinvar|VCV\d|eutils|esummary/i);
    // The withheld list names the source (its name includes "esummary") and why; no record data.
    expect(JSON.stringify(sourcePolicy)).not.toMatch(/VCV\d|"variants"|"uid"/);
  });
});
