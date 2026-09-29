/**
 * NIfTI-1 reader.
 *
 * Two things here matter for how the volume looks on screen:
 *
 * 1. **Percentile normalisation.** Scaling by raw min/max is what makes MRI
 *    look black — a handful of bright outlier voxels (fat, vessels, noise
 *    spikes) push the ceiling up and crush everything else into the bottom of
 *    the range. Windowing to the 1st–99th percentile is what radiology
 *    software does, and it is the single biggest difference between "dim grey
 *    smear" and "readable scan".
 *
 * 2. **Real voxel spacing.** `pixdim` is carried through so the renderer can
 *    scale the volume to its true physical proportions instead of forcing it
 *    into a cube. A 1×1×3mm acquisition drawn as a cube is visibly wrong.
 */

export type NiftiVolume = {
  /** Normalised 0–255 intensities, x fastest. */
  data: Uint8Array;
  /** Resampled grid size. */
  size: [number, number, number];
  /** Original acquisition grid. */
  dims: [number, number, number];
  /** Physical extent in mm, used to keep proportions honest. */
  extent: [number, number, number];
  /** Voxel spacing in mm. */
  spacing: [number, number, number];
  frames: number;
  datatypeLabel: string;
  stats: {
    min: number;
    max: number;
    mean: number;
    std: number;
    p01: number;
    p99: number;
    voxels: number;
    /** Fraction of voxels above the tissue threshold — a crude head/background split. */
    occupancy: number;
  };
};

const DATATYPE_LABELS: Record<number, string> = {
  2: "uint8",
  4: "int16",
  8: "int32",
  16: "float32",
  64: "float64",
  256: "int8",
  512: "uint16",
  768: "uint32",
};

/** Inflate `.nii.gz` when the browser can, otherwise pass the buffer through. */
export async function readNiftiBytes(file: File): Promise<ArrayBuffer> {
  const raw = await file.arrayBuffer();
  // Decide by the gzip magic bytes, not the file name: a server that sends a
  // .nii.gz with Content-Encoding: gzip hands over bytes already decompressed.
  const head = new Uint8Array(raw, 0, Math.min(2, raw.byteLength));
  if (!(head[0] === 0x1f && head[1] === 0x8b)) return raw;
  if (!("DecompressionStream" in window)) {
    throw new Error(
      "This browser cannot decompress .nii.gz. Upload an uncompressed .nii, or use Chrome or Edge.",
    );
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/**
 * Parse a NIfTI-1 volume and resample it onto a cubic grid for the GPU.
 *
 * `target` is the edge of the sampling grid. 160³ is ~4MB as a 3D texture,
 * which every laptop GPU handles, and is finer than the 128³ the previous
 * viewer used.
 */
export function parseNifti(buffer: ArrayBuffer, target = 160): NiftiVolume {
  const view = new DataView(buffer);
  if (view.byteLength < 352) throw new Error("File is too small to be a NIfTI volume.");

  // sizeof_hdr is 348; whichever endianness reads it correctly is the file's.
  const little = view.getInt32(0, true) === 348;
  if (!little && view.getInt32(0, false) !== 348) {
    throw new Error("Not a NIfTI-1 file — the header magic does not match.");
  }

  const i16 = (o: number) => view.getInt16(o, little);
  const f32 = (o: number) => view.getFloat32(o, little);

  const nx = i16(42);
  const ny = i16(44);
  const nz = i16(46);
  const frames = Math.max(1, i16(48));
  const datatype = i16(70);
  const bitpix = i16(72);

  const sx = Math.abs(f32(80)) || 1;
  const sy = Math.abs(f32(84)) || 1;
  const sz = Math.abs(f32(88)) || 1;

  const voxOffsetRaw = f32(108);
  const voxOffset = Math.max(352, Number.isFinite(voxOffsetRaw) ? voxOffsetRaw : 352);
  const slope = f32(112) || 1;
  const intercept = f32(116) || 0;

  if (nx < 2 || ny < 2 || nz < 2) {
    throw new Error(`Volume is not 3D (got ${nx}×${ny}×${nz}). This viewer needs a 3D or 4D scan.`);
  }
  const bytesPer = bitpix / 8;
  if (bytesPer <= 0 || bitpix % 8 !== 0) {
    throw new Error(`Unsupported bit depth: ${bitpix}.`);
  }

  const perFrame = nx * ny * nz;
  const needed = voxOffset + perFrame * bytesPer; // first frame only
  if (needed > view.byteLength) {
    throw new Error("File is truncated — the header describes more data than the file contains.");
  }

  const readRaw = (i: number): number => {
    const o = voxOffset + i * bytesPer;
    switch (datatype) {
      case 2:
        return view.getUint8(o);
      case 4:
        return view.getInt16(o, little);
      case 8:
        return view.getInt32(o, little);
      case 16:
        return view.getFloat32(o, little);
      case 64:
        return view.getFloat64(o, little);
      case 256:
        return view.getInt8(o);
      case 512:
        return view.getUint16(o, little);
      case 768:
        return view.getUint32(o, little);
      default:
        throw new Error(`Unsupported NIfTI datatype code ${datatype}.`);
    }
  };
  const read = (i: number) => readRaw(i) * slope + intercept;

  // -- pass 1: distribution, sampled if the volume is large -----------------
  const stride = Math.max(1, Math.ceil(Math.cbrt(perFrame / 400_000)));
  const samples: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let z = 0; z < nz; z += stride) {
    for (let y = 0; y < ny; y += stride) {
      for (let x = 0; x < nx; x += stride) {
        const q = read(x + nx * (y + ny * z));
        if (!Number.isFinite(q)) continue;
        samples.push(q);
        if (q < min) min = q;
        if (q > max) max = q;
        sum += q;
        sumSq += q * q;
        count++;
      }
    }
  }
  if (!count || !Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error("Volume contains no finite voxel values.");
  }

  samples.sort((a, b) => a - b);
  const at = (p: number) =>
    samples[Math.min(samples.length - 1, Math.max(0, Math.floor(p * (samples.length - 1))))]!;
  // Window to 1–99%: clipping the extremes is what makes tissue contrast visible.
  const p01 = at(0.01);
  const p99 = at(0.99);
  const lo = p01;
  const hi = p99 > p01 ? p99 : max > min ? max : min + 1;
  const range = hi - lo || 1;

  const mean = sum / count;
  const std = Math.sqrt(Math.max(0, sumSq / count - mean * mean));

  // -- pass 2: resample onto a cubic grid, normalised -----------------------
  const N = target;
  const out = new Uint8Array(N * N * N);
  let occupied = 0;

  for (let z = 0; z < N; z++) {
    const sz0 = Math.min(nz - 1, Math.round((z * (nz - 1)) / (N - 1)));
    for (let y = 0; y < N; y++) {
      const sy0 = Math.min(ny - 1, Math.round((y * (ny - 1)) / (N - 1)));
      const rowBase = nx * (sy0 + ny * sz0);
      for (let x = 0; x < N; x++) {
        const sx0 = Math.min(nx - 1, Math.round((x * (nx - 1)) / (N - 1)));
        const q = read(sx0 + rowBase);
        const t = Math.max(0, Math.min(1, (q - lo) / range));
        const v = Math.round(t * 255);
        out[x + N * (y + N * z)] = v;
        if (v > 28) occupied++;
      }
    }
  }

  return {
    data: out,
    size: [N, N, N],
    dims: [nx, ny, nz],
    spacing: [sx, sy, sz],
    extent: [nx * sx, ny * sy, nz * sz],
    frames,
    datatypeLabel: DATATYPE_LABELS[datatype] ?? `code ${datatype}`,
    stats: {
      min,
      max,
      mean,
      std,
      p01,
      p99,
      voxels: perFrame,
      occupancy: occupied / out.length,
    },
  };
}

/**
 * A synthetic T1-like head, used when no scan is loaded.
 *
 * Explicitly a phantom, never presented as a subject. It exists so the console
 * has something to render on open rather than an empty box.
 */
export function phantomVolume(target = 160): NiftiVolume {
  const N = target;
  const c = (N - 1) / 2;
  const data = new Uint8Array(N * N * N);
  let sum = 0;
  let sumSq = 0;
  let occupied = 0;

  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const X = (x - c) / c;
        const Y = (y - c) / c;
        const Z = (z - c) / c;
        const shell = (X * X) / 0.9 + (Y * Y) / 0.78 + (Z * Z) / 0.86;
        // Gyral folding: a few superposed ripples read as cortex at a glance.
        const folds =
          0.05 * Math.sin(Y * 34 + Z * 7) +
          0.028 * Math.sin(Y * 59 - Z * 9) +
          0.016 * Math.sin((Y + Z) * 92);
        let q = shell < 1 + folds ? 30 + 205 * Math.pow(Math.max(0, 1 - shell), 0.55) : 0;
        // Deep grey structures.
        q += 34 * Math.exp(-((X * X) / 0.2 + (Y + 0.02) ** 2 / 0.26 + (Z + 0.01) ** 2 / 0.3));
        // Ventricles: dark on T1.
        const vent = (X / 0.17) ** 2 + ((Y + 0.01) / 0.3) ** 2 + ((Z + 0.02) / 0.24) ** 2 < 1;
        if (vent) q *= 0.1;
        q = Math.max(0, Math.min(255, q));
        const v = Math.round(q);
        data[x + N * (y + N * z)] = v;
        sum += v;
        sumSq += v * v;
        if (v > 28) occupied++;
      }
    }
  }
  const mean = sum / data.length;
  return {
    data,
    size: [N, N, N],
    dims: [N, N, N],
    spacing: [1, 1, 1],
    extent: [N, N, N],
    frames: 1,
    datatypeLabel: "synthetic phantom",
    stats: {
      min: 0,
      max: 255,
      mean,
      std: Math.sqrt(Math.max(0, sumSq / data.length - mean * mean)),
      p01: 0,
      p99: 255,
      voxels: data.length,
      occupancy: occupied / data.length,
    },
  };
}

/** Sample the volume with nearest-neighbour lookup, in 0–1 grid coordinates. */
export function sampleVolume(vol: NiftiVolume, u: number, v: number, w: number): number {
  const [nx, ny, nz] = vol.size;
  const x = Math.max(0, Math.min(nx - 1, Math.round(u * (nx - 1))));
  const y = Math.max(0, Math.min(ny - 1, Math.round(v * (ny - 1))));
  const z = Math.max(0, Math.min(nz - 1, Math.round(w * (nz - 1))));
  return vol.data[x + nx * (y + ny * z)]!;
}

/* ---------------------------------------------------------- label maps */

export type LabelVolume = {
  /** Integer labels on the same resampled grid as the anatomy, x fastest. */
  labels: Uint8Array;
  size: [number, number, number];
  dims: [number, number, number];
  spacing: [number, number, number];
  /** label -> voxel count at ORIGINAL resolution. */
  counts: Map<number, number>;
  /** label -> volume in cm³, from original voxel counts × voxel volume. */
  volumesCm3: Map<number, number>;
  /** label -> centroid in 0–1 grid coordinates, for placing a callout. */
  centroids: Map<number, [number, number, number]>;
};

/**
 * Read a segmentation (label map) without destroying it.
 *
 * Anatomy gets percentile-windowed; labels must not — windowing turns label 4
 * into some fraction of 255 and the classes are lost. This keeps integer values
 * and resamples with nearest-neighbour only, so no label is ever blended into a
 * value that does not exist.
 *
 * Volumes are counted at the ORIGINAL resolution. Counting on the resampled
 * 160³ grid would change every volume depending on the display resolution,
 * which is exactly the kind of number that must not move.
 *
 * Alignment assumption: the label map covers the same field of view as the
 * anatomy it is shown with. That holds for BraTS, where every modality and the
 * segmentation share one grid; the UI warns if the dimensions differ.
 */
export function parseNiftiLabels(buffer: ArrayBuffer, target = 160): LabelVolume {
  const view = new DataView(buffer);
  if (view.byteLength < 352) throw new Error("File is too small to be a NIfTI label map.");
  const little = view.getInt32(0, true) === 348;
  if (!little && view.getInt32(0, false) !== 348) {
    throw new Error("Not a NIfTI-1 file — the header magic does not match.");
  }
  const i16 = (o: number) => view.getInt16(o, little);
  const f32 = (o: number) => view.getFloat32(o, little);
  const nx = i16(42);
  const ny = i16(44);
  const nz = i16(46);
  const datatype = i16(70);
  const bitpix = i16(72);
  const sx = Math.abs(f32(80)) || 1;
  const sy = Math.abs(f32(84)) || 1;
  const sz = Math.abs(f32(88)) || 1;
  const voxOffsetRaw = f32(108);
  const voxOffset = Math.max(352, Number.isFinite(voxOffsetRaw) ? voxOffsetRaw : 352);
  const slope = f32(112) || 1;
  const intercept = f32(116) || 0;
  const bytesPer = bitpix / 8;
  const perFrame = nx * ny * nz;
  if (nx < 2 || ny < 2 || nz < 2) throw new Error("Label map is not 3D.");
  if (voxOffset + perFrame * bytesPer > view.byteLength) {
    throw new Error("Label map is truncated.");
  }

  const readRaw = (i: number): number => {
    const o = voxOffset + i * bytesPer;
    switch (datatype) {
      case 2:
        return view.getUint8(o);
      case 4:
        return view.getInt16(o, little);
      case 8:
        return view.getInt32(o, little);
      case 16:
        return view.getFloat32(o, little);
      case 64:
        return view.getFloat64(o, little);
      case 256:
        return view.getInt8(o);
      case 512:
        return view.getUint16(o, little);
      case 768:
        return view.getUint32(o, little);
      default:
        throw new Error(`Unsupported label datatype code ${datatype}.`);
    }
  };
  // Labels are integers; round away any float storage noise, never interpolate.
  const read = (i: number) => Math.round(readRaw(i) * slope + intercept);

  const counts = new Map<number, number>();
  const sums = new Map<number, [number, number, number]>();
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const v = read(x + nx * (y + ny * z));
        if (v <= 0) continue;
        if (v > 255) throw new Error(`Label value ${v} exceeds 255 — is this a segmentation?`);
        counts.set(v, (counts.get(v) ?? 0) + 1);
        const acc = sums.get(v) ?? [0, 0, 0];
        acc[0] += x;
        acc[1] += y;
        acc[2] += z;
        sums.set(v, acc);
      }
    }
  }
  if (!counts.size) throw new Error("The label map contains no labelled voxels.");
  if (counts.size > 64) {
    throw new Error(
      `Found ${counts.size} distinct values. A segmentation has a handful of classes — this looks like an intensity image, not a label map.`,
    );
  }

  const voxelCm3 = (sx * sy * sz) / 1000;
  const volumesCm3 = new Map<number, number>();
  const centroids = new Map<number, [number, number, number]>();
  for (const [label, count] of counts) {
    volumesCm3.set(label, count * voxelCm3);
    const s = sums.get(label)!;
    centroids.set(label, [
      s[0] / count / (nx - 1),
      s[1] / count / (ny - 1),
      s[2] / count / (nz - 1),
    ]);
  }

  const N = target;
  const labels = new Uint8Array(N * N * N);
  for (let z = 0; z < N; z++) {
    const z0 = Math.min(nz - 1, Math.round((z * (nz - 1)) / (N - 1)));
    for (let y = 0; y < N; y++) {
      const y0 = Math.min(ny - 1, Math.round((y * (ny - 1)) / (N - 1)));
      const row = nx * (y0 + ny * z0);
      for (let x = 0; x < N; x++) {
        const x0 = Math.min(nx - 1, Math.round((x * (nx - 1)) / (N - 1)));
        const v = read(x0 + row);
        labels[x + N * (y + N * z)] = v > 0 ? v : 0;
      }
    }
  }

  return {
    labels,
    size: [N, N, N],
    dims: [nx, ny, nz],
    spacing: [sx, sy, sz],
    counts,
    volumesCm3,
    centroids,
  };
}

/**
 * A demonstration lesion for the phantom — explicitly NOT a finding.
 *
 * It exists so the lesion layer can be shown before a real segmentation is
 * loaded. It uses the BraTS class convention (1 necrotic core, 2 oedema,
 * 4 enhancing) so the colours and legend match what a real BraTS file shows.
 * The UI labels it "demonstration" everywhere it appears.
 */
export function demonstrationLesion(target = 160): LabelVolume {
  const N = target;
  const labels = new Uint8Array(N * N * N);
  const counts = new Map<number, number>();
  const sums = new Map<number, [number, number, number]>();
  // Right parietal, off-centre, so it reads as a lesion and not as anatomy.
  const cx = 0.64;
  const cy = 0.42;
  const cz = 0.6;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / (N - 1) - cx;
        const v = y / (N - 1) - cy;
        const w = z / (N - 1) - cz;
        // Slightly irregular: a lumpy radius reads as tissue, a sphere as a diagram.
        const lump = 1 + 0.18 * Math.sin(u * 40) * Math.cos(v * 34) + 0.1 * Math.sin(w * 46);
        const r = Math.sqrt(u * u + v * v * 1.1 + w * w * 0.9) / lump;
        let label = 0;
        if (r < 0.032) label = 1;
        else if (r < 0.052) label = 4;
        else if (r < 0.092) label = 2;
        if (!label) continue;
        labels[x + N * (y + N * z)] = label;
        counts.set(label, (counts.get(label) ?? 0) + 1);
        const acc = sums.get(label) ?? [0, 0, 0];
        acc[0] += x;
        acc[1] += y;
        acc[2] += z;
        sums.set(label, acc);
      }
    }
  }
  const voxelCm3 = 1 / 1000;
  const volumesCm3 = new Map<number, number>();
  const centroids = new Map<number, [number, number, number]>();
  for (const [label, count] of counts) {
    volumesCm3.set(label, count * voxelCm3);
    const s = sums.get(label)!;
    centroids.set(label, [s[0] / count / (N - 1), s[1] / count / (N - 1), s[2] / count / (N - 1)]);
  }
  return {
    labels,
    size: [N, N, N],
    dims: [N, N, N],
    spacing: [1, 1, 1],
    counts,
    volumesCm3,
    centroids,
  };
}

/**
 * BraTS class names and display colours. BraTS 2021 uses 1/2/4; BraTS 2023
 * renumbered enhancing tumour to 3. Both are accepted.
 */
export const BRATS_CLASSES: Record<
  number,
  { name: string; short: string; colour: [number, number, number] }
> = {
  // Kept in sync with labelColour() in the volume renderer's shader.
  1: { name: "Necrotic tumour core", short: "NCR", colour: [255, 92, 72] },
  2: { name: "Peritumoural oedema", short: "ED", colour: [192, 140, 255] },
  3: { name: "Enhancing tumour", short: "ET", colour: [255, 214, 90] },
  4: { name: "Enhancing tumour", short: "ET", colour: [255, 214, 90] },
};
