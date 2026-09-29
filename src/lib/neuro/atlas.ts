/**
 * Atlas identifiers used by the module: the FreeSurfer colour lookup table
 * (FreeSurferColorLUT.txt), which labels both `aseg` subcortical structures
 * and Desikan–Killiany (`aparc`) cortical parcels. Regions are stored by these
 * integer IDs; names are for display only.
 *
 * Desikan RS, et al. An automated labeling system for subdividing the human
 * cerebral cortex on MRI scans into gyral based regions of interest.
 * NeuroImage 2006;31:968–980.
 */

export const ATLAS = "FreeSurfer aseg + Desikan-Killiany (aparc)";

export type AtlasRegion = {
  id: number;
  name: string;
  hemisphere: "left" | "right" | "midline";
  /** Pairs left/right homologues for asymmetry. */
  key: string;
};

const ASEG: [number, string, "left" | "right" | "midline", string][] = [
  [4, "Lateral ventricle", "left", "lateral-ventricle"],
  [43, "Lateral ventricle", "right", "lateral-ventricle"],
  [5, "Inferior lateral ventricle", "left", "inf-lat-vent"],
  [44, "Inferior lateral ventricle", "right", "inf-lat-vent"],
  [10, "Thalamus", "left", "thalamus"],
  [49, "Thalamus", "right", "thalamus"],
  [11, "Caudate", "left", "caudate"],
  [50, "Caudate", "right", "caudate"],
  [12, "Putamen", "left", "putamen"],
  [51, "Putamen", "right", "putamen"],
  [13, "Pallidum", "left", "pallidum"],
  [52, "Pallidum", "right", "pallidum"],
  [17, "Hippocampus", "left", "hippocampus"],
  [53, "Hippocampus", "right", "hippocampus"],
  [18, "Amygdala", "left", "amygdala"],
  [54, "Amygdala", "right", "amygdala"],
  [8, "Cerebellum cortex", "left", "cerebellum-cortex"],
  [47, "Cerebellum cortex", "right", "cerebellum-cortex"],
  [7, "Cerebellum white matter", "left", "cerebellum-wm"],
  [46, "Cerebellum white matter", "right", "cerebellum-wm"],
  [14, "3rd ventricle", "midline", "3rd-ventricle"],
  [15, "4th ventricle", "midline", "4th-ventricle"],
  [16, "Brainstem", "midline", "brainstem"],
  [77, "White-matter hypointensities", "midline", "wm-hypointensities"],
];

/** Desikan–Killiany parcels; left = 1000 + index, right = 2000 + index. */
const DK: [number, string][] = [
  [1, "Banks of superior temporal sulcus"],
  [2, "Caudal anterior cingulate"],
  [3, "Caudal middle frontal"],
  [5, "Cuneus"],
  [6, "Entorhinal"],
  [7, "Fusiform"],
  [8, "Inferior parietal"],
  [9, "Inferior temporal"],
  [10, "Isthmus cingulate"],
  [11, "Lateral occipital"],
  [12, "Lateral orbitofrontal"],
  [13, "Lingual"],
  [14, "Medial orbitofrontal"],
  [15, "Middle temporal"],
  [16, "Parahippocampal"],
  [17, "Paracentral"],
  [18, "Pars opercularis"],
  [19, "Pars orbitalis"],
  [20, "Pars triangularis"],
  [21, "Pericalcarine"],
  [22, "Postcentral"],
  [23, "Posterior cingulate"],
  [24, "Precentral"],
  [25, "Precuneus"],
  [26, "Rostral anterior cingulate"],
  [27, "Rostral middle frontal"],
  [28, "Superior frontal"],
  [29, "Superior parietal"],
  [30, "Superior temporal"],
  [31, "Supramarginal"],
  [32, "Frontal pole"],
  [33, "Temporal pole"],
  [34, "Transverse temporal"],
  [35, "Insula"],
];

/** FreeSurfer aparc short names ("entorhinal") → DK index, for importing stats files. */
export const DK_SHORT: Record<string, number> = {
  bankssts: 1,
  caudalanteriorcingulate: 2,
  caudalmiddlefrontal: 3,
  cuneus: 5,
  entorhinal: 6,
  fusiform: 7,
  inferiorparietal: 8,
  inferiortemporal: 9,
  isthmuscingulate: 10,
  lateraloccipital: 11,
  lateralorbitofrontal: 12,
  lingual: 13,
  medialorbitofrontal: 14,
  middletemporal: 15,
  parahippocampal: 16,
  paracentral: 17,
  parsopercularis: 18,
  parsorbitalis: 19,
  parstriangularis: 20,
  pericalcarine: 21,
  postcentral: 22,
  posteriorcingulate: 23,
  precentral: 24,
  precuneus: 25,
  rostralanteriorcingulate: 26,
  rostralmiddlefrontal: 27,
  superiorfrontal: 28,
  superiorparietal: 29,
  superiortemporal: 30,
  supramarginal: 31,
  frontalpole: 32,
  temporalpole: 33,
  transversetemporal: 34,
  insula: 35,
};

export const REGIONS: AtlasRegion[] = [
  ...ASEG.map(([id, name, hemisphere, key]) => ({ id, name, hemisphere, key })),
  ...DK.flatMap(([i, name]) => {
    const key = name.toLowerCase().replace(/\s+/g, "-");
    return [
      { id: 1000 + i, name, hemisphere: "left" as const, key },
      { id: 2000 + i, name, hemisphere: "right" as const, key },
    ];
  }),
];

const BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

export function region(id: number): AtlasRegion | undefined {
  return BY_ID.get(id);
}

/** The contralateral homologue's ID, or null for midline structures. */
export function homologue(id: number): number | null {
  const r = BY_ID.get(id);
  if (!r || r.hemisphere === "midline") return null;
  const other = REGIONS.find(
    (x) => x.key === r.key && x.hemisphere !== r.hemisphere && x.hemisphere !== "midline",
  );
  return other?.id ?? null;
}

/** All atlas IDs for a region key, e.g. "hippocampus" → [17, 53]. */
export function idsForKey(key: string): number[] {
  return REGIONS.filter((r) => r.key === key).map((r) => r.id);
}
