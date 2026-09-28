import { describe, expect, it } from "vitest";
import { buildVolume, decodeRle, groupSeries, parseDicomInstance } from "./dicom";
import { apply } from "./geometry";
import { voxelValue } from "./reslice";
import {
  encodeRle,
  samples16,
  sliceElements,
  writeDicom,
  type DicomElement,
} from "./testing/fixtures";
import { ImagingError } from "./types";

const R = 3;
const C = 4;

/** A slice whose every pixel encodes (slice, row, column) so ordering errors show. */
function slicePixels(k: number): number[] {
  return Array.from({ length: R * C }, (_, idx) => 1000 * k + 10 * Math.floor(idx / C) + (idx % C));
}

function mrSlice(
  k: number,
  z: number,
  extra: DicomElement[] = [],
  opts: Parameters<typeof writeDicom>[1] = {},
) {
  return writeDicom(
    [
      ...sliceElements({
        rows: R,
        columns: C,
        ipp: [-10, -20, z],
        spacing: [0.8, 0.6],
        instance: `1.2.3.${k}`,
        extra,
      }),
      {
        tag: [0x7fe0, 0x0010],
        vr: "OW",
        value: samples16(slicePixels(k), opts.syntax !== "explicit-be"),
      },
    ],
    opts,
  );
}

describe("series → volume", () => {
  it("sorts slices by position along the normal, not by file order", () => {
    // Slice k sits at z = 5 + 2.5k; files are given shuffled.
    const files = [2, 0, 3, 1].map((k) => mrSlice(k, 5 + 2.5 * k));
    const vol = buildVolume(files.map(parseDicomInstance), "test");
    expect(vol.dims).toEqual([C, R, 4]);
    for (let k = 0; k < 4; k++) expect(voxelValue(vol, 0, 0, k)).toBe(1000 * k);
    expect(voxelValue(vol, 3, 2, 1)).toBe(1000 + 20 + 3);
  });

  it("places voxels in patient space with column spacing along i and row spacing along j", () => {
    const vol = buildVolume(
      [0, 1, 2].map((k) => parseDicomInstance(mrSlice(k, 5 + 2.5 * k))),
      "t",
    );
    expect(apply(vol.ijkToLps, [0, 0, 0])).toEqual([-10, -20, 5]);
    const p = apply(vol.ijkToLps, [2, 1, 2]);
    expect(p[0]).toBeCloseTo(-10 + 2 * 0.6, 9);
    expect(p[1]).toBeCloseTo(-20 + 1 * 0.8, 9);
    expect(p[2]).toBeCloseTo(10, 9);
    expect(vol.spacing[0]).toBeCloseTo(0.6, 9);
    expect(vol.spacing[1]).toBeCloseTo(0.8, 9);
    expect(vol.spacing[2]).toBeCloseTo(2.5, 9);
    expect(vol.metadata.acquisitionPlane).toBe("axial");
    expect(vol.unit).toBe("signal intensity (a.u.)");
    expect(vol.quantitative).toBe(false);
  });

  it("applies the modality LUT and labels calibrated CT as HU", () => {
    const extra: DicomElement[] = [
      { tag: [0x0028, 0x1052], vr: "DS", value: "-1024" },
      { tag: [0x0028, 0x1053], vr: "DS", value: "1" },
      { tag: [0x0028, 0x1050], vr: "DS", value: "40\\600" },
      { tag: [0x0028, 0x1051], vr: "DS", value: "80\\2800" },
      { tag: [0x0028, 0x1055], vr: "LO", value: "BRAIN\\BONE" },
    ];
    const file = writeDicom([
      ...sliceElements({ rows: 1, columns: 2, ipp: [0, 0, 0], modality: "CT", extra }),
      { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16([1000, 1064]) },
    ]);
    const vol = buildVolume([parseDicomInstance(file)], "ct");
    expect(voxelValue(vol, 0, 0, 0)).toBe(-24);
    expect(voxelValue(vol, 1, 0, 0)).toBe(40);
    expect(vol.unit).toBe("HU");
    expect(vol.quantitative).toBe(true);
    expect(vol.windows.map((w) => [w.center, w.width, w.label])).toEqual([
      [40, 80, "File: BRAIN"],
      [600, 2800, "File: BONE"],
    ]);
    // Stored values are kept; the rescale is carried alongside, not baked in.
    expect(vol.valueScale).toEqual({ slope: 1, intercept: -1024 });
    expect(vol.data).toBeInstanceOf(Uint16Array);
  });

  it("preserves MONOCHROME1", () => {
    const file = writeDicom([
      ...sliceElements({ rows: 1, columns: 1, ipp: [0, 0, 0], photometric: "MONOCHROME1" }),
      { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16([5]) },
    ]);
    expect(buildVolume([parseDicomInstance(file)], "m1").photometric).toBe("MONOCHROME1");
  });

  it("masks unused high bits and sign-extends from Bits Stored", () => {
    // 12 bits stored, signed: 0x0FFF is −1; the 0xF000 bits are garbage (overlay).
    const file = writeDicom([
      ...sliceElements({
        rows: 1,
        columns: 3,
        ipp: [0, 0, 0],
        bits: { allocated: 16, stored: 12, signed: true },
      }),
      { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16([0xffff, 0xf7ff, 0x0005]) },
    ]);
    const inst = parseDicomInstance(file);
    expect(Array.from(inst.frames[0]!.pixels)).toEqual([-1, 2047, 5]);
  });

  it("decodes big-endian and implicit little-endian pixel data identically", () => {
    const be = buildVolume(
      [0, 1].map((k) => parseDicomInstance(mrSlice(k, k, [], { syntax: "explicit-be" }))),
      "be",
    );
    const im = buildVolume(
      [0, 1].map((k) => parseDicomInstance(mrSlice(k, k, [], { syntax: "implicit-le" }))),
      "im",
    );
    expect(Array.from(be.data)).toEqual(Array.from(im.data));
    expect(voxelValue(be, 2, 1, 1)).toBe(1012);
  });

  it("decodes RLE Lossless, 16-bit signed", () => {
    const values = [-5, -5, -5, -5, 1, 2, 3, 300, 300, 300, 300, -32768];
    const unsigned = values.map((v) => v & 0xffff);
    const file = writeDicom(
      sliceElements({
        rows: R,
        columns: C,
        ipp: [0, 0, 0],
        bits: { allocated: 16, stored: 16, signed: true },
      }),
      {
        transferSyntaxUid: "1.2.840.10008.1.2.5",
        encapsulatedFrames: [encodeRle(unsigned, 2)],
      },
    );
    expect(Array.from(parseDicomInstance(file).frames[0]!.pixels)).toEqual(values);
  });

  it("RLE decoder rejects a frame with the wrong segment count", () => {
    expect(() => decodeRle(encodeRle([1, 2, 3], 1), 3, 2)).toThrow(ImagingError);
  });

  it("reads enhanced multi-frame positions and per-frame rescale", () => {
    const frame = (z: number, slope: number): DicomElement[] => [
      {
        tag: [0x0020, 0x9113],
        vr: "SQ",
        items: [[{ tag: [0x0020, 0x0032], vr: "DS", value: `0\\0\\${z}` }]],
      },
      {
        tag: [0x0028, 0x9145],
        vr: "SQ",
        items: [
          [
            { tag: [0x0028, 0x1052], vr: "DS", value: "0" },
            { tag: [0x0028, 0x1053], vr: "DS", value: String(slope) },
          ],
        ],
      },
    ];
    const px = [...slicePixels(0), ...slicePixels(1)];
    const file = writeDicom([
      ...sliceElements({ rows: R, columns: C, ipp: null, iop: null, spacing: null }),
      { tag: [0x0028, 0x0008], vr: "IS", value: "2" },
      {
        tag: [0x5200, 0x9229],
        vr: "SQ",
        items: [
          [
            {
              tag: [0x0020, 0x9116],
              vr: "SQ",
              items: [[{ tag: [0x0020, 0x0037], vr: "DS", value: "1\\0\\0\\0\\1\\0" }]],
            },
            {
              tag: [0x0028, 0x9110],
              vr: "SQ",
              items: [[{ tag: [0x0028, 0x0030], vr: "DS", value: "1\\1" }]],
            },
          ],
        ],
      },
      // Frames stored top-down; the second frame is physically first.
      { tag: [0x5200, 0x9230], vr: "SQ", items: [frame(10, 1), frame(4, 2)] },
      { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16(px) },
    ]);
    const vol = buildVolume([parseDicomInstance(file)], "enh");
    expect(vol.dims[2]).toBe(2);
    // Frame 2 (z = 4, slope 2) comes first; its raw values are doubled.
    expect(voxelValue(vol, 1, 0, 0)).toBe(2 * 1001);
    expect(voxelValue(vol, 1, 0, 1)).toBe(1);
    expect(vol.data).toBeInstanceOf(Float32Array);
    expect(vol.warnings.some((w) => w.includes("per frame"))).toBe(true);
  });

  it("warns on non-uniform slice spacing", () => {
    const vol = buildVolume(
      [
        [0, 0],
        [1, 2],
        [2, 5],
      ].map(([k, z]) => parseDicomInstance(mrSlice(k!, z!))),
      "gap",
    );
    expect(vol.warnings.some((w) => w.startsWith("Slice spacing varies"))).toBe(true);
  });

  it("groups by series", () => {
    const a = parseDicomInstance(
      writeDicom([
        ...sliceElements({ rows: 1, columns: 1, ipp: [0, 0, 0], series: "1.1" }),
        { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16([1]) },
      ]),
    );
    const b = parseDicomInstance(
      writeDicom([
        ...sliceElements({ rows: 1, columns: 1, ipp: [0, 0, 0], series: "1.2" }),
        { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16([1]) },
      ]),
    );
    expect([...groupSeries([a, b]).keys()]).toEqual(["1.1", "1.2"]);
  });
});

describe("failure states", () => {
  it("names an unsupported transfer syntax", () => {
    const file = writeDicom(sliceElements({ rows: 1, columns: 1, ipp: [0, 0, 0] }), {
      transferSyntaxUid: "1.2.840.10008.1.2.4.50",
      encapsulatedFrames: [new Uint8Array([0xff, 0xd8])],
    });
    try {
      parseDicomInstance(file);
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(ImagingError);
      expect((e as ImagingError).kind).toBe("unsupported-transfer-syntax");
      expect((e as ImagingError).message).toContain("JPEG Baseline");
    }
  });

  it("rejects deflate by its UID before trying to inflate", () => {
    const file = writeDicom(sliceElements({ rows: 1, columns: 1, ipp: [0, 0, 0] }), {
      transferSyntaxUid: "1.2.840.10008.1.2.1.99",
    });
    expect(() => parseDicomInstance(file)).toThrow(/Deflated Explicit VR Little Endian/);
  });

  it("refuses to build a volume without orientation", () => {
    const file = writeDicom([
      ...sliceElements({ rows: 1, columns: 1, ipp: [0, 0, 0], iop: null }),
      { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16([1]) },
    ]);
    expect(() => buildVolume([parseDicomInstance(file)], "x")).toThrow(/Orientation/);
  });

  it("refuses to mix image sizes", () => {
    const a = parseDicomInstance(mrSlice(0, 0));
    const b = parseDicomInstance(
      writeDicom([
        ...sliceElements({ rows: 2, columns: 2, ipp: [0, 0, 1] }),
        { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16([1, 2, 3, 4]) },
      ]),
    );
    expect(() => buildVolume([a, b], "x")).toThrow(/differ in size/);
  });

  it("rejects bytes that are not DICOM", () => {
    expect(() => parseDicomInstance(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow(
      ImagingError,
    );
  });

  it("rejects colour images rather than showing them as grayscale", () => {
    const file = writeDicom([
      ...sliceElements({ rows: 1, columns: 1, ipp: [0, 0, 0], photometric: "RGB" }),
      { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16([1]) },
    ]);
    expect(() => parseDicomInstance(file)).toThrow(/not a grayscale/);
  });
});

describe("protected health information", () => {
  it("records that identifying tags exist without copying their values", () => {
    const file = writeDicom([
      ...sliceElements({ rows: 1, columns: 1, ipp: [0, 0, 0] }),
      { tag: [0x0010, 0x0010], vr: "PN", value: "DOE^JANE" },
      { tag: [0x0010, 0x0030], vr: "DA", value: "19400101" },
      { tag: [0x0008, 0x0022], vr: "DA", value: "20240317" },
      { tag: [0x7fe0, 0x0010], vr: "OW", value: samples16([1]) },
    ]);
    const vol = buildVolume([parseDicomInstance(file)], "phi");
    expect(vol.metadata.phiTagsPresent).toEqual(["Patient's Name", "Patient's Birth Date"]);
    const everything = JSON.stringify({ ...vol, data: null, ijkToLps: null, lpsToIjk: null });
    expect(everything).not.toContain("DOE");
    expect(everything).not.toContain("1940");
    // Acquisition date is kept at month precision only.
    expect(vol.metadata.acquisitionDate).toBe("2024-03");
  });
});
