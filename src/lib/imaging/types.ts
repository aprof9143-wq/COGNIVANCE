/**
 * Imaging data model.
 *
 * Four kinds of state are kept apart on purpose:
 *
 *   source        ImageVolume, SegmentationVolume — what the file said, values
 *                 untouched. Never mutated after load.
 *   presentation  VoiWindow, view geometry, enhancement settings — how it is
 *                 being looked at. Changing it never changes a source value.
 *   derived       histograms, reslices, 3D textures, measurements — computed
 *                 from source + presentation, always recomputable.
 *   annotations   user-drawn measurements and ROIs, stored in patient space.
 *
 * Coordinate system: every world coordinate in this module is DICOM patient
 * space, LPS, in millimetres — +x toward the patient's Left, +y toward
 * Posterior, +z toward Superior. See geometry.ts.
 */

export type Vec3 = [number, number, number];

/** Row-major 4×4 affine: out = M · [x y z 1]ᵀ. */
export type Mat4 = Float64Array;

export type Interpolation = "nearest" | "linear";

/** DICOM VOI LUT Function (0028,1056). LINEAR is the default when absent. */
export type VoiFunction = "LINEAR" | "LINEAR_EXACT" | "SIGMOID";

export type VoiWindow = {
  center: number;
  width: number;
  /** Where this window came from; shown next to the numbers. */
  source: "dicom" | "preset" | "auto" | "user" | "file";
  label: string;
};

/** How pixel values should be named in the UI. */
export type ValueUnit =
  /** Calibrated CT only. */
  | "HU"
  /** MRI and anything without a quantitative calibration. */
  | "signal intensity (a.u.)"
  /** A value with a unit declared by the file that we did not verify. */
  | string;

export type SourceFormat = "dicom" | "nifti";

/**
 * Descriptive, non-identifying metadata. Patient identifiers are never copied
 * here — `phiTagsPresent` records only *which* identifying tags the file had,
 * so the UI can say the data is not anonymised without ever showing it.
 */
export type ImageMetadata = {
  format: SourceFormat;
  modality: string | null;
  seriesDescription: string | null;
  protocolName: string | null;
  /** Sequence descriptors as recorded; never used to guess a sequence. */
  scanningSequence: string | null;
  sequenceVariant: string | null;
  mrAcquisitionType: string | null;
  magneticFieldStrength: number | null;
  manufacturer: string | null;
  model: string | null;
  acquisitionDate: string | null;
  bodyPart: string | null;
  transferSyntaxUid: string | null;
  photometricInterpretation: string;
  bitsAllocated: number | null;
  bitsStored: number | null;
  pixelRepresentation: number | null;
  rescaleSlope: number;
  rescaleIntercept: number;
  rescaleType: string | null;
  sliceThickness: number | null;
  spacingBetweenSlices: number | null;
  /** Acquisition plane derived from the orientation cosines. */
  acquisitionPlane: "axial" | "coronal" | "sagittal" | "oblique" | "unknown";
  frames: number;
  instances: number;
  phiTagsPresent: string[];
};

export type ImageVolume = {
  id: string;
  /** Display name with no patient information (file or series description). */
  name: string;
  dims: Vec3;
  /** Voxel spacing along i, j, k in mm. */
  spacing: Vec3;
  ijkToLps: Mat4;
  lpsToIjk: Mat4;
  /**
   * Modality values (stored value × slope + intercept), i fastest then j then
   * k. Integer types are kept when the rescale maps integers to integers, so a
   * CT is not silently widened to float.
   */
  data: Float32Array | Int16Array | Uint16Array | Uint8Array | Int32Array;
  /** Present when `data` holds stored values that still need the rescale. */
  valueScale: { slope: number; intercept: number } | null;
  unit: ValueUnit;
  /** True only for calibrated CT (HU). Governs how probed values are named. */
  quantitative: boolean;
  photometric: "MONOCHROME1" | "MONOCHROME2";
  windows: VoiWindow[];
  voiFunction: VoiFunction;
  range: { min: number; max: number };
  metadata: ImageMetadata;
  /** Non-fatal problems found while building the volume. */
  warnings: string[];
};

export type SegmentClass = {
  label: number;
  name: string;
  /** sRGB 0–255. */
  colour: [number, number, number];
};

export type SegmentationVolume = {
  id: string;
  name: string;
  dims: Vec3;
  spacing: Vec3;
  ijkToLps: Mat4;
  lpsToIjk: Mat4;
  labels: Uint8Array | Uint16Array;
  classes: SegmentClass[];
  /** A label map holds one label per voxel, so classes cannot overlap. */
  mutuallyExclusive: true;
  /** Convention the class names were taken from, or null if unknown. */
  convention: string | null;
  provenance: Provenance;
};

export type Provenance = {
  source: string;
  method: string;
  date: string | null;
  notes: string[];
};

export type Electrode = {
  id: string;
  /** Patient-space LPS mm. */
  position: Vec3;
};

export type ElectrodeSet = {
  electrodes: Electrode[];
  /** As declared by the file, e.g. BIDS coordsystem "CapTrak" or "individual". */
  coordinateSystem: string;
  units: "mm";
  registered: boolean;
  provenance: Provenance;
};

/** Load failures the UI must name precisely rather than as "an error". */
export class ImagingError extends Error {
  constructor(
    readonly kind:
      | "malformed"
      | "unsupported-transfer-syntax"
      | "unsupported-image"
      | "missing-geometry"
      | "inconsistent-series"
      | "empty",
    message: string,
  ) {
    super(message);
    this.name = "ImagingError";
  }
}
