"""Build the anatomy shipped with the Simulation Window (public/sim/anatomy.bin.gz).

Every mesh is extracted from public atlases in MNI152 space; nothing is
sculpted by hand.

Inputs (TemplateFlow, tpl-MNI152NLin2009cAsym, res-01; McGill licence, see
public/templates/NOTICE.md)
  _T1w.nii.gz                         cortical surface (T1 isosurface in the brain mask)
  _desc-brain_mask.nii.gz             brain mask
  _seg-aseg_dseg.nii.gz               FreeSurfer aseg: hippocampus, amygdala, thalamus
  _atlas-MASSP20_dseg.nii.gz          MASSP (Alkemade et al. 2022): subthalamic nucleus
  _atlas-HOCPAL_desc-th25_dseg.nii.gz Harvard-Oxford cortical, lateralised
                                      (label 2k-1 = left, 2k = right of HO index k)

Surfaces: Gaussian-smoothed mask -> marching cubes (scikit-image) -> a few
Laplacian smoothing passes. The cortex is the T1 isosurface between grey
matter and CSF inside the brain mask, so gyri and sulci are real.

Output format (little endian)
  magic "CVSA1\\0\\0\\0" | uint32 header length | header JSON (utf-8)
  then per mesh: int16 xyz (mm * 50, MNI RAS) and uint32 triangle indices,
  at the offsets the header lists. gzip-compressed.

Run
  .venv/bin/pip install nibabel numpy scipy scikit-image
  .venv/bin/python tools/demo-assets/build_sim_anatomy.py ATLAS_DIR OUT
"""

import gzip
import json
import struct
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage
from skimage import measure

P = "tpl-MNI152NLin2009cAsym_res-01_"
QUANT = 50.0

# key, display name, source, labels, colour (sRGB hex)
REGIONS = [
    ("hippocampus", "Hippocampus", "aseg", [17, 53], "#f2b33d"),
    ("amygdala", "Amygdala", "aseg", [18, 54], "#e8608a"),
    ("thalamus", "Thalamus", "aseg", [10, 49], "#7fa7d9"),
    ("stn", "Subthalamic nucleus", "massp", [3, 4], "#ff7f6b"),
    ("v1", "Primary visual cortex (V1)", "ho", [24, 47, 48], "#7b4fe0"),
    ("dlpfc", "Dorsolateral PFC", "ho", [4], "#3fb6ff"),
    ("vmpfc", "Ventromedial PFC", "ho", [25], "#41d3c2"),
    ("insula", "Insula", "ho", [2], "#c58cff"),
    ("auditory", "Auditory cortex (Heschl)", "ho", [45], "#2ec4b6"),
    ("motor", "Primary motor cortex", "ho", [7], "#8be15b"),
]


def ho_labels(k_list):
    out = []
    for k in k_list:
        out += [2 * k - 1, 2 * k]
    return out


def laplacian(verts, faces, passes=3, lam=0.5):
    n = len(verts)
    nbr_sum = np.zeros_like(verts)
    deg = np.zeros(n)
    edges = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    for _ in range(passes):
        nbr_sum[:] = 0
        deg[:] = 0
        np.add.at(nbr_sum, edges[:, 0], verts[edges[:, 1]])
        np.add.at(nbr_sum, edges[:, 1], verts[edges[:, 0]])
        np.add.at(deg, edges[:, 0], 1)
        np.add.at(deg, edges[:, 1], 1)
        avg = nbr_sum / np.maximum(deg, 1)[:, None]
        verts = verts + lam * (avg - verts)
    return verts


def surface(volume, level, affine, step, sigma, passes):
    v = ndimage.gaussian_filter(volume.astype(np.float32), sigma)
    verts, faces, _, _ = measure.marching_cubes(v, level=level, step_size=step)
    verts = laplacian(verts, faces, passes)
    world = (np.c_[verts, np.ones(len(verts))] @ affine.T)[:, :3]
    return world.astype(np.float32), faces.astype(np.uint32)


def main(atlas_dir, out_path):
    d = Path(atlas_dir)
    t1 = nib.load(d / f"{P}T1w.nii.gz")
    affine = t1.affine
    T = np.asarray(t1.dataobj).astype(np.float32)
    mask = np.asarray(nib.load(d / f"{P}desc-brain_mask.nii.gz").dataobj) > 0
    aseg = np.asarray(nib.load(d / f"{P}seg-aseg_dseg.nii.gz").dataobj).astype(int)
    massp = np.asarray(nib.load(d / f"{P}atlas-MASSP20_dseg.nii.gz").dataobj).astype(int)
    ho = np.asarray(nib.load(d / f"{P}atlas-HOCPAL_desc-th25_dseg.nii.gz").dataobj).astype(int)

    meshes = []

    # Cortex: T1 isosurface between CSF and grey matter, inside a slightly
    # eroded mask so the surface does not snap to the mask edge.
    inside = ndimage.binary_erosion(mask, iterations=1)
    gm = np.median(T[(aseg == 3) | (aseg == 42)])
    csf = np.median(T[(aseg == 4) | (aseg == 43)])
    level = 0.5 * (gm + csf)
    cortex_vol = np.where(inside, T, csf)
    verts, faces = surface(cortex_vol, level, affine, step=2, sigma=0.8, passes=2)
    meshes.append(("cortex", "Cortex", "#9fb8d8", verts, faces, None))
    print(f"cortex: {len(verts)} verts, {len(faces)} faces (level {level:.1f})")

    # Outer brain surface (no ventricle walls): where an implant can sit.
    outer_v, outer_f = surface(mask, 0.5, affine, step=3, sigma=1.5, passes=3)
    meshes.append(("outer", "Brain surface", "#5d7aa8", outer_v, outer_f, None))
    print(f"outer: {len(outer_v)} verts")

    for key, name, src, labels, colour in REGIONS:
        lab = {"aseg": aseg, "massp": massp, "ho": ho}[src]
        ids = ho_labels(labels) if src == "ho" else labels
        m = np.isin(lab, ids)
        vox = int(m.sum())
        # Large cortical parcels need no 1 mm sampling; small nuclei do.
        step = 2 if src == "ho" else 1
        verts, faces = surface(m, 0.5, affine, step=step, sigma=0.9 if step == 2 else 0.7, passes=4)
        centroid = (affine @ np.r_[np.argwhere(m).mean(0), 1])[:3]
        # Per hemisphere centroids, for targeting.
        sides = {}
        for side, sel in (("left", lambda x: x < 0), ("right", lambda x: x >= 0)):
            idx = np.argwhere(m)
            w = (np.c_[idx, np.ones(len(idx))] @ affine.T)[:, :3]
            ws = w[sel(w[:, 0])]
            if len(ws):
                sides[side] = [round(float(c), 2) for c in ws.mean(0)]
        meshes.append(
            (key, name, colour, verts, faces, {
                "volumeMm3": vox * float(abs(np.linalg.det(affine[:3, :3]))),
                "centroid": [round(float(c), 2) for c in centroid],
                "sides": sides,
                "source": src,
                "labels": ids,
            })
        )
        print(f"{key}: {vox} voxels, {len(verts)} verts")

    header = {"version": 1, "space": "MNI152 (RAS mm)", "quant": QUANT, "meshes": []}
    blobs = []
    offset = 0
    for key, name, colour, verts, faces, meta in meshes:
        q = np.clip(np.round(verts * QUANT), -32768, 32767).astype("<i2").tobytes()
        f = faces.astype("<u4").tobytes()
        entry = {
            "key": key,
            "name": name,
            "colour": colour,
            "vertexCount": len(verts),
            "indexCount": int(faces.size),
            "vertexOffset": offset,
            "indexOffset": offset + len(q) + (4 - len(q) % 4) % 4,
        }
        if meta:
            entry.update(meta)
        pad = b"\0" * ((4 - len(q) % 4) % 4)
        blobs += [q, pad, f]
        offset += len(q) + len(pad) + len(f)
        header["meshes"].append(entry)

    hj = json.dumps(header, separators=(",", ":")).encode()
    hpad = b" " * ((4 - (12 + len(hj)) % 4) % 4)
    hj += hpad
    body = b"CVSA1\0\0\0" + struct.pack("<I", len(hj)) + hj + b"".join(blobs)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out_path, "wb", compresslevel=9) as fh:
        fh.write(body)
    print(f"wrote {out_path}: {len(body)} bytes raw")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
