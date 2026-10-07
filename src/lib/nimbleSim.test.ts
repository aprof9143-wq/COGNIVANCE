import { describe, expect, it } from "vitest";
import {
  DEGRADED_HOLD_MS,
  NO_FAULTS,
  PROFILES,
  SimStream,
  StreamView,
  TICK_MS,
  TickProducer,
  type Faults,
} from "./nimbleSim";

const LOSSY: Faults = { ...NO_FAULTS, packetLoss: true };

/** Drive a producer and a view the way the worker and the page do. */
function run(ticks: number, faults: Faults = NO_FAULTS) {
  const producer = new TickProducer(PROFILES.mcu, 42);
  const view = new StreamView(PROFILES.mcu);
  let t = 0;
  const clock = () => t;
  for (let i = 0; i < ticks; i++) {
    t += TICK_MS;
    view.receive(producer.tick(clock, true, faults), t);
    for (let f = 0; f < 15; f++) view.play(TICK_MS / 1000 / 15);
  }
  return { producer, view, t };
}

describe("worker ticks", () => {
  it("keeps wall time: each tick generates exactly the time that passed", () => {
    const { producer } = run(40);
    const s = producer.stream;
    expect(s.clock).toBeCloseTo(40 * (TICK_MS / 1000), 9);
    expect(Math.abs(s.written - s.clock * s.profile.sampleRate)).toBeLessThanOrEqual(1);
  });

  it("generates nothing while paused", () => {
    const p = new TickProducer(PROFILES.simulated, 1);
    let t = 0;
    const clock = () => t;
    t += TICK_MS;
    p.tick(clock, true, NO_FAULTS);
    const before = p.stream.written;
    t += TICK_MS;
    const paused = p.tick(clock, false, NO_FAULTS);
    expect(paused.chunk[0]!.length).toBe(0);
    expect(p.stream.written).toBe(before);
    expect(paused.overran).toBe(false);
  });

  it("flags a tick that starts a cadence late or takes longer than one", () => {
    const p = new TickProducer(PROFILES.simulated, 1);
    let t = 0;
    const clock = () => t;
    t += TICK_MS;
    expect(p.tick(clock, true, NO_FAULTS).overran).toBe(false);
    t += 2 * TICK_MS + 1;
    expect(p.tick(clock, true, NO_FAULTS).overran).toBe(true);
    // Work that outlasts the cadence: the clock moves during the tick.
    let calls = 0;
    const slow = () => (calls++ === 0 ? (t += TICK_MS) : t + TICK_MS + 1);
    expect(p.tick(slow, true, NO_FAULTS).overran).toBe(true);
  });

  it("reports only what is new since the previous tick", () => {
    const p = new TickProducer(PROFILES.simulated, 1);
    let t = 0;
    const clock = () => t;
    let total = 0;
    let next = 0;
    for (let i = 0; i < 12; i++) {
      t += TICK_MS;
      const k = p.tick(clock, true, NO_FAULTS);
      expect(k.start).toBe(next);
      next = k.start + k.chunk[0]!.length;
      total += k.chunk[0]!.length;
      expect(k.chunk).toHaveLength(19);
      expect(k.impedance).toHaveLength(19);
    }
    expect(total).toBe(p.stream.written);
  });
});

describe("stream view (page side)", () => {
  it("plays out exactly the samples, packets and losses the source produced", () => {
    const { producer, view } = run(48, LOSSY);
    view.play(10); // drain what is still queued
    const s = producer.stream;
    expect(view.played).toBe(s.written);
    expect(view.packets).toBe(s.packets);
    expect(view.lostPackets).toBe(s.lostPackets);
    expect(s.lostPackets).toBeGreaterThan(0);
    expect(view.dropped).toBe(s.dropped);
    for (let c = 0; c < 19; c++) {
      const a = view.recent(c, 8);
      const b = s.recent(c, 8);
      expect(a).toEqual(b);
    }
    expect(view.rms(3)).toBeCloseTo(s.rms(3), 9);
  });

  it("waits half a cadence after a full tick, then scrolls at the sample rate", () => {
    const p = new TickProducer(PROFILES.simulated, 3);
    const v = new StreamView(PROFILES.simulated);
    const t = TICK_MS;
    v.receive(
      p.tick(() => t, true, NO_FAULTS),
      t,
    );
    v.play(0.1);
    expect(v.played).toBe(0); // waited 100 of 125 ms
    v.play(0.05);
    expect(v.played).toBe(12); // primed: 256 Hz × 0.05 s
    v.play(0.125);
    expect(v.played).toBe(44);
  });

  it("measures buffer fill from its own playout buffer, without overflow", () => {
    const { view } = run(60);
    const fill = view.health().bufferFill;
    // Steady state oscillates between half a tick and a tick and a half of a
    // two-tick buffer, so the average sits near the middle.
    expect(fill).toBeGreaterThan(0.35);
    expect(fill).toBeLessThan(0.65);
    expect(view.overflowed).toBe(0);
  });

  it("drops the oldest samples when the page stops draining", () => {
    const p = new TickProducer(PROFILES.simulated, 3);
    const v = new StreamView(PROFILES.simulated);
    let t = 0;
    for (let i = 0; i < 6; i++) {
      t += TICK_MS;
      v.receive(
        p.tick(() => t, true, NO_FAULTS),
        t,
      );
    }
    expect(v.queued).toBe(v.queueCapacity);
    expect(v.overflowed).toBe(p.stream.written - v.queueCapacity);
  });

  it("shows DEGRADED for a while after an overrun", () => {
    const v = new StreamView(PROFILES.simulated);
    const p = new TickProducer(PROFILES.simulated, 3);
    let t = TICK_MS;
    v.receive(
      p.tick(() => t, true, NO_FAULTS),
      t,
    );
    expect(v.degraded(t)).toBe(false);
    t += 3 * TICK_MS;
    const late = p.tick(() => t, true, NO_FAULTS);
    expect(late.overran).toBe(true);
    v.receive(late, t);
    expect(v.degraded(t + DEGRADED_HOLD_MS - 1)).toBe(true);
    expect(v.degraded(t + DEGRADED_HOLD_MS)).toBe(false);
  });
});

describe("source health", () => {
  it("reports the consumer's measured buffer fill, not a modelled one", () => {
    const s = new SimStream(PROFILES.simulated, 5);
    expect(s.health().bufferFill).toBe(0);
    s.bufferFill = 0.42;
    s.advance(1, NO_FAULTS);
    expect(s.health().bufferFill).toBe(0.42);
    expect(s.log.some((l) => l.text.includes("buffer_fill=0.42"))).toBe(true);
  });
});
