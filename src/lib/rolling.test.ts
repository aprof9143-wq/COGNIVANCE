import { describe, expect, it } from "vitest";
import { percentile, RollingWindow } from "./rolling";

describe("rolling window", () => {
  it("uses nearest-rank percentiles", () => {
    const s = Float64Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(s, 0.5)).toBe(50);
    expect(percentile(s, 0.95)).toBe(95);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.5)).toBeNaN();
  });

  it("keeps only the values inside the window", () => {
    const w = new RollingWindow(1000);
    for (let t = 0; t <= 3000; t += 10) w.push(t, t);
    const q = w.percentiles(3000)!;
    expect(q.n).toBe(101); // 2000 … 3000
    expect(q.p50).toBe(2500);
    expect(w.percentiles(5000)).toBeNull();
  });

  it("sums the values inside the window", () => {
    // Time only moves forward: pruning is permanent.
    const w = new RollingWindow(1000);
    w.push(0, 5);
    w.push(500, 3);
    expect(w.sum(900)).toBe(8);
    w.push(1600, 2);
    expect(w.sum(1600)).toBe(2);
  });

  it("stays bounded over a long run", () => {
    const w = new RollingWindow(100);
    for (let t = 0; t < 100_000; t++) w.push(t, 1);
    expect(w.size).toBeLessThanOrEqual(101);
  });
});
