/**
 * Regional volumes for the bundled MNI template, from its FreeSurfer-label
 * segmentation (public/templates/mni152_aseg.nii.gz; provenance in
 * public/templates/NOTICE.md). Linked only while the template is what is on
 * screen, so its numbers never attach to a person's scan.
 */

import { FREESURFER_CONVENTION, LABEL_CONVENTIONS, parseNiftiSegmentation } from "../imaging/nifti";
import { classVolumes } from "../imaging/segmentation";
import { getLinked, setLinked, type LinkOrigin } from "./linked";

export const TEMPLATE_ASEG_URL = "/templates/mni152_aseg.nii.gz";

let cached: Promise<{ label: number; name: string; mm3: number }[]> | null = null;

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, 2);
  if (!(head[0] === 0x1f && head[1] === 0x8b)) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export function templateAsegVolumes() {
  cached ??= (async () => {
    const res = await fetch(TEMPLATE_ASEG_URL);
    if (!res.ok) throw new Error(`template segmentation: HTTP ${res.status}`);
    const names = LABEL_CONVENTIONS[FREESURFER_CONVENTION]!;
    const seg = parseNiftiSegmentation(
      await gunzip(await res.arrayBuffer()),
      "MNI152 aseg",
      names,
      FREESURFER_CONVENTION,
    );
    return classVolumes(seg)
      .filter((k) => k.voxels > 0 && names[k.label])
      .map((k) => ({ label: k.label, name: k.name, mm3: k.mm3 }));
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

/** Attach the template's regional volumes to the template scan, if it is on screen. */
export async function linkTemplateAseg(origin: LinkOrigin) {
  const classes = await templateAsegVolumes();
  if (getLinked().mri?.kind !== "template") return;
  setLinked({
    segmentation: {
      origin,
      label: "MNI152 template — FreeSurfer aseg (TemplateFlow 2009c)",
      convention: FREESURFER_CONVENTION,
      method:
        "TemplateFlow MNI152NLin2009cAsym aseg carried onto the 2009a template by MNI coordinates (27-point majority vote)",
      classes,
      linkedAt: new Date().toISOString(),
    },
  });
}
