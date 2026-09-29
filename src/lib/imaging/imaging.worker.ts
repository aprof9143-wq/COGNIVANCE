/// <reference lib="webworker" />
/**
 * Decoding worker: DICOM/NIfTI parsing and volume building off the main thread.
 * Volumes come back with their voxel buffer transferred, not copied.
 */

import { ImageLoader, loadSegmentation, type FileInput } from "./loader";
import { ImagingError } from "./types";

export type WorkerRequest =
  | { id: number; type: "load"; files: FileInput[] }
  | { id: number; type: "build"; uid: string }
  | {
      id: number;
      type: "segmentation";
      file: FileInput;
      names?: Record<number, string> | undefined;
      convention: string | null;
    };

const loader = new ImageLoader();
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.type === "load") {
      const result = await loader.load(req.files);
      ctx.postMessage(
        { id: req.id, ok: true, result },
        result.nifti ? [result.nifti.data.buffer as ArrayBuffer] : [],
      );
    } else if (req.type === "build") {
      const volume = loader.build(req.uid);
      ctx.postMessage({ id: req.id, ok: true, result: volume }, [
        volume.data.buffer as ArrayBuffer,
      ]);
    } else {
      const seg = await loadSegmentation(req.file, req.names, req.convention);
      ctx.postMessage({ id: req.id, ok: true, result: seg }, [seg.labels.buffer as ArrayBuffer]);
    }
  } catch (e) {
    ctx.postMessage({
      id: req.id,
      ok: false,
      error: {
        kind: e instanceof ImagingError ? e.kind : "unknown",
        message: e instanceof Error ? e.message : String(e),
      },
    });
  }
};
