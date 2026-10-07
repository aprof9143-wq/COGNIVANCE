/**
 * A subject package for the Simulation Window, built in the browser:
 *
 *   T1          required. A T1-weighted NIfTI already registered to MNI152.
 *   aseg        optional. A FreeSurfer-convention label map in the same space.
 *   brain mask  optional. A binary brain mask in the same space.
 *   config.json optional. Subject metadata, target regions, array geometry.
 *
 * Nothing here registers images. The files must already be in MNI152 space
 * (for example fMRIPrep's space-MNI152NLin2009cAsym outputs); the page checks
 * that they line up with the template and refuses them otherwise. Because the
 * subject is in MNI space, the template's cortical (Schaefer) and subthalamic
 * (MASSP) atlases apply to it directly. Everything that can be measured on
 * the subject's own images is measured there:
 *
 *   from the T1          the scalp (unless the T1 is skull-stripped)
 *   from the brain mask  the brain surface (else from the aseg, closed)
 *   from the aseg        the cortex, and hippocampus, amygdala and thalamus
 *                        (meshes, centroids and volumes)
 *
 * analyseSubject() does the heavy work and runs in a worker
 * (subject.worker.ts); composeSubject() merges its result into the template.
 */

import { rasToLps } from "../imaging/geometry";
import { parseNiftiImage, parseNiftiSegmentation } from "../imaging/nifti";
import type { Vec3 } from "./acoustics";
import { gunzip, regionMeasures, type Anatomy, type RegionMeasures } from "./anatomy";
import { REGIONS, type RegionKey } from "./neural";
import {
  bbox,
  boundaryPoints,
  closeMask,
  crop,
  downsample2,
  erode,
  fillSlices,
  outsideOf,
  surfaceNets,
  type Grid,
} from "./volume";

export type SubjectFile = { name: string; buffer: ArrayBuffer };

export type SubjectConfig = {
  subject_id?: string;
  age?: number;
  sex?: string;
  /** Replace the programme's target regions for this subject. */
  target_regions?: RegionKey[];
  /** Array geometry; elements stay at the spec's 16 × 16. */
  array?: { frequency_mhz?: number; pitch_mm?: number };
};

export type Box = { lo: Vec3; hi: Vec3 };

/** What analyseSubject needs from the template, as plain data. */
export type SubjectRef = {
  scalpBox: Box;
  brainBox: Box;
  /** Label value of each aseg-derived region in the template's label map. */
  deepLabels: Partial<Record<RegionKey, number>>;
};

type MeshData = { positions: Float32Array; indices: Uint32Array };

/** Everything measured on the subject; null where the template is kept. */
export type SubjectParts = {
  config: SubjectConfig;
  notes: string[];
  scalp: Float32Array | null;
  outer: Float32Array | null;
  cortex: MeshData | null;
  deep: Partial<Record<RegionKey, MeshData & { measures: RegionMeasures }>>;
};

export type Source = "subject" | "template";

export type Subject = {
  anatomy: Anatomy;
  /** Where each mesh of the anatomy came from. */
  sources: Record<string, Source>;
  config: SubjectConfig;
  /** Short display name, e.g. "sub-01 · F · 71 y". */
  label: string;
  /** Fallbacks taken, files ignored, config entries dropped. */
  notes: string[];
};

/** aseg labels of the regions taken from a subject's aseg (as in tools/demo-assets/sim_regions.json). */
export const ASEG_REGIONS: Partial<Record<RegionKey, number[]>> = {
  hippocampus: [17, 53],
  amygdala: [18, 54],
  thalamus: [10, 49],
};

/**
 * Closing radius (voxels) that turns an aseg into a filled brain: it bridges
 * the Sylvian and interhemispheric fissures, which an aseg leaves unlabelled.
 * On the MNI152 template, radius 6 reproduces the depths measured against the
 * template's own brain mask to within 2.2 mm for all ten regions.
 */
const ASEG_CLOSING = 6;

const EEG = /\.(edf|bdf|set|fdt|vhdr|vmrk|eeg|fif)$/i;
const NIFTI = /\.nii(\.gz)?$/i;

const tick = () => new Promise((r) => setTimeout(r, 0));

/* ---------------------------------------------------------------- config */

export function parseConfig(text: string, notes: string[]): SubjectConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("config.json is not valid JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("config.json must hold a JSON object.");
  const r = raw as Record<string, unknown>;
  const c: SubjectConfig = {};
  const known = new Set(["subject_id", "age", "sex", "target_regions", "array"]);
  for (const k of Object.keys(r)) if (!known.has(k)) notes.push(`config.json: "${k}" is not used.`);
  if (typeof r["subject_id"] === "string" && r["subject_id"].trim())
    c.subject_id = r["subject_id"].trim().slice(0, 40);
  if (typeof r["age"] === "number" && r["age"] > 0 && r["age"] < 130) c.age = r["age"];
  if (typeof r["sex"] === "string" && r["sex"].trim()) c.sex = r["sex"].trim().slice(0, 12);
  if (r["target_regions"] !== undefined) {
    const keys = new Set<string>(REGIONS.map((x) => x.key));
    const list: unknown[] = Array.isArray(r["target_regions"]) ? r["target_regions"] : [];
    const ok = list.filter((x): x is RegionKey => typeof x === "string" && keys.has(x));
    const bad = list.filter((x) => !(typeof x === "string" && keys.has(x)));
    if (bad.length)
      notes.push(`config.json: unknown target regions ignored (${bad.map(String).join(", ")}).`);
    if (ok.length) c.target_regions = [...new Set(ok)];
  }
  const a = r["array"];
  if (a && typeof a === "object" && !Array.isArray(a)) {
    const f = (a as Record<string, unknown>)["frequency_mhz"];
    const p = (a as Record<string, unknown>)["pitch_mm"];
    const arr: NonNullable<SubjectConfig["array"]> = {};
    if (typeof f === "number" && f >= 0.5 && f <= 20) arr.frequency_mhz = f;
    else if (f !== undefined) notes.push("config.json: array.frequency_mhz must be 0.5–20.");
    if (typeof p === "number" && p >= 0.05 && p <= 2) arr.pitch_mm = p;
    else if (p !== undefined) notes.push("config.json: array.pitch_mm must be 0.05–2.");
    if (Object.keys(arr).length) c.array = arr;
  }
  return c;
}

/* ----------------------------------------------------------- image helpers */

type Volume = { values: ArrayLike<number>; grid: Grid };

const sameGrid = (a: Grid, b: Grid) =>
  a.dims.every((d, i) => d === b.dims[i]) &&
  a.ijkToRas.every((x, i) => Math.abs(x - b.ijkToRas[i]!) < 1e-3);

/** World-space bounding box of a point set, or null if empty. */
export function pointsBox(p: Float32Array): Box | null {
  if (!p.length) return null;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let d = 0; d < 3; d++) {
      lo[d] = Math.min(lo[d]!, p[i + d]!);
      hi[d] = Math.max(hi[d]!, p[i + d]!);
    }
  return { lo, hi };
}

/**
 * How far one box is from another: centre offset in units of 20 mm and
 * extent ratio in units of 25 %, whichever is worse. Below 1, they line up.
 */
export function boxMismatch(a: Box, b: Box): number {
  let worst = 0;
  for (let d = 0; d < 3; d++) {
    const ca = (a.lo[d]! + a.hi[d]!) / 2;
    const cb = (b.lo[d]! + b.hi[d]!) / 2;
    const ea = Math.max(1, a.hi[d]! - a.lo[d]!);
    const eb = Math.max(1, b.hi[d]! - b.lo[d]!);
    worst = Math.max(worst, Math.abs(ca - cb) / 20, Math.abs(Math.log(ea / eb)) / Math.log(1.25));
  }
  return worst;
}

/**
 * Intensity that separates the head from the background: the background's
 * median plus five robust standard deviations (1.4826 × MAD), with the
 * background sampled on the volume's six faces. Robust to the faces the head
 * touches (neck, nose) as long as they are a minority. For a masked image
 * (zero background) it is 0, so every non-zero voxel counts as head.
 */
export function headThreshold(values: ArrayLike<number>, dims: Vec3): number {
  const [nx, ny, nz] = dims;
  const face: number[] = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1)
          face.push(values[i + j * nx + k * nx * ny]!);
  const med = median(face);
  const mad = median(face.map((v) => Math.abs(v - med)));
  return med + 5 * 1.4826 * mad;
}

/** The largest 6-connected component of a mask. */
export function largestComponent(mask: Uint8Array, dims: Vec3): Uint8Array {
  const [nx, ny] = dims;
  const sxy = nx * ny;
  const n = mask.length;
  const label = new Int32Array(n);
  const queue = new Int32Array(n);
  let best = 0;
  let bestSize = 0;
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s]) continue;
    id++;
    let head = 0;
    let tail = 0;
    label[s] = id;
    queue[tail++] = s;
    const visit = (q: number) => {
      if (mask[q] && !label[q]) {
        label[q] = id;
        queue[tail++] = q;
      }
    };
    while (head < tail) {
      const idx = queue[head++]!;
      const i = idx % nx;
      const j = Math.floor(idx / nx) % ny;
      if (i > 0) visit(idx - 1);
      if (i < nx - 1) visit(idx + 1);
      if (j > 0) visit(idx - nx);
      if (j < ny - 1) visit(idx + nx);
      if (idx >= sxy) visit(idx - sxy);
      if (idx + sxy < n) visit(idx + sxy);
    }
    if (tail > bestSize) {
      bestSize = tail;
      best = id;
    }
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (label[i] === best) out[i] = 1;
  return out;
}

/** A solid with every enclosed cavity filled. */
function fill(mask: Uint8Array, dims: Vec3): Uint8Array {
  const out = outsideOf(mask, dims);
  for (let i = 0; i < out.length; i++) out[i] = out[i] ? 0 : 1;
  return out;
}

const invertMask = (m: Uint8Array) => {
  const o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1;
  return o;
};

function invert4(m: Float64Array): Float64Array {
  const [a, b, c, d, e, f, g, h, i] = [
    m[0]!,
    m[1]!,
    m[2]!,
    m[4]!,
    m[5]!,
    m[6]!,
    m[8]!,
    m[9]!,
    m[10]!,
  ];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const r = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  const t = [m[3]!, m[7]!, m[11]!];
  const o = new Float64Array(16);
  for (let row = 0; row < 3; row++) {
    o[row * 4] = r[row * 3]!;
    o[row * 4 + 1] = r[row * 3 + 1]!;
    o[row * 4 + 2] = r[row * 3 + 2]!;
    o[row * 4 + 3] = -(r[row * 3]! * t[0]! + r[row * 3 + 1]! * t[1]! + r[row * 3 + 2]! * t[2]!);
  }
  o[15] = 1;
  return o;
}

/** Values of `src` at the centres of `dst`'s voxels (nearest neighbour), 0 outside. */
function sampleNearest(src: Volume, dst: Grid): Float32Array {
  const [sx, sy, sz] = src.grid.dims;
  const v = invert4(src.grid.ijkToRas);
  const m = dst.ijkToRas;
  const [nx, ny, nz] = dst.dims;
  const out = new Float32Array(nx * ny * nz);
  let idx = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++, idx++) {
        const x = m[0]! * i + m[1]! * j + m[2]! * k + m[3]!;
        const y = m[4]! * i + m[5]! * j + m[6]! * k + m[7]!;
        const z = m[8]! * i + m[9]! * j + m[10]! * k + m[11]!;
        const a = Math.round(v[0]! * x + v[1]! * y + v[2]! * z + v[3]!);
        const b = Math.round(v[4]! * x + v[5]! * y + v[6]! * z + v[7]!);
        const c = Math.round(v[8]! * x + v[9]! * y + v[10]! * z + v[11]!);
        if (a >= 0 && b >= 0 && c >= 0 && a < sx && b < sy && c < sz)
          out[idx] = src.values[a + b * sx + c * sx * sy]!;
      }
  return out;
}

/** A sub-volume of values, cropped like crop() crops a mask. */
function cropValues(values: ArrayLike<number>, grid: Grid, lo: Vec3, hi: Vec3, pad: number) {
  const [nx, ny, nz] = grid.dims;
  const a: Vec3 = [Math.max(0, lo[0] - pad), Math.max(0, lo[1] - pad), Math.max(0, lo[2] - pad)];
  const b: Vec3 = [
    Math.min(nx - 1, hi[0] + pad),
    Math.min(ny - 1, hi[1] + pad),
    Math.min(nz - 1, hi[2] + pad),
  ];
  const d: Vec3 = [b[0] - a[0] + 1, b[1] - a[1] + 1, b[2] - a[2] + 1];
  const out = new Float32Array(d[0] * d[1] * d[2]);
  let idx = 0;
  for (let k = 0; k < d[2]; k++)
    for (let j = 0; j < d[1]; j++) {
      const src = a[0] + (a[1] + j) * nx + (a[2] + k) * nx * ny;
      for (let i = 0; i < d[0]; i++, idx++) out[idx] = values[src + i]!;
    }
  return out;
}

const median = (xs: number[]) => {
  const s = xs.sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

/* -------------------------------------------------------------- reading */

type Classified = {
  t1: Volume;
  aseg: Volume | null;
  mask: Volume | null;
  config: SubjectConfig;
  notes: string[];
};

/**
 * Sort the selected files. Names decide first (fMRIPrep-style outputs say what
 * they are), content second. Files that are clearly something else (tissue
 * probability maps, a tissue-class segmentation, BOLD) are skipped with a
 * note, so a whole derivatives folder can be selected.
 */
async function classify(files: SubjectFile[]): Promise<Classified> {
  const notes: string[] = [];
  let config: SubjectConfig = {};
  const images: (Volume & { name: string })[] = [];
  const asegs: Volume[] = [];
  const masks: Volume[] = [];
  for (const f of files) {
    if (/\.json$/i.test(f.name)) {
      config = parseConfig(new TextDecoder().decode(f.buffer), notes);
      continue;
    }
    if (!NIFTI.test(f.name)) {
      if (/\.mg[hz]$/i.test(f.name))
        notes.push(`${f.name}: MGZ is not read here; convert it to NIfTI (mri_convert).`);
      else if (EEG.test(f.name)) notes.push(`${f.name}: EEG is not used by the Simulation Window.`);
      else notes.push(`${f.name}: not a subject file, ignored.`);
      continue;
    }
    if (/(probseg|bold|xfm|warp)/i.test(f.name)) {
      notes.push(`${f.name}: not a T1, aseg or brain mask, ignored.`);
      continue;
    }
    const buf = await gunzip(f.buffer);
    const named = /mask/i.test(f.name)
      ? "mask"
      : /aseg/i.test(f.name)
        ? "aseg"
        : /(dseg|seg|label)/i.test(f.name)
          ? "labels"
          : /t1/i.test(f.name)
            ? "t1"
            : null;
    let seg: ReturnType<typeof parseNiftiSegmentation> | null = null;
    if (named !== "t1") {
      try {
        seg = parseNiftiSegmentation(buf, f.name);
      } catch {
        seg = null;
      }
    }
    const labels = new Set(seg ? seg.classes.map((c) => c.label) : []);
    const grid = seg ? { dims: seg.dims, ijkToRas: rasToLps(seg.ijkToLps) } : null;
    // A uint8 T1 also parses as integers, but with far more distinct values.
    const isAseg =
      seg !== null &&
      [17, 53, 18, 54].every((l) => labels.has(l)) &&
      (named === "aseg" || named === "labels" || labels.size <= 120);
    const isMask = seg !== null && labels.size === 1;
    if (named === "aseg" && !isAseg)
      throw new Error(
        `${f.name} is not a FreeSurfer aseg: it needs the hippocampus and amygdala labels (17/53, 18/54).`,
      );
    if (named === "mask" && !isMask) throw new Error(`${f.name} is not a binary mask.`);
    if (seg && grid && isAseg) asegs.push({ values: seg.labels, grid });
    else if (seg && grid && isMask) masks.push({ values: seg.labels, grid });
    else if (named === "labels") notes.push(`${f.name}: a label map but not an aseg, ignored.`);
    else {
      const img = parseNiftiImage(buf, f.name);
      const values = new Float32Array(img.data.length);
      const sc = img.valueScale ?? { slope: 1, intercept: 0 };
      for (let i = 0; i < values.length; i++) values[i] = img.data[i]! * sc.slope + sc.intercept;
      images.push({
        name: f.name,
        values,
        grid: { dims: img.dims, ijkToRas: rasToLps(img.ijkToLps) },
      });
    }
  }
  // Several images: the one named T1 is the T1.
  const named = images.filter((i) => /t1/i.test(i.name));
  const t1s = images.length > 1 && named.length === 1 ? named : images;
  for (const i of images)
    if (t1s.length === 1 && i !== t1s[0]) notes.push(`${i.name}: not the T1, ignored.`);
  if (t1s.length !== 1)
    throw new Error(
      t1s.length
        ? "More than one T1 image was selected; choose one."
        : "No T1 image (NIfTI) was selected.",
    );
  if (asegs.length > 1) throw new Error("More than one aseg label map was selected; choose one.");
  if (masks.length > 1) throw new Error("More than one brain mask was selected; choose one.");
  return { t1: t1s[0]!, aseg: asegs[0] ?? null, mask: masks[0] ?? null, config, notes };
}

/* --------------------------------------------------------------- analyse */

/** Brain-surface points of a brain mask, after filling (and closing by r voxels). */
function brainSurface(m: Volume, r: number): { points: Float32Array; box: Box } | null {
  const full = new Uint8Array(m.values.length);
  for (let i = 0; i < full.length; i++) if (m.values[i]) full[i] = 1;
  const b = bbox(full, m.grid.dims);
  if (!b) return null;
  const c = crop(full, m.grid, b.lo, b.hi, r + 2);
  const solid = fill(r ? closeMask(c.mask, c.grid.dims, r) : c.mask, c.grid.dims);
  const points = boundaryPoints(solid, invertMask(solid), c.grid, false);
  return { points, box: pointsBox(points)! };
}

/** Measure everything the subject's own images allow. Runs in a worker. */
export async function analyseSubject(
  files: SubjectFile[],
  ref: SubjectRef,
  onStep?: (step: string) => void,
): Promise<SubjectParts> {
  const step = async (s: string) => {
    onStep?.(s);
    await tick();
  };
  await step("Reading files");
  const { t1, aseg, mask, config, notes } = await classify(files);

  // Head: above the background, at 2 mm; small openings (ear canals,
  // nostrils) closed, axial slices filled so the airway does not count as
  // outside, enclosed space (skull, brain) filled, specks dropped.
  await step("Finding the scalp");
  const threshold = headThreshold(t1.values, t1.grid.dims);
  const bin = new Uint8Array(t1.values.length);
  for (let i = 0; i < bin.length; i++) if (t1.values[i]! > threshold) bin[i] = 1;
  const coarse = downsample2(bin, t1.grid);
  const toRas = coarse.grid.ijkToRas;
  // The voxel axis closest to world z: slices across it are axial.
  const zAxis = [0, 1, 2].reduce((best, a) =>
    Math.abs(toRas[8 + a]!) > Math.abs(toRas[8 + best]!) ? a : best,
  ) as 0 | 1 | 2;
  const closed = fillSlices(closeMask(coarse.mask, coarse.grid.dims, 2), coarse.grid.dims, zAxis);
  const head = largestComponent(fill(closed, coarse.grid.dims), coarse.grid.dims);
  const out = invertMask(head);
  const headBox = pointsBox(boundaryPoints(head, out, coarse.grid, false));
  if (!headBox) throw new Error("The T1 image is empty.");
  const asScalp = boxMismatch(headBox, ref.scalpBox);
  const asBrain = boxMismatch(headBox, ref.brainBox);
  if (Math.min(asScalp, asBrain) > 1)
    throw new Error(
      "The T1 does not line up with MNI152. Register it to MNI152 first (for example fMRIPrep's space-MNI152NLin2009cAsym outputs).",
    );
  let scalp: Float32Array | null = null;
  if (asScalp <= asBrain) scalp = boundaryPoints(head, out, coarse.grid, true);
  else notes.push("The T1 looks skull-stripped: depths below the scalp use the template scalp.");

  await step("Building the brain surface");
  let outer: Float32Array | null = null;
  const brain = mask ? brainSurface(mask, 0) : aseg ? brainSurface(aseg, ASEG_CLOSING) : null;
  if (brain) {
    if (boxMismatch(brain.box, ref.brainBox) > 1)
      throw new Error(
        `The ${mask ? "brain mask" : "aseg"} does not line up with MNI152; it must be in the same space as the T1.`,
      );
    outer = brain.points;
  }

  let cortex: MeshData | null = null;
  const deep: SubjectParts["deep"] = {};
  if (aseg) {
    await step("Building the cortex");
    const labels = aseg.values;
    const full = new Uint8Array(labels.length);
    for (let i = 0; i < full.length; i++) if (labels[i]) full[i] = 1;
    const b = bbox(full, aseg.grid.dims)!;
    const c = crop(full, aseg.grid, b.lo, b.hi, 2);
    const lab = cropValues(labels, aseg.grid, b.lo, b.hi, 2);
    const t1v = sameGrid(t1.grid, aseg.grid)
      ? cropValues(t1.values, aseg.grid, b.lo, b.hi, 2)
      : sampleNearest(t1, c.grid);
    const gm: number[] = [];
    const csf: number[] = [];
    for (let i = 0; i < lab.length; i++) {
      const l = lab[i]!;
      // Cortex: aseg 3/42, or the aparc parcels of an aparc+aseg (1000–2999).
      if (l === 3 || l === 42 || (l >= 1000 && l < 3000)) gm.push(t1v[i]!);
      else if (l === 4 || l === 43) csf.push(t1v[i]!);
    }
    const level = (median(gm) + median(csf)) / 2;
    if (Number.isFinite(level)) {
      const inside = erode(c.mask, c.grid.dims, 1);
      const cm = new Uint8Array(inside.length);
      for (let i = 0; i < cm.length; i++) if (inside[i] && t1v[i]! > level) cm[i] = 1;
      const half = downsample2(cm, c.grid);
      cortex = surfaceNets(half.mask, half.grid, 2);
    } else {
      notes.push("The aseg has no cortex or ventricle labels: the cortex view uses the template.");
    }

    await step("Building deep regions");
    const regionLabels = new Uint8Array(lab.length);
    const masks = new Map<RegionKey, Uint8Array>();
    for (const [key, ids] of Object.entries(ASEG_REGIONS) as [RegionKey, number[]][]) {
      const value = ref.deepLabels[key];
      if (value === undefined) continue;
      const m = new Uint8Array(lab.length);
      for (let i = 0; i < lab.length; i++)
        if (ids.includes(lab[i]!)) {
          m[i] = 1;
          regionLabels[i] = value;
        }
      masks.set(key, m);
    }
    const measures = regionMeasures(regionLabels, c.grid.dims, c.grid.ijkToRas);
    for (const [key, m] of masks) {
      const rb = bbox(m, c.grid.dims);
      const r = measures.get(ref.deepLabels[key]!);
      if (!rb || !r?.sides.left || !r.sides.right) {
        notes.push(`The aseg lacks one or both ${key} labels: the template region is used.`);
        continue;
      }
      const rc = crop(m, c.grid, rb.lo, rb.hi, 2);
      deep[key] = { ...surfaceNets(rc.mask, rc.grid, 4), measures: r };
    }
  }
  if (!aseg && !mask) notes.push("No aseg or brain mask: the brain surface uses the template.");
  if (!aseg)
    notes.push("No aseg: the cortex view and hippocampus, amygdala and thalamus use the template.");
  return { config, notes, scalp, outer, cortex, deep };
}

/* --------------------------------------------------------------- compose */

export function subjectRef(template: Anatomy): SubjectRef {
  const scalpBox = pointsBox(template.meshes.get("scalp")?.positions ?? new Float32Array());
  const brainBox = pointsBox(template.meshes.get("outer")?.positions ?? new Float32Array());
  if (!scalpBox || !brainBox) throw new Error("Template anatomy is incomplete.");
  const deepLabels: SubjectRef["deepLabels"] = {};
  for (const key of Object.keys(ASEG_REGIONS) as RegionKey[]) {
    const label = template.meshes.get(key)?.label;
    if (label !== undefined) deepLabels[key] = label;
  }
  return { scalpBox, brainBox, deepLabels };
}

/** The template with every subject measurement swapped in. The template is not modified. */
export function composeSubject(template: Anatomy, parts: SubjectParts): Subject {
  const meshes = new Map(template.meshes);
  const sources: Record<string, Source> = {};
  for (const k of template.meshes.keys()) sources[k] = "template";
  const swap = (key: string, patch: Partial<NonNullable<ReturnType<typeof meshes.get>>>) => {
    meshes.set(key, { ...template.meshes.get(key)!, ...patch });
    sources[key] = "subject";
  };
  if (parts.scalp) swap("scalp", { positions: parts.scalp, indices: new Uint32Array(0) });
  if (parts.outer) swap("outer", { positions: parts.outer, indices: new Uint32Array(0) });
  if (parts.cortex) swap("cortex", parts.cortex);
  for (const [key, d] of Object.entries(parts.deep)) {
    if (!d) continue;
    swap(key, {
      positions: d.positions,
      indices: d.indices,
      volumeMm3: d.measures.volumeMm3,
      centroid: d.measures.centroid,
      sides: d.measures.sides,
    });
  }
  const c = parts.config;
  const label = [c.subject_id ?? "Subject", c.sex, c.age !== undefined ? `${c.age} y` : undefined]
    .filter(Boolean)
    .join(" · ");
  return { anatomy: { meshes }, sources, config: c, label, notes: parts.notes };
}
