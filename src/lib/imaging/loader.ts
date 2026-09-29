/**
 * File → volume loading, shared by the Web Worker and tests. Runs anywhere
 * DecompressionStream exists (browsers and workers; Node 18+).
 */

import { buildVolume, groupSeries, parseDicomInstance, type DicomInstance } from "./dicom";
import { parseNiftiImage, parseNiftiSegmentation } from "./nifti";
import { ImagingError, type ImageVolume, type SegmentationVolume } from "./types";

export type FileInput = { name: string; buffer: ArrayBuffer };

export type FileFailure = { file: string; kind: ImagingError["kind"] | "unknown"; message: string };

export type SeriesSummary = {
  uid: string;
  description: string;
  modality: string | null;
  instances: number;
  frames: number;
};

export async function gunzipIfNeeded(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  if (!(head[0] === 0x1f && head[1] === 0x8b)) return buffer;
  if (typeof DecompressionStream === "undefined") {
    throw new ImagingError(
      "unsupported-image",
      "This browser cannot decompress .gz files; load the uncompressed file.",
    );
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export const isNiftiName = (name: string) => /\.nii(\.gz)?$/i.test(name);

function failure(file: string, e: unknown): FileFailure {
  if (e instanceof ImagingError) return { file, kind: e.kind, message: e.message };
  return { file, kind: "unknown", message: e instanceof Error ? e.message : String(e) };
}

/** Holds parsed DICOM instances so a different series can be built later. */
export class ImageLoader {
  private instances: DicomInstance[] = [];

  /** Parse a batch. Returns a volume for NIfTI, or the DICOM series found. */
  async load(files: FileInput[]): Promise<{
    nifti: ImageVolume | null;
    series: SeriesSummary[];
    failures: FileFailure[];
  }> {
    const failures: FileFailure[] = [];
    const dicom: DicomInstance[] = [];
    let nifti: ImageVolume | null = null;
    for (const f of files) {
      try {
        if (isNiftiName(f.name)) {
          nifti = parseNiftiImage(await gunzipIfNeeded(f.buffer), f.name.replace(/\.gz$/i, ""));
        } else {
          dicom.push(parseDicomInstance(f.buffer));
        }
      } catch (e) {
        failures.push(failure(f.name, e));
      }
    }
    if (dicom.length) this.instances = dicom;
    const series = [...groupSeries(this.instances)].map(([uid, list]) => ({
      uid,
      description:
        list[0]!.meta.seriesDescription ?? list[0]!.meta.protocolName ?? "Unnamed series",
      modality: list[0]!.meta.modality,
      instances: list.length,
      frames: list.reduce((n, i) => n + i.frames.length, 0),
    }));
    series.sort((a, b) => b.frames - a.frames);
    return { nifti, series, failures };
  }

  build(uid: string): ImageVolume {
    const list = groupSeries(this.instances).get(uid);
    if (!list) throw new ImagingError("empty", "That series is no longer loaded.");
    const desc = list[0]!.meta.seriesDescription ?? list[0]!.meta.protocolName ?? "DICOM series";
    return buildVolume(list, desc);
  }
}

/** Optional BIDS-style label names: a TSV with `index` and `name` columns. */
export function parseLabelTable(text: string): Record<number, string> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0]?.split("\t").map((h) => h.trim().toLowerCase()) ?? [];
  const idx = header.indexOf("index");
  const name = header.indexOf("name");
  if (idx < 0 || name < 0)
    throw new ImagingError(
      "malformed",
      "Label table needs 'index' and 'name' columns (BIDS dseg.tsv).",
    );
  const out: Record<number, string> = {};
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const i = Number.parseInt(cols[idx] ?? "", 10);
    if (Number.isFinite(i) && cols[name]?.trim()) out[i] = cols[name]!.trim();
  }
  return out;
}

export async function loadSegmentation(
  file: FileInput,
  names?: Record<number, string>,
  convention: string | null = null,
): Promise<SegmentationVolume> {
  return parseNiftiSegmentation(
    await gunzipIfNeeded(file.buffer),
    file.name.replace(/\.gz$/i, ""),
    names,
    convention,
  );
}
