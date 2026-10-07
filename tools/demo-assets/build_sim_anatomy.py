"""Build the anatomy shipped with the Simulation Window (public/sim/).

Every mesh is extracted from public atlases in MNI152 space; nothing is
sculpted by hand. Which atlas labels make up each target region is defined in
sim_regions.json, next to this script.

Inputs (TemplateFlow, tpl-MNI152NLin2009cAsym, res-01; licences in
public/templates/NOTICE.md and public/sim/NOTICE.md)
  _T1w.nii.gz                         cortical surface (T1 isosurface in the brain mask)
                                      and the scalp (head above the background)
  _desc-brain_mask.nii.gz             brain mask
  _seg-aseg_dseg.nii.gz               FreeSurfer aseg: hippocampus, amygdala, thalamus
  _atlas-MASSP20_dseg.nii.gz          MASSP (Alkemade et al. 2022): subthalamic nucleus
  _atlas-Schaefer2018_desc-400Parcels17Networks_dseg.nii.gz (+ .tsv)
                                      Schaefer 2018 cortical parcels
and, from CBIG (MIT), the current parcel names, which tag parcels anatomically
(e.g. VisPeri_StriCal = calcarine cortex):
  Schaefer2018_400Parcels_17Networks_order.txt
      github.com/ThomasYeoLab/CBIG, stable_projects/brain_parcellation/
      Schaefer2018_LocalGlobal/Parcellations/MNI/freeview_lut/
The TemplateFlow table and the CBIG table must describe the same parcels; the
script checks that every parcel's colour matches before using CBIG's names.

Surfaces: Gaussian-smoothed mask -> marching cubes (scikit-image) -> a few
Laplacian smoothing passes. The cortex is the T1 isosurface between grey
matter and CSF inside the brain mask, so gyri and sulci are real.

Outputs (in OUT_DIR)
  anatomy.bin.gz   meshes. Little endian: magic "CVSA1\\0\\0\\0" | uint32 header
                   length | header JSON (utf-8), then per mesh int16 xyz
                   (mm * 50, MNI RAS) and uint32 triangle indices at the
                   offsets the header lists. gzip-compressed. "scalp" is a
                   point set (no triangles): it is measured against, not drawn.
  regions.nii.gz   uint8 label map of the target regions (value = the mesh's
                   "label" in the header), cropped to the regions. The page
                   computes region centroids and volumes from it at load time,
                   so no coordinate is stored or typed in anywhere.

Run
  .venv/bin/pip install nibabel numpy scipy scikit-image
  .venv/bin/python tools/demo-assets/build_sim_anatomy.py ATLAS_DIR public/sim
"""

import gzip
import io
import json
import struct
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage
from skimage import measure

P = "tpl-MNI152NLin2009cAsym_res-01_"
SCHAEFER = "atlas-Schaefer2018_desc-400Parcels17Networks_dseg"
CBIG_NAMES = "Schaefer2018_400Parcels_17Networks_order.txt"
QUANT = 50.0
HERE = Path(__file__).resolve().parent


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


def schaefer_names(d):
    """Parcel index -> CBIG name, after checking CBIG and TemplateFlow agree."""
    tf = {}
    for line in (d / f"tpl-MNI152NLin2009cAsym_{SCHAEFER}.tsv").read_text().splitlines()[1:]:
        index, _name, colour = line.split("\t")[:3]
        tf[int(index)] = colour.strip().lower()
    cbig = {}
    for line in (d / CBIG_NAMES).read_text().splitlines():
        p = line.split()
        if len(p) >= 5:
            cbig[int(p[0])] = (p[1], "#%02x%02x%02x" % tuple(int(x) for x in p[2:5]))
    if set(tf) != set(cbig) or any(tf[i] != cbig[i][1] for i in tf):
        raise SystemExit("CBIG and TemplateFlow Schaefer tables do not describe the same parcels.")
    return {i: name for i, (name, _) in cbig.items()}


def schaefer_ids(names, tags):
    """Parcels whose network_tag matches, e.g. 'VisPeri_StriCal' (either hemisphere)."""
    ids = []
    for i, name in names.items():
        rest = name.split("_", 2)[2]  # 17Networks_LH_<rest>
        if any(rest.startswith(t + "_") for t in tags):
            ids.append(i)
    return ids


def gz(data):
    """gzip with a fixed timestamp, so a rebuild from the same inputs is byte-identical."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=9, mtime=0) as fh:
        fh.write(data)
    return buf.getvalue()


SIX = ndimage.generate_binary_structure(3, 1)


def head_threshold(T):
    """Background median + 5 robust SD (1.4826 x MAD), sampled on the six faces.

    Same definition as headThreshold() in src/lib/sim/subject.ts, including
    its median (the upper middle value) and each face voxel counted once.
    """
    face = np.ones(T.shape, bool)
    face[1:-1, 1:-1, 1:-1] = False
    v = T[face].astype(np.float64)
    med = lambda x: np.sort(x)[len(x) // 2]
    m = med(v)
    return m + 5 * 1.4826 * med(np.abs(v - m))


def downsample2(mask, affine):
    """2x coarser: a voxel is set when half or more of its 2x2x2 block is."""
    p = [(0, s % 2) for s in mask.shape]
    m = np.pad(mask.astype(np.float32), p)
    n = np.pad(np.ones(mask.shape, np.float32), p)
    blocks = lambda a: a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2, a.shape[2] // 2, 2).sum((1, 3, 5))
    coarse = 2 * blocks(m) >= blocks(n)
    a = affine.copy()
    a[:3, :3] = 2 * affine[:3, :3]
    a[:3, 3] = affine[:3, 3] + 0.5 * affine[:3, :3].sum(1)
    return coarse, a


def scalp_points(T, affine):
    """Skin surface of a head T1 as points, the field-of-view edge dropped.

    Mirrors analyseSubject() in src/lib/sim/subject.ts step for step.
    """
    coarse, a = downsample2(T > head_threshold(T), affine)
    # Closing that leaves the field-of-view edge alone (erosion border = set).
    closed = ndimage.binary_erosion(
        ndimage.binary_dilation(coarse, SIX, iterations=2), SIX, iterations=2, border_value=1
    )
    # Fill every axial slice: seals the airway, which opens where the image
    # cuts through the neck.
    z = int(np.argmax(np.abs(a[2, :3])))
    closed = np.moveaxis(closed, z, 0).copy()
    for w in range(closed.shape[0]):
        closed[w] = ndimage.binary_fill_holes(closed[w])
    closed = np.moveaxis(closed, 0, z)
    # Fill: everything not reachable from the border through empty voxels.
    bg, _ = ndimage.label(~closed, SIX)
    border = np.unique(np.concatenate([bg[0].ravel(), bg[-1].ravel(), bg[:, 0].ravel(),
                                       bg[:, -1].ravel(), bg[:, :, 0].ravel(), bg[:, :, -1].ravel()]))
    solid = ~np.isin(bg, border[border > 0])
    lab, n = ndimage.label(solid, SIX)
    head = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
    pts = []
    inner = np.zeros_like(head)
    inner[1:-1, 1:-1, 1:-1] = head[1:-1, 1:-1, 1:-1]
    for axis in range(3):
        for step in (-1, 1):
            nb = np.roll(head, -step, axis=axis)
            idx = np.argwhere(inner & ~nb)
            mid = idx.astype(np.float64)
            mid[:, axis] += step / 2
            pts.append(mid)
    ijk = np.concatenate(pts)
    return (np.c_[ijk, np.ones(len(ijk))] @ a.T)[:, :3].astype(np.float32)


def main(atlas_dir, out_dir):
    d = Path(atlas_dir)
    out = Path(out_dir)
    spec = json.loads((HERE / "sim_regions.json").read_text())

    t1 = nib.load(d / f"{P}T1w.nii.gz")
    affine = t1.affine
    T = np.asarray(t1.dataobj).astype(np.float32)
    mask = np.asarray(nib.load(d / f"{P}desc-brain_mask.nii.gz").dataobj) > 0
    atlases = {}
    for key, name in (
        ("aseg", "seg-aseg_dseg"),
        ("massp", "atlas-MASSP20_dseg"),
        ("schaefer2018", SCHAEFER),
    ):
        img = nib.load(d / f"{P}{name}.nii.gz")
        if img.shape != t1.shape or not np.allclose(img.affine, affine):
            raise SystemExit(f"{name} is not on the T1 grid.")
        atlases[key] = np.asarray(img.dataobj).astype(int)
    names = schaefer_names(d)
    aseg = atlases["aseg"]

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

    # Scalp: the skin surface of the T1, found exactly as the page finds a
    # subject's (src/lib/sim/subject.ts), so template and subject depths are
    # measured the same way. (TemplateFlow's head mask is not used: below
    # z ≈ 0 it fills the whole field of view, so it has no skin surface there.)
    scalp = scalp_points(T, affine)
    meshes.append(("scalp", "Scalp", "#c8a27a", scalp, np.zeros((0, 3), np.uint32), None))
    print(f"scalp: {len(scalp)} points")

    # Target regions: one label each in the label map, one mesh each.
    labelmap = np.zeros(t1.shape, np.uint8)
    for value, r in enumerate(spec["regions"], start=1):
        src = r["atlas"]
        ids = schaefer_ids(names, r["parcels"]) if src == "schaefer2018" else r["labels"]
        if not ids:
            raise SystemExit(f"{r['key']}: no atlas labels matched.")
        m = np.isin(atlases[src], ids)
        clash = labelmap[m]
        if clash.any():
            other = spec["regions"][int(clash[clash > 0][0]) - 1]["key"]
            raise SystemExit(f"{r['key']} overlaps {other}; regions must not share voxels.")
        labelmap[m] = value
        # Large cortical parcels need no 1 mm sampling; small nuclei do.
        step = 2 if src == "schaefer2018" else 1
        verts, faces = surface(m, 0.5, affine, step=step, sigma=0.9 if step == 2 else 0.7, passes=4)
        meta = {"label": value, "source": src}
        meshes.append((r["key"], r["name"], r["colour"], verts, faces, meta))
        print(f"{r['key']}: {int(m.sum())} voxels from {len(ids)} labels, {len(verts)} verts")

    header = {"version": 2, "space": "MNI152 (RAS mm)", "quant": QUANT, "meshes": []}
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
    out.mkdir(parents=True, exist_ok=True)
    (out / "anatomy.bin.gz").write_bytes(gz(body))
    print(f"wrote {out / 'anatomy.bin.gz'}: {len(body)} bytes raw")

    # Label map, cropped to the regions plus a one-voxel margin. The affine is
    # shifted by the crop so every voxel keeps its MNI position.
    nz = np.argwhere(labelmap)
    lo = np.maximum(nz.min(0) - 1, 0)
    hi = np.minimum(nz.max(0) + 2, labelmap.shape)
    crop = labelmap[lo[0] : hi[0], lo[1] : hi[1], lo[2] : hi[2]]
    crop_affine = affine.copy()
    crop_affine[:3, 3] = affine[:3, :3] @ lo + affine[:3, 3]
    img = nib.Nifti1Image(crop, crop_affine)
    img.header.set_data_dtype(np.uint8)
    img.set_sform(crop_affine, code=4)  # 4 = MNI152
    img.set_qform(crop_affine, code=4)
    img.header["descrip"] = b"Simulation Window target regions"
    (out / "regions.nii.gz").write_bytes(gz(img.to_bytes()))
    print(f"wrote {out / 'regions.nii.gz'}: {crop.shape}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
