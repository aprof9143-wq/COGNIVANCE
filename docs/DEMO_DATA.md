# Demo data and runbook

Everything below is free and public. Download the files **tonight**, on the
machine you will present from, and keep them in one folder. Do not rely on
conference Wi-Fi to fetch anything live.

---

## MRI — a scan to load

### Recommended: MNI152 T1 template (most reliable)

A standard averaged adult brain at 1 mm isotropic. It renders beautifully, loads
in about a second, and is what this console was verified against.

It ships inside the `nilearn` Python package, so it downloads from PyPI:

```sh
pip download nilearn --no-deps -d .
unzip -o nilearn-*.whl "nilearn/datasets/data/mni_icbm152_t1_tal_nlin_sym_09a_converted.nii.gz"
mv nilearn/datasets/data/mni_icbm152_t1_tal_nlin_sym_09a_converted.nii.gz MNI152_T1.nii.gz
```

This template is **skull-stripped** and is a population average, not a person.
The viewer labels it "template" wherever it appears.

### For a real individual head, with skull: OpenNeuro

<https://openneuro.org> — thousands of real, de-identified subject scans. Pick
any dataset, open a subject folder, and download the file ending in
`_T1w.nii.gz` from the `anat/` directory. For DICOM, open a whole series
folder with **Open DICOM folder**; files are grouped by series and sorted by
position, not by file name.

### Alzheimer's-specific cohorts

- **OASIS** — <https://www.oasis-brains.org>. Free with a short registration.
- **ADNI** — <https://adni.loni.usc.edu>. Requires a Data Use Agreement, which
  takes weeks. Not an option for tomorrow.

---

## EEG — a recording to load

### Recommended: PhysioNet EEG Motor Movement/Imagery

<https://physionet.org/content/eegmmidb/1.0.0/> — 64-channel EDF, no
registration. Direct file:

<https://physionet.org/files/eegmmidb/1.0.0/S001/S001R01.edf>

`R01` is eyes-open rest and `R02` is **eyes-closed rest**. Use `R02` if you can:
closing the eyes produces the strongest posterior alpha rhythm, which is exactly
what the topography and the "posterior rhythm" readout are built to show.

Verified: all 19 positions of the 10-20 montage map from this file's 64 channel
labels (its `T7/T8/P7/P8` are aliased to the classic `T3/T4/T5/T6`).

### Other sources

- **OpenNeuro** also hosts EEG datasets — filter for EEG and pick one in EDF.
- **TUH EEG Corpus** — <https://isip.piconepress.com/projects/tuh_eeg/>. Large
  clinical corpus, registration required.

### Format support

The console reads **EDF / EDF+** only. BDF (24-bit), BrainVision (`.vhdr`) and
`.set` files will not load yet — convert them to EDF first, or choose an EDF
source.

---

## What ships with the console

`/research` (the research console) and `/viewer` (the diagnostic viewer) open
on real data without any download:

| Layer | What it is | Source | Licence |
| --- | --- | --- | --- |
| MRI | MNI152 ICBM 2009a T1 template, 1.5 mm | McConnell Brain Imaging Centre, via `nilearn` | MNI/McGill permissive notice — `public/templates/NOTICE.md` |
| Tractography | 20,000 whole-brain streamlines, CSD + deterministic tracking, affinely registered to the template | OpenNeuro **ds000221** (MPI-Leipzig Mind-Brain-Body), subject 010002 | CC0 |
| Lesion | None. Without a loaded label map the viewer shows "No validated segmentation loaded". | — | — |
| EEG | The console opens on a synthetic 10-20 recording, labelled "phantom"; the viewer has none until one is loaded. | generated in code | — |

The tractogram is rebuilt, byte for byte, by
[`tools/demo-assets/build_tractogram.py`](../tools/demo-assets/build_tractogram.py)
from the public diffusion data. The script prints its own registration check
(share of fibre points on template tissue — 0.98 for the shipped file).

---

## Tractography — data sources

The console reads **TrackVis `.trk`** and **MRtrix3 `.tck`**. Drop either onto
the page; it is fitted to the loaded brain (or placed exactly, for the bundled
tractogram on the template).

### Ready-made tractograms

- **HCP-842 population atlas** (Yeh et al., *NeuroImage* 2018) — 80 named
  bundles in MNI space, `.trk`. Easiest route is DIPY:
  `python -c "from dipy.data import fetch_bundle_atlas_hcp842 as f; f()"`
  (~300 MB, figshare). Being in MNI space, it lines up with the bundled template.
- **TractoInferno** — OpenNeuro **ds003900**, CC0. 284 subjects, multi-site,
  with reference bundle tractograms built for machine learning on tractography.
  The strongest dataset to cite for a "trained on real tractography" roadmap.
- **ORG fibre-clustering atlas** (O'Donnell Research Group, Zhang et al.,
  *NeuroImage* 2018) — <https://dmri.slicer.org/atlases/>. 800-cluster
  whole-brain atlas from 100 HCP subjects.

### Raw diffusion MRI to track yourself

- **OpenNeuro ds000221** — what the bundled tractogram is built from. CC0.
- **Human Connectome Project** — <https://db.humanconnectome.org>. The reference
  standard for diffusion quality; free account and open-access data terms.
- Run the same pipeline on any of them with the script above, or with
  MRtrix3 (`tckgen`) / DSI Studio, and drop the resulting `.tck`/`.trk` in.

### Tumour patients with diffusion MRI — the pilot pairing

- **OpenNeuro ds001226 (BTC_preop)** — CC0. T1 and diffusion MRI of glioma and
  meningioma patients before surgery (and ds002080, **BTC_postop**, after). This
  is the dataset for the flagship view: a tumour and the fibres it displaces,
  in one frame. It has no tumour masks in its subject folders, so pair it with
  a segmentation (below).
- **UCSF-PDGM** (The Cancer Imaging Archive) — preoperative diffuse glioma MRI
  with diffusion and BraTS-style tumour segmentations. Check the collection's
  licence and citation terms on TCIA before use in a pitch.

---

## Tumour segmentation — data sources

The segmentation layer (**Add layer**) reads an integer **label map** in NIfTI,
optionally with a BIDS `dseg.tsv` for class names. It shows what the labels say
and measures their volumes on the label map's own grid (voxel count × voxel
volume). Class names are never assumed: pick the convention the file follows,
or leave it as label numbers. It does **not** detect tumours from a raw scan —
that needs a trained model.

- **BraTS** (RSNA-ASNR-MICCAI Brain Tumor Segmentation) — via Synapse, free
  registration. Expert multi-class labels: 1 necrotic core, 2 oedema, 3/4
  enhancing tumour (BraTS 2023+ uses 3 for enhancing tumour). Choose the
  matching convention in the Segmentation panel.
- **Medical Segmentation Decathlon, Task01_BrainTumour** — CC-BY-SA 4.0.
  Different label convention (1 oedema, 2 non-enhancing, 3 enhancing): choose
  "MSD Task01" in the Segmentation panel.
- **UCSF-PDGM** — as above; segmentations included.

---

## Before you present

1. **Use Chrome or Edge.** The volume renderer needs WebGL2. Safari decompresses
   `.nii.gz` inconsistently.
2. **Plug in the laptop.** Raymarching is GPU work; battery-saver modes throttle
   it and the rotation stutters.
3. **Load both files once beforehand** to confirm they render on this machine.
4. **Sign in first** — `/research` redirects to `/auth` without a session.

---

## Walkthrough — about three minutes

1. **Open `/research`.** The research console opens on the MNI template
   (labelled "template") as a GPU-raymarched 3D volume with the 10-20
   electrodes, three linked slices, and the EEG analysis of the loaded
   recording. Load a NIfTI, an EDF, or a FreeSurfer label map; the
   Neurodegeneration panel updates as each one loads.
2. **Open the diagnostic viewer (`/viewer`)** and load a DICOM series or NIfTI. Orientation markers, slice n/N, spacing and
   the acquired-versus-reformatted plane come from the file's own geometry.
   *Say:* "Every view is resliced from the source volume in patient space."
3. **Window/level:** drag with the W/L tool, type values, or press 1–9 for the
   file's windows (and CT presets on calibrated CT only). The histogram shows
   what the window clips.
4. **Measure:** Length (mm) and Ellipse ROI (mm², mean ± sd) are computed in
   patient space and do not change with zoom.
5. **Display tools:** any enhancement shows "Display enhancement active";
   **Original** and the before/after split are one click away.
6. **3D:** clip along patient axes, switch camera presets, toggle layers; each
   layer lists its source and method.
7. **Neurodegeneration tracking** (`/neurodegeneration`): whatever the console
   or viewer has loaded is linked in automatically — the MRI as a visit,
   FreeSurfer label-map volumes as regional measurements (QC pending), and the
   EEG measures as nonspecific biomarkers. Template and phantom data are
   labelled as such. It also imports FreeSurfer stats files. No diagnosis or
   probability is computed.

---

## NIMBLE hardware simulation — `/nimble`

A live twin of the acquisition layer, public, no sign-in. Switch **Simulated
source → Bench MCU link** and the link health changes (latency, jitter, loss)
while the analysis reading from it does not — that is the hardware abstraction
layer's claim, made visible. Then inject faults: **Electrode lift** on O1 turns
the self-test from PASS to DIVERGED, which is the point: the platform notices.
Every value on that page is simulated in the browser, and it says so.

---

## What to say if asked "does it diagnose Alzheimer's?"

**No — and say so plainly.** Every number on screen is a measurement computed
from the loaded files. Diagnostic claims are gated behind the published
benchmark targets on `/benchmarks`, none of which have been measured yet.

This is a strength in a VC room, not a weakness. The credible story is: *the
fusion infrastructure works on real data today; the models that turn it into a
diagnosis are gated on rigorous benchmarks we have already published.*

Limits worth knowing before someone else points them out:

- **Electrodes appear in 3D only from coordinate files** (BIDS
  `electrodes.tsv`) that pass a bounds check against the image. The scalp map
  in the EEG section is a schematic 10-20 layout, labelled as interpolated.
- **Compressed DICOM** (JPEG, JPEG-LS, JPEG 2000, deflate) is not decoded; the
  viewer names the transfer syntax and asks for an uncompressed copy.
