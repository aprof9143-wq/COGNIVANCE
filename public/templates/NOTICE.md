# mni152_template.nii.gz

The MNI ICBM152 2009a nonlinear symmetric T1 template, cropped to the brain and
resampled to 1.5 mm isotropic (uint8) so the research console opens on real
cortical anatomy. It is a population average, not an individual, and nothing
drawn on it is a finding.

Source: McConnell Brain Imaging Centre, Montreal Neurological Institute —
<https://www.bic.mni.mcgill.ca/ServicesAtlases/ICBM152NLin2009>. Obtained via the
`nilearn` distribution (`mni_icbm152_t1_tal_nlin_sym_09a_converted.nii.gz`).

Copyright (C) 1993–2009 Louis Collins, McConnell Brain Imaging Centre, Montreal
Neurological Institute, McGill University. Permission to use, copy, modify, and
distribute this software and its documentation for any purpose and without fee
is hereby granted, provided that the above copyright notice appear in all
copies. The authors and McGill University make no representations about the
suitability of this software for any purpose. It is provided "as is" without
express or implied warranty. The authors are not responsible for any data loss,
equipment damage, property loss, or injury to subjects or patients resulting
from the use or misuse of this software package.

References: Fonov et al., NeuroImage 54 (2011); Fonov et al., NeuroImage 47
(2009) S102; Collins et al., Human Brain Mapping (1999).

# mni152_aseg.nii.gz

FreeSurfer-convention subcortical labels (aseg: hippocampus, amygdala,
ventricles, thalamus, basal ganglia, ...) for the template above, so the
research console and Neurodegeneration Tracking have regional volumes to show
on the template. The labels describe the population-average template, not a
person.

Source: TemplateFlow, `tpl-MNI152NLin2009cAsym_res-01_seg-aseg_dseg.nii.gz`
(ICBM 152 Nonlinear Asymmetrical 2009c; same McGill licence as above). They
were carried onto the 2009a symmetric grid by MNI coordinates, using a
27-point majority vote per voxel. The brain-mask Dice against the template is
0.986. Rebuilt by `tools/demo-assets/build_template_aseg.py`.

References: Fonov et al., NeuroImage 54 (2011); Ciric et al., Nature Methods 19
(2022) (TemplateFlow).
