import { describe, expect, it } from "vitest";
import {
  clinicalModeAvailability,
  parseReleaseGate,
  RELEASE_GATE,
  type ReleaseGate,
} from "./release";

const gate = (f: (g: ReleaseGate) => void) => {
  const g = structuredClone(RELEASE_GATE);
  f(g);
  return parseReleaseGate(g);
};

/** A complete, synthetic set of records, for testing the gate's logic only. */
const fullyRecorded = () =>
  gate((g) => {
    g.clinicalMode.approvals = g.clinicalMode.requiredEvidence.map((e, n) => ({
      id: `TEST-${n}`,
      approver: "Synthetic Approver",
      role: e.reviewerRole,
      date: "2030-01-01",
      outcome: "approved" as const,
      documentRef: `test/${e.id}`,
      rationale: "Synthetic record for a unit test.",
    }));
    g.clinicalMode.requiredEvidence.forEach((e, n) => {
      e.status = "verified";
      e.approvalId = `TEST-${n}`;
    });
  });

describe("clinical release gate", () => {
  it("is unavailable today, with one unmet reason per required item", () => {
    const a = clinicalModeAvailability();
    expect(a.available).toBe(false);
    expect(a.unmet).toHaveLength(RELEASE_GATE.clinicalMode.requiredEvidence.length);
    expect(RELEASE_GATE.clinicalMode.approvals).toEqual([]);
  });

  it("cannot be opened by setting its status field", () => {
    expect(
      clinicalModeAvailability(gate((g) => (g.clinicalMode.status = "available"))).available,
    ).toBe(false);
  });

  it("refuses evidence marked verified without a recorded approval", () => {
    const g = gate((x) => x.clinicalMode.requiredEvidence.forEach((e) => (e.status = "verified")));
    const a = clinicalModeAvailability(g);
    expect(a.available).toBe(false);
    expect(a.unmet[0]).toMatch(/no recorded approval/);
  });

  it("refuses a rejected approval", () => {
    const g = fullyRecorded();
    g.clinicalMode.approvals[0]!.outcome = "rejected";
    expect(clinicalModeAvailability(g).unmet).toEqual([expect.stringMatching(/was rejected/)]);
  });

  it("opens only when every item is verified and backed by an approval", () => {
    expect(clinicalModeAvailability(fullyRecorded()).available).toBe(true);
  });

  it("rejects approvals with no approver, document or date", () => {
    expect(() =>
      gate((g) =>
        g.clinicalMode.approvals.push({
          id: "X",
          approver: "",
          role: "r",
          date: "soon",
          outcome: "approved",
          documentRef: "",
          rationale: "",
        }),
      ),
    ).toThrow();
  });
});
