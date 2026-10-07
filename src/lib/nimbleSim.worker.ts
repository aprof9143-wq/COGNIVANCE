/// <reference lib="webworker" />
/**
 * Runs the NIMBLE simulated stream off the main thread. Every TICK_MS it
 * advances the stream by the wall time that passed and posts the new samples,
 * counters and log lines; the page plays them out (StreamView).
 */

import {
  NO_FAULTS,
  PROFILES,
  TICK_MS,
  TickProducer,
  type Faults,
  type SourceKind,
  type Tick,
} from "./nimbleSim";

export type SimRequest =
  /** A new connection: fresh stream, fresh counters. */
  | { type: "start"; kind: SourceKind; session: number }
  | { type: "faults"; faults: Faults }
  | { type: "run"; running: boolean }
  /** Playout-buffer occupancy measured on the page, for the health() log line. */
  | { type: "fill"; value: number };

export type SimTick = Tick & { session: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const now = () => performance.now();

let producer: TickProducer | null = null;
let session = 0;
let faults: Faults = NO_FAULTS;
let running = true;

setInterval(() => {
  if (!producer) return;
  const t: SimTick = { ...producer.tick(now, running, faults), session };
  ctx.postMessage(
    t,
    t.chunk.map((c) => c.buffer),
  );
}, TICK_MS);

ctx.onmessage = (e: MessageEvent<SimRequest>) => {
  const m = e.data;
  if (m.type === "start") {
    producer = new TickProducer(PROFILES[m.kind]);
    session = m.session;
    faults = NO_FAULTS;
  } else if (m.type === "faults") {
    faults = m.faults;
  } else if (m.type === "run") {
    running = m.running;
  } else if (producer) {
    producer.stream.bufferFill = m.value;
  }
};
