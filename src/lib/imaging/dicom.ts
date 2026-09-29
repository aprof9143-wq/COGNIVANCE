/**
 * DICOM → patient-space volume.
 *
 * Parsing is delegated to dicom-parser; everything that decides what a pixel
 * *means* is here and is tested: pixel decoding (bits stored, sign, byte
 * order, RLE), the modality LUT, window tags, photometric interpretation, and
 * the geometry that turns a stack of instances into one volume.
 *
 * Identifying tags are never copied. The reader only records which of them
 * were present, so the UI can say the data is not anonymised.
 */

import * as dicomParser from "dicom-parser";
import {
  affineFromDicom,
  cross,
  dot,
  invert,
  normalize,
  planeFromNormal,
  scale,
  sub,
  norm,
} from "./geometry";
import {
  ImagingError,
  type ImageMetadata,
  type ImageVolume,
  type Vec3,
  type VoiFunction,
  type VoiWindow,
} from "./types";

/* ------------------------------------------------------ transfer syntax */

export const TRANSFER_SYNTAXES: Record<string, { name: string; supported: boolean }> = {
  "1.2.840.10008.1.2": { name: "Implicit VR Little Endian", supported: true },
  "1.2.840.10008.1.2.1": { name: "Explicit VR Little Endian", supported: true },
  "1.2.840.10008.1.2.2": { name: "Explicit VR Big Endian (retired)", supported: true },
  "1.2.840.10008.1.2.5": { name: "RLE Lossless", supported: true },
  "1.2.840.10008.1.2.1.99": { name: "Deflated Explicit VR Little Endian", supported: false },
  "1.2.840.10008.1.2.4.50": { name: "JPEG Baseline (Process 1)", supported: false },
  "1.2.840.10008.1.2.4.51": { name: "JPEG Extended (Process 2 & 4)", supported: false },
  "1.2.840.10008.1.2.4.57": { name: "JPEG Lossless (Process 14)", supported: false },
  "1.2.840.10008.1.2.4.70": { name: "JPEG Lossless SV1", supported: false },
  "1.2.840.10008.1.2.4.80": { name: "JPEG-LS Lossless", supported: false },
  "1.2.840.10008.1.2.4.81": { name: "JPEG-LS Near-Lossless", supported: false },
  "1.2.840.10008.1.2.4.90": { name: "JPEG 2000 Lossless", supported: false },
  "1.2.840.10008.1.2.4.91": { name: "JPEG 2000", supported: false },
  "1.2.840.10008.1.2.4.201": { name: "HTJ2K Lossless", supported: false },
  "1.2.840.10008.1.2.4.202": { name: "HTJ2K Lossless RPCL", supported: false },
  "1.2.840.10008.1.2.4.203": { name: "HTJ2K", supported: false },
};

const RLE = "1.2.840.10008.1.2.5";
const BIG_ENDIAN = "1.2.840.10008.1.2.2";

/** Identifying attributes: recorded as present/absent, never read into memory. */
const PHI_TAGS: Record<string, string> = {
  x00100010: "Patient's Name",
  x00100020: "Patient ID",
  x00100030: "Patient's Birth Date",
  x00101000: "Other Patient IDs",
  x00101001: "Other Patient Names",
  x00101040: "Patient's Address",
  x00102154: "Patient's Telephone Numbers",
  x00080050: "Accession Number",
  x00080080: "Institution Name",
  x00080081: "Institution Address",
  x00080090: "Referring Physician's Name",
  x00081050: "Performing Physician's Name",
  x00081070: "Operators' Name",
  x00081010: "Station Name",
  x00200010: "Study ID",
};

/* ------------------------------------------------------------ instances */

export type DicomFrame = {
  ipp: Vec3 | null;
  slope: number;
  intercept: number;
  window: { center: number; width: number } | null;
  pixels: Int16Array | Uint16Array | Uint8Array | Int32Array | Float32Array;
};

export type DicomInstance = {
  seriesUid: string;
  sopInstanceUid: string;
  instanceNumber: number | null;
  rows: number;
  columns: number;
  iop: [number, number, number, number, number, number] | null;
  pixelSpacing: [number, number] | null;
  frames: DicomFrame[];
  photometric: "MONOCHROME1" | "MONOCHROME2";
  windows: VoiWindow[];
  voiFunction: VoiFunction;
  meta: Omit<ImageMetadata, "acquisitionPlane" | "frames" | "instances" | "format">;
  warnings: string[];
};

const str = (ds: dicomParser.DataSet, tag: string) => {
  const v = ds.string(tag);
  return v && v.trim() ? v.trim() : null;
};
const num = (ds: dicomParser.DataSet, tag: string, index = 0) => {
  const v = ds.floatString(tag, index);
  return v !== undefined && Number.isFinite(v) ? v : null;
};
const multi = (ds: dicomParser.DataSet, tag: string): number[] => {
  const raw = ds.string(tag);
  if (!raw) return [];
  return raw
    .split("\\")
    .map((s) => Number.parseFloat(s))
    .filter((v) => Number.isFinite(v));
};

/** First item's dataset of a sequence, if present. */
function item(ds: dicomParser.DataSet | undefined, tag: string): dicomParser.DataSet | undefined {
  return ds?.elements[tag]?.items?.[0]?.dataSet;
}

/** dicom-parser throws strings, Errors, or {exception, dataSet} objects. */
function parseFailure(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "exception" in e)
    return String((e as { exception: unknown }).exception);
  return "unknown parse failure";
}

function parseBytes(bytes: Uint8Array): dicomParser.DataSet {
  // Check the transfer syntax from the meta header before parsing the dataset:
  // for deflate, dicom-parser would otherwise try (and fail) to inflate first.
  let hasMeta = true;
  try {
    const meta = dicomParser.readPart10Header(bytes);
    const ts = meta.string("x00020010")?.trim();
    const info = ts ? TRANSFER_SYNTAXES[ts] : undefined;
    if (ts && info && !info.supported) {
      throw new ImagingError(
        "unsupported-transfer-syntax",
        `${info.name} (${ts}) is not decoded in this viewer. Convert to an uncompressed transfer syntax (e.g. dcmdjpeg, gdcmconv --raw) and load again.`,
      );
    }
  } catch (e) {
    if (e instanceof ImagingError) throw e;
    hasMeta = false;
  }
  if (hasMeta) {
    try {
      return dicomParser.parseDicom(bytes);
    } catch (e) {
      throw new ImagingError(
        "malformed",
        `Not a readable DICOM file (${parseFailure(e).replace(/^dicomParser\.\w+: /, "")}).`,
      );
    }
  }
  // No Part 10 preamble: a bare dataset. Try explicit, then implicit VR little
  // endian, and keep whichever finds pixel data.
  for (const ts of ["1.2.840.10008.1.2.1", "1.2.840.10008.1.2"]) {
    try {
      const ds = dicomParser.parseDicom(bytes, { TransferSyntaxUID: ts });
      if (ds.elements["x7fe00010"]) return ds;
    } catch {
      // try the next syntax
    }
  }
  throw new ImagingError(
    "malformed",
    "Not a readable DICOM file (no Part 10 header, and not a bare dataset with pixel data).",
  );
}

/** Parse one DICOM file into stored-value frames plus descriptive metadata. */
export function parseDicomInstance(buffer: ArrayBuffer): DicomInstance {
  const bytes = new Uint8Array(buffer);
  const ds = parseBytes(bytes);
  const warnings: string[] = [];

  const ts = str(ds, "x00020010") ?? "1.2.840.10008.1.2";
  const tsInfo = TRANSFER_SYNTAXES[ts];
  if (tsInfo && !tsInfo.supported) {
    throw new ImagingError(
      "unsupported-transfer-syntax",
      `${tsInfo.name} (${ts}) is not decoded in this viewer. Convert to an uncompressed transfer syntax (e.g. dcmdjpeg, gdcmconv --raw) and load again.`,
    );
  }
  if (!tsInfo) {
    throw new ImagingError(
      "unsupported-transfer-syntax",
      `Unknown transfer syntax ${ts}; refusing to guess how the pixels are encoded.`,
    );
  }

  const pixelEl = ds.elements["x7fe00010"];
  if (!pixelEl) {
    if (ds.elements["x7fe00008"] || ds.elements["x7fe00009"]) {
      throw new ImagingError(
        "unsupported-image",
        "Float or double pixel data is not supported in this viewer.",
      );
    }
    throw new ImagingError(
      "unsupported-image",
      "The file has no pixel data (it may be a report, presentation state or structured document).",
    );
  }

  const rows = ds.uint16("x00280010") ?? 0;
  const columns = ds.uint16("x00280011") ?? 0;
  const samples = ds.uint16("x00280002") ?? 1;
  const bitsAllocated = ds.uint16("x00280100") ?? 0;
  const bitsStored = ds.uint16("x00280101") ?? bitsAllocated;
  const pixelRepresentation = ds.uint16("x00280103") ?? 0;
  const photometricRaw = (str(ds, "x00280004") ?? "MONOCHROME2").toUpperCase();
  const nFrames = Math.max(1, ds.intString("x00280008") ?? 1);

  if (!rows || !columns) throw new ImagingError("malformed", "Rows or Columns is missing or zero.");
  if (samples !== 1 || (photometricRaw !== "MONOCHROME1" && photometricRaw !== "MONOCHROME2")) {
    throw new ImagingError(
      "unsupported-image",
      `Photometric interpretation ${photometricRaw} with ${samples} sample(s) per pixel is not a grayscale image; this viewer shows MONOCHROME1/2 only.`,
    );
  }
  if (![8, 16, 32].includes(bitsAllocated)) {
    throw new ImagingError(
      "unsupported-image",
      `Bits Allocated ${bitsAllocated} is not supported.`,
    );
  }

  // -- functional groups (enhanced multi-frame) and classic tags --------------
  const shared = item(ds, "x52009229");
  const perFrame = ds.elements["x52009230"]?.items ?? [];
  const fg = (frame: number, seq: string): dicomParser.DataSet | undefined =>
    item(perFrame[frame]?.dataSet, seq) ?? item(shared, seq);

  const iopDs = item(shared, "x00209116") ?? item(perFrame[0]?.dataSet, "x00209116") ?? ds;
  const iopValues = multi(iopDs, "x00200037");
  const iop =
    iopValues.length === 6 ? (iopValues as [number, number, number, number, number, number]) : null;

  const measures = item(shared, "x00289110") ?? item(perFrame[0]?.dataSet, "x00289110") ?? ds;
  const ps = multi(measures, "x00280030");
  const pixelSpacing: [number, number] | null =
    ps.length === 2 && ps[0]! > 0 && ps[1]! > 0 ? [ps[0]!, ps[1]!] : null;
  const sliceThickness = num(measures, "x00180050") ?? num(ds, "x00180050");
  const spacingBetweenSlices = num(measures, "x00180088") ?? num(ds, "x00180088");

  const modality = str(ds, "x00080060");
  const baseSlope = num(ds, "x00281053") ?? 1;
  const baseIntercept = num(ds, "x00281052") ?? 0;
  const rescaleType = str(ds, "x00281054");

  // Windows: Window Center/Width can be multi-valued, with explanations.
  const centers = multi(ds, "x00281050");
  const widths = multi(ds, "x00281051");
  const explanations = (ds.string("x00281055") ?? "").split("\\");
  const windows: VoiWindow[] = [];
  for (let i = 0; i < Math.min(centers.length, widths.length); i++) {
    if (widths[i]! > 0) {
      windows.push({
        center: centers[i]!,
        width: widths[i]!,
        source: "dicom",
        label: explanations[i]?.trim()
          ? `File: ${explanations[i]!.trim()}`
          : `File window ${i + 1}`,
      });
    }
  }
  const fnRaw = (str(ds, "x00281056") ?? "LINEAR").toUpperCase();
  const voiFunction: VoiFunction =
    fnRaw === "SIGMOID" || fnRaw === "LINEAR_EXACT" ? fnRaw : "LINEAR";

  if (ds.elements["x00283010"])
    warnings.push("VOI LUT Sequence present — not applied; window values are used instead.");
  if (ds.elements["x00283000"])
    warnings.push("Modality LUT Sequence present — not applied; the linear rescale is used.");
  if (ds.elements["x00409096"])
    warnings.push(
      "Real World Value Mapping present — not applied; values are shown as stored and rescaled.",
    );

  // -- pixels -----------------------------------------------------------------
  const frameLength = rows * columns;
  const frames: DicomFrame[] = [];
  const classicIpp = multi(ds, "x00200032");
  for (let f = 0; f < nFrames; f++) {
    const pos = fg(f, "x00209113");
    const ippValues = pos ? multi(pos, "x00200032") : f === 0 ? classicIpp : [];
    const pvt = fg(f, "x00289145");
    const fvoi = fg(f, "x00289132");
    const wc = fvoi ? num(fvoi, "x00281050") : null;
    const ww = fvoi ? num(fvoi, "x00281051") : null;
    frames.push({
      ipp: ippValues.length === 3 ? (ippValues as Vec3) : null,
      slope: (pvt ? num(pvt, "x00281053") : null) ?? baseSlope,
      intercept: (pvt ? num(pvt, "x00281052") : null) ?? baseIntercept,
      window: wc !== null && ww !== null && ww > 0 ? { center: wc, width: ww } : null,
      pixels: decodeFrame(
        ds,
        pixelEl,
        f,
        nFrames,
        frameLength,
        bitsAllocated,
        bitsStored,
        pixelRepresentation,
        ts,
      ),
    });
  }
  if (!windows.length && frames[0]?.window) {
    windows.push({ ...frames[0].window, source: "dicom", label: "File: frame VOI" });
  }

  // Multi-frame without per-frame positions: positions from the spacing, if declared.
  if (nFrames > 1 && frames.slice(1).every((fr) => fr.ipp === null) && frames[0]!.ipp && iop) {
    const step = spacingBetweenSlices ?? null;
    if (step) {
      const n = normalize(cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]));
      frames.forEach((fr, k) => {
        fr.ipp = [
          frames[0]!.ipp![0] + n[0] * step * k,
          frames[0]!.ipp![1] + n[1] * step * k,
          frames[0]!.ipp![2] + n[2] * step * k,
        ];
      });
      warnings.push(
        "Frame positions derived from Spacing Between Slices (no per-frame Image Position).",
      );
    }
  }

  const phiTagsPresent = Object.entries(PHI_TAGS)
    .filter(([tag]) => {
      const el = ds.elements[tag];
      return el && el.length > 0 && (ds.string(tag) ?? "").trim() !== "";
    })
    .map(([, name]) => name);

  const acquisitionDate = str(ds, "x00080022") ?? str(ds, "x00080020");
  return {
    seriesUid: str(ds, "x0020000e") ?? "unknown-series",
    sopInstanceUid: str(ds, "x00080018") ?? `instance-${Math.random().toString(36).slice(2)}`,
    instanceNumber: ds.intString("x00200013") ?? null,
    rows,
    columns,
    iop,
    pixelSpacing,
    frames,
    photometric: photometricRaw as "MONOCHROME1" | "MONOCHROME2",
    windows,
    voiFunction,
    warnings,
    meta: {
      modality,
      seriesDescription: str(ds, "x0008103e"),
      protocolName: str(ds, "x00181030"),
      scanningSequence: str(ds, "x00180020"),
      sequenceVariant: str(ds, "x00180021"),
      mrAcquisitionType: str(ds, "x00180023"),
      magneticFieldStrength: num(ds, "x00180087"),
      manufacturer: str(ds, "x00080070"),
      model: str(ds, "x00081090"),
      // Dates are kept at month precision only.
      acquisitionDate: acquisitionDate
        ? `${acquisitionDate.slice(0, 4)}-${acquisitionDate.slice(4, 6)}`
        : null,
      bodyPart: str(ds, "x00180015"),
      transferSyntaxUid: ts,
      photometricInterpretation: photometricRaw,
      bitsAllocated,
      bitsStored,
      pixelRepresentation,
      rescaleSlope: baseSlope,
      rescaleIntercept: baseIntercept,
      rescaleType,
      sliceThickness,
      spacingBetweenSlices,
      phiTagsPresent,
    },
  };
}

/* ------------------------------------------------------------ pixel decode */

function decodeFrame(
  ds: dicomParser.DataSet,
  el: dicomParser.Element,
  frame: number,
  nFrames: number,
  n: number,
  bitsAllocated: number,
  bitsStored: number,
  pixelRepresentation: number,
  ts: string,
): DicomFrame["pixels"] {
  const bytesPer = bitsAllocated / 8;
  let raw: Uint8Array;
  let littleEndian = ts !== BIG_ENDIAN;

  if (ts === RLE) {
    if (!el.encapsulatedPixelData)
      throw new ImagingError("malformed", "RLE transfer syntax without encapsulated pixel data.");
    let fragment: Uint8Array;
    try {
      const fragments = el.fragments ?? [];
      fragment =
        el.basicOffsetTable && el.basicOffsetTable.length
          ? (dicomParser.readEncapsulatedImageFrame(ds, el, frame) as Uint8Array)
          : fragments.length === nFrames
            ? (dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, frame, 1) as Uint8Array)
            : (dicomParser.readEncapsulatedPixelDataFromFragments(
                ds,
                el,
                0,
                fragments.length,
              ) as Uint8Array);
    } catch (e) {
      throw new ImagingError(
        "malformed",
        `Could not read RLE fragment for frame ${frame + 1}: ${String(e)}`,
      );
    }
    raw = decodeRle(fragment, n, bytesPer);
    littleEndian = true; // decodeRle assembles native little-endian samples
  } else {
    const start = el.dataOffset + frame * n * bytesPer;
    if (start + n * bytesPer > ds.byteArray.length) {
      throw new ImagingError("malformed", `Pixel data is truncated at frame ${frame + 1}.`);
    }
    raw = ds.byteArray.subarray(start, start + n * bytesPer) as Uint8Array;
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const signed = pixelRepresentation === 1;
  // Bits Stored below Bits Allocated: mask off the unused high bits (which can
  // carry overlays in older data), then sign-extend from the stored width.
  const mask = bitsStored >= 32 ? 0xffffffff : (1 << bitsStored) - 1;
  const signBit = bitsStored >= 32 ? 0 : 1 << (bitsStored - 1);
  const fix = (v: number) => {
    if (bitsStored >= bitsAllocated) return v;
    let u = v & mask;
    if (signed && u & signBit) u -= 1 << bitsStored;
    return u;
  };

  if (bitsAllocated === 8) {
    if (signed) {
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = fix(view.getInt8(i));
      return out;
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = fix(view.getUint8(i));
    return out;
  }
  if (bitsAllocated === 16) {
    if (signed) {
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++)
        out[i] = fix(
          bitsStored < 16
            ? view.getUint16(i * 2, littleEndian)
            : view.getInt16(i * 2, littleEndian),
        );
      return out;
    }
    const out = new Uint16Array(n);
    for (let i = 0; i < n; i++) out[i] = fix(view.getUint16(i * 2, littleEndian));
    return out;
  }
  if (signed) {
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getInt32(i * 4, littleEndian);
    return out;
  }
  // Unsigned 32-bit does not fit Int32; widen to float to keep every value.
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getUint32(i * 4, littleEndian);
  return out;
}

/**
 * RLE Lossless (PS3.5 Annex G): a 64-byte header of segment offsets, then one
 * PackBits segment per byte plane, most significant plane first. Returns the
 * samples as little-endian bytes.
 */
export function decodeRle(fragment: Uint8Array, n: number, bytesPer: number): Uint8Array {
  const view = new DataView(fragment.buffer, fragment.byteOffset, fragment.byteLength);
  if (fragment.byteLength < 64)
    throw new ImagingError("malformed", "RLE fragment is shorter than its header.");
  const segments = view.getUint32(0, true);
  if (segments !== bytesPer) {
    throw new ImagingError(
      "malformed",
      `RLE frame has ${segments} segments; expected ${bytesPer} for this bit depth.`,
    );
  }
  const out = new Uint8Array(n * bytesPer);
  for (let s = 0; s < segments; s++) {
    const start = view.getUint32(4 + s * 4, true);
    const end = s + 1 < segments ? view.getUint32(8 + s * 4, true) : fragment.byteLength;
    // Segment s holds byte plane s, most significant first; write it into the
    // little-endian position (bytesPer − 1 − s) of each sample.
    const plane = bytesPer - 1 - s;
    let p = start;
    let i = 0;
    while (p < end && i < n) {
      const control = (fragment[p++]! << 24) >> 24; // as int8
      if (control >= 0) {
        for (let k = 0; k <= control && i < n; k++) out[i++ * bytesPer + plane] = fragment[p++]!;
      } else if (control !== -128) {
        const value = fragment[p++]!;
        for (let k = 0; k < 1 - control && i < n; k++) out[i++ * bytesPer + plane] = value;
      }
    }
    if (i < n)
      throw new ImagingError("malformed", `RLE segment ${s + 1} decoded ${i} of ${n} samples.`);
  }
  return out;
}

/* ------------------------------------------------------------ series → volume */

/** Group instances by series. */
export function groupSeries(instances: DicomInstance[]): Map<string, DicomInstance[]> {
  const out = new Map<string, DicomInstance[]>();
  for (const inst of instances) {
    const list = out.get(inst.seriesUid) ?? [];
    list.push(inst);
    out.set(inst.seriesUid, list);
  }
  return out;
}

const close = (a: number[], b: number[], tol: number) =>
  a.every((v, i) => Math.abs(v - b[i]!) <= tol);

/**
 * Build one patient-space volume from the instances of a single series.
 * Frames are sorted by their position along the slice normal — never by
 * Instance Number, which does not have to follow anatomy.
 */
export function buildVolume(instances: DicomInstance[], name: string): ImageVolume {
  if (!instances.length) throw new ImagingError("empty", "No images in the series.");
  const first = instances[0]!;
  const warnings = [...new Set(instances.flatMap((i) => i.warnings))];

  for (const inst of instances) {
    if (inst.rows !== first.rows || inst.columns !== first.columns) {
      throw new ImagingError(
        "inconsistent-series",
        `Images in the series differ in size (${first.columns}×${first.rows} vs ${inst.columns}×${inst.rows}).`,
      );
    }
    if (inst.photometric !== first.photometric) {
      throw new ImagingError(
        "inconsistent-series",
        "Images in the series mix MONOCHROME1 and MONOCHROME2.",
      );
    }
  }
  if (!first.iop) {
    throw new ImagingError(
      "missing-geometry",
      "Image Orientation (Patient) is missing, so the images cannot be placed in patient space.",
    );
  }
  if (!first.pixelSpacing) {
    throw new ImagingError(
      "missing-geometry",
      "Pixel Spacing is missing, so physical sizes and measurements would be wrong.",
    );
  }
  for (const inst of instances) {
    if (!inst.iop || !close(inst.iop, first.iop, 1e-3)) {
      throw new ImagingError(
        "inconsistent-series",
        "Images in the series have different orientations; they are not one volume.",
      );
    }
    if (!inst.pixelSpacing || !close(inst.pixelSpacing, first.pixelSpacing, 1e-4)) {
      throw new ImagingError(
        "inconsistent-series",
        "Images in the series have different pixel spacing.",
      );
    }
  }

  const iop = first.iop;
  const normal = normalize(cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]));
  type Slice = { frame: DicomFrame; t: number };
  const slices: Slice[] = [];
  for (const inst of instances) {
    for (const fr of inst.frames) {
      if (!fr.ipp) {
        throw new ImagingError(
          "missing-geometry",
          "Image Position (Patient) is missing for at least one image, so slices cannot be ordered in space.",
        );
      }
      slices.push({ frame: fr, t: dot(fr.ipp, normal) });
    }
  }
  slices.sort((a, b) => a.t - b.t);

  // Duplicate positions: several echoes/phases/acquisitions in one series.
  const unique: Slice[] = [];
  for (const s of slices) {
    const prev = unique[unique.length - 1];
    if (prev && Math.abs(prev.t - s.t) < 1e-3) continue;
    unique.push(s);
  }
  if (unique.length < slices.length) {
    warnings.push(
      `${slices.length - unique.length} image(s) share a position with another (multiple echoes, phases or acquisitions?). The first at each position is shown.`,
    );
  }

  const nz = unique.length;
  let step: Vec3 = scale(normal, first.meta.spacingBetweenSlices ?? first.meta.sliceThickness ?? 1);
  if (nz > 1) {
    const a = unique[0]!.frame.ipp!;
    const b = unique[nz - 1]!.frame.ipp!;
    // Full vector, not just its normal component: a CT gantry tilt shears the
    // stack, and dropping the in-plane component would straighten it wrongly.
    step = scale(sub(b, a), 1 / (nz - 1));
    const gaps = unique.slice(1).map((s, i) => s.t - unique[i]!.t);
    const lo = Math.min(...gaps);
    const hi = Math.max(...gaps);
    const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    if (hi - lo > 0.01 * mean + 1e-3) {
      warnings.push(
        `Slice spacing varies from ${lo.toFixed(3)} to ${hi.toFixed(3)} mm; reformatted views assume the mean (${mean.toFixed(3)} mm) and may be distorted.`,
      );
    }
    // Positions should lie on one line; if not, a single affine cannot hold them.
    let worst = 0;
    unique.forEach((s, k) => {
      const expected: Vec3 = [a[0] + step[0] * k, a[1] + step[1] * k, a[2] + step[2] * k];
      worst = Math.max(worst, norm(sub(s.frame.ipp!, expected)));
    });
    if (worst > 0.1 * Math.max(1e-3, norm(step)) + 0.05) {
      warnings.push(
        `Slice positions deviate from a straight stack by up to ${worst.toFixed(2)} mm.`,
      );
    }
  }

  const ijkToLps = affineFromDicom(unique[0]!.frame.ipp!, iop, first.pixelSpacing, step);
  const lpsToIjk = invert(ijkToLps);

  // Values: keep stored integers and one shared rescale when every frame uses
  // the same one; otherwise materialise modality values per frame as float.
  const perSlice = first.rows * first.columns;
  const slopes = unique.map((s) => s.frame.slope);
  const intercepts = unique.map((s) => s.frame.intercept);
  const uniformRescale =
    slopes.every((v) => v === slopes[0]) && intercepts.every((v) => v === intercepts[0]);
  const sample = unique[0]!.frame.pixels;
  let data: ImageVolume["data"];
  let valueScale: ImageVolume["valueScale"] = null;
  if (uniformRescale) {
    const Ctor = sample.constructor as
      | Int16ArrayConstructor
      | Uint16ArrayConstructor
      | Uint8ArrayConstructor
      | Int32ArrayConstructor
      | Float32ArrayConstructor;
    data = new Ctor(perSlice * nz);
    unique.forEach((s, k) => data.set(s.frame.pixels, k * perSlice));
    if (slopes[0] !== 1 || intercepts[0] !== 0)
      valueScale = { slope: slopes[0]!, intercept: intercepts[0]! };
  } else {
    const f = new Float32Array(perSlice * nz);
    unique.forEach((s, k) => {
      const px = s.frame.pixels;
      for (let i = 0; i < perSlice; i++)
        f[k * perSlice + i] = px[i]! * s.frame.slope + s.frame.intercept;
    });
    data = f;
    warnings.push(
      "Rescale slope/intercept differ between frames; modality values were computed per frame.",
    );
  }

  let min = Infinity;
  let max = -Infinity;
  const sc = valueScale;
  for (let i = 0; i < data.length; i++) {
    const v = sc ? data[i]! * sc.slope + sc.intercept : data[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const modality = first.meta.modality;
  const hu =
    modality === "CT" &&
    (first.meta.rescaleType === null || first.meta.rescaleType.toUpperCase() === "HU");
  const spacing: Vec3 = [
    first.pixelSpacing[1],
    first.pixelSpacing[0],
    nz > 1 ? norm(step) : (first.meta.sliceThickness ?? 1),
  ];

  return {
    id: first.seriesUid,
    name,
    dims: [first.columns, first.rows, nz],
    spacing,
    ijkToLps,
    lpsToIjk,
    data,
    valueScale,
    unit: hu ? "HU" : modality === "MR" ? "signal intensity (a.u.)" : "stored value (a.u.)",
    quantitative: hu,
    photometric: first.photometric,
    windows: first.windows,
    voiFunction: first.voiFunction,
    range: { min, max },
    warnings,
    metadata: {
      ...first.meta,
      format: "dicom",
      acquisitionPlane: planeFromNormal(normal),
      frames: slices.length,
      instances: instances.length,
    },
  };
}
