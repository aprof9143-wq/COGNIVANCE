# Imaging viewer audit

Scope: the `/research` console (2D MRI panels, 3D volume and EEG fusion) and the
proposed Alzheimer's-oriented neurodegeneration module. Written before any code
was changed. Status of each item is tracked in the plan at the end.

> For research/educational use unless separately validated and cleared for
> clinical use. Nothing in this repository has been tested against, or claims
> conformance with, DICOM, FDA, CE/MDR, HIPAA or any clinical standard.

---

## 1. Stack as found

| Concern | Implementation | Where |
| --- | --- | --- |
| Framework | TanStack Start (React 19, Vite 8, Tailwind 4), SSR | `src/routes/*` |
| DICOM parser | **None.** No DICOM support of any kind | — |
| Volume reader | Custom NIfTI-1 reader, first frame only | `src/lib/nifti.ts` |
| 2D renderer | `<canvas>` per plane, drawn from the derived 8-bit cube | `src/components/research/SliceView.tsx` |
| 3D renderer | Custom three.js GLSL raymarcher; three has **no type declarations installed**, so it is typed `any` | `src/components/research/VolumeRenderer.tsx` |
| EEG | Custom EDF/EDF+ reader, Welch PSD, coherence | `src/lib/edf.ts`, `src/lib/signal.ts` |
| Tractography | `.trk` / `.tck` readers, bundled compact tractogram | `src/lib/tractography.ts` |
| State | React component state in one 1,900-line component; source data, presentation state, derived data and annotations are not separated | `src/components/research/ResearchConsole.tsx` |
| Workers | None; all parsing runs on the main thread | — |
| Tests (web) | **None.** No test runner is installed. CI runs only the Python `core/` suite | `.github/workflows/core.yml` |

## 2. What the displayed data actually is

| Layer | Default content | Real? |
| --- | --- | --- |
| MRI | MNI152 ICBM 2009a template (population average, bundled) | Real, but not a patient. Falls back to a **synthetic phantom** if the fetch fails |
| Tractography | 20,000 streamlines, OpenNeuro ds000221 (CC0), DIPY CSD, affinely registered to the template | Real, one healthy adult. Falls back to a **synthetic bundle** |
| Lesion | **Synthetic demonstration lesion** with volumes in a callout | Fabricated; labelled synthetic |
| EEG | **Synthetic phantom recording** until an EDF is loaded | Fabricated; labelled phantom |
| Electrodes (3D) | 10-20 directions **projected** onto the scan by ray-marching | Not registered coordinates |
| Coherence arcs | Computed from the loaded EEG | Real computation, inferred connectivity |

## 3. Weaknesses — data correctness (these change what a reader concludes)

1. **No DICOM.** Nothing reads rescale slope/intercept, window tags,
   photometric interpretation, pixel spacing, orientation or position.
2. **Source intensities are destroyed on load.** `parseNifti` clips to the
   1st–99th percentile and quantises to 0–255 before anything is drawn. The
   original values cannot be probed, windowed or recovered.
3. **Anisotropic resampling to a 160³ cube.** A 512-pixel in-plane acquisition
   is downsampled to 160; a 60-slice acquisition is upsampled to 160 by nearest
   neighbour. The 2D panels show the resampled cube, not the source.
4. **Orientation is ignored.** qform/sform are never read. Voxel order is
   assumed to be RAS; an LAS or LPS file is shown mirrored with no indication,
   and no orientation markers can be derived.
5. **`mriAsymmetry` assumes +x is the subject's right.** For radiologically
   stored (LAS) files the index silently changes sign.
6. **Wrong aspect ratio in 2D.** Each slice is drawn into a square panel from a
   cube grid; physical proportions are lost.
7. **Cosmetic grayscale alteration.** `SliceView` applies gamma 0.78 and a blue
   tint to every slice, always on, with no way to see the original.
8. **Fabricated layers shown by default.** Synthetic lesion with volume numbers,
   synthetic EEG, synthetic tract fallback. They are labelled, but the brief is
   explicit: no placeholder layer is shown as data.
9. **Tractograms are fitted, not registered.** An uploaded `.trk`/`.tck` is
   stretched to the brain's bounding box. That is arbitrary placement.
10. **Electrodes are projected, not registered.** They are placed by marching
    along idealised directions to the first bright voxel.
11. **Lesion particle cloud invents detail.** Points are jittered randomly
    within voxels and 8 % are made into white "sparks".
12. **No measurements, no value probe, no window/level, no zoom/pan,** no slice
    counter, no spacing or coordinate readout.
13. **Landing page shows generated numbers as live telemetry** ("Cortical
    channel array — live", jittering SNR/drift/yield). `src/routes/index.tsx`.

## 4. Weaknesses — visual design

1. Orbital rings, tick bezels, satellites, 420 drifting motes and glow sprites
   around the brain imply precision and compete with anatomy.
2. Default "neural" palette tints anatomy blue; grayscale should be default.
3. Rainbow-like electrode and topomap ramps; categorical lesion colours not
   chosen for colour-vision deficiency.
4. 2D panels are small squares below a large 3D canvas; diagnostic images
   should get the viewport.
5. Many 0.55–0.62 rem labels at low contrast (`#5e719a` on near-black).

## 5. Repository health before this work

- `eslint .`: 800 problems, all in Lovable-generated components, most of which
  no route imports (`NimbleResearchLab*`, `NimbleResearchStudio*`,
  `NimbleRealTimeAnalysis*`, `BrainResearchLab*`, `NimbleAnalysisWorkspace`,
  `NimbleMRI*`, `VolumeBrain`); ~750 are formatting.
- `tsc --noEmit`: stops at a syntax error in `NimbleNeuralLab.tsx` (unused);
  behind it ~160 semantic errors, nearly all in the same unused files.
- `vite build`: passes.

## 6. Decisions

- **Parser:** `dicom-parser` (the Cornerstone team's parser, MIT). Cornerstone3D
  itself was considered and not adopted now: it brings worker-bundled WASM
  codecs and a large rendering stack into an SSR build that Lovable also edits,
  and the integration risk outweighed the benefit at this stage. The viewer follows
  Cornerstone/OHIF conventions (tool bindings, VOI LUT semantics) so a later
  migration is a swap of the rendering layer, not the data model.
- **Transfer syntaxes (target):** native (uncompressed) little and big endian,
  plus RLE Lossless, decoded in-browser. Anything else — JPEG family, JPEG-LS,
  JPEG 2000, HTJ2K, deflate — shows an explicit "unsupported transfer syntax"
  state naming the UID rather than guessing. See the final status table.
- **Coordinate system:** the internal world frame is **DICOM patient LPS, in
  mm**. NIfTI's RAS affine is converted on load (x, y negated). Every volume
  carries a 4×4 `ijkToLps` matrix; every overlay is placed through it.
  Documented in `src/lib/imaging/geometry.ts`.
- **Display convention:** radiological (patient left on screen right) for axial
  and coronal; orientation markers are derived from the direction cosines,
  never assumed.

## 7. Plan

| # | Change | Files |
| --- | --- | --- |
| 1 | This audit | `docs/VIEWER_AUDIT.md` |
| 2 | Tooling: vitest, `typecheck` script, `@types/three`, `dicom-parser` | `package.json`, lockfiles, `vitest.config.ts` |
| 3 | Imaging core, pure and tested: types, geometry, modality/VOI LUT, DICOM series builder, NIfTI → patient-space volume, reslicing, measurement, segmentation volume | `src/lib/imaging/*` |
| 4 | MPR viewer: three synchronised viewports, W/L, presets, zoom/pan/fit, cine, keyboard, orientation markers, measurements, probe, overlays, metadata panel, histogram, reversible display tools with Original and split view, error states; decode in a Web Worker | `src/components/viewer/*`, `src/lib/imaging/*.worker.ts` |
| 5 | 3D restraint and provenance: grayscale default, remove decorative HUD, orientation cube, clipping planes, camera presets, independent layers with provenance, registered-only tracts and electrodes, no fabricated lesion, export with legend and audit metadata | `VolumeRenderer.tsx`, `ResearchConsole.tsx` |
| 6 | Neurodegeneration module: typed schemas, calculators (ICV normalisation, asymmetry, annualised change, norm lookup, QC and missing states), symptom capture, assessments, visual ratings, symptom–region research matrix with provenance, regional table, longitudinal charts, imports/exports | `src/lib/neuro/*`, `src/routes/neurodegeneration.tsx`, `src/components/neuro/*` |
| 7 | Honest labelling of landing-page animations | `src/routes/index.tsx` |

## 8. What cannot be done validly in the browser here

These are import-only (with provenance) or out of scope, and the UI says so:

- Hippocampal/regional segmentation and cortical thickness — needs FreeSurfer,
  FastSurfer, SynthSeg or equivalent. The module imports their outputs.
- Rigid/deformable longitudinal registration and Jacobian maps — needs ANTs,
  FSL or equivalent. Precomputed maps can be loaded as overlays.
- Normative percentiles — no compatible reference dataset ships with the app;
  a reference table can be imported and is checked for compatibility.
- PET, CSF and blood biomarkers — entered or imported with their assay
  metadata; never inferred from MRI.
- Compressed DICOM transfer syntaxes other than RLE.

---

## 9. Status after implementation

### Implemented

| Area | What exists now | Where |
| --- | --- | --- |
| DICOM reading | dicom-parser; native LE/BE and RLE decoded; rescale slope/intercept; window centre/width (multi-valued, explanations); VOI LUT Function; MONOCHROME1/2; pixel spacing; slice thickness and spacing; IOP/IPP; enhanced multi-frame functional groups; per-frame rescale; bits-stored masking and sign extension | `src/lib/imaging/dicom.ts` |
| Series building | grouping by series, sorting by position along the normal, gantry-tilt-safe step, duplicate-position, non-uniform-spacing and straight-stack checks | `dicom.ts` |
| NIfTI | native resolution and values, sform → qform → none, RAS → LPS, scl_slope/inter, cal_min/max | `src/lib/imaging/nifti.ts` |
| Coordinate system | LPS mm everywhere; documented; every overlay placed through its own affine | `geometry.ts` |
| Grayscale | modality LUT, VOI LINEAR / LINEAR_EXACT / SIGMOID per PS3.3 C.11.2.1.2, MONOCHROME1 inversion, histogram with clipped fractions | `voi.ts`, `display.ts` |
| MPR | three views resliced from the source in patient space, nearest (raw) or trilinear display interpolation, physical aspect ratio, crosshair sync, orientation markers from view axes | `reslice.ts`, `MprViewport.tsx` |
| Interaction | W/L drag + numeric, file windows, CT presets on calibrated CT only, zoom about cursor, pan, fit, reset, magnifier (re-samples source), wheel/keys/cine, single/quad layout | `Workstation.tsx` |
| Measurement | length mm, ellipse area mm² with mean ± sd, probe (HU only for calibrated CT) — all in patient space | `measure.ts` |
| Overlays | label maps with per-class visibility, opacity, outline; different-grid resampling; no-overlap failure state; volumes on the native label grid | `segmentation.ts`, `panels.tsx` |
| Display tools | gamma, local contrast, mild bilateral denoise, unsharp mask — off by default, "Display enhancement active", Original, before/after split | `display.ts` |
| Metadata / PHI | descriptive metadata panel; identifying tags recorded as present, never read into memory, displayed, logged or exported; dates at month precision | `dicom.ts`, `panels.tsx` |
| 3D | volume placed through its affine, grayscale TF from the 2D window, volume/MIP/surface, patient-axis clipping, orientation cube, camera presets, independent layers with provenance, registered-only tracts and electrodes, export with legend and audit lines | `Volume3D.tsx` |
| EEG | measured / interpolated / inferred separated; band and time-window selectors; viridis maps; synthetic demo only on request, labelled | `EegSection.tsx` |
| Neurodegeneration module | schemas, calculators, imports/exports, dashboard, research matrix, longitudinal charts, ratings, biomarkers, 3D regional map, evidence panel, safety statement | `src/lib/neuro/*`, `src/components/neuro/*` |

### Test and build results

- `pnpm test`: 101 tests, 8 files, all passing (imaging core, display,
  electrodes, tractography, neurodegeneration calculators and importers).
- DICOM decoding was cross-checked outside the suite against pydicom on its
  bundled files (CT_small; MR_small in explicit, implicit, big-endian, RLE and
  padded forms; a 484×300 image with overlay bits): pixel-for-pixel identical.
- Browser checks: a 101-file sagittal DICOM series generated from the template
  (shuffled, fake patient name) reconstructs to the same patient positions as
  the NIfTI in all three planes; no identifier appears in the page text; a
  2 mm label map on the 1.5 mm template gives the expected voxel counts.
- `pnpm build`: passes.
- Type check and lint: clean for all mounted code (every file reachable from a
  route). **Repository-wide `tsc` and `eslint .` still fail**, solely because
  of 15 Lovable-generated components that no route imports
  (`NimbleResearchLab*`, `NimbleResearchStudio*`, `NimbleResearchSafe`,
  `NimbleRealTimeAnalysis*`, `NimbleAnalysisWorkspace`, `BrainResearchLab*`,
  `NimbleNeuralLab` — which has a syntax error — `NimbleMRI*`, `VolumeBrain`).
  They were left untouched pending an owner's decision to delete or repair
  them.

### Not implemented / limitations

- JPEG, JPEG-LS, JPEG 2000, HTJ2K and deflated transfer syntaxes: named
  "unsupported transfer syntax" state, no decoding.
- DICOM SEG and DICOM SR import/export; presentation states; overlay planes
  (60xx); VOI LUT Sequence, Modality LUT Sequence and Real World Value Mapping
  (detected and warned, not applied).
- Non-uniform slice spacing is displayed with the mean spacing (warned), not
  per-slice positions; multi-echo/multi-phase series show the first image at
  each position.
- Views are true patient-axis planes; no oblique or acquisition-aligned MPR,
  no 2D slab/MIP.
- Reslicing runs on the main thread; whole series are held in memory; no
  progressive loading for very large studies. 3D textures above 256³ are
  block-averaged for display.
- No display calibration (PS3.14 Grayscale Standard Display Function) — screen
  grey levels depend on the monitor.
- Longitudinal registration, Jacobian and percentage-change maps are not
  computed or imported; the module works from regional measurements.
- No normative reference, segmentation uncertainty, PET image, or automated
  visual-rating model is bundled; the UI shows "Unavailable" / "No compatible
  norm" accordingly.
- Series Description can, rarely, contain identifying text; it is displayed
  and exported as recorded.
- Contrast and keyboard accessibility were designed for but not formally
  audited against WCAG.

### Requires clinical, regulatory or medical-physics validation

- Rendering and VOI against reference DICOM viewers and conformance datasets;
  display calibration.
- Geometric and measurement accuracy with physical phantoms across vendors,
  including oblique and gantry-tilted acquisitions.
- Segmentation-volume agreement (Dice, surface distance) and test–retest
  reproducibility for whatever pipeline produces the imported measurements.
- Compatibility rules for normative references, and any reference dataset
  before use.
- The symptom–network associations: review by clinicians against current
  literature, including atypical presentations.
- EEG spectral and coherence methods against established toolboxes.
- Regulatory classification (e.g. EU MDR Rule 11, FDA software as a medical
  device) before any clinical use. No compliance is claimed.
