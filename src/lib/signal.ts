/**
 * Spectral features for EEG.
 *
 * Welch's method rather than a single FFT: averaging periodograms over
 * overlapping windows trades frequency resolution for a far lower-variance
 * estimate, which is what makes band power stable enough to compare across
 * channels. A single FFT of a whole recording looks precise and is noisy.
 *
 * Everything here is real arithmetic on the loaded samples. Nothing is
 * simulated, and no clinical interpretation is attached to any number.
 */

export type Band = { name: string; lo: number; hi: number };

/** Standard clinical bands. Gamma is capped at 45 Hz to stay under line noise. */
export const BANDS: Band[] = [
  { name: "delta", lo: 1, hi: 4 },
  { name: "theta", lo: 4, hi: 8 },
  { name: "alpha", lo: 8, hi: 13 },
  { name: "beta", lo: 13, hi: 30 },
  { name: "gamma", lo: 30, hi: 45 },
];

export type ChannelSpectrum = {
  label: string;
  freqs: Float32Array;
  /** Power spectral density, µV²/Hz. */
  psd: Float32Array;
  /** Band name -> share of total 1–45 Hz power, summing to ~1. */
  relative: Record<string, number>;
  /** Band name -> absolute power, µV². */
  absolute: Record<string, number>;
  thetaAlphaRatio: number;
  peakFrequency: number;
  rms: number;
};

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k]!;
        const ai = im[i + k]!;
        const br = re[i + k + len / 2]!;
        const bi = im[i + k + len / 2]!;
        const tr = br * cr - bi * ci;
        const ti = br * ci + bi * cr;
        re[i + k] = ar + tr;
        im[i + k] = ai + ti;
        re[i + k + len / 2] = ar - tr;
        im[i + k + len / 2] = ai - ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

/**
 * Welch PSD with a Hann window and 50% overlap.
 *
 * The signal is mean-removed per segment: a DC offset or slow drift otherwise
 * dominates the delta band and makes every relative-power figure wrong.
 */
export function welchPsd(
  samples: Float32Array,
  sampleRate: number,
  segmentSeconds = 2,
): { freqs: Float32Array; psd: Float32Array } {
  const segLen = Math.min(
    nextPow2(Math.round(segmentSeconds * sampleRate)),
    nextPow2(samples.length),
  );
  if (segLen < 16 || samples.length < segLen) {
    return { freqs: new Float32Array(0), psd: new Float32Array(0) };
  }
  const step = Math.max(1, Math.floor(segLen / 2));
  const bins = segLen / 2 + 1;

  // Hann window, with its power correction factor.
  const win = new Float64Array(segLen);
  let winPower = 0;
  for (let i = 0; i < segLen; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (segLen - 1));
    winPower += win[i]! * win[i]!;
  }
  const scale = 1 / (sampleRate * winPower);

  const acc = new Float64Array(bins);
  let segments = 0;

  for (let start = 0; start + segLen <= samples.length; start += step) {
    let mean = 0;
    for (let i = 0; i < segLen; i++) mean += samples[start + i]!;
    mean /= segLen;

    const re = new Float64Array(segLen);
    const im = new Float64Array(segLen);
    for (let i = 0; i < segLen; i++) re[i] = (samples[start + i]! - mean) * win[i]!;

    fft(re, im);

    for (let k = 0; k < bins; k++) {
      const power = re[k]! * re[k]! + im[k]! * im[k]!;
      // Double the interior bins to fold in the negative frequencies.
      const folded = k === 0 || k === bins - 1 ? power : power * 2;
      acc[k] += folded * scale;
    }
    segments++;
  }

  if (!segments) return { freqs: new Float32Array(0), psd: new Float32Array(0) };

  const freqs = new Float32Array(bins);
  const psd = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    freqs[k] = (k * sampleRate) / segLen;
    psd[k] = acc[k]! / segments;
  }
  return { freqs, psd };
}

function integrate(freqs: Float32Array, psd: Float32Array, lo: number, hi: number): number {
  let total = 0;
  for (let k = 1; k < freqs.length; k++) {
    const f = freqs[k]!;
    if (f < lo || f > hi) continue;
    const df = f - freqs[k - 1]!;
    total += ((psd[k]! + psd[k - 1]!) / 2) * df;
  }
  return total;
}

export function analyseChannel(
  label: string,
  samples: Float32Array,
  sampleRate: number,
): ChannelSpectrum {
  const { freqs, psd } = welchPsd(samples, sampleRate);

  const absolute: Record<string, number> = {};
  let total = 0;
  for (const band of BANDS) {
    const p = integrate(freqs, psd, band.lo, band.hi);
    absolute[band.name] = p;
    total += p;
  }
  const relative: Record<string, number> = {};
  for (const band of BANDS) {
    relative[band.name] = total > 0 ? absolute[band.name]! / total : Number.NaN;
  }

  // Peak within 1–45 Hz — the posterior dominant rhythm in a resting recording.
  let peakFrequency = Number.NaN;
  let peakPower = -Infinity;
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k]!;
    if (f < 1 || f > 45) continue;
    if (psd[k]! > peakPower) {
      peakPower = psd[k]!;
      peakFrequency = f;
    }
  }

  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i]! * samples[i]!;
  const rms = samples.length ? Math.sqrt(sumSq / samples.length) : Number.NaN;

  const alpha = absolute.alpha ?? 0;
  const thetaAlphaRatio = alpha > 0 ? (absolute.theta ?? 0) / alpha : Number.NaN;

  return { label, freqs, psd, relative, absolute, thetaAlphaRatio, peakFrequency, rms };
}

/** Downsample a trace to at most `width` points for drawing, preserving extremes. */
export function decimate(samples: Float32Array, width: number): Float32Array {
  if (samples.length <= width) return samples;
  const out = new Float32Array(width);
  const bucket = samples.length / width;
  for (let i = 0; i < width; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(samples.length, Math.floor((i + 1) * bucket));
    // Keep whichever extreme is larger, so spikes survive decimation.
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = start; k < end; k++) {
      const v = samples[k]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[i] = Math.abs(hi) >= Math.abs(lo) ? hi : lo;
  }
  return out;
}
