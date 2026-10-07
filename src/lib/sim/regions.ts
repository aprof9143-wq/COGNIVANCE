/**
 * Regions of the anatomy, gated regions and their depth, for the Simulation
 * Window's "Depth & localisation" panel.
 *
 * The deep (subcortical) targets are gated: scalp EEG cannot localise activity
 * there to anything like the precision of a cortical source, so an estimate
 * for them needs cross-validation (fMRI or intracranial EEG) before clinical
 * use. This is background for scalp EEG. The simulation itself senses with a
 * mesh on the cortical surface and writes with focused ultrasound.
 *
 * Every number is either computed here from the MNI152 anatomy (coordinates,
 * depths) or quoted from a reference listed in REFS, which were checked
 * against the publications.
 */

import type { Vec3 } from "./acoustics";
import { nearestVertex, placeArray, targetPoint, type Anatomy } from "./anatomy";
import { REGION_INDEX, type RegionKey } from "./neural";

/**
 * Regions shown and measured on the anatomy but not simulated: the oscillator
 * network (neural.ts) has no coupling data for them, so they are not nodes of
 * it and cannot be stimulation targets.
 */
export const ANATOMY_ONLY = [
  "caudate",
  "putamen",
  "accumbens",
  "lgn",
  "vis_dorsal",
  "vis_ventral",
  "ifg",
  "smg",
] as const;

export type AnatomyOnlyKey = (typeof ANATOMY_ONLY)[number];
/** Any region of the anatomy: a network region or an anatomy-only one. */
export type AnyRegionKey = RegionKey | AnatomyOnlyKey;

export const isSimulated = (k: string): k is RegionKey => k in REGION_INDEX;

/**
 * Deep regions: subcortical, out of reach of scalp-EEG localisation. The
 * network's deep targets first, then the anatomy-only ones.
 */
export const GATED_REGIONS: AnyRegionKey[] = [
  "amygdala",
  "hippocampus",
  "thalamus",
  "stn",
  "caudate",
  "putamen",
  "accumbens",
  "lgn",
];

export const isGated = (k: AnyRegionKey) => GATED_REGIONS.includes(k);

/**
 * The spec's Julich-Brain areas that a broader Schaefer region stands in for.
 * Schaefer's network parcels do not follow these borders (see
 * tools/demo-assets/sim_regions.json for each region's make-up).
 */
export const STANDS_FOR: Partial<Record<AnyRegionKey, string>> = {
  vis_dorsal: "V3d (hOc3d)",
  vis_ventral: "V4v (hOc4v)",
  ifg: "Areas 44 and 45",
  smg: "PFt",
};

/** Regions the spec lists that are not in the anatomy, and why. */
export const NOT_INCLUDED: { name: string; reason: string }[] = [
  {
    name: "Hypothalamus",
    reason:
      "no permissively licensed MNI152 label. The aseg only has the ventral diencephalon, which lumps it with other nuclei; MASSP has none.",
  },
  {
    name: "Area TE 1.0",
    reason:
      "primary auditory cortex has no parcel of its own in Schaefer; it lies inside Auditory cortex.",
  },
];

export type RegionDepth = {
  region: AnyRegionKey;
  side: "left" | "right";
  /** Hemisphere centroid of the region, MNI152 RAS mm, from the label map. */
  mni: Vec3;
  /** To the nearest point of the brain surface, where the implant's array sits. */
  belowBrainMm: number;
  /** To the nearest point of the template head's skin surface. */
  belowScalpMm: number;
};

/** Depths of a region's hemisphere centroid, measured on the loaded anatomy. */
export function regionDepth(
  an: Anatomy,
  region: AnyRegionKey,
  side: "left" | "right" = "left",
): RegionDepth | null {
  const mesh = an.meshes.get(region);
  const outer = an.meshes.get("outer");
  const scalp = an.meshes.get("scalp");
  if (!mesh?.sides?.[side] || !outer || !scalp) return null;
  const mni = targetPoint(mesh, side);
  return {
    region,
    side,
    mni,
    belowBrainMm: placeArray(outer, mni).depthMm,
    belowScalpMm: nearestVertex(scalp, mni).distMm,
  };
}

/** Depths of every region in the anatomy (left hemisphere), in the anatomy's order. */
export function allRegionDepths(an: Anatomy): RegionDepth[] {
  const out: RegionDepth[] = [];
  for (const mesh of an.meshes.values()) {
    if (mesh.label === undefined) continue;
    const d = regionDepth(an, mesh.key as AnyRegionKey);
    if (d) out.push(d);
  }
  return out;
}

/** `url` only where the link itself was checked. */
export type Reference = { cite: string; title: string; url?: string };

export const REFS = {
  cuffin2001: {
    cite: "Cuffin et al. 2001",
    title:
      "Experimental tests of EEG source localization accuracy in spherical head models. Clinical Neurophysiology 112:46–51",
    url: "https://pubmed.ncbi.nlm.nih.gov/11137660/",
  },
  akalinAcar2013: {
    cite: "Akalin Acar & Makeig 2013",
    title: "Effects of forward model errors on EEG source localization. Brain Topography",
    url: "https://pubmed.ncbi.nlm.nih.gov/23355112/",
  },
  pascualMarqui2007: {
    cite: "Pascual-Marqui 2007",
    title:
      "Discrete, 3D distributed, linear imaging methods of electric neuronal activity. Part 1: exact, zero error localization. arXiv:0710.3341",
    url: "https://arxiv.org/abs/0710.3341",
  },
  rushDriscoll1968: {
    cite: "Rush & Driscoll 1968",
    title:
      "Current distribution in the brain from surface electrodes. Anesthesia & Analgesia 47:717–723",
  },
  oostendorp2000: {
    cite: "Oostendorp et al. 2000",
    title:
      "The conductivity of the human skull: results of in vivo and in vitro measurements. IEEE Transactions on Biomedical Engineering 47:1487–1492",
    url: "https://doi.org/10.1109/10.880100",
  },
  neurosity: {
    cite: "Neurosity",
    title: "Amygdala and EEG: the amygdala sits roughly 5–7 cm from the scalp surface",
    url: "https://neurosity.co/guides/amygdala-eeg-fear-stress-emotional-regulation",
  },
} satisfies Record<string, Reference>;

/** Scalp-EEG localisation error for deep sources, as the panel states it. */
export const DEEP_SOURCE_ERROR = {
  value: "12.8 ± 6.2 mm (inferior) · ≈ 20 mm (basal)",
  refs: [REFS.cuffin2001, REFS.akalinAcar2013],
};

/** Published amygdala depth below the scalp, shown beside the computed value. */
export const AMYGDALA_SCALP_RANGE_MM: [number, number] = [50, 70];
