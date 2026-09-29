/**
 * NIfTI-1 → patient-space volume, at native resolution with values untouched.
 *
 * Orientation follows the NIfTI-1 specification: the sform when sform_code > 0,
 * otherwise the qform when qform_code > 0, otherwise pixdim scaling only — in
 * which case the orientation is unknown and the volume says so. The resulting
 * RAS affine is converted to LPS (see geometry.ts).
 */

import {
  affineFromQuaternion,
  invert,
  mat4,
  rasToLps,
  axisVector,
  norm,
  cross,
  normalize,
  planeFromNormal,
} from "./geometry";
import {
  ImagingError,
  type ImageVolume,
  type Mat4,
  type SegmentClass,
  type SegmentationVolume,
  type Vec3,
} from "./types";

type Header = {
  little: boolean;
  dims: Vec3;
  frames: number;
  datatype: number;
  voxOffset: number;
  slope: number;
  intercept: number;
  pixdim: Vec3;
  rasAffine: Mat4;
  orientationSource: "sform" | "qform" | "none";
  unitScale: number;
  calMin: number;
  calMax: number;
};

const DATATYPES: Record<number, { bytes: number; label: string }> = {
  2: { bytes: 1, label: "uint8" },
  4: { bytes: 2, label: "int16" },
  8: { bytes: 4, label: "int32" },
  16: { bytes: 4, label: "float32" },
  64: { bytes: 8, label: "float64" },
  256: { bytes: 1, label: "int8" },
  512: { bytes: 2, label: "uint16" },
  768: { bytes: 4, label: "uint32" },
};

export function readNiftiHeader(buffer: ArrayBuffer): Header {
  const view = new DataView(buffer);
  if (view.byteLength < 348)
    throw new ImagingError("malformed", "File is too small to be a NIfTI-1 volume.");
  let little = view.getInt32(0, true) === 348;
  if (!little && view.getInt32(0, false) !== 348) {
    if (view.getInt32(0, true) === 540 || view.getInt32(0, false) === 540) {
      throw new ImagingError("unsupported-image", "NIfTI-2 is not supported; convert to NIfTI-1.");
    }
    throw new ImagingError("malformed", "Not a NIfTI-1 file — the header size field is wrong.");
  }
  little = view.getInt32(0, true) === 348;
  const i16 = (o: number) => view.getInt16(o, little);
  const f32 = (o: number) => view.getFloat32(o, little);

  const ndim = i16(40);
  const nx = i16(42);
  const ny = i16(44);
  const nz = Math.max(1, i16(46));
  const frames = ndim >= 4 ? Math.max(1, i16(48)) : 1;
  if (nx < 1 || ny < 1)
    throw new ImagingError("malformed", `Invalid dimensions ${nx}×${ny}×${nz}.`);
  const datatype = i16(70);
  if (!DATATYPES[datatype]) {
    throw new ImagingError(
      "unsupported-image",
      `NIfTI datatype code ${datatype} is not supported (complex/RGB volumes are not grayscale).`,
    );
  }
  const qfac = f32(76);
  const pixdim: Vec3 = [Math.abs(f32(80)) || 1, Math.abs(f32(84)) || 1, Math.abs(f32(88)) || 1];
  const voxOffset = Math.max(352, Math.round(f32(108)) || 352);
  const rawSlope = f32(112);
  const slope = Number.isFinite(rawSlope) && rawSlope !== 0 ? rawSlope : 1;
  const intercept = Number.isFinite(f32(116)) && rawSlope !== 0 ? f32(116) : 0;
  const xyztUnits = view.getUint8(123);
  const spatial = xyztUnits & 0x07;
  // 1 = metre, 2 = mm, 3 = micron. Unset (0) is treated as mm, the common case.
  const unitScale = spatial === 1 ? 1000 : spatial === 3 ? 0.001 : 1;
  const calMax = f32(124);
  const calMin = f32(128);
  const qformCode = i16(252);
  const sformCode = i16(254);

  let rasAffine: Mat4;
  let orientationSource: Header["orientationSource"];
  if (sformCode > 0) {
    const r = (o: number) => [f32(o), f32(o + 4), f32(o + 8), f32(o + 12)];
    rasAffine = mat4([...r(280), ...r(296), ...r(312), 0, 0, 0, 1]);
    orientationSource = "sform";
  } else if (qformCode > 0) {
    rasAffine = affineFromQuaternion(
      f32(256),
      f32(260),
      f32(264),
      f32(268),
      f32(272),
      f32(276),
      pixdim,
      qfac,
    );
    orientationSource = "qform";
  } else {
    // Method 1 of the spec: no orientation information at all.
    rasAffine = mat4([pixdim[0], 0, 0, 0, 0, pixdim[1], 0, 0, 0, 0, pixdim[2], 0, 0, 0, 0, 1]);
    orientationSource = "none";
  }
  if (unitScale !== 1) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) rasAffine[r * 4 + c]! *= unitScale;
  }

  return {
    little,
    dims: [nx, ny, nz],
    frames,
    datatype,
    voxOffset,
    slope,
    intercept,
    pixdim,
    rasAffine,
    orientationSource,
    unitScale,
    calMin,
    calMax,
  };
}

/** Read the first frame's values in their stored type. */
function readValues(buffer: ArrayBuffer, h: Header): ImageVolume["data"] {
  const n = h.dims[0] * h.dims[1] * h.dims[2];
  const { bytes } = DATATYPES[h.datatype]!;
  if (h.voxOffset + n * bytes > buffer.byteLength) {
    throw new ImagingError(
      "malformed",
      "File is truncated — the header describes more voxels than the file contains.",
    );
  }
  const view = new DataView(buffer, h.voxOffset);
  const L = h.little;
  switch (h.datatype) {
    case 2:
      return new Uint8Array(buffer, h.voxOffset, n).slice();
    case 256: {
      const o = new Int16Array(n);
      for (let i = 0; i < n; i++) o[i] = view.getInt8(i);
      return o;
    }
    case 4: {
      const o = new Int16Array(n);
      for (let i = 0; i < n; i++) o[i] = view.getInt16(i * 2, L);
      return o;
    }
    case 512: {
      const o = new Uint16Array(n);
      for (let i = 0; i < n; i++) o[i] = view.getUint16(i * 2, L);
      return o;
    }
    case 8: {
      const o = new Int32Array(n);
      for (let i = 0; i < n; i++) o[i] = view.getInt32(i * 4, L);
      return o;
    }
    case 768: {
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = view.getUint32(i * 4, L);
      return o;
    }
    case 16: {
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = view.getFloat32(i * 4, L);
      return o;
    }
    default: {
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = view.getFloat64(i * 8, L);
      return o;
    }
  }
}

export function parseNiftiImage(buffer: ArrayBuffer, name: string): ImageVolume {
  const h = readNiftiHeader(buffer);
  const data = readValues(buffer, h);
  const warnings: string[] = [];
  if (h.frames > 1) warnings.push(`4D file with ${h.frames} volumes; only the first is shown.`);
  if (h.orientationSource === "none") {
    warnings.push(
      "No sform or qform: orientation is unknown. Orientation markers and left/right are not reliable.",
    );
  }
  if (h.datatype === 64) warnings.push("float64 values were narrowed to float32 for display.");

  const ijkToLps = rasToLps(h.rasAffine);
  const lpsToIjk = invert(ijkToLps);
  const valueScale =
    h.slope !== 1 || h.intercept !== 0 ? { slope: h.slope, intercept: h.intercept } : null;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const raw = data[i]!;
    const v = valueScale ? raw * valueScale.slope + valueScale.intercept : raw;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min))
    throw new ImagingError("empty", "Volume contains no finite voxel values.");

  const spacing: Vec3 = [
    norm(axisVector(ijkToLps, 0)),
    norm(axisVector(ijkToLps, 1)),
    norm(axisVector(ijkToLps, 2)),
  ];
  const normal = normalize(cross(axisVector(ijkToLps, 0), axisVector(ijkToLps, 1)));
  const windows =
    Number.isFinite(h.calMin) && Number.isFinite(h.calMax) && h.calMax > h.calMin
      ? [
          {
            center: (h.calMin + h.calMax) / 2,
            width: h.calMax - h.calMin,
            source: "file" as const,
            label: "File: cal_min–cal_max",
          },
        ]
      : [];

  return {
    id: `nifti:${name}`,
    name,
    dims: h.dims,
    spacing,
    ijkToLps,
    lpsToIjk,
    data,
    valueScale,
    // NIfTI records no modality, so values cannot be called HU or anything calibrated.
    unit: "voxel value (a.u.)",
    quantitative: false,
    photometric: "MONOCHROME2",
    windows,
    voiFunction: "LINEAR",
    range: { min, max },
    warnings,
    metadata: {
      format: "nifti",
      modality: null,
      seriesDescription: null,
      protocolName: null,
      scanningSequence: null,
      sequenceVariant: null,
      mrAcquisitionType: null,
      magneticFieldStrength: null,
      manufacturer: null,
      model: null,
      acquisitionDate: null,
      bodyPart: null,
      transferSyntaxUid: null,
      photometricInterpretation: "MONOCHROME2",
      bitsAllocated: DATATYPES[h.datatype]!.bytes * 8,
      bitsStored: null,
      pixelRepresentation: null,
      rescaleSlope: h.slope,
      rescaleIntercept: h.intercept,
      rescaleType: null,
      sliceThickness: h.pixdim[2] * h.unitScale,
      spacingBetweenSlices: null,
      acquisitionPlane: h.orientationSource === "none" ? "unknown" : planeFromNormal(normal),
      frames: h.frames,
      instances: 1,
      phiTagsPresent: [],
    },
  };
}

/* ------------------------------------------------------------ label maps */

/** Okabe–Ito: distinguishable under the common colour-vision deficiencies. */
export const CLASS_PALETTE: [number, number, number][] = [
  [230, 159, 0],
  [86, 180, 233],
  [0, 158, 115],
  [240, 228, 66],
  [0, 114, 178],
  [213, 94, 0],
  [204, 121, 167],
];

/**
 * Label conventions the user can choose. None is assumed: an integer label map
 * does not say what its integers mean.
 */
export const LABEL_CONVENTIONS: Record<string, Record<number, string>> = {
  "BraTS 2021": {
    1: "Necrotic tumour core (NCR)",
    2: "Peritumoural oedema (ED)",
    4: "Enhancing tumour (ET)",
  },
  "BraTS 2023+": {
    1: "Necrotic tumour core (NCR)",
    2: "Peritumoural oedema (ED)",
    3: "Enhancing tumour (ET)",
  },
  "MSD Task01": { 1: "Oedema", 2: "Non-enhancing tumour", 3: "Enhancing tumour" },
};

/** Parse an integer label map at native resolution, in patient space. */
export function parseNiftiSegmentation(
  buffer: ArrayBuffer,
  name: string,
  names?: Record<number, string>,
  convention: string | null = null,
): SegmentationVolume {
  const h = readNiftiHeader(buffer);
  const values = readValues(buffer, h);
  const n = values.length;
  let maxLabel = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i]! * h.slope + h.intercept;
    if (v < 0 || Math.abs(v - Math.round(v)) > 1e-3) {
      throw new ImagingError(
        "unsupported-image",
        "Not a label map: it contains negative or non-integer values.",
      );
    }
    if (v > maxLabel) maxLabel = v;
  }
  if (maxLabel > 65535)
    throw new ImagingError("unsupported-image", "Label values above 65535 are not supported.");
  const labels = maxLabel > 255 ? new Uint16Array(n) : new Uint8Array(n);
  const present = new Set<number>();
  for (let i = 0; i < n; i++) {
    const v = Math.round(values[i]! * h.slope + h.intercept);
    labels[i] = v;
    if (v) present.add(v);
  }
  if (present.size > 256)
    throw new ImagingError(
      "unsupported-image",
      `${present.size} distinct labels — this looks like an intensity image, not a segmentation.`,
    );

  const ijkToLps = rasToLps(h.rasAffine);
  const classes: SegmentClass[] = [...present]
    .sort((a, b) => a - b)
    .map((label, i) => ({
      label,
      name: names?.[label] ?? `Label ${label}`,
      colour: CLASS_PALETTE[i % CLASS_PALETTE.length]!,
    }));
  return {
    id: `seg:${name}`,
    name,
    dims: h.dims,
    spacing: [
      norm(axisVector(ijkToLps, 0)),
      norm(axisVector(ijkToLps, 1)),
      norm(axisVector(ijkToLps, 2)),
    ],
    ijkToLps,
    lpsToIjk: invert(ijkToLps),
    labels,
    classes,
    mutuallyExclusive: true,
    convention,
    provenance: {
      source: name,
      method: "Loaded label map (NIfTI)",
      date: null,
      notes:
        h.orientationSource === "none"
          ? ["No sform/qform — placement in patient space is unreliable."]
          : [],
    },
  };
}
