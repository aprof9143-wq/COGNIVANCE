# anatomy.bin.gz and regions.nii.gz

Anatomy for the CIRCUIT Simulation Window (`/simulation`):

- `anatomy.bin.gz` holds surface meshes: the cortex, the outer brain surface
  used to place the array, and ten target regions. It also holds the scalp as
  points, never drawn, so the page can measure each region's depth below
  the scalp.
- `regions.nii.gz` is the label map of those ten regions. The page computes
  every region centroid and volume from it when it loads; no coordinate is
  stored or typed in.

Both files are extracted from public atlases in MNI152 space (ICBM 2009c
nonlinear asymmetric, 1 mm). Nothing is sculpted by hand. Both are rebuilt by
`tools/demo-assets/build_sim_anatomy.py`, and
`tools/demo-assets/sim_regions.json` says which atlas labels make up each
region and why.

They describe a population-average template, not a person.

| Region                                                     | Source                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Cortex, outer surface                                      | TemplateFlow `tpl-MNI152NLin2009cAsym_res-01_T1w` and `_desc-brain_mask` — MNI/McGill permissive notice, see `public/templates/NOTICE.md` |
| Scalp (points)                                             | TemplateFlow `_desc-head_mask`, resampled to 1 mm; points at the field-of-view edge are dropped — same notice                             |
| Hippocampus, amygdala, thalamus                            | TemplateFlow `_seg-aseg_dseg` (FreeSurfer convention) — same notice                                                                       |
| Subthalamic nucleus                                        | MASSP atlas (Alkemade et al., _Science Advances_ 2022), TemplateFlow `_atlas-MASSP20_dseg`                                                |
| V1, dlPFC, vmPFC, insula, auditory and sensorimotor cortex | Schaefer 2018, 400 parcels, 17 networks — TemplateFlow `_atlas-Schaefer2018_desc-400Parcels17Networks_dseg`, parcel names from CBIG       |

## Cortical regions (Schaefer 2018)

Schaefer parcels are functional: each belongs to one of 17 resting-state
networks (Yeo et al. 2011). CBIG's parcel names also tag each parcel with its
anatomical location, and the regions are built from those tags:

- **V1:** the parcels tagged striate/calcarine.
- **Insula** and **auditory cortex:** the parcels tagged insular or auditory.
- **dlPFC** and **vmPFC:** prefrontal parcels of the control, limbic and
  default networks. Schaefer has no parcel defined as either region.
- **Sensorimotor cortex:** the somatomotor parcels around the central sulcus.
  Network parcels do not separate M1 from S1, so the region covers both.

Two of these regions are wider than the anatomical areas they are named
after. The auditory region covers the superior temporal cortex around Heschl's
gyrus, and the vmPFC region reaches into dorsomedial prefrontal cortex.

## Licence status — check before commercial use

- **Schaefer 2018** parcellation is distributed by the Computational Brain
  Imaging Group (CBIG) under the MIT licence:

  > Copyright (c) 2016 Computational Brain Imaging Group (CBIG)
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to
  > deal in the Software without restriction, including without limitation the
  > rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
  > sell copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in
  > all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
  > FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
  > IN THE SOFTWARE.

- **MASSP**: we have not confirmed the licence terms. Confirm them with the
  authors or the distribution before commercial use.
- **MNI152 template and aseg**: permissive MNI/McGill notice (see above).

References: Fonov et al., NeuroImage 54 (2011); Ciric et al., Nature Methods 19
(2022) (TemplateFlow); Alkemade et al., Science Advances 8 (2022) (MASSP);
Schaefer et al., Cerebral Cortex 28 (2018) (Schaefer 2018); Yeo et al., Journal
of Neurophysiology 106 (2011) (17 networks).
