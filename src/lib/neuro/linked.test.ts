import { describe, expect, it } from "vitest";
import {
  applyLinked,
  fingerprint,
  planLinked,
  reduceLinked,
  toLinkedMarkers,
  visitIdFor,
  type LinkedEeg,
  type LinkedMri,
  type LinkedSegmentation,
  type LinkedState,
} from "./linked";
import { emptyCase } from "./schema";
import { regionRows } from "./results";

const EMPTY: LinkedState = { mri: null, segmentation: null, eeg: null, scans: [], recordings: [] };

const mri = (patch: Partial<LinkedMri> = {}): LinkedMri => ({
  origin: "viewer",
  kind: "subject",
  label: "DICOM series (MR)",
  fingerprint: "a",
  dims: [256, 256, 176],
  spacingMm: [1, 1, 1],
  acquisitionMonth: "2025-03",
  manufacturer: "Vendor",
  model: "Model",
  fieldStrength: 3,
  sequence: "T1 MPRAGE",
  linkedAt: "2026-09-29T10:00:00.000Z",
  ...patch,
});

const aseg = (hippoL: number, hippoR: number): LinkedSegmentation => ({
  origin: "console",
  label: "label map",
  convention: "FreeSurfer (aseg/aparc)",
  method: "test",
  classes: [
    { label: 17, name: "Left Hippocampus", mm3: hippoL },
    { label: 53, name: "Right Hippocampus", mm3: hippoR },
    { label: 999, name: "Unknown", mm3: 10 },
  ],
  linkedAt: "2026-09-29T10:00:00.000Z",
});

const eeg = (pdr: number, kind: LinkedEeg["kind"] = "subject"): LinkedEeg => ({
  origin: "console",
  kind,
  label: kind === "subject" ? "Uploaded EDF recording" : "Synthetic 10-20 recording",
  channels: 19,
  mapped: 19,
  sampleRate: 256,
  analysedSeconds: 30,
  markers: [
    { id: "pdr", name: "Posterior dominant rhythm", value: pdr, unit: "Hz" },
    { id: "coh", name: "Interhemispheric α coherence", value: null, unit: "0–1" },
  ],
  linkedAt: "2026-09-29T10:00:00.000Z",
});

const load = (...patches: Partial<LinkedState>[]) => patches.reduce(reduceLinked, EMPTY);

describe("linking loaded data into the case", () => {
  it("adds a visit dated to the acquisition month, with scanner details", () => {
    const l = load({ mri: mri() });
    const c = applyLinked(emptyCase(), l);
    expect(c.visits).toHaveLength(1);
    expect(c.visits[0]!).toMatchObject({ date: "2025-03-01", voxelSize: "1.00 × 1.00 × 1.00 mm" });
    expect(c.visits[0]!.scanner.fieldStrength).toBe(3);
    expect(c.visits[0]!.notes).toMatch(/day not retained/);
  });

  it("turns FreeSurfer label volumes into regional measurements on that scan's visit", () => {
    const l = load({ mri: mri() }, { segmentation: aseg(3500.04, 3600) });
    const c = applyLinked(emptyCase(), l);
    expect(c.measurements.map((m) => [m.regionId, m.hemisphere, m.value])).toEqual([
      [17, "left", 3500],
      [53, "right", 3600],
    ]);
    expect(c.measurements.every((m) => m.visitId === c.visits[0]!.id)).toBe(true);
    expect(c.measurements.every((m) => m.qc.status === "pending")).toBe(true);
  });

  it("does not map labels from another convention onto atlas regions", () => {
    const l = load({ mri: mri() }, { segmentation: { ...aseg(1, 1), convention: "BraTS 2021" } });
    expect(applyLinked(emptyCase(), l).measurements).toEqual([]);
  });

  it("keeps every scan: two dated scans give two visits and an annualised change", () => {
    const l = load(
      { mri: mri({ fingerprint: "a", acquisitionMonth: "2024-01" }) },
      { segmentation: aseg(4000, 4100) },
      { mri: mri({ fingerprint: "b", acquisitionMonth: "2025-01" }) },
      { segmentation: aseg(3900, 4000) },
    );
    const c = applyLinked(emptyCase(), l);
    expect(c.visits.map((v) => v.date)).toEqual(["2024-01-01", "2025-01-01"]);
    const hippo = regionRows(c, "raw").find((r) => r.key === "hippocampus")!;
    expect(hippo.left!.change.state).toBe("value");
    expect((hippo.left!.change as { percentPerYear: number }).percentPerYear).toBeCloseTo(-2.5, 1);
  });

  it("uses template or phantom data only until a subject's data arrives", () => {
    const demo = load(
      { mri: mri({ kind: "template", fingerprint: "t" }) },
      { eeg: eeg(10, "phantom") },
    );
    expect(planLinked(demo).included.map((s) => s.mri.kind)).toEqual(["template"]);
    const both = reduceLinked(reduceLinked(demo, { mri: mri() }), { eeg: eeg(8.5) });
    const plan = planLinked(both);
    expect(plan.included.map((s) => s.mri.kind)).toEqual(["subject"]);
    expect(plan.recordings.map((r) => r.eeg.kind)).toEqual(["subject"]);
  });

  it("leaves out a scan whose date collides, until the user dates it", () => {
    const undated = { acquisitionMonth: null };
    let l = load(
      { mri: mri({ ...undated, fingerprint: "a" }) },
      { mri: mri({ ...undated, fingerprint: "b" }) },
    );
    let plan = planLinked(l);
    expect(plan.included).toHaveLength(1);
    expect(plan.excluded[0]!.reason).toMatch(/enter its scan date/);
    const key = plan.excluded[0]!.scan.key;
    l = { ...l, scans: l.scans.map((s) => (s.key === key ? { ...s, date: "2027-01-15" } : s)) };
    plan = planLinked(l);
    expect(plan.included).toHaveLength(2);
    expect(applyLinked(emptyCase(), l).visits.map((v) => v.date)).toContain("2027-01-15");
  });

  it("adds EEG measures as nonspecific biomarkers; missing stays missing", () => {
    const c = applyLinked(emptyCase(), load({ eeg: eeg(10, "phantom") }));
    expect(c.biomarkers).toHaveLength(2);
    expect(c.biomarkers[0]!).toMatchObject({ modality: "EEG", category: "nonspecific", value: 10 });
    expect(c.biomarkers[0]!.tracerOrAssay).toMatch(/SYNTHETIC PHANTOM/);
    expect(c.biomarkers[1]!.value).toBeNull();
    expect(c.biomarkers.every((b) => b.cutoff === null)).toBe(true);
  });

  it("rebuilds linked items on update, keeps user entries and linked-visit edits", () => {
    const l = load({ mri: mri() });
    let c = applyLinked(emptyCase(), l);
    const id = visitIdFor(l.scans[0]!);
    c = { ...c, visits: c.visits.map((v) => (v.id === id ? { ...v, ageYears: 71 } : v)) };
    c = {
      ...c,
      visits: [
        ...c.visits,
        {
          id: "v-user",
          date: "2020-01-10",
          scanner: { manufacturer: null, model: null, fieldStrength: null },
          sequence: null,
          voxelSize: null,
          icvMm3: null,
          ageYears: null,
          notes: "",
        },
      ],
    };
    c = applyLinked(c, l);
    expect(c.visits.map((v) => v.id).sort()).toEqual([id, "v-user"].sort());
    expect(c.visits.find((v) => v.id === id)!.ageYears).toBe(71);
    c = applyLinked(c, EMPTY);
    expect(c.visits.map((v) => v.id)).toEqual(["v-user"]);
  });
});

describe("helpers", () => {
  it("stores percentages as percentages and non-finite values as missing", () => {
    expect(
      toLinkedMarkers([
        { id: "palpha", name: "Posterior alpha share", value: 0.42, unit: "% of power" },
        { id: "pdr", name: "Posterior dominant rhythm", value: 9.5, unit: "Hz" },
        { id: "coh", name: "Coherence", value: Number.NaN, unit: "0–1" },
      ]).map((m) => m.value),
    ).toEqual([42, 9.5, null]);
  });

  it("fingerprints differ for different data and match for equal data", () => {
    const a = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
    const b = Uint8Array.from(a);
    b[500] = 7;
    expect(fingerprint(a)).toBe(fingerprint(Uint8Array.from(a)));
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});
