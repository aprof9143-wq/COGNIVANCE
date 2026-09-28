"""Build the whole-brain demo tractogram shipped with the research console.

Reproducible from public data. Every step is here; nothing is hand-edited.

Input
  OpenNeuro ds000221 (MPI-Leipzig Mind-Brain-Body), licence CC0,
  doi:10.18112/openneuro.ds000221.v1.0.0, subject sub-010002, session 1:
  single-shell diffusion MRI, b = 1000 s/mm², 60 directions, 1.7 mm.

  https://s3.amazonaws.com/openneuro.org/ds000221/sub-010002/ses-01/dwi/sub-010002_ses-01_dwi.{nii.gz,bval,bvec}

Pipeline (DIPY)
  1. Brain mask from the b0 volumes (median Otsu).
  2. Diffusion tensor for FA, used as the tracking stop criterion.
  3. Constrained spherical deconvolution (SH order 6, single-fibre response
     estimated from high-FA voxels) for the fibre orientation distribution.
  4. Deterministic (maximum-direction) local tracking on the CSD fibre
     orientations from random white-matter seeds, 0.5 mm steps, 30° max turn,
     stopping at FA < 0.15. Deterministic tracking gives smooth, bundle-coherent
     streamlines, which is what makes a whole-brain tractogram legible.
  5. Keep streamlines between 50 and 240 mm. Deterministic tracking can loop;
     nothing in the adult brain runs much past 200 mm, so longer is artefact.
  6. Affine registration (mutual information) of the mean b0 to the MNI152
     template the console ships, then move the streamlines into template space.
  7. Length-weighted random subsample (long association and projection fibres
     carry the anatomy), resample each streamline to a fixed number of points,
     quantise to the template's grid and write a compact delta-encoded binary.

Output (public/templates/tractogram_ds000221.bin.gz)
  magic   "CVTR2\\0\\0\\0"      8 bytes
  count   uint32                number of streamlines
  points  uint32                total points
  offsets uint32[count + 1]     start index of each streamline's points
  first   uint16[count * 3]     first point of each streamline, 1/2048 grid units
  deltas  int8[(points - count) * 3]  step to each following point, same units

Run
  python -m venv .venv && .venv/bin/pip install dipy nibabel numpy scipy
  .venv/bin/python tools/demo-assets/build_tractogram.py DWI_DIR OUT_DIR

It is a demonstration asset: one healthy adult, affinely registered. It is not
a patient's tractogram and nothing drawn from it is a finding.
"""

from __future__ import annotations

import gzip
import struct
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
from dipy.align import affine_registration
from dipy.core.gradients import gradient_table
from dipy.data import default_sphere
from dipy.direction import DeterministicMaximumDirectionGetter
from dipy.io.gradients import read_bvals_bvecs
from dipy.reconst.csdeconv import ConstrainedSphericalDeconvModel, auto_response_ssst
from dipy.reconst.dti import TensorModel
from dipy.segment.mask import median_otsu
from dipy.tracking import utils
from dipy.tracking.local_tracking import LocalTracking
from dipy.tracking.stopping_criterion import ThresholdStoppingCriterion
from dipy.tracking.streamline import Streamlines, set_number_of_points, transform_streamlines

SEED = 20260928
N_SEEDS = 260_000
KEEP = 20_000
POINTS = 32
MIN_LENGTH_MM = 50.0
MAX_LENGTH_MM = 240.0
Q = 2048  # quantisation steps across the template grid (~0.07-0.09 mm)

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "public" / "templates" / "mni152_template.nii.gz"


def main(dwi_dir: Path, out_dir: Path) -> None:
    rng = np.random.default_rng(SEED)

    img = nib.load(dwi_dir / "dwi.nii.gz")
    data = img.get_fdata(dtype=np.float32)
    affine = img.affine
    bvals, bvecs = read_bvals_bvecs(str(dwi_dir / "dwi.bval"), str(dwi_dir / "dwi.bvec"))
    gtab = gradient_table(bvals, bvecs=bvecs, b0_threshold=50)
    b0_idx = np.where(gtab.b0s_mask)[0]
    print(f"dwi {data.shape}  b0 volumes {len(b0_idx)}")

    masked, mask = median_otsu(data, vol_idx=b0_idx, median_radius=2, numpass=1, dilate=1)
    print(f"brain mask voxels {int(mask.sum())}")

    fa = TensorModel(gtab).fit(masked, mask=mask).fa
    fa = np.nan_to_num(fa)

    response, ratio = auto_response_ssst(gtab, masked, roi_radii=10, fa_thr=0.7)
    print(f"response eigenvalues {response[0]}  ratio {ratio:.3f}")
    csd = ConstrainedSphericalDeconvModel(gtab, response, sh_order_max=6)
    csd_fit = csd.fit(masked, mask=fa > 0.12)

    getter = DeterministicMaximumDirectionGetter.from_shcoeff(
        csd_fit.shm_coeff, max_angle=30.0, sphere=default_sphere
    )
    stopping = ThresholdStoppingCriterion(fa, 0.15)
    seeds = utils.random_seeds_from_mask(
        fa > 0.25, affine, seeds_count=N_SEEDS, seed_count_per_voxel=False, random_seed=SEED
    )
    tracks = Streamlines(
        LocalTracking(getter, stopping, seeds, affine, step_size=0.5, random_seed=SEED)
    )
    lengths = np.array([np.sum(np.linalg.norm(np.diff(s, axis=0), axis=1)) for s in tracks])
    tracks = Streamlines(
        [s for s, n in zip(tracks, lengths) if MIN_LENGTH_MM <= n <= MAX_LENGTH_MM]
    )
    print(f"streamlines {MIN_LENGTH_MM:.0f}-{MAX_LENGTH_MM:.0f} mm: {len(tracks)}")

    # Register the subject's mean b0 to the template, then move the streamlines.
    tpl = nib.load(TEMPLATE)
    tpl_data = tpl.get_fdata(dtype=np.float32)
    mean_b0 = masked[..., b0_idx].mean(axis=-1)
    _, reg = affine_registration(
        mean_b0,
        tpl_data,
        moving_affine=affine,
        static_affine=tpl.affine,
        nbins=32,
        pipeline=["center_of_mass", "translation", "rigid", "affine"],
        level_iters=[10000, 1000, 100],
        sigmas=[3.0, 1.0, 0.0],
        factors=[4, 2, 1],
    )
    tracks = transform_streamlines(tracks, np.linalg.inv(reg))

    lengths = np.array([np.sum(np.linalg.norm(np.diff(s, axis=0), axis=1)) for s in tracks])
    pick = rng.choice(
        len(tracks), size=min(KEEP, len(tracks)), replace=False, p=lengths / lengths.sum()
    )
    tracks = set_number_of_points(Streamlines([tracks[i] for i in sorted(pick)]), POINTS)

    # World mm -> template voxel -> 0..1 grid (voxel i sits at i / (n - 1)).
    inv = np.linalg.inv(tpl.affine)
    dims = np.array(tpl.shape[:3], dtype=np.float64)
    grid = [
        (nib.affines.apply_affine(inv, s) / (dims - 1)).clip(0.0, 1.0) for s in tracks
    ]

    # Registration check: share of points on template tissue.
    tissue = tpl_data > 0.12 * tpl_data.max()
    pts = np.concatenate(grid) * (dims - 1)
    idx = np.clip(np.rint(pts).astype(int), 0, dims.astype(int) - 1)
    on_tissue = tissue[idx[:, 0], idx[:, 1], idx[:, 2]].mean()
    mean_t1 = tpl_data[idx[:, 0], idx[:, 1], idx[:, 2]].mean() / tpl_data[tissue].mean()
    print(f"points on template tissue {on_tissue:.3f}  mean T1 vs tissue mean {mean_t1:.2f}")

    offsets = np.zeros(len(grid) + 1, dtype=np.uint32)
    offsets[1:] = np.cumsum([len(s) for s in grid])
    q = [np.rint(s * Q).astype(np.int32) for s in grid]
    first = np.stack([s[0] for s in q]).astype(np.uint16)
    deltas = np.concatenate([np.diff(s, axis=0) for s in q])
    if np.abs(deltas).max() > 127:
        raise SystemExit(f"step too long for int8: {np.abs(deltas).max()} units; raise POINTS")

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "tractogram_ds000221.bin.gz"
    with gzip.open(out, "wb", compresslevel=9) as fh:
        fh.write(b"CVTR2\0\0\0")
        fh.write(struct.pack("<II", len(grid), int(offsets[-1])))
        fh.write(offsets.astype("<u4").tobytes())
        fh.write(first.astype("<u2").tobytes())
        fh.write(deltas.astype(np.int8).tobytes())
    print(f"wrote {out}  {out.stat().st_size / 1e6:.2f} MB  {len(grid)} streamlines")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
