import { describe, expect, it } from "vitest";
import {
  DYNAMICS,
  Responder,
  SCENARIOS,
  frameAt,
  pupilForLuminance,
  pupilResponder,
  scenarioLength,
  trolands,
} from "./dynamics";

describe("pupil steady state (Moon & Spencer)", () => {
  it("is 4.9 mm at 1 cd/m² and stays inside 1.9–7.9 mm", () => {
    expect(pupilForLuminance(1)).toBeCloseTo(4.9, 6);
    for (const L of [1e-6, 1e-3, 1, 1e3, 1e6]) {
      expect(pupilForLuminance(L)).toBeGreaterThan(1.9);
      expect(pupilForLuminance(L)).toBeLessThan(7.9);
    }
  });
  it("gets smaller as light increases", () => {
    let prev = Infinity;
    for (const L of [0.001, 0.1, 10, 100, 3000, 30000]) {
      const d = pupilForLuminance(L);
      expect(d).toBeLessThan(prev);
      prev = d;
    }
  });
  it("trolands are luminance times pupil area", () => {
    expect(trolands(100, 2)).toBeCloseTo(100 * Math.PI, 9);
  });
});

describe("Responder", () => {
  const run = (r: Responder, from: number, to: number, dt = 0.001) => {
    for (let t = from + dt; t <= to + 1e-9; t += dt) r.step(t, dt);
    return r.value;
  };

  it("does nothing until the latency has passed", () => {
    const r = new Responder(0, 0.3, 0.5, 0.5);
    r.aim(0, 1);
    expect(run(r, 0, 0.29)).toBe(0);
  });

  it("reaches 1 − 1/e of the step one time constant after the latency", () => {
    const r = new Responder(0, 0.3, 0.5, 0.5);
    r.aim(0, 1);
    expect(run(r, 0, 0.8)).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it("the pupil closes faster than it opens", () => {
    const close = pupilResponder(6);
    close.aim(0, 2);
    const open = pupilResponder(2);
    open.aim(0, 6);
    const t = DYNAMICS.pupilLatency.value + 0.5;
    const closed = (6 - run(close, 0, t)) / 4;
    const opened = (run(open, 0, t) - 2) / 4;
    expect(closed).toBeGreaterThan(opened * 2);
  });

  it("settles", () => {
    const r = new Responder(0, 0.1, 0.2, 0.2);
    r.aim(0, 1);
    run(r, 0, 3);
    expect(r.settled(1e-3)).toBe(true);
  });
});

describe("scenarios", () => {
  it("are ordered in time and start at 0", () => {
    for (const s of SCENARIOS) {
      expect(s.frames[0]!.t).toBe(0);
      for (let i = 1; i < s.frames.length; i++)
        expect(s.frames[i]!.t).toBeGreaterThan(s.frames[i - 1]!.t);
      expect(frameAt(s, scenarioLength(s) + 1)).toBe(s.frames[s.frames.length - 1]);
    }
  });
});
