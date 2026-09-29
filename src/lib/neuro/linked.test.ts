import { describe, expect, it } from "vitest";
import { applyLinked, LINKED_VISIT, toLinkedMarkers, type LinkedState } from "./linked";
import { emptyCase } from "./schema";

const at = "2026-09-29T10:00:00.000Z";

const state = (patch: Partial<LinkedState>): LinkedState => ({
  mri: null,
  segmentation: null,
  eeg: null,
  ...patch,
});

const mri = {
  origin: "viewer" as const,
  kind: "subject" as const,
  label: "DICOM series (MR)",
  dims: [256, 256, 176] as [number, number, number],
  spacingMm: [1, 1, 1] as [number, number, number],
  acquisitionMonth: "2025-03",
  manufacturer: "Vendor",
  model: "Model",
  fieldStrength: 3,
  sequence: "T1 MPRAGE",
  linkedAt: at,
};

describe("linking loaded data into the case", () => {
  it("adds a visit dated to the acquisition month, with scanner details", () => {
    const c = applyLinked(emptyCase(), state({ mri }));
    const v = c.visits.find((x) => x.id === LINKED_VISIT)!;
    expect(v.date).toBe("2025-03-01");
    expect(v.scanner.fieldStrength).toBe(3);
    expect(v.voxelSize).toBe("1.00 × 1.00 × 1.00 mm");
    expect(v.notes).toMatch(/Day of month not retained/);
  });

  it("turns FreeSurfer label volumes into regional measurements, and nothing else", () => {
    const c = applyLinked(
      emptyCase(),
      state({
        mri,
        segmentation: {
          origin: "viewer",
          label: "label map",
          convention: "FreeSurfer (aseg/aparc)",
          classes: [
            { label: 17, name: "Left Hippocampus", mm3: 3500.04 },
            { label: 53, name: "Right Hippocampus", mm3: 3600 },
            { label: 999, name: "Unknown", mm3: 10 },
          ],
          linkedAt: at,
        },
      }),
    );
    expect(c.measurements.map((m) => [m.regionId, m.hemisphere, m.value])).toEqual([
      [17, "left", 3500],
      [53, "right", 3600],
    ]);
    expect(
      c.measurements.every((m) => m.visitId === LINKED_VISIT && m.qc.status === "pending"),
    ).toBe(true);
  });

  it("does not map labels from another convention onto atlas regions", () => {
    const c = applyLinked(
      emptyCase(),
      state({
        segmentation: {
          origin: "viewer",
          label: "label map",
          convention: "BraTS 2021",
          classes: [{ label: 17, name: "x", mm3: 1 }],
          linkedAt: at,
        },
      }),
    );
    expect(c.measurements).toEqual([]);
  });

  it("adds EEG measures as nonspecific biomarkers; a phantom is labelled synthetic", () => {
    const c = applyLinked(
      emptyCase(),
      state({
        eeg: {
          origin: "console",
          kind: "phantom",
          label: "Synthetic 10-20 recording",
          channels: 19,
          mapped: 19,
          sampleRate: 256,
          analysedSeconds: 30,
          markers: [
            { id: "pdr", name: "Posterior dominant rhythm", value: 10, unit: "Hz" },
            { id: "coh", name: "Interhemispheric α coherence", value: null, unit: "0–1" },
          ],
          linkedAt: at,
        },
      }),
    );
    expect(c.biomarkers).toHaveLength(2);
    expect(c.biomarkers[0]!).toMatchObject({ modality: "EEG", category: "nonspecific", value: 10 });
    expect(c.biomarkers[0]!.tracerOrAssay).toMatch(/SYNTHETIC PHANTOM/);
    // Missing stays missing, never zero.
    expect(c.biomarkers[1]!.value).toBeNull();
    expect(c.biomarkers.every((b) => b.cutoff === null)).toBe(true);
  });

  it("replaces linked items on update, keeps user entries, and never goes stale", () => {
    let c = emptyCase();
    c = {
      ...c,
      visits: [
        {
          id: "v-user",
          date: "2024-01-10",
          scanner: { manufacturer: null, model: null, fieldStrength: null },
          sequence: null,
          voxelSize: null,
          icvMm3: null,
          ageYears: null,
          notes: "",
        },
      ],
    };
    c = applyLinked(c, state({ mri }));
    c = applyLinked(c, state({ mri: { ...mri, acquisitionMonth: "2026-01" } }));
    expect(c.visits.map((v) => v.id)).toEqual(["v-user", LINKED_VISIT]);
    expect(c.visits[1]!.date).toBe("2026-01-01");
    c = applyLinked(c, state({}));
    expect(c.visits.map((v) => v.id)).toEqual(["v-user"]);
  });
});

describe("marker normalisation", () => {
  it("stores percentages as percentages and non-finite values as missing", () => {
    expect(
      toLinkedMarkers([
        { id: "palpha", name: "Posterior alpha share", value: 0.42, unit: "% of power" },
        { id: "pdr", name: "Posterior dominant rhythm", value: 9.5, unit: "Hz" },
        { id: "coh", name: "Coherence", value: Number.NaN, unit: "0–1" },
      ]).map((m) => m.value),
    ).toEqual([42, 9.5, null]);
  });
});
