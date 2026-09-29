"""Build the FreeSurfer-label segmentation shipped with the bundled MNI template.

Reproducible from public data; nothing is hand-edited.

Input (TemplateFlow, MNI152NLin2009cAsym, same licence as the template)
  https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_seg-aseg_dseg.nii.gz
  https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/tpl-MNI152NLin2009cAsym_res-01_desc-brain_mask.nii.gz

The labels follow the FreeSurfer colour lookup table (17/53 hippocampus,
4/43 lateral ventricles, ...). They were drawn on the 2009c asymmetric
template; the console ships the 2009a symmetric template. Both are in the
same MNI152 2009 stereotaxic space, so the labels are carried across by
world coordinates, with no registration step.

Resampling: every 1.5 mm target voxel takes the majority label of 27 points
spread over its extent (3 x 3 x 3), so small structures keep their volume
instead of depending on where a single nearest-neighbour sample happens to
land.

Checks printed on every run
  - Dice between the template's tissue (> 20) and the 2009c brain mask
    (0.986 for the shipped file).
  - Native 1 mm versus resampled volumes for a few structures (within ~2%).

Output: public/templates/mni152_aseg.nii.gz (uint8, template grid and affine)

Run
  python -m venv .venv && .venv/bin/pip install nibabel numpy scipy
  .venv/bin/python tools/demo-assets/build_template_aseg.py ASEG MASK TEMPLATE OUT
"""

import sys

import nibabel as nib
import numpy as np
from scipy import stats


def main(aseg_path: str, mask_path: str, template_path: str, out_path: str) -> None:
    t = nib.load(template_path)
    a = nib.load(aseg_path)
    m = nib.load(mask_path)
    labels = np.asarray(a.dataobj).astype(np.int16)
    mask = np.asarray(m.dataobj) > 0
    tissue = np.asarray(t.dataobj).astype(np.float32) > 20

    nx, ny, nz = t.shape
    ii, jj, kk = np.meshgrid(np.arange(nx), np.arange(ny), np.arange(nz), indexing="ij")
    to_src = np.linalg.inv(a.affine) @ t.affine
    votes, mvotes = [], []
    for dx in (-0.5, 0.0, 0.5):
        for dy in (-0.5, 0.0, 0.5):
            for dz in (-0.5, 0.0, 0.5):
                vox = np.stack([ii + dx, jj + dy, kk + dz, np.ones_like(ii)], -1).reshape(-1, 4)
                src = np.rint((vox @ to_src.T)[:, :3]).astype(int)
                ok = (src >= 0).all(1) & (src < labels.shape).all(1)
                lab = np.zeros(len(src), np.int16)
                mk = np.zeros(len(src), bool)
                lab[ok] = labels[src[ok, 0], src[ok, 1], src[ok, 2]]
                mk[ok] = mask[src[ok, 0], src[ok, 1], src[ok, 2]]
                votes.append(lab)
                mvotes.append(mk)
    out = stats.mode(np.stack(votes, 1), axis=1, keepdims=False).mode.reshape(t.shape)
    brain = (np.stack(mvotes, 1).mean(1) > 0.5).reshape(t.shape)

    dice = 2 * (tissue & brain).sum() / (tissue.sum() + brain.sum())
    print(f"Dice, template tissue vs 2009c brain mask: {dice:.3f}")
    v15 = float(np.prod(t.header.get_zooms()[:3]))
    v1 = float(np.prod(a.header.get_zooms()[:3]))
    for label, name in [(17, "L hippocampus"), (53, "R hippocampus"), (4, "L lat. ventricle")]:
        native = (labels == label).sum() * v1
        resampled = (out == label).sum() * v15
        print(f"{name}: native {native:.0f} mm3, resampled {resampled:.0f} mm3")

    img = nib.Nifti1Image(out.astype(np.uint8), t.affine)
    img.header.set_data_dtype(np.uint8)
    img.header.set_xyzt_units("mm")
    img.set_qform(t.affine, 1)
    img.set_sform(t.affine, 1)
    nib.save(img, out_path)


if __name__ == "__main__":
    main(*sys.argv[1:5])
