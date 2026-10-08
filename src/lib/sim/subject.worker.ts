/// <reference lib="webworker" />
/**
 * Builds a subject's anatomy off the main thread (a few seconds for a 1 mm
 * head), so the 3D view keeps rendering. The page merges the result into the
 * template with composeSubject().
 */

import { analyseSubject, type SubjectFile, type SubjectParts, type SubjectRef } from "./subject";

export type SubjectRequest = { files: SubjectFile[]; ref: SubjectRef };

export type SubjectReply =
  | { type: "step"; step: string }
  | { type: "done"; parts: SubjectParts }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<SubjectRequest>) => {
  try {
    const parts = await analyseSubject(e.data.files, e.data.ref, (step) =>
      ctx.postMessage({ type: "step", step } satisfies SubjectReply),
    );
    const transfer: ArrayBuffer[] = [];
    const take = (a: Float32Array | Uint32Array | null | undefined) => {
      if (a) transfer.push(a.buffer as ArrayBuffer);
    };
    take(parts.scalp);
    take(parts.outer);
    take(parts.cortex?.positions);
    take(parts.cortex?.indices);
    for (const d of Object.values(parts.deep)) {
      take(d?.positions);
      take(d?.indices);
    }
    ctx.postMessage({ type: "done", parts } satisfies SubjectReply, transfer);
  } catch (err) {
    ctx.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies SubjectReply);
  }
};
