import { describe, expect, it } from "vitest";
import { checkElectrodes, parseElectrodesTsv } from "./electrodes";
import { parseNiftiImage } from "./nifti";
import { writeNifti } from "./testing/fixtures";

const tsv =
  "name\tx\ty\tz\timpedance\nFp1\t-30\t80\t10\t5\nO1\t-30\t-90\t10\t5\nCz\t0\t0\t90\tn/a\nX1\tn/a\tn/a\tn/a\t5\n";

describe("electrodes", () => {
  it("reads BIDS electrodes.tsv, converting RAS to LPS and skipping n/a positions", () => {
    const set = parseElectrodesTsv(tsv, "sub-01_electrodes.tsv", "CapTrak");
    expect(set.electrodes).toEqual([
      { id: "Fp1", position: [30, -80, 10] },
      { id: "O1", position: [30, 90, 10] },
      { id: "Cz", position: [-0, -0, 90] },
    ]);
    expect(set.registered).toBe(false);
  });

  it("displays electrodes only when they fall within the image", () => {
    // 200 mm cube centred on the origin (RAS −100..99).
    const vol = parseNiftiImage(
      writeNifti({
        dims: [4, 4, 4],
        values: new Array(64).fill(1),
        srow: [66, 0, 0, -100, 0, 66, 0, -100, 0, 0, 66, -100],
      }),
      "head.nii",
    );
    expect(checkElectrodes(parseElectrodesTsv(tsv, "e.tsv"), vol).registered).toBe(true);
    const far = parseElectrodesTsv(tsv.replace(/-30/g, "900"), "e.tsv");
    const checked = checkElectrodes(far, vol);
    expect(checked.registered).toBe(false);
    expect(checked.provenance.notes.at(-1)).toMatch(/Not displayed/);
  });
});
