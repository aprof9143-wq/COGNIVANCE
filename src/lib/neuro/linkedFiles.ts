/**
 * The image files behind the current linked scan, kept in memory only (never
 * stored, never sent), so the tracking dashboard's 3D map can show the same
 * scan and label map the console has loaded without asking for them again.
 * Lost on reload by design; the template is always available from its URL.
 */

export type LinkedFile = { name: string; buffer: ArrayBuffer };

export type LinkedFiles =
  { source: "template" } | { source: "subject"; t1: LinkedFile; parc: LinkedFile | null } | null;

let files: LinkedFiles = null;

export function setLinkedFiles(next: LinkedFiles) {
  files = next;
}

/** Attach a label map to the subject scan that is currently linked. */
export function setLinkedParcellation(parc: LinkedFile) {
  if (files?.source === "subject") files = { ...files, parc };
}

export function getLinkedFiles(): LinkedFiles {
  return files;
}
