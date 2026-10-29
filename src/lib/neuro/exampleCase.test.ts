import { describe, expect, it } from "vitest";
import { exampleCase, EXAMPLE_SUBJECT, isExampleCase } from "./exampleCase";
import { parseCaseFile, exportCaseFile } from "./io";
import { regionRows } from "./results";
import { emptyCase } from "./schema";

describe("synthetic example case", () => {
  const c = exampleCase();

  it("is a valid case file that survives export and import", () => {
    const back = parseCaseFile(exportCaseFile(c));
    expect(back.subjectCode).toBe(EXAMPLE_SUBJECT);
    expect(back.measurements).toHaveLength(c.measurements.length);
  });

  it("labels every value as synthetic and claims no review", () => {
    expect(c.measurements.length).toBeGreaterThan(0);
    for (const m of c.measurements) {
      expect(m.provenance.software).toMatch(/synthetic/i);
      expect(m.qc.status).toBe("pending");
    }
    for (const a of c.assessments) expect(a.examiner).toMatch(/synthetic/i);
    for (const v of c.visits) expect(v.notes).toMatch(/synthetic/i);
    expect(c.reviewer).toBeNull();
  });

  it("carries nothing that would let the module flag a value as abnormal", () => {
    expect(c.norms).toEqual([]);
    expect(c.ratings).toEqual([]);
    expect(c.biomarkers).toEqual([]);
  });

  it("fills the regional table at the latest visit", () => {
    const rows = regionRows(c, "raw");
    const hip = rows.find((r) => r.key === "hippocampus" && r.metric === "volume");
    expect(hip?.visit.id).toBe("example-v3");
    expect(hip?.left?.value).toEqual({ state: "value", value: 3171 });
  });

  it("is still recognised after the subject code is renamed", () => {
    expect(isExampleCase(c)).toBe(true);
    expect(isExampleCase({ ...c, subjectCode: "RENAMED" })).toBe(true);
    expect(isExampleCase(emptyCase())).toBe(false);
  });

  it("is a fresh copy each time", () => {
    const a = exampleCase();
    a.measurements[0]!.value = 0;
    expect(exampleCase().measurements[0]!.value).not.toBe(0);
  });
});
