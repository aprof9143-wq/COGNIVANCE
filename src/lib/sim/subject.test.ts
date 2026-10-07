import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { writeNifti } from "../imaging/testing/fixtures";
import { attachRegionMeasures, parseAnatomy, parseRegionLabels, targetPoint } from "./anatomy";
import { regionDepth } from "./regions";
import {
  analyseSubject,
  composeSubject,
  parseConfig,
  subjectRef,
  type SubjectFile,
} from "./subject";

const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const gz = (p: string) => buf(gunzipSync(readFileSync(p)));
const file = (p: string): SubjectFile => ({
  name: p.split("/").pop()!,
  buffer: buf(readFileSync(p)),
});

function template() {
  const an = parseAnatomy(gz("public/sim/anatomy.bin.gz"));
  attachRegionMeasures(an, parseRegionLabels(gz("public/sim/regions.nii.gz")));
  return an;
}

/**
 * A synthetic head in MNI space at 2 mm: an ellipsoid the size of the
 * template's head on a neck cut by the image, with an airway that opens at
 * the bottom of the image. Background is low-level noise.
 */
function phantomHead(): SubjectFile {
  const dims: [number, number, number] = [96, 114, 96];
  const origin = [-95, -129, -77];
  const values = new Array<number>(dims[0] * dims[1] * dims[2]);
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40;
  let idx = 0;
  for (let k = 0; k < dims[2]; k++)
    for (let j = 0; j < dims[1]; j++)
      for (let i = 0; i < dims[0]; i++, idx++) {
        const x = origin[0]! + 2 * i;
        const y = origin[1]! + 2 * j;
        const z = origin[2]! + 2 * k;
        const r = Math.hypot(x / 92, (y + 15) / 108, (z - 15) / 90);
        const neck = z < -30 && Math.hypot(x, y + 15) < 50;
        const airway = z < -10 && Math.hypot(x, y - 10) < 12;
        let v = noise();
        if ((r < 1 || neck) && !airway) v = r < 0.75 ? 600 : r < 0.9 ? 150 : 900;
        values[idx] = Math.round(v);
      }
  const nii = writeNifti({
    dims,
    values,
    srow: [2, 0, 0, origin[0]!, 0, 2, 0, origin[1]!, 0, 0, 2, origin[2]!],
  });
  return { name: "phantom_T1w.nii", buffer: nii };
}

describe("subject config", () => {
  it("keeps what it understands and says what it dropped", () => {
    const notes: string[] = [];
    const c = parseConfig(
      JSON.stringify({
        subject_id: "sub-01",
        age: 71,
        sex: "F",
        target_regions: ["amygdala", "vmpfc", "cerebellum"],
        array: { frequency_mhz: 7.5, pitch_mm: 5 },
        site: "x",
      }),
      notes,
    );
    expect(c).toEqual({
      subject_id: "sub-01",
      age: 71,
      sex: "F",
      target_regions: ["amygdala", "vmpfc"],
      array: { frequency_mhz: 7.5 },
    });
    expect(notes.join(" ")).toMatch(/"site" is not used/);
    expect(notes.join(" ")).toMatch(/cerebellum/);
    expect(notes.join(" ")).toMatch(/pitch_mm/);
    expect(() => parseConfig("{", [])).toThrow(/not valid JSON/);
  });
});

describe("subject anatomy", () => {
  it("builds brain surface, cortex and deep regions from an MNI-space T1 and aseg", async () => {
    const tpl = template();
    const before = tpl.meshes.get("amygdala")!.positions;
    const parts = await analyseSubject(
      [
        file("public/templates/mni152_template.nii.gz"),
        file("public/templates/mni152_aseg.nii.gz"),
      ],
      subjectRef(tpl),
    );
    const s = composeSubject(tpl, parts);
    for (const k of ["outer", "cortex", "hippocampus", "amygdala", "thalamus"])
      expect(s.sources[k]).toBe("subject");
    for (const k of ["stn", "v1", "dlpfc", "vmpfc", "insula", "auditory", "motor"])
      expect(s.sources[k]).toBe("template");
    // This T1 is cropped to the brain: no scalp, so the template's is kept.
    expect(s.sources["scalp"]).toBe("template");
    expect(s.notes.join(" ")).toMatch(/skull-stripped/);
    // Same template space, so the subject's deep regions land where the atlas's do.
    for (const k of ["hippocampus", "amygdala", "thalamus"] as const) {
      const a = targetPoint(tpl.meshes.get(k)!, "left");
      const b = targetPoint(s.anatomy.meshes.get(k)!, "left");
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(3);
      const da = regionDepth(tpl, k)!;
      const db = regionDepth(s.anatomy, k)!;
      expect(Math.abs(da.belowBrainMm - db.belowBrainMm)).toBeLessThan(4);
    }
    // The template is not modified.
    expect(tpl.meshes.get("amygdala")!.positions).toBe(before);
    expect(s.label).toBe("Subject");
  }, 60_000);

  it("finds the scalp of a full head and keeps the airway inside", async () => {
    const tpl = template();
    const parts = await analyseSubject([phantomHead()], subjectRef(tpl));
    expect(parts.scalp).not.toBeNull();
    expect(parts.notes.join(" ")).not.toMatch(/skull-stripped/);
    const p = parts.scalp!;
    let nearAirway = 0;
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i]!, p[i + 1]!, p[i + 2]!];
      if (z > -70 && z < -15 && Math.hypot(x, y - 10) < 18) nearAirway++;
    }
    expect(nearAirway).toBe(0);
    // Every other point is on the outside of the head or neck.
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i]!, p[i + 1]!, p[i + 2]!];
      const r = Math.hypot(x / 92, (y + 15) / 108, (z - 15) / 90);
      const neck = Math.hypot(x, y + 15);
      expect(r > 0.93 || (z < -28 && neck > 46)).toBe(true);
    }
  }, 60_000);

  it("refuses a T1 that is not in MNI152 space", async () => {
    const tpl = template();
    const head = phantomHead();
    // Same image, placed 80 mm off.
    const dv = new DataView(head.buffer);
    dv.setFloat32(280 + 3 * 4, -15, true);
    await expect(analyseSubject([head], subjectRef(tpl))).rejects.toThrow(/line up with MNI152/);
  }, 60_000);

  it("takes the T1 out of a derivatives folder and skips what it does not use", async () => {
    const tpl = template();
    const t1 = { ...phantomHead(), name: "sub-01_space-MNI152NLin2009cAsym_desc-preproc_T1w.nii" };
    const t2 = { ...phantomHead(), name: "sub-01_space-MNI152NLin2009cAsym_T2w.nii" };
    const tissue = {
      name: "sub-01_space-MNI152NLin2009cAsym_dseg.nii",
      buffer: writeNifti({
        dims: [4, 4, 4],
        values: Array.from({ length: 64 }, (_, i) => i % 4),
        datatype: 2,
      }),
    };
    const prob = { ...tissue, name: "sub-01_space-MNI152NLin2009cAsym_label-GM_probseg.nii" };
    const parts = await analyseSubject([t2, tissue, prob, t1], subjectRef(tpl));
    expect(parts.scalp).not.toBeNull();
    const notes = parts.notes.join(" ");
    expect(notes).toMatch(/T2w\.nii: not the T1, ignored/);
    expect(notes).toMatch(/_dseg\.nii: a label map but not an aseg, ignored/);
    expect(notes).toMatch(/probseg\.nii: not a T1, aseg or brain mask, ignored/);
  }, 60_000);

  it("needs exactly one T1", async () => {
    const tpl = template();
    const config = { name: "config.json", buffer: new TextEncoder().encode("{}").buffer };
    await expect(analyseSubject([config], subjectRef(tpl))).rejects.toThrow(/No T1 image/);
  });
});
