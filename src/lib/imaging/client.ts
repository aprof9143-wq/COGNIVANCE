/**
 * Main-thread client for the decoding worker. Promise per request; buffers
 * are transferred in both directions.
 */

import type { WorkerRequest } from "./imaging.worker";
import type { FileFailure, FileInput, SeriesSummary } from "./loader";
import { ImagingError, type ImageVolume, type SegmentationVolume } from "./types";

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

type Req =
  | { type: "load"; files: FileInput[] }
  | { type: "build"; uid: string }
  | {
      type: "segmentation";
      file: FileInput;
      names?: Record<number, string> | undefined;
      convention: string | null;
    };

export class ImagingClient {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("./imaging.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (
      e: MessageEvent<{
        id: number;
        ok: boolean;
        result?: unknown;
        error?: { kind: ImagingError["kind"]; message: string };
      }>,
    ) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new ImagingError(e.data.error!.kind, e.data.error!.message));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values())
        p.reject(new ImagingError("malformed", `Decoder crashed: ${e.message}`));
      this.pending.clear();
    };
  }

  private call<T>(req: Req, transfer: Transferable[] = []): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  load(files: FileInput[]) {
    return this.call<{
      nifti: ImageVolume | null;
      series: SeriesSummary[];
      failures: FileFailure[];
    }>(
      { type: "load", files },
      files.map((f) => f.buffer),
    );
  }

  build(uid: string) {
    return this.call<ImageVolume>({ type: "build", uid });
  }

  segmentation(
    file: FileInput,
    names: Record<number, string> | undefined,
    convention: string | null,
  ) {
    return this.call<SegmentationVolume>({ type: "segmentation", file, names, convention }, [
      file.buffer,
    ]);
  }

  dispose() {
    this.worker.terminate();
  }
}

export async function readFiles(files: File[]): Promise<FileInput[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() })));
}
