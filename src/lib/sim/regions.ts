/**
 * Gated regions and their depth, for the Simulation Window's "Depth &
 * localisation" panel.
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
import type { RegionKey } from "./neural";

/** Deep targets: subcortical, out of reach of scalp-EEG localisation. */
export const GATED_REGIONS: RegionKey[] = ["amygdala", "hippocampus", "thalamus", "stn"];

export const isGated = (k: RegionKey) => GATED_REGIONS.includes(k);

export type RegionDepth = {
  region: RegionKey;
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
  region: RegionKey,
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
