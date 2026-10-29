import { describe, expect, it } from "vitest";
import { LICENCES, type Licences } from "./config";
import {
  allowed,
  assertAllowed,
  DATA_ACTIONS,
  decide,
  decisionMatrix,
  PolicyError,
  PURPOSES,
  withheldSources,
} from "./policy";
import { RELEASE_GATE, type ReleaseGate } from "./release";

const clone = (l: Licences): Licences => structuredClone(l);
const withItem = (id: string, f: (i: Licences["items"][number]) => void) => {
  const l = clone(LICENCES);
  f(l.items.find((i) => i.id === id)!);
  return l;
};

describe("source policy", () => {
  it("permits research fetch, store and display only where the inventory records it", () => {
    for (const id of ["ensembl-rest", "uniprot-rest", "alphafold-db", "hgnc-rest", "rcsb-pdb"])
      for (const a of ["fetch", "store", "display"] as const)
        expect(allowed(id, a), `${id} ${a}`).toBe(true);
  });

  it("denies every action on ClinVar, for every purpose, with the recorded condition", () => {
    for (const purpose of PURPOSES)
      for (const action of DATA_ACTIONS) {
        const d = decide("clinvar-eutils", action, purpose);
        expect(d.allowed, `${action} ${purpose}`).toBe(false);
        expect(d.reason).toMatch(/disclaimer and copyright notice/);
      }
  });

  it("denies redistribution of every source: none is confirmed", () => {
    for (const i of LICENCES.items) expect(allowed(i.id, "redistribute"), i.id).toBe(false);
    expect(decide("ensembl-rest", "redistribute").reason).toMatch(/pending review/);
  });

  it("denies commercial-pilot use of everything: nothing is approved", () => {
    for (const i of LICENCES.items)
      for (const a of DATA_ACTIONS) expect(allowed(i.id, a, "commercial-pilot")).toBe(false);
    expect(decide("ensembl-rest", "fetch", "commercial-pilot").reason).toMatch(/not approved/);
  });

  it("denies clinical use of everything, and the release gate alone cannot open it", () => {
    for (const i of LICENCES.items)
      for (const a of DATA_ACTIONS) expect(allowed(i.id, a, "clinical")).toBe(false);
    // Even a source marked clinically approved is refused while the gate is shut.
    const l = withItem("ensembl-rest", (i) => (i.clinicalUse = "approved"));
    expect(decide("ensembl-rest", "display", "clinical", { licences: l }).reason).toMatch(
      /release gate/,
    );
  });

  it("fails closed on unknown, missing, pending and undecided entries", () => {
    expect(decide("no-such-source", "display").allowed).toBe(false);
    expect(decide("no-such-source", "display").recorded).toBe("not-in-inventory");
    expect(decide("zod", "fetch").recorded).toBe("not-a-data-source");
    expect(decide("alphamissense", "display").allowed).toBe(false);
    const dropped = withItem("ensembl-rest", (i) => delete i.permissions);
    expect(decide("ensembl-rest", "display", "research", { licences: dropped }).allowed).toBe(
      false,
    );
    for (const value of ["pending-review", "unknown", "denied"] as const) {
      const l = withItem("ensembl-rest", (i) => (i.permissions!.research.display = value));
      expect(decide("ensembl-rest", "display", "research", { licences: l }).allowed).toBe(false);
    }
    const unused = withItem("ensembl-rest", (i) => (i.used = false));
    expect(decide("ensembl-rest", "display", "research", { licences: unused }).allowed).toBe(false);
  });

  it("lets a blocked app use override a recorded allow", () => {
    const l = withItem("ensembl-rest", (i) => {
      i.appUse = "blocked";
      i.appUseCondition = "Blocked for a test.";
    });
    expect(decide("ensembl-rest", "display", "research", { licences: l }).reason).toBe(
      "Blocked for a test.",
    );
  });

  it("throws a PolicyError where a code path must stop", () => {
    expect(() => assertAllowed("clinvar-eutils", "display")).toThrow(PolicyError);
    expect(() => assertAllowed("ensembl-rest", "display")).not.toThrow();
  });

  it("names ClinVar, and only ClinVar, as withheld from display", () => {
    expect(withheldSources().map((w) => w.id)).toEqual(["clinvar-eutils"]);
  });

  it("gives a full matrix: three purposes, four actions", () => {
    const m = decisionMatrix("ensembl-rest");
    expect(m.map((r) => r.purpose)).toEqual(["research", "commercial-pilot", "clinical"]);
    expect(m[0]!.actions.filter((d) => d.allowed).map((d) => d.action)).toEqual([
      "fetch",
      "store",
      "display",
    ]);
    expect(m.slice(1).every((r) => r.actions.every((d) => !d.allowed))).toBe(true);
  });

  it("records every data source's permissions with their basis", () => {
    for (const i of LICENCES.items.filter((x) => x.kind === "data-source")) {
      expect(i.permissions, i.id).toBeDefined();
      expect(i.permissions!.basis.length).toBeGreaterThan(40);
      expect(i.clinicalUse).toBe("not-approved");
    }
  });

  it("uses the gate it is given", () => {
    const open: ReleaseGate = structuredClone(RELEASE_GATE);
    expect(decide("ensembl-rest", "display", "clinical", { gate: open }).allowed).toBe(false);
  });
});
