/**
 * EDF / EDF+ reader.
 *
 * European Data Format is the lingua franca of clinical EEG, and the format is
 * simple enough to read directly: a 256-byte ASCII header, then 256 bytes per
 * signal describing it, then interleaved data records of int16 samples.
 *
 * Physical scaling matters and is easy to get wrong. Samples are stored as
 * raw ADC integers; converting to microvolts needs the per-signal digital and
 * physical ranges from the header. Skipping that step gives traces that look
 * plausible and are numerically meaningless, which is worse than failing.
 */

export type EdfSignal = {
  label: string;
  transducer: string;
  physicalDimension: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  prefiltering: string;
  samplesPerRecord: number;
  /** Samples in microvolts, full recording. */
  data: Float32Array;
  sampleRate: number;
};

export type EdfRecording = {
  patientId: string;
  recordingId: string;
  startDate: string;
  durationSeconds: number;
  recordDurationSeconds: number;
  records: number;
  signals: EdfSignal[];
  /** Signals that look like scalp EEG, in montage order where recognised. */
  eegSignals: EdfSignal[];
};

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  new TextDecoder("ascii").decode(bytes.subarray(start, start + length)).trim();

const num = (bytes: Uint8Array, start: number, length: number): number => {
  const text = ascii(bytes, start, length);
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : 0;
};

/** Channels that are not scalp EEG and should not be averaged into features. */
const NON_EEG = /(ecg|ekg|eog|emg|resp|sao2|pleth|status|annotation|marker|temp|trigger)/i;

/**
 * Normalise the many ways a 10-20 electrode gets written: "EEG Fp1-REF",
 * "Fp1-A1", "eeg fp1" all become "Fp1".
 */
export function canonicalChannelName(raw: string): string {
  let name = raw.trim();
  name = name.replace(/^eeg\s*/i, "");
  // Strip a trailing reference suffix. Cz is deliberately NOT in this list: it
  // is a real midline electrode, and treating "Cz-REF" as all-suffix used to
  // erase the channel entirely.
  name = name.replace(/[-_\s]+(ref|le|a1|a2|m1|m2|avg)$/i, "");
  name = name.replace(/[-_\s]+$/, "");
  const m = name.match(/^([A-Za-z]{1,2}[0-9z]{1,2})/);
  if (!m) return name;
  const token = m[1]!;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase().replace(/z$/, "z");
}

export function parseEdf(buffer: ArrayBuffer): EdfRecording {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 256) throw new Error("File is too small to be an EDF recording.");

  const version = ascii(bytes, 0, 8);
  if (!/^0/.test(version)) {
    throw new Error("Not an EDF file — the version field should start with '0'.");
  }

  const patientId = ascii(bytes, 8, 80);
  const recordingId = ascii(bytes, 88, 80);
  const startDate = `${ascii(bytes, 168, 8)} ${ascii(bytes, 176, 8)}`;
  const headerBytes = num(bytes, 184, 8);
  const records = num(bytes, 236, 8);
  const recordDurationSeconds = num(bytes, 244, 8) || 1;
  const nSignals = num(bytes, 252, 4);

  if (nSignals < 1) throw new Error("EDF header declares no signals.");
  if (bytes.length < headerBytes) throw new Error("EDF file is truncated inside its header.");

  // Per-signal header fields are stored column-wise: all labels, then all
  // transducers, and so on.
  let cursor = 256;
  const take = (len: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < nSignals; i++) out.push(ascii(bytes, cursor + i * len, len));
    cursor += nSignals * len;
    return out;
  };

  const labels = take(16);
  const transducers = take(80);
  const dimensions = take(8);
  const physMins = take(8).map(Number);
  const physMaxs = take(8).map(Number);
  const digMins = take(8).map(Number);
  const digMaxs = take(8).map(Number);
  const prefilters = take(80);
  const samplesPerRecord = take(8).map((s) => Number.parseInt(s, 10) || 0);

  const perRecordTotal = samplesPerRecord.reduce((a, b) => a + b, 0);
  if (perRecordTotal <= 0) throw new Error("EDF header declares no samples per record.");

  const expected = headerBytes + records * perRecordTotal * 2;
  // Some writers pad or under-report; read what is actually present.
  const available = Math.max(0, bytes.length - headerBytes);
  const usableRecords =
    expected > bytes.length ? Math.floor(available / (perRecordTotal * 2)) : records;
  if (usableRecords < 1) throw new Error("EDF file contains no complete data records.");

  const view = new DataView(buffer);
  const signals: EdfSignal[] = [];

  for (let s = 0; s < nSignals; s++) {
    const spr = samplesPerRecord[s]!;
    const data = new Float32Array(spr * usableRecords);

    const physMin = physMins[s]!;
    const physMax = physMaxs[s]!;
    const digMin = digMins[s]!;
    const digMax = digMaxs[s]!;
    // Raw ADC counts become microvolts through the header's two ranges. A
    // degenerate digital range means the header is unusable; pass values
    // through rather than dividing by zero.
    const span = digMax - digMin;
    const gain = span !== 0 ? (physMax - physMin) / span : 1;
    const offset = physMin - digMin * gain;

    // Offset of this signal within one record.
    let within = 0;
    for (let k = 0; k < s; k++) within += samplesPerRecord[k]!;

    for (let r = 0; r < usableRecords; r++) {
      const base = headerBytes + (r * perRecordTotal + within) * 2;
      for (let i = 0; i < spr; i++) {
        const raw = view.getInt16(base + i * 2, true); // EDF is little-endian
        data[r * spr + i] = raw * gain + offset;
      }
    }

    signals.push({
      label: labels[s]!,
      transducer: transducers[s]!,
      physicalDimension: dimensions[s]!,
      physicalMin: physMin,
      physicalMax: physMax,
      digitalMin: digMin,
      digitalMax: digMax,
      prefiltering: prefilters[s]!,
      samplesPerRecord: spr,
      data,
      sampleRate: spr / recordDurationSeconds,
    });
  }

  const eegSignals = signals.filter((sig) => sig.samplesPerRecord > 0 && !NON_EEG.test(sig.label));

  return {
    patientId,
    recordingId,
    startDate,
    durationSeconds: usableRecords * recordDurationSeconds,
    recordDurationSeconds,
    records: usableRecords,
    signals,
    eegSignals: eegSignals.length ? eegSignals : signals,
  };
}

/**
 * A deterministic EEG recording used when no file is loaded.
 *
 * Explicitly synthetic. Carries a real 10 Hz occipital alpha rhythm and 1/f
 * background so the spectral panels show something structurally correct rather
 * than noise — and so a demo works with no file to hand.
 */
export function phantomRecording(seconds = 30, sampleRate = 256): EdfRecording {
  const names = [
    "Fp1",
    "Fp2",
    "F7",
    "F3",
    "Fz",
    "F4",
    "F8",
    "T3",
    "C3",
    "Cz",
    "C4",
    "T4",
    "T5",
    "P3",
    "Pz",
    "P4",
    "T6",
    "O1",
    "O2",
  ];
  const n = Math.floor(seconds * sampleRate);

  // Deterministic PRNG so the phantom is identical on every load.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };

  const signals: EdfSignal[] = names.map((label) => {
    const data = new Float32Array(n);
    const posterior = /^[OPT]/.test(label);
    const alpha = posterior ? 22 : 5;
    const theta = /^F/.test(label) ? 7 : 3;
    let pink = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      pink = pink * 0.94 + rand() * 6; // brown-ish drift stands in for 1/f
      data[i] =
        pink +
        alpha * Math.sin(2 * Math.PI * 10 * t + label.length) +
        theta * Math.sin(2 * Math.PI * 6 * t + label.charCodeAt(0)) +
        3 * Math.sin(2 * Math.PI * 21 * t);
    }
    return {
      label,
      transducer: "synthetic",
      physicalDimension: "uV",
      physicalMin: -200,
      physicalMax: 200,
      digitalMin: -2048,
      digitalMax: 2047,
      prefiltering: "none",
      samplesPerRecord: sampleRate,
      data,
      sampleRate,
    };
  });

  return {
    patientId: "phantom",
    recordingId: "synthetic reference recording",
    startDate: "—",
    durationSeconds: seconds,
    recordDurationSeconds: 1,
    records: seconds,
    signals,
    eegSignals: signals,
  };
}
