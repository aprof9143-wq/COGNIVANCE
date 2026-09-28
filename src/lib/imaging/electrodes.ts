/**
 * Registered electrode coordinates.
 *
 * Electrodes are drawn in 3D only from coordinates a file supplies — never
 * projected from an idealised cap onto a scan. BIDS `*_electrodes.tsv` holds
 * name, x, y, z; BIDS coordinate systems are RAS-oriented, so positions are
 * converted to LPS. Whether they share the image's space is checked, not
 * assumed: electrodes outside the image (plus a scalp margin) are refused.
 */

import { worldBounds } from "./geometry";
import { ImagingError, type ElectrodeSet, type ImageVolume } from "./types";

export function parseElectrodesTsv(
  text: string,
  source: string,
  coordinateSystem = "unspecified",
): ElectrodeSet {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0]?.split("\t").map((h) => h.trim().toLowerCase()) ?? [];
  const [ni, xi, yi, zi] = ["name", "x", "y", "z"].map((k) => header.indexOf(k));
  if ([ni, xi, yi, zi].some((i) => i! < 0)) {
    throw new ImagingError(
      "malformed",
      "Electrode table needs name, x, y and z columns (BIDS electrodes.tsv).",
    );
  }
  const electrodes = [];
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    const x = Number.parseFloat(c[xi!] ?? "");
    const y = Number.parseFloat(c[yi!] ?? "");
    const z = Number.parseFloat(c[zi!] ?? "");
    // "n/a" rows are electrodes without a measured position: skipped, not zeroed.
    if (![x, y, z].every(Number.isFinite)) continue;
    electrodes.push({
      id: (c[ni!] ?? "").trim(),
      position: [-x, -y, z] as [number, number, number],
    });
  }
  if (!electrodes.length) throw new ImagingError("empty", "No electrode has a numeric position.");
  return {
    electrodes,
    coordinateSystem,
    units: "mm",
    registered: false,
    provenance: { source, method: "BIDS electrodes.tsv (RAS mm → LPS)", date: null, notes: [] },
  };
}

/**
 * Mark a set registered to an image only if its electrodes sit within the
 * image volume plus a margin for scalp and cap. A bounds check, not proof of
 * co-registration — the UI says which.
 */
export function checkElectrodes(set: ElectrodeSet, vol: ImageVolume, marginMm = 25): ElectrodeSet {
  const { min, max } = worldBounds(vol.ijkToLps, vol.dims);
  const inside = set.electrodes.filter((e) =>
    e.position.every((v, i) => v >= min[i]! - marginMm && v <= max[i]! + marginMm),
  ).length;
  const share = inside / set.electrodes.length;
  const ok = share >= 0.9;
  return {
    ...set,
    registered: ok,
    provenance: {
      ...set.provenance,
      notes: [
        ...set.provenance.notes.filter((n) => !n.startsWith("Bounds check")),
        `Bounds check: ${Math.round(share * 100)} % of electrodes within the image (+${marginMm} mm). ${ok ? "Displayed." : "Not displayed — coordinates are not in this image's space."}`,
      ],
    },
  };
}
