/**
 * The feature list and workflow shown on the landing page and the workspace:
 * every status is one of the four, every captured data set points at a
 * manifest that exists, every link leads to a page, and nothing claims to be
 * live or real-time.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES, STATUS_LABEL, WORKFLOW } from "./company";

const ROOT = join(__dirname, "../..");
const ROUTES = readFileSync(join(ROOT, "src/routeTree.gen.ts"), "utf8");
const routeExists = (to: string) => ROUTES.includes(`'${to.split("#")[0]}'`);

describe("features", () => {
  it("gives every feature one of the four statuses, and what it runs on", () => {
    for (const m of MODULES) {
      expect(Object.keys(STATUS_LABEL), m.key).toContain(m.status);
      expect(m.data.length, m.key).toBeGreaterThan(5);
      expect(routeExists(m.to), m.to).toBe(true);
    }
    for (const step of WORKFLOW)
      for (const it of step.items) {
        expect(Object.keys(STATUS_LABEL), it.name).toContain(it.status);
        if (it.to) expect(routeExists(it.to), it.to).toBe(true);
      }
  });

  it("reads 'data as of' from manifests that exist, with a capture time", () => {
    const withData = MODULES.filter((m) => m.manifest);
    expect(withData.map((m) => m.key)).toEqual(["vision", "genomics"]);
    for (const m of withData) {
      const p = join(ROOT, "public", m.manifest!);
      expect(existsSync(p), p).toBe(true);
      expect(JSON.parse(readFileSync(p, "utf8")).capturedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    }
  });

  it("claims no live, real-time or clinical capability", () => {
    const text = JSON.stringify({ MODULES, WORKFLOW }).toLowerCase();
    expect(text).not.toMatch(
      /real[- ]time|\blive data\b|streaming|clinically validated|(gives|makes|provides) (a )?diagnos/,
    );
    expect(MODULES.filter((m) => m.status === "planned").map((m) => m.key)).toEqual(["benchmarks"]);
  });
});
