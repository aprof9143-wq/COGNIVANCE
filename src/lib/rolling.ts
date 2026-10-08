/**
 * Timestamped values kept for a fixed window (e.g. the last 60 s), with
 * percentiles on demand. Used for the measured loop latencies on /nimble and
 * /simulation.
 */

export type Percentiles = { p50: number; p95: number; n: number };

/** Nearest-rank percentile of a sorted array, q in (0, 1]. */
export function percentile(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

export class RollingWindow {
  private t: number[] = [];
  private v: number[] = [];
  private head = 0;

  constructor(readonly windowMs: number) {}

  push(atMs: number, value: number) {
    this.t.push(atMs);
    this.v.push(value);
    this.prune(atMs);
  }

  /** Drop values older than the window. */
  prune(nowMs: number) {
    const cut = nowMs - this.windowMs;
    while (this.head < this.t.length && this.t[this.head]! < cut) this.head++;
    // Compact once the dead prefix is large, so memory stays bounded.
    if (this.head > 4096 && this.head * 2 > this.t.length) {
      this.t = this.t.slice(this.head);
      this.v = this.v.slice(this.head);
      this.head = 0;
    }
  }

  get size(): number {
    return this.t.length - this.head;
  }

  /** p50 and p95 of the values in the window ending at `nowMs`, or null if empty. */
  percentiles(nowMs: number): Percentiles | null {
    this.prune(nowMs);
    const n = this.size;
    if (!n) return null;
    const s = Float64Array.from(this.v.slice(this.head)).sort();
    return { p50: percentile(s, 0.5), p95: percentile(s, 0.95), n };
  }

  /** Sum of the values in the window ending at `nowMs`. */
  sum(nowMs: number): number {
    this.prune(nowMs);
    let total = 0;
    for (let i = this.head; i < this.v.length; i++) total += this.v[i]!;
    return total;
  }

  clear() {
    this.t = [];
    this.v = [];
    this.head = 0;
  }
}
