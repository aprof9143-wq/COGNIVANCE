import type { Stage } from "./loop";

/** Visual share of one loop period given to each stage. */
export const STAGE_SPANS: [Stage, number][] = [
  ["SENSE", 0.25],
  ["PREDICT", 0.17],
  ["VERIFY", 0.16],
  ["WRITE", 0.3],
  ["MEASURE", 0.12],
];

/** The stage shown at fraction `f` of a loop period, and how far into it. */
export function stageAt(f: number): { stage: Stage; phase: number; index: number } {
  let acc = 0;
  for (let i = 0; i < STAGE_SPANS.length; i++) {
    const [s, w] = STAGE_SPANS[i]!;
    if (f < acc + w) return { stage: s, phase: (f - acc) / w, index: i };
    acc += w;
  }
  return { stage: "MEASURE", phase: 1, index: STAGE_SPANS.length - 1 };
}
