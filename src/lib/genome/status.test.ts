/**
 * The status statement and the status, notice and loading components, rendered
 * to markup on the server (no browser): the text is there, it is the same
 * everywhere, and the states carry their accessible roles and names.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusLine, StatusPanel } from "@/components/vision/StatusPanel";
import { Gap, Spinner, Withheld } from "@/components/vision/ui";
import { buildEvidenceExport } from "@/lib/vision/export";
import { GOVERNANCE, STATUS_CATEGORIES, STATUS_HEADINGS } from "./governance";
import { decide } from "./policy";
import { NOT_FOR_CLINICAL_USE } from "./status";

const ROOT = join(__dirname, "../../..");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

describe("status statement and panel", () => {
  it("shows the not-for-clinical-use statement in the status panel", () => {
    const out = html(createElement(StatusPanel));
    expect(out).toContain(NOT_FOR_CLINICAL_USE);
    expect(out).toContain('aria-labelledby="status-title"');
    expect(out).toContain("Clinical use is unavailable");
    expect(out).toContain("cannot be switched on by a setting");
  });

  it("uses one statement across screens, exports and records", () => {
    expect(NOT_FOR_CLINICAL_USE).toMatch(/not for clinical decision-making/);
    expect(html(createElement(StatusLine))).toContain(NOT_FOR_CLINICAL_USE);
    const ex = buildEvidenceExport({
      exportedAt: "t",
      target: { gene: "RPE65", taxonId: 9606, condition: "c" },
      record: null,
      structure: null,
      crossChecks: [],
      decisions: [],
    });
    expect(ex.notice).toContain(NOT_FOR_CLINICAL_USE);
    const display = JSON.parse(
      readFileSync(join(ROOT, "public/vision/display/rpe65/manifest.json"), "utf8"),
    );
    expect(display.notice).toContain(NOT_FOR_CLINICAL_USE);
  });

  it("groups every status item under exactly one of the five headings", () => {
    const out = html(createElement(StatusPanel));
    expect(STATUS_CATEGORIES).toHaveLength(5);
    for (const c of STATUS_CATEGORIES) {
      const has = GOVERNANCE.productStatus.items.some((i) => i.category === c);
      expect(out.includes(`>${STATUS_HEADINGS[c]}<`), c).toBe(has);
    }
    for (const i of GOVERNANCE.productStatus.items)
      expect(out.split(`>${i.name}.<`).length - 1, i.id).toBe(1);
    // ClinVar sits under Blocked; clinical use under the future work.
    const cat = (id: string) => GOVERNANCE.productStatus.items.find((i) => i.id === id)!.category;
    expect(cat("ST-CLINVAR")).toBe("blocked");
    expect(cat("ST-CLINICAL")).toBe("future-clinical-readiness");
    expect(cat("ST-PANEL")).toBe("proposed");
  });

  it("links the one-line status to the full panel", () => {
    const out = html(createElement(StatusLine));
    expect(out).toContain('role="note"');
    expect(out).toContain('href="/vision#status"');
  });
});

describe("states and their accessibility", () => {
  it("renders a withheld source as an accessible note with its reason", () => {
    const d = decide("clinvar-eutils", "display");
    const out = html(createElement(Withheld, { what: "Variant records", reason: d.reason }));
    expect(out).toContain('role="note"');
    expect(out).toContain('aria-label="Variant records withheld"');
    expect(out).toContain(d.reason);
    expect(out).toContain("withheld by the source policy");
  });

  it("announces loading as a status, and shows gaps and errors as text", () => {
    expect(html(createElement(Spinner, { label: "Reading the evidence snapshot…" }))).toContain(
      'role="status"',
    );
    const gap = html(createElement(Gap, null, "Snapshot could not be read: HTTP 404"));
    expect(gap).toContain("Snapshot could not be read: HTTP 404");
    expect(gap).toMatch(/aria-hidden="true"/);
  });
});
