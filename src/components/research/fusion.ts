/**
 * Cross-modal measures: the same question asked of the MRI and of the EEG.
 *
 * Fusion here means the two modalities answer comparable questions about the
 * same head, in one coordinate frame. It does not mean a classifier. Every
 * number below is arithmetic on the loaded data, labelled for what it is, and
 * none of it carries a clinical interpretation — the benchmark gates for that
 * have not been passed.
 */

import type { NiftiVolume } from "@/lib/nifti";
import type { ChannelSpectrum } from "@/lib/signal";
import { findElectrode, type ElectrodePosition } from "@/lib/montage";

export type Hemispheres = { left: number; right: number; index: number };

/**
 * Structural asymmetry from the MRI: tissue signal in the left versus right
 * half of the volume.
 *
 * Index = (L − R) / (L + R). Zero is symmetric. This assumes the scan is roughly
 * midline-aligned (RAS); an obliquely acquired scan inflates it, which is why
 * the UI shows it as a raw measure and not a finding.
 */
export function mriAsymmetry(vol: NiftiVolume, threshold = 0.12): Hemispheres {
  const [nx, ny, nz] = vol.size;
  const cut = threshold * 255;
  const mid = (nx - 1) / 2;
  let left = 0;
  let right = 0;
  // Sampling every other voxel is plenty for a hemisphere total.
  for (let z = 0; z < nz; z += 2) {
    for (let y = 0; y < ny; y += 2) {
      const row = nx * (y + ny * z);
      for (let x = 0; x < nx; x += 2) {
        const v = vol.data[row + x]!;
        if (v < cut) continue;
        // RAS: +x is the subject's right.
        if (x < mid) left += v;
        else if (x > mid) right += v;
      }
    }
  }
  const total = left + right;
  return { left, right, index: total ? (left - right) / total : Number.NaN };
}

/**
 * Functional asymmetry from the EEG: one band's power over left versus right
 * electrodes, using homologous pairs only so the two sides are like for like.
 */
export function eegAsymmetry(spectra: Map<string, ChannelSpectrum>, band: string): Hemispheres {
  const PAIRS: [string, string][] = [
    ["Fp1", "Fp2"],
    ["F7", "F8"],
    ["F3", "F4"],
    ["T3", "T4"],
    ["C3", "C4"],
    ["T5", "T6"],
    ["P3", "P4"],
    ["O1", "O2"],
  ];
  let left = 0;
  let right = 0;
  for (const [l, r] of PAIRS) {
    const a = spectra.get(l);
    const b = spectra.get(r);
    if (!a || !b) continue;
    const pa = a.absolute[band];
    const pb = b.absolute[band];
    if (!Number.isFinite(pa) || !Number.isFinite(pb)) continue;
    left += pa!;
    right += pb!;
  }
  const total = left + right;
  return { left, right, index: total ? (left - right) / total : Number.NaN };
}

export type RegionSummary = {
  region: ElectrodePosition["region"];
  channels: number;
  /** Mean relative power of the selected band across this region's electrodes. */
  bandShare: number;
  thetaAlpha: number;
};

export function regionalSummary(
  spectra: Map<string, ChannelSpectrum>,
  band: string,
): RegionSummary[] {
  const order: ElectrodePosition["region"][] = [
    "frontal",
    "central",
    "temporal",
    "parietal",
    "occipital",
  ];
  const acc = new Map<string, { n: number; share: number; ta: number; taN: number }>();
  for (const [label, spec] of spectra) {
    const pos = findElectrode(label);
    if (!pos) continue;
    const cur = acc.get(pos.region) ?? { n: 0, share: 0, ta: 0, taN: 0 };
    const share = spec.relative[band];
    if (Number.isFinite(share)) {
      cur.share += share!;
      cur.n++;
    }
    if (Number.isFinite(spec.thetaAlphaRatio)) {
      cur.ta += spec.thetaAlphaRatio;
      cur.taN++;
    }
    acc.set(pos.region, cur);
  }
  return order
    .filter((r) => acc.has(r))
    .map((r) => {
      const a = acc.get(r)!;
      return {
        region: r,
        channels: a.n,
        bandShare: a.n ? a.share / a.n : Number.NaN,
        thetaAlpha: a.taN ? a.ta / a.taN : Number.NaN,
      };
    });
}

/** Global posterior dominant rhythm: median peak frequency over O/P electrodes. */
export function posteriorDominantRhythm(spectra: Map<string, ChannelSpectrum>): number {
  const peaks: number[] = [];
  for (const [label, spec] of spectra) {
    const pos = findElectrode(label);
    if (!pos || (pos.region !== "occipital" && pos.region !== "parietal")) continue;
    if (Number.isFinite(spec.peakFrequency)) peaks.push(spec.peakFrequency);
  }
  if (!peaks.length) return Number.NaN;
  peaks.sort((a, b) => a - b);
  return peaks[Math.floor(peaks.length / 2)]!;
}
