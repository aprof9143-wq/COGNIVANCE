/// <reference lib="webworker" />
/**
 * Runs an in-silico cohort off the main thread so the 3D view keeps rendering.
 * Input and output are plain data; beams are recomputed here from placements.
 */

import type { ArrayDesign } from "./acoustics";
import type { Placement } from "./anatomy";
import { runCohort } from "./benchmark";
import { diseaseByKey, type DiseaseKey } from "./diseases";
import { computeBeams } from "./loop";
import type { RegionKey } from "./neural";

export type BenchRequest = {
  disease: DiseaseKey;
  /** Target regions that replace the programme's own (a subject's config.json). */
  targets?: RegionKey[];
  design: ArrayDesign;
  placements: { region: RegionKey; placement: Placement }[];
  dutyLimit: number;
  patients: number;
  loops: number;
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<BenchRequest>) => {
  const r = e.data;
  try {
    const base = diseaseByKey(r.disease);
    const disease = r.targets ? { ...base, targets: r.targets } : base;
    const beams = computeBeams(r.design, r.placements);
    const result = await runCohort(
      {
        disease,
        design: r.design,
        beams,
        dutyLimit: r.dutyLimit,
        patients: r.patients,
        loops: r.loops,
      },
      (done, total) => ctx.postMessage({ type: "progress", done, total }),
    );
    ctx.postMessage({ type: "result", result });
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
