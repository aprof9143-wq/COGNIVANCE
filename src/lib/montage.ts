/**
 * The international 10-20 system.
 *
 * Unit directions in RAS (x right, y anterior, z superior), from the centre of
 * the head. These are the standard idealised positions on a sphere; a real
 * head is not a sphere, which is why the 3D view projects each one onto the
 * actual scalp of the loaded scan rather than using these radii directly.
 *
 * Both old (T3/T4/T5/T6) and new (T7/T8/P7/P8) temporal names are accepted —
 * recordings use either.
 */

export type ElectrodePosition = {
  label: string;
  dir: [number, number, number];
  /** 2D topomap position, x right, y anterior, both in −1…1. */
  topo: [number, number];
  region: "frontal" | "central" | "temporal" | "parietal" | "occipital";
  hemisphere: "left" | "right" | "midline";
};

const RAW: [string, number, number, number, ElectrodePosition["region"]][] = [
  ["Fp1", -0.309, 0.951, 0.0, "frontal"],
  ["Fp2", 0.309, 0.951, 0.0, "frontal"],
  ["F7", -0.809, 0.588, 0.0, "frontal"],
  ["F3", -0.545, 0.673, 0.5, "frontal"],
  ["Fz", 0.0, 0.719, 0.695, "frontal"],
  ["F4", 0.545, 0.673, 0.5, "frontal"],
  ["F8", 0.809, 0.588, 0.0, "frontal"],
  ["T3", -1.0, 0.0, 0.0, "temporal"],
  ["C3", -0.719, 0.0, 0.695, "central"],
  ["Cz", 0.0, 0.0, 1.0, "central"],
  ["C4", 0.719, 0.0, 0.695, "central"],
  ["T4", 1.0, 0.0, 0.0, "temporal"],
  ["T5", -0.809, -0.588, 0.0, "temporal"],
  ["P3", -0.545, -0.673, 0.5, "parietal"],
  ["Pz", 0.0, -0.719, 0.695, "parietal"],
  ["P4", 0.545, -0.673, 0.5, "parietal"],
  ["T6", 0.809, -0.588, 0.0, "temporal"],
  ["O1", -0.309, -0.951, 0.0, "occipital"],
  ["O2", 0.309, -0.951, 0.0, "occipital"],
];

/** Modern names map onto the classic positions. */
const ALIASES: Record<string, string> = { T7: "T3", T8: "T4", P7: "T5", P8: "T6" };

export const MONTAGE_1020: ElectrodePosition[] = RAW.map(([label, x, y, z, region]) => {
  const len = Math.hypot(x, y, z) || 1;
  // Azimuthal equidistant projection: the standard way a scalp is flattened
  // onto a topomap, so the rim of the circle is the head's equator.
  const polar = Math.acos(Math.max(-1, Math.min(1, z / len)));
  const radius = polar / (Math.PI / 2);
  const azimuth = Math.atan2(y, x);
  return {
    label,
    dir: [x / len, y / len, z / len],
    topo: [radius * Math.cos(azimuth) * 0.92, radius * Math.sin(azimuth) * 0.92],
    region,
    hemisphere: x < -0.05 ? "left" : x > 0.05 ? "right" : "midline",
  };
});

const BY_LABEL = new Map(MONTAGE_1020.map((e) => [e.label.toLowerCase(), e]));

export function findElectrode(label: string): ElectrodePosition | undefined {
  const canonical = ALIASES[label] ?? label;
  return BY_LABEL.get(canonical.toLowerCase());
}
