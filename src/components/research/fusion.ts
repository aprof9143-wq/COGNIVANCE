/**
 * EEG spectral measures. Every number below is arithmetic on the loaded
 * recording, labelled for what it is; none carries a clinical interpretation.
 */

import type { ChannelSpectrum } from "@/lib/signal";
import { findElectrode } from "@/lib/montage";

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

/* ------------------------------------------------- Alzheimer's biomarkers */

export type Biomarker = {
  id: string;
  name: string;
  value: number;
  unit: string;
  format: (v: number) => string;
  /** The direction the Alzheimer's literature associates with disease. */
  adDirection: "higher" | "lower";
  /** What the marker measures, in one line. */
  meaning: string;
  basis: string;
};

/**
 * EEG markers the Alzheimer's literature reports as altered in disease.
 *
 * This is deliberately a panel of measurements, not a prediction. Each value
 * is computed from the loaded recording, and each is shown with the direction
 * the literature associates with Alzheimer's — never with a threshold, a flag,
 * or a combined score. Turning these into a risk estimate needs a model trained
 * and validated on labelled cohorts, which is gated behind the published
 * benchmarks and has not been done. The console states this beside the panel.
 *
 * The markers themselves are well established: EEG in Alzheimer's is
 * characterised by "slowing" — power shifting from alpha and beta toward delta
 * and theta, a slower posterior dominant rhythm, and reduced coherence.
 */
export function alzheimerBiomarkers(
  spectra: Map<string, ChannelSpectrum>,
  alphaCoherence: { labels: string[]; values: Float32Array } | null,
): Biomarker[] {
  const all = [...spectra.values()];
  const mean = (xs: number[]) => {
    const f = xs.filter(Number.isFinite);
    return f.length ? f.reduce((a, b) => a + b, 0) / f.length : Number.NaN;
  };

  const pdr = posteriorDominantRhythm(spectra);
  const ta = mean(all.map((s) => s.thetaAlphaRatio));

  // Slowing index: slow over fast power. The single most-cited EEG summary of
  // the Alzheimer's spectral shift.
  const slowing = mean(
    all.map((s) => {
      const slow = (s.absolute["delta"] ?? 0) + (s.absolute["theta"] ?? 0);
      const fast = (s.absolute["alpha"] ?? 0) + (s.absolute["beta"] ?? 0);
      return fast > 0 ? slow / fast : Number.NaN;
    }),
  );

  const posteriorAlpha = mean(
    [...spectra.entries()]
      .filter(([label]) => {
        const r = findElectrode(label)?.region;
        return r === "occipital" || r === "parietal";
      })
      .map(([, s]) => s.relative["alpha"] ?? Number.NaN),
  );

  // Interhemispheric alpha coherence over homologous pairs only, so the number
  // compares like with like across the midline.
  let interCoh = Number.NaN;
  if (alphaCoherence) {
    const idx = new Map(alphaCoherence.labels.map((l, i) => [l, i]));
    const n = alphaCoherence.labels.length;
    const pairs: [string, string][] = [
      ["Fp1", "Fp2"],
      ["F7", "F8"],
      ["F3", "F4"],
      ["T3", "T4"],
      ["C3", "C4"],
      ["T5", "T6"],
      ["P3", "P4"],
      ["O1", "O2"],
    ];
    const vals: number[] = [];
    for (const [a, b] of pairs) {
      const i = idx.get(a);
      const j = idx.get(b);
      if (i === undefined || j === undefined) continue;
      vals.push(alphaCoherence.values[i * n + j]!);
    }
    interCoh = mean(vals);
  }

  const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
  const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
  const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}` : "—");

  return [
    {
      id: "pdr",
      name: "Posterior dominant rhythm",
      value: pdr,
      unit: "Hz",
      format: f1,
      adDirection: "lower",
      meaning: "Frequency of the resting occipital-parietal rhythm.",
      basis:
        "Slowing of the posterior rhythm is among the most consistent EEG findings in Alzheimer's.",
    },
    {
      id: "slowing",
      name: "Slowing index",
      value: slowing,
      unit: "(δ+θ)/(α+β)",
      format: f2,
      adDirection: "higher",
      meaning: "Slow-wave over fast-wave power, averaged across channels.",
      basis: "Power shifts from alpha and beta toward delta and theta as the disease progresses.",
    },
    {
      id: "ta",
      name: "Theta / alpha ratio",
      value: ta,
      unit: "ratio",
      format: f2,
      adDirection: "higher",
      meaning: "Theta power relative to alpha, averaged across channels.",
      basis: "Reported elevated in mild cognitive impairment and Alzheimer's.",
    },
    {
      id: "palpha",
      name: "Posterior alpha share",
      value: posteriorAlpha,
      unit: "% of power",
      format: pct,
      adDirection: "lower",
      meaning: "Alpha's share of total power over occipital and parietal leads.",
      basis: "Posterior alpha is reported reduced in Alzheimer's.",
    },
    {
      id: "coh",
      name: "Interhemispheric α coherence",
      value: interCoh,
      unit: "0–1",
      format: f2,
      adDirection: "lower",
      meaning: "Alpha-band coherence between homologous left–right electrode pairs.",
      basis: "Reduced coherence is reported in Alzheimer's, read as weakened functional coupling.",
    },
  ];
}
