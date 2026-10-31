/**
 * Which library a page shows: the captured snapshot when it exists, otherwise
 * the synthetic sample, said plainly. Never both, and never a mixture.
 */
import { SAMPLE_LIBRARY } from "./sample";
import { parseLibrary, type Library } from "./schema";

/** The display copy built by tools/genome-library/capture_library.py. */
export const LIBRARY_URL = "/genomics/library.json";

export type Loaded =
  | { kind: "snapshot"; lib: Library }
  | { kind: "sample"; lib: Library; reason: string }
  | { kind: "error"; message: string };

type Fetcher = (url: string) => Promise<Response>;

export async function loadLibrary(fetcher: Fetcher = (u) => fetch(u)): Promise<Loaded> {
  let res: Response;
  try {
    res = await fetcher(LIBRARY_URL);
  } catch (e) {
    return { kind: "error", message: `The library could not be read: ${(e as Error).message}` };
  }
  if (res.status === 404)
    return {
      kind: "sample",
      lib: SAMPLE_LIBRARY,
      reason: "No library has been captured yet, so synthetic sample data is shown.",
    };
  if (!res.ok)
    return { kind: "error", message: `The library could not be read: HTTP ${res.status}` };
  try {
    const lib = parseLibrary(await res.json());
    if (lib.mode !== "snapshot")
      return {
        kind: "error",
        message: `The served library is marked "${lib.mode}", not a snapshot.`,
      };
    return { kind: "snapshot", lib };
  } catch (e) {
    return {
      kind: "error",
      message: `The library file is not in the expected format: ${(e as Error).message.slice(0, 200)}`,
    };
  }
}
