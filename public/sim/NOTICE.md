# anatomy.bin.gz

Surface meshes for the CIRCUIT Simulation Window (`/simulation`): the cortex,
the outer brain surface used to place the array, and ten target regions. All of
them are extracted from public atlases in MNI152 space (ICBM 2009c nonlinear
asymmetric, 1 mm). Nothing is sculpted by hand. Rebuilt by
`tools/demo-assets/build_sim_anatomy.py`.

They describe a population-average template, not a person.

| Mesh                                                    | Source                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Cortex, outer surface                                   | TemplateFlow `tpl-MNI152NLin2009cAsym_res-01_T1w` and `_desc-brain_mask` — MNI/McGill permissive notice, see `public/templates/NOTICE.md` |
| Hippocampus, amygdala, thalamus                         | TemplateFlow `_seg-aseg_dseg` (FreeSurfer convention) — same notice                                                                       |
| Subthalamic nucleus                                     | MASSP atlas (Alkemade et al., _Science Advances_ 2022), TemplateFlow `_atlas-MASSP20_dseg`                                                |
| V1, dlPFC, vmPFC, insula, auditory cortex, motor cortex | Harvard-Oxford cortical atlas, lateralised, 25 % threshold — TemplateFlow `_atlas-HOCPAL_desc-th25_dseg`                                  |

## Licence status — check before commercial use

- **Harvard-Oxford** is distributed with FSL and is covered by the FSL licence,
  which is free for non-commercial use only. Shipping it in a commercial product
  needs a commercial FSL licence, or replacing the six cortical regions with a
  permissively licensed parcellation. Julich-Brain (CC BY 4.0) has
  cytoarchitectonic V1, auditory, motor and insular areas.
- **MASSP**: we have not confirmed the licence terms. Confirm them with the
  authors or the distribution before commercial use.
- **MNI152 template and aseg**: permissive MNI/McGill notice (see above).

References: Fonov et al., NeuroImage 54 (2011); Ciric et al., Nature Methods 19
(2022) (TemplateFlow); Alkemade et al., Science Advances 8 (2022) (MASSP);
Desikan et al., NeuroImage 31 (2006) and Makris et al., Schizophrenia Research
83 (2006) (Harvard-Oxford).
