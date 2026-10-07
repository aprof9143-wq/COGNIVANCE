/**
 * NIMBLE hardware simulator — the browser twin of the platform's acquisition
 * layer.
 *
 * Everything the platform reads comes through one contract, `NeuralDataSource`
 * (core/cognivance_core/abstraction/source.py): connect, read_chunk, health.
 * A simulator, a bench microcontroller and a future implant all implement it,
 * and nothing downstream can tell them apart except through `capabilities()`
 * and `health()`. This module makes that visible: switch the source, and the
 * link characteristics change while the pipeline reading from it does not.
 *
 * NOTHING HERE IS HARDWARE. The stream is seeded pink noise plus planted
 * rhythms, the same construction as core's `SimulatedSource`, and the link
 * model (packetisation, latency, loss) is a parameterised model, not a
 * measurement of any device.
 *
 * The stream runs in a Web Worker (nimbleSim.worker.ts). Every TICK_MS a
 * `TickProducer` advances it by the wall time that passed and posts what is
 * new; on the main thread a `StreamView` plays those samples out at the
 * sample rate, so the display stays smooth while the source keeps wall time.
 */

import { MONTAGE_1020 } from "./montage";

export type SourceKind = "simulated" | "mcu" | "implant";

export type SourceProfile = {
  kind: SourceKind;
  name: string;
  /** Class name the platform uses for it. */
  impl: string;
  detail: string;
  sampleRate: number;
  adcBits: number;
  /** Samples per transport packet. */
  packet: number;
  latencyMs: number;
  jitterMs: number;
  lossRate: number;
  noiseUv: number;
  capabilities: string[];
  /** False for a design target that does not exist yet. */
  available: boolean;
};

export const PROFILES: Record<SourceKind, SourceProfile> = {
  simulated: {
    kind: "simulated",
    name: "Simulated source",
    impl: "SimulatedSource",
    detail: "Seeded pink noise with planted rhythms — ground truth known exactly",
    sampleRate: 256,
    adcBits: 32,
    packet: 16,
    latencyMs: 0.3,
    jitterMs: 0.08,
    lossRate: 0,
    noiseUv: 10,
    capabilities: ["SEEKABLE"],
    available: true,
  },
  mcu: {
    kind: "mcu",
    name: "Bench MCU link",
    impl: "McuSource (link model)",
    detail: "Modelled 24-bit ADC over a wireless link — latency, jitter and loss are parameters",
    sampleRate: 250,
    adcBits: 24,
    packet: 10,
    latencyMs: 22,
    jitterMs: 7,
    lossRate: 0.004,
    noiseUv: 12,
    capabilities: ["LIVE"],
    available: true,
  },
  implant: {
    kind: "implant",
    name: "NIMBLE implant",
    impl: "ImplantSource",
    detail: "Design target. Not built; nothing is simulated for it",
    sampleRate: 1000,
    adcBits: 16,
    packet: 32,
    latencyMs: 0,
    jitterMs: 0,
    lossRate: 0,
    noiseUv: 0,
    capabilities: ["LIVE", "MULTI_SESSION"],
    available: false,
  },
};

export type Faults = {
  lineNoise: boolean;
  packetLoss: boolean;
  /** Index of a channel whose electrode has lifted, or -1. */
  liftedChannel: number;
  motion: boolean;
};

export const NO_FAULTS: Faults = {
  lineNoise: false,
  packetLoss: false,
  liftedChannel: -1,
  motion: false,
};

/** Rhythms planted in the stream. Measuring them back is the self-test. */
export const PLANTED = [
  { name: "alpha", freq: 10, amp: 22, where: ["O1", "O2", "P3", "P4", "Pz", "T5", "T6"] },
  { name: "alpha", freq: 10, amp: 6, where: null },
  { name: "theta", freq: 6, amp: 5, where: ["Fp1", "Fp2", "F3", "F4", "Fz", "F7", "F8"] },
  { name: "beta", freq: 20, amp: 3.5, where: ["C3", "C4", "Cz"] },
] as const;

export type LogLine = { t: number; text: string; tone: "call" | "ok" | "warn" };

export class SimStream {
  readonly profile: SourceProfile;
  readonly labels = MONTAGE_1020.map((e) => e.label);
  readonly seconds = 8;
  /** Ring buffers, µV. Lost packets are written as NaN so the trace shows the gap. */
  readonly buffers: Float32Array[];
  readonly capacity: number;
  head = 0;
  written = 0;
  dropped = 0;
  packets = 0;
  lostPackets = 0;
  readonly latencies: number[] = [];
  readonly log: LogLine[] = [];
  /** Totals ever pushed to `latencies` and `log`, which keep only the newest. */
  latencyCount = 0;
  logCount = 0;
  clock = 0;
  /**
   * Consumer buffer occupancy, 0–1, as last reported by whoever drains this
   * stream (StreamView measures it). The source cannot see it by itself.
   */
  bufferFill = 0;

  private seed: number;
  private pink: Float64Array; // Paul Kellet pink-noise filter state, 7 per channel
  private phase: Float64Array;
  private accum = 0;
  private sampleIndex = 0;
  private lastLog = 0;
  private impedanceBase: Float64Array;
  private gains: Float64Array; // planted amplitude per channel per rhythm

  constructor(profile: SourceProfile, seed = 20260928) {
    this.profile = profile;
    this.seed = seed >>> 0;
    this.capacity = Math.round(profile.sampleRate * this.seconds);
    this.buffers = this.labels.map(() => new Float32Array(this.capacity).fill(Number.NaN));
    this.pink = new Float64Array(this.labels.length * 7);
    this.phase = new Float64Array(this.labels.length * PLANTED.length);
    for (let i = 0; i < this.phase.length; i++) this.phase[i] = this.rand() * Math.PI * 2;
    this.impedanceBase = new Float64Array(this.labels.length);
    for (let c = 0; c < this.labels.length; c++) this.impedanceBase[c] = 4 + this.rand() * 7;
    this.gains = new Float64Array(this.labels.length * PLANTED.length);
    this.labels.forEach((label, c) => {
      PLANTED.forEach((p, k) => {
        const on = p.where === null || (p.where as readonly string[]).includes(label);
        this.gains[c * PLANTED.length + k] = on ? p.amp : 0;
      });
    });
    this.push(0, `connect() → True`, "ok");
    this.push(
      0,
      `get_metadata() → ${profile.impl}, ${this.labels.length} ch @ ${profile.sampleRate} Hz`,
      "call",
    );
    this.push(0, `capabilities() → {${profile.capabilities.join(", ")}}`, "call");
  }

  /** LCG in [0, 1). Deterministic: same seed, same stream. */
  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private gauss(): number {
    const u = Math.max(1e-12, this.rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  private push(t: number, text: string, tone: LogLine["tone"]) {
    this.log.push({ t, text, tone });
    this.logCount++;
    if (this.log.length > 60) this.log.shift();
  }

  /** Advance the stream by `dt` seconds of wall time. */
  advance(dt: number, faults: Faults) {
    const p = this.profile;
    if (!p.available) return;
    this.clock += dt;
    this.accum += dt * p.sampleRate;
    const n = Math.floor(this.accum);
    this.accum -= n;
    const nCh = this.labels.length;
    const loss = p.lossRate + (faults.packetLoss ? 0.06 : 0);

    let packetLost = false;
    for (let i = 0; i < n; i++) {
      // Packet boundary: decide loss and latency once per packet.
      if (this.sampleIndex % p.packet === 0) {
        packetLost = this.rand() < loss;
        this.packets++;
        if (packetLost) this.lostPackets++;
        else {
          this.latencies.push(Math.max(0.05, p.latencyMs + p.jitterMs * this.gauss()));
          this.latencyCount++;
          if (this.latencies.length > 240) this.latencies.shift();
        }
      }
      const t = this.sampleIndex / p.sampleRate;
      const motion = faults.motion && Math.sin(t * 0.9) > 0.55 ? 90 * Math.sin(t * 2.3) : 0;
      for (let c = 0; c < nCh; c++) {
        let v: number;
        if (packetLost) {
          v = Number.NaN;
        } else if (c === faults.liftedChannel) {
          // A lifted electrode: no neural signal, slow drift, and the rail noise
          // of an open input.
          v = 140 * Math.sin(t * 0.35 + c) + 6 * this.gauss();
        } else {
          // Pink noise (Paul Kellet's filter) scaled to the profile's floor.
          const w = this.gauss();
          const o = c * 7;
          const b = this.pink;
          b[o] = 0.99886 * b[o]! + w * 0.0555179;
          b[o + 1] = 0.99332 * b[o + 1]! + w * 0.0750759;
          b[o + 2] = 0.969 * b[o + 2]! + w * 0.153852;
          b[o + 3] = 0.8665 * b[o + 3]! + w * 0.3104856;
          b[o + 4] = 0.55 * b[o + 4]! + w * 0.5329522;
          b[o + 5] = -0.7616 * b[o + 5]! - w * 0.016898;
          const pinkV =
            b[o]! +
            b[o + 1]! +
            b[o + 2]! +
            b[o + 3]! +
            b[o + 4]! +
            b[o + 5]! +
            b[o + 6]! +
            w * 0.5362;
          b[o + 6] = w * 0.115926;
          v = pinkV * p.noiseUv * 0.35;
          for (let k = 0; k < PLANTED.length; k++) {
            const g = this.gains[c * PLANTED.length + k]!;
            if (g)
              v +=
                g *
                Math.sin(2 * Math.PI * PLANTED[k]!.freq * t + this.phase[c * PLANTED.length + k]!);
          }
          if (faults.lineNoise) v += 18 * Math.sin(2 * Math.PI * 50 * t);
          v += motion * (0.6 + 0.4 * Math.cos(c));
        }
        this.buffers[c]![this.head] = v;
      }
      if (packetLost) this.dropped++;
      this.head = (this.head + 1) % this.capacity;
      this.written++;
      this.sampleIndex++;
    }

    // The contract calls a consumer would make, logged at a readable pace.
    if (this.clock - this.lastLog > 0.6) {
      this.lastLog = this.clock;
      const chunk = Math.round(p.sampleRate / 4);
      this.push(this.clock, `read_chunk(${chunk}) → (${nCh}, ${chunk}) float32 µV`, "call");
      const h = this.health();
      this.push(
        this.clock,
        `health() → SourceHealth(dropped_samples=${h.dropped}, latency_ms=${h.latencyMs.toFixed(2)}, buffer_fill=${h.bufferFill.toFixed(2)})`,
        h.dropped > 0 && faults.packetLoss ? "warn" : "ok",
      );
      if (faults.liftedChannel >= 0) {
        this.push(
          this.clock,
          `impedance(${this.labels[faults.liftedChannel]}) > 500 kΩ — electrode contact lost`,
          "warn",
        );
      }
    }
  }

  health() {
    return {
      dropped: this.dropped,
      latencyMs: median(this.latencies),
      bufferFill: this.bufferFill,
    };
  }

  /** Modelled electrode impedance in kΩ. */
  impedance(c: number, faults: Faults): number {
    if (c === faults.liftedChannel) return 900 + 60 * Math.sin(this.clock * 2 + c);
    return this.impedanceBase[c]! * (1 + 0.06 * Math.sin(this.clock * 0.4 + c * 1.3));
  }

  /**
   * The most recent `seconds` of a channel, oldest first, with gaps (lost
   * packets) linearly bridged so spectral estimates are not poisoned by NaN.
   */
  recent(c: number, seconds: number): Float32Array {
    return ringRecent(this, c, this.written, seconds);
  }

  /** RMS of the last `seconds`, µV. */
  rms(c: number, seconds = 0.5): number {
    return rmsOf(this.recent(c, seconds));
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** The newest `seconds` of a ring buffer, oldest first, lost-packet gaps bridged. */
function ringRecent(
  r: { buffers: Float32Array[]; head: number; capacity: number; profile: SourceProfile },
  c: number,
  available: number,
  seconds: number,
): Float32Array {
  const n = Math.min(available, r.capacity, Math.round(seconds * r.profile.sampleRate));
  const out = new Float32Array(n);
  const buf = r.buffers[c]!;
  for (let i = 0; i < n; i++) out[i] = buf[(r.head - n + i + r.capacity) % r.capacity]!;
  let last = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(out[i]!)) out[i] = last;
    else last = out[i]!;
  }
  return out;
}

function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return x.length ? Math.sqrt(s / x.length) : 0;
}

/* ------------------------------------------------------------ worker ticks */

/** Display cadence: the worker delivers one chunk of samples per tick. */
export const TICK_MS = 250;
/** How long the DEGRADED state stays up after a tick overruns, ms. */
export const DEGRADED_HOLD_MS = 2000;

export type Tick = {
  /** Source clock after this tick, s. Advances with wall time while running. */
  clock: number;
  /** Samples per channel the source has produced in total. */
  written: number;
  /** Global sample index of the first sample in `chunk`. */
  start: number;
  /** New samples per channel, oldest first, µV. NaN marks a lost packet. */
  chunk: Float32Array[];
  /** New modelled per-packet link latencies, ms. */
  latencies: number[];
  /** New contract-log lines. */
  log: LogLine[];
  /** Modelled electrode impedance per channel now, kΩ. */
  impedance: Float32Array;
  /** Wall time since the previous tick, ms. */
  intervalMs: number;
  /** Time spent producing this tick, ms. */
  workMs: number;
  /** The tick started a full cadence late, or took longer than one. */
  overran: boolean;
};

/** Owns a SimStream in the worker and turns it into ticks. */
export class TickProducer {
  readonly stream: SimStream;
  private sent = 0;
  private latenciesSent = 0;
  private logSent = 0;
  private lastAt: number | null = null;

  constructor(profile: SourceProfile, seed?: number) {
    this.stream = new SimStream(profile, seed);
  }

  /** Advance by the wall time since the previous tick and package what is new. */
  tick(now: () => number, running: boolean, faults: Faults): Tick {
    const s = this.stream;
    const t0 = now();
    const intervalMs = this.lastAt === null ? TICK_MS : t0 - this.lastAt;
    this.lastAt = t0;
    // Wall-clock synchronised: generate exactly the time that passed, up to
    // what the ring can hold. Paused time is not generated.
    if (running) s.advance(Math.min(intervalMs / 1000, s.seconds), faults);

    const n = Math.min(s.written - this.sent, s.capacity);
    const chunk = s.buffers.map((buf) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf[(s.head - n + i + s.capacity) % s.capacity]!;
      return out;
    });
    this.sent = s.written;
    const nLat = Math.min(s.latencyCount - this.latenciesSent, s.latencies.length);
    const nLog = Math.min(s.logCount - this.logSent, s.log.length);
    this.latenciesSent = s.latencyCount;
    this.logSent = s.logCount;
    const impedance = Float32Array.from(s.labels, (_, c) => s.impedance(c, faults));
    const workMs = now() - t0;
    return {
      clock: s.clock,
      written: s.written,
      start: s.written - n,
      chunk,
      latencies: nLat ? s.latencies.slice(-nLat) : [],
      log: nLog ? s.log.slice(-nLog) : [],
      impedance,
      intervalMs,
      workMs,
      overran: running && (workMs > TICK_MS || intervalMs > 2 * TICK_MS),
    };
  }
}

/**
 * The main thread's view of a stream produced in the worker.
 *
 * Ticks arrive every TICK_MS. Their samples go into a playout buffer of two
 * ticks and are released at the sample rate, so the traces scroll smoothly.
 * Playback starts half a cadence after a full tick is queued, so the buffer
 * holds between half a tick and a tick and a half: a tick can arrive up to
 * half a cadence early or late without overflowing or stalling. Everything drawn
 * (traces, RMS, packets) reads the played-out state. `clock` and `written` are
 * the source's own counters from the latest tick. Buffer fill is the measured
 * occupancy of the playout buffer, averaged over about a second.
 */
export class StreamView {
  readonly profile: SourceProfile;
  readonly labels = MONTAGE_1020.map((e) => e.label);
  readonly seconds = 8;
  /** Played-out samples, µV, as a ring; NaN where a packet was lost. */
  readonly buffers: Float32Array[];
  readonly capacity: number;
  head = 0;
  /** Samples per channel the source reports producing. */
  written = 0;
  /** Samples per channel played out to the display. */
  played = 0;
  dropped = 0;
  packets = 0;
  lostPackets = 0;
  clock = 0;
  readonly latencies: number[] = [];
  readonly log: LogLine[] = [];
  /** Playout buffer size, samples per channel (two ticks). */
  readonly queueCapacity: number;
  /** Samples the source produced that overflowed the playout buffer. */
  overflowed = 0;

  private queue: Float32Array[];
  private qRead = 0;
  private qLen = 0;
  /** Global sample index of the next sample to enqueue. */
  private nextIndex = 0;
  private acc = 0;
  private primed = false;
  /** Seconds a full tick has been waiting while not primed. */
  private waited = 0;
  private fill = 0;
  private impedances: Float32Array;
  private overrunAt: number | null = null;

  constructor(profile: SourceProfile) {
    this.profile = profile;
    this.capacity = Math.round(profile.sampleRate * this.seconds);
    this.buffers = this.labels.map(() => new Float32Array(this.capacity).fill(Number.NaN));
    this.queueCapacity = Math.max(1, Math.round((profile.sampleRate * 2 * TICK_MS) / 1000));
    this.queue = this.labels.map(() => new Float32Array(this.queueCapacity));
    this.impedances = new Float32Array(this.labels.length);
  }

  /** Samples per channel waiting in the playout buffer. */
  get queued(): number {
    return this.qLen;
  }

  receive(t: Tick, nowMs: number) {
    this.clock = t.clock;
    this.written = t.written;
    this.impedances = t.impedance;
    for (const l of t.latencies) this.latencies.push(l);
    if (this.latencies.length > 240) this.latencies.splice(0, this.latencies.length - 240);
    for (const l of t.log) this.log.push(l);
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
    if (t.overran) this.overrunAt = nowMs;

    // A gap in sample indices means the source dropped samples it could not
    // hold; start the playout again from the new chunk.
    if (t.start !== this.nextIndex) {
      this.qLen = 0;
      this.primed = false;
      this.nextIndex = t.start;
    }
    const n = t.chunk[0]?.length ?? 0;
    for (let i = 0; i < n; i++) {
      if (this.qLen === this.queueCapacity) {
        // Full: drop the oldest queued sample.
        this.qRead = (this.qRead + 1) % this.queueCapacity;
        this.qLen--;
        this.overflowed++;
      }
      const w = (this.qRead + this.qLen) % this.queueCapacity;
      for (let c = 0; c < this.queue.length; c++) this.queue[c]![w] = t.chunk[c]![i]!;
      this.qLen++;
    }
    this.nextIndex = t.start + n;
  }

  /** Release `dt` seconds of samples to the display. */
  play(dt: number) {
    const p = this.profile;
    const tickSamples = Math.floor((p.sampleRate * TICK_MS) / 1000);
    if (!this.primed) {
      this.waited = this.qLen >= tickSamples ? this.waited + dt : 0;
      if (this.waited >= TICK_MS / 2000) {
        this.primed = true;
        this.waited = 0;
      }
    }
    if (this.primed) {
      this.acc += dt * p.sampleRate;
      let n = Math.floor(this.acc);
      this.acc -= n;
      if (n >= this.qLen) {
        // Underrun: play what there is and wait for the buffer to refill.
        n = this.qLen;
        this.acc = 0;
        this.primed = false;
      }
      for (let i = 0; i < n; i++) {
        const index = this.nextIndex - this.qLen;
        const r = this.qRead;
        const lost = Number.isNaN(this.queue[0]![r]!);
        if (index % p.packet === 0) {
          this.packets++;
          if (lost) this.lostPackets++;
        }
        if (lost) this.dropped++;
        for (let c = 0; c < this.buffers.length; c++)
          this.buffers[c]![this.head] = this.queue[c]![r]!;
        this.head = (this.head + 1) % this.capacity;
        this.played++;
        this.qRead = (this.qRead + 1) % this.queueCapacity;
        this.qLen--;
      }
    }
    // Occupancy averaged with a 1 s time constant: the raw value is a 4 Hz
    // sawtooth (filled per tick, drained per frame).
    const k = 1 - Math.exp(-Math.max(0, dt));
    this.fill += (this.qLen / this.queueCapacity - this.fill) * k;
  }

  health() {
    return { dropped: this.dropped, latencyMs: median(this.latencies), bufferFill: this.fill };
  }

  /** Modelled electrode impedance in kΩ, as of the latest tick. */
  impedance(c: number, _faults?: Faults): number {
    return this.impedances[c] ?? 0;
  }

  /** A tick overran within the last DEGRADED_HOLD_MS. */
  degraded(nowMs: number): boolean {
    return this.overrunAt !== null && nowMs - this.overrunAt < DEGRADED_HOLD_MS;
  }

  recent(c: number, seconds: number): Float32Array {
    return ringRecent(this, c, this.played, seconds);
  }

  rms(c: number, seconds = 0.5): number {
    return rmsOf(this.recent(c, seconds));
  }
}
