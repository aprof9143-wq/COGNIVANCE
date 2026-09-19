# NIMBLE Build Plan

**Alzheimer's Neural Reconstruction & Implant-Ready Platform**
Cognivance Labs · Build Plan v1 · 14 Sep 2026

Derived from *Platform Vision + Architecture + Benchmarking* and *Benchmarking & Uniqueness*,
read against this repository at commit `067e039`.

> "A research-to-prototype platform that combines multi-modal Alzheimer's neuroimaging,
> neuronal degeneration simulation, and an implant-ready hardware interface — a combination
> that existing tools do not offer together."

---

## 1. Where this repository actually stands

The source documents specify a Python scientific platform (nibabel, SimpleITK, nilearn,
MNE-Python, PyTorch, pyserial, vedo). This repository is a TypeScript marketing site built on
TanStack Start, and its `/research` route is a demonstration, not an instrument. Read against
the five-layer architecture, **only Layer 5 exists.**

| Layer | Specified | In the repo today |
|---|---|---|
| 1 · Data Source | ADNI/OASIS loaders, EEG loaders, simulator, live MCU | None. Browser file-picker only. |
| 2 · Abstraction | Unified Data Object, metadata standard, source switch | None. |
| 3 · Processing | Atrophy, connectivity, EEG features, fusion engine | A NIfTI header parser that downsamples to 128³ `Uint8Array` for display. No segmentation, no registration. |
| 4 · Intelligence | Classification, progression risk, suggestion modules | None. Mode labels (`TUMOR`, `TRACTS`, `CONNECTOME`) render synthetic geometry. |
| 5 · Presentation | Plots, 3D views, reports, logs | **Partial.** Working three.js viewer, real NIfTI ingest, good visual language. |

### Three defects to fix before any real data touches this code

1. **Auth is theatre.** `src/routes/auth.tsx` stores plaintext passwords in `localStorage`
   under `cognivance_users` and gates `/research` on a client-side key. Anyone can set it from
   a console.
2. **Dead code outnumbers live code.** Thirteen of twenty-two components — roughly 2,000 lines
   of abandoned viewer rewrites — are unreferenced.
3. **Team assets are wrong.** Four photos in `public/` are byte-identical to each other, and
   three more are case-variant pairs that collide on case-insensitive filesystems.

---

## 2. Target architecture and where each layer lives

The layered design from Section 2 of the Vision document holds. The addition this plan makes
is a **seam**: Layers 1–4 run in Python on a workstation or server; Layer 5 is this repository,
talking to the core over one versioned HTTP + WebSocket contract.

```
LAYER 1            LAYER 2          LAYER 3         LAYER 4          ║  LAYER 5
DATA SOURCE        ABSTRACTION      PROCESSING      INTELLIGENCE     ║  PRESENTATION
                                                                     ║
ADNILoader     ┐                ┐  imaging/     ┐  AD vs CN          ║  FastAPI
OASISLoader    │   NeuralData   │  eeg/         │  MCI vs CN         ║  REST + WS
EEGLoader      ├─> Source       ├─> fusion/     ├─> Progression      ║  OpenAPI 3.1
SimulatedSrc   │                │  longitudinal/│  Explainers        ║      │
SerialMCUSrc   │   UnifiedNeural│  runner.py    │  Stim. suggestion  ║      v
FutureImplant  ┘   Record       ┘               ┘  (simulation only) ║  THIS REPO
                                                                     ║  TanStack Start
                   §2.2 / §2.3                                       ║  three.js viewer
                   non-negotiable                                    ║  generated client
                                                       NETWORK SEAM ═╝
```

### Two repositories, not one

`AGENTS.md` marks this repository as Lovable-connected: commits sync back into the Lovable
editor, and its agent writes to `main`. That is fine for a web front end and hostile to a
scientific core — you do not want a prompt-driven editor holding the code that produces your
published accuracy figures.

- **COGNIVANCE** (this repo) — Lovable-managed console.
- **cognivance-core** (new) — the Python platform.

The only thing crossing between them is a generated TypeScript client built from the core's
OpenAPI schema, committed into the web repo and refreshed by CI.

---

## 3. The two contracts that must not drift

Both documents call the Hardware Abstraction Layer and the Unified Data Object
non-negotiable. Concretely: these two definitions are written in week 1, put under a contract
test suite every source and every modality must pass, and changed only by an explicit version
bump.

### 3.1 NeuralDataSource

The Vision document's conceptual interface, with the additions needed to make it testable:
capability reporting so callers can adapt without type-checking, and an explicit contract on
`read_chunk` at end-of-stream.

```python
# core/abstraction/source.py
class NeuralDataSource(ABC):
    """Every signal origin — simulator, MCU, implant — implements this."""

    def connect(self) -> bool: ...
    def get_sampling_rate(self) -> float: ...
    def read_chunk(self, n_samples: int) -> np.ndarray:
        # (n_channels, n_samples) float32, microvolts.
        # Returns fewer than n_samples ONLY at end of stream.
        ...
    def get_metadata(self) -> SourceMetadata: ...
    def close(self) -> None: ...

    # added for testability
    def capabilities(self) -> set[Capability]: ...  # LIVE, SEEKABLE, MULTI_SESSION
    def health(self) -> SourceHealth: ...           # dropped, latency_ms, buffer

# Implementations: SimulatedSource, SerialMCUSource, EDFFileSource,
#                  FutureImplantSource (stub, raises NotImplemented)
```

### 3.2 UnifiedNeuralRecord

One record type carries MRI-derived features, EEG features and live implant features into
identical downstream code. `provenance` is not optional metadata — it is what makes the
reproducibility metric measurable.

```python
# core/abstraction/record.py
@dataclass(frozen=True)
class UnifiedNeuralRecord:
    subject_id:   str            # pseudonymous; never a site MRN
    session_id:   str            # one visit / timepoint
    timepoint:    date
    modality:     Modality       # MRI | FMRI | PET | EEG | CLINICAL | LIVE
    features:     dict[str, float]
    arrays:       dict[str, np.ndarray]   # volumes, epochs — lazy-loaded
    quality:      QualityReport  # motion, SNR, dropped channels
    provenance:   Provenance     # git sha, config hash, lib versions, seed

# Rule enforced in CI: no module above Layer 2 may import nibabel or mne.
```

**Why the import rule matters.** It is the mechanical form of the source-switch metric. If
`fusion/` can reach for `mne`, then EEG assumptions leak into code the implant path will later
reuse, and "same analysis on simulated and real signals" stops being provable. A lint rule in
CI costs nothing now and is unaffordable to retrofit at month six.

---

## 4. Phases

Ordered by dependency, not by appeal. The benchmark harness is built **before** the models it
will judge, exactly as both documents instruct.

### Phase 00 — Repository remediation · weeks 1–2 · web

Clear the demo debris so the console can become an instrument.

- Delete the 13 unreferenced components (`BrainResearchLab`, `NimbleMRI*`,
  `NimbleResearchStudio*`, `VolumeBrain`, and the rest) — about 2,000 lines.
- Replace `localStorage` auth with a real identity provider; move the `/research` gate to a
  server route guard.
- Resolve duplicate and case-colliding images in `public/`; source correct team photographs.
- Drop one lockfile — keep `pnpm-lock.yaml`, which Vercel uses; delete `bun.lock`.
- Add CI: `pnpm lint`, `tsc --noEmit`, build on every PR. The repo has none today.
- Rewrite `README.md`, which still carries the Lovable scaffold prompt and the title
  "Surreal Spark Studio".

**Exit:** clean `tsc --noEmit`; zero unreferenced modules; no credential path through
`localStorage`; CI green on `main`.

### Phase 01 — Core skeleton and contracts · weeks 1–4 · core

- `cognivance-core` scaffolded: Python 3.11, `uv`, ruff, mypy strict, pytest.
- `NeuralDataSource` and `UnifiedNeuralRecord` as written in §3.
- `SimulatedSource` and `EDFFileSource`, both passing one shared contract suite.
- YAML pipeline runner; every run writes a provenance record (git sha, config hash, library
  versions, RNG seed).
- Layer-boundary import lint wired into CI.

**Exit:** the same pipeline config runs unmodified against `SimulatedSource` and
`EDFFileSource`. Two runs of one config produce byte-identical outputs. Source-switch cost is
zero code changes, one config line.

### Phase 02 — Benchmark harness · weeks 3–6 · core · *before models*

- Fixed evaluation cohort with subject IDs committed to the repository as a manifest — the
  documents' first protocol step.
- **Subject-level grouped splits**, enforced in code: no subject may appear in both train and
  test, across any timepoint.
- A locked hold-out test set, opened once per release, plus a separate development set for all
  tuning.
- Metric library: accuracy, AUC, sensitivity, specificity, Dice, volume % error — each
  reported with a 95% bootstrap confidence interval.
- Versioned benchmark table emitted per release, with run-to-run variance recorded.

**Exit:** harness scores a deliberately weak baseline (logistic regression on age + MMSE) end
to end and produces a signed benchmark table. Repeat runs show documented variance.

### Phase 03 — Imaging pipeline · weeks 5–12 · core

- T1 ingest via nibabel; N4 bias correction, skull strip, MNI registration through SimpleITK.
- Hippocampal and ventricular segmentation; regional volumetry normalised to intracranial
  volume.
- FreeSurfer comparison run on the evaluation cohort, as the documents' third protocol step.
- PET SUVR quantification against a reference region; fMRI connectivity matrices via nilearn.
- Longitudinal atrophy rates across timepoints for the same subject.

**Exit:** hippocampal volume error < 4% versus FreeSurfer, Dice > 0.85, on the fixed cohort.
Full-subject processing time recorded on stated hardware.

### Phase 04 — EEG pipeline · weeks 9–14 · core

- MNE-Python preprocessing: filtering, ICA artefact removal, automated epoch rejection with a
  logged quality report.
- Alzheimer's-relevant features — relative band power, theta/alpha ratio, spectral slowing,
  phase-lag index, sample entropy.
- Identical feature extraction over `SimulatedSource` output and recorded EEG, as the
  documents' fourth protocol step.

**Exit:** EEG-only AD vs CN within 80–90% on the fixed cohort. Feature values from simulated
and recorded input agree within a stated tolerance.

### Phase 05 — Fusion and intelligence · weeks 13–20 · core

- Fusion engine assembling MRI + PET + EEG + clinical features with explicit missing-modality
  handling.
- Three classifiers — AD vs CN, MCI vs CN, converter vs stable — each with a matched
  single-modality baseline.
- Per-feature attribution on every prediction, satisfying the explainability differentiator.
- Ablation table quantifying what each added modality contributes.

**Exit:** all three tasks meet §5 targets on the locked hold-out, reported with confidence
intervals. Multi-modal beats every single-modality baseline by a margin exceeding its CI.

### Phase 06 — Degeneration simulation · weeks 17–22 · core · *USP*

The Benchmarking document is explicit that this must not be "fake data only". It earns its
place by following published patterns — regional atrophy ordering, approximate rates,
individual variation.

- Braak-staged regional atrophy progression with literature-derived rates and per-subject
  variability.
- Coupled EEG degradation so simulated imaging and simulated signal tell one consistent story.
- Synthetic longitudinal cohorts with known ground truth, used to test progression models
  where real follow-up is scarce.
- A documented validation comparing simulated atrophy trajectories against published cohort
  curves.

**Exit:** simulated trajectories fall within published ranges for the regions modelled.
Progression models trained on simulation transfer to real data above chance, with the gap
reported honestly.

### Phase 07 — Hardware abstraction, live path · weeks 19–24 · core · *USP*

- `SerialMCUSource` over pyserial with a documented framing protocol, sequence numbers and
  drop accounting.
- Reference firmware for one commodity board, streaming a known waveform for loopback
  validation.
- Streaming feature extraction on live chunks, reusing Layer 3 unchanged.
- End-to-end latency instrumentation, chunk arrival to rendered display.
- `FutureImplantSource` as an interface-complete stub that raises — proving the seam without
  overclaiming.

**Exit:** one analysis config runs against simulator and real MCU with no code change. Latency
measured and published. Loopback features match offline features on the same waveform.

### Phase 08 — Console integration · weeks 21–27 · web

This is where the repository stops being a demo. The existing three.js viewer is worth
keeping; what changes is that it renders computed results instead of synthetic geometry.

- FastAPI service over Layers 1–4; OpenAPI 3.1 schema generating the TypeScript client
  committed into this repo.
- `/research` rebuilt against real endpoints: upload, job status, segmentation overlays,
  volumetry tables, classifier output with attributions.
- Retire the client-side NIfTI parser in favour of server-rendered volumes and masks; keep the
  viewer.
- WebSocket channel for live EEG and MCU streams.
- Subject timeline view for longitudinal tracking; one-click export of a report carrying its
  provenance record.

**Exit:** a researcher uploads a subject, receives real volumetry and a real classification
with attributions, and exports a report reproducible from its provenance record alone.

### Phase 09 — v1.0 benchmark release · weeks 27–28 · gate

- Hold-out test set opened once; full benchmark table published with confidence intervals.
- All five uniqueness metrics measured and recorded, not asserted.
- Competitor positioning table refreshed against measured capability.
- Explicit limitations section: closed-loop implant control is future work.

**Exit:** every claim in the uniqueness formula is backed by a number in the release table.

---

## 5. Benchmark targets

Carried directly from both documents. These are **release gates**, not aspirations — Phase 09
does not ship until each row is filled in with a measurement.

### 5.1 Diagnostic and quantification

| Task | Metric | Target | Gate phase |
|---|---|---|---|
| AD vs Cognitively Normal | Accuracy / AUC | 88–93% / > 0.90 | 05 |
| MCI vs Normal | Accuracy / AUC | 75–85% / > 0.80 | 05 |
| Progression, converter vs stable | Accuracy / AUC | 70–78% / > 0.75 | 05 |
| EEG-based AD detection | Accuracy / AUC | 80–90% | 04 |
| Hippocampal volume | Volume % error | < 4% | 03 |
| Segmentation quality | Dice coefficient | > 0.85 | 03 |
| Test–retest stability | Variance across runs | low, documented | 02 |

### 5.2 System and uniqueness

These are the metrics that distinguish the platform from a well-tuned classifier. They deserve
the same rigour as accuracy.

| Metric | How it is measured | Gate phase |
|---|---|---|
| **Source-switch cost** | Lines of code and config changed to move simulator → MCU → implant stub. Target: zero code, one config line. | 01, 07 |
| **Multi-modal fusion count** | Modalities running in one coherent pipeline. Target: 5 — MRI, fMRI, PET, EEG, clinical. | 05 |
| **End-to-end latency** | Live chunk arrival to rendered display, p50 and p95, on stated hardware. | 07, 08 |
| **Reproducibility** | Same input and provenance record reproduce byte-identical output on a clean machine. | 01, 09 |
| **Full-subject processing time** | Wall-clock for a complete multi-modal subject on documented commodity hardware. | 03, 09 |

---

## 6. Risks that will decide whether the numbers hold

### Data leakage is the main threat to every accuracy figure

The Vision document notes multi-modal studies reporting 90–96% for AD vs CN. A meaningful
share of that literature splits at the *scan* level rather than the *subject* level, so the
same person's follow-up scans land in both train and test. On longitudinal cohorts like ADNI
this alone can inflate reported accuracy by several points.

Three defences, all in Phase 02, before any model exists:

1. Grouped splits keyed on subject ID and asserted in code.
2. A hold-out set opened once per release, with all tuning on a separate development set.
3. Every figure published with a bootstrap confidence interval.

An honest 89% will survive external review. An unexamined 95% will not.

### Other risks

- **Data access is the schedule's critical path.** ADNI requires an approved Data Use
  Agreement and prohibits redistribution — it cannot sit in CI. Apply in week 1; assume 4–8
  weeks. Build Phases 02–03 against OASIS, whose terms are more permissive, and keep a small
  synthetic fixture set for continuous integration.
- **Cohort size bounds what you may claim.** With 200 subjects, a 90% accuracy carries a 95%
  CI of roughly ±4 points. Fix the cohort size in Phase 02 and state the achievable precision
  then, rather than discovering at Phase 09 that the result cannot distinguish your model from
  the baseline.
- **Regulatory posture.** Research use only, not a medical device, no diagnostic claims —
  stated in the UI, the README and every exported report. The word *implant* attracts scrutiny
  disproportionate to a simulation module; keep the limitation statement the documents call
  for prominent and unhedged.
- **Privacy in the web tier.** The moment real scans reach the console, this repository is in
  scope for health-data handling. Pseudonymous subject IDs only, defacing on ingest,
  encryption at rest, audit logging, and a deployment region chosen deliberately. None of that
  exists today.
- **Lovable and the core.** Lovable's agent writes to this repository's `main`. Keeping the
  scientific core in a separate repository removes any path by which a prompt-driven edit
  changes a published result.
- **Simulation credibility.** The degeneration module is a differentiator only if it is
  validated against literature. Budget the validation write-up inside Phase 06 rather than
  deferring it — unvalidated, it reads to reviewers as synthetic data dressed up as a feature.

---

## 7. Schedule

28 weeks to v1.0. Phases overlap where they touch different people.

```
Week                1    5    9   13   17   21   25  28
00 Repo remediation ██
01 Core contracts   ████▒
02 Benchmark harness  ████▒▒
03 Imaging               ████████▒▒
04 EEG                       █████▒▒
05 Fusion + models               ███████▒▒
06 Simulation                        █████▒▒
07 Hardware / live                     █████▒▒
08 Console                               ██████
09 v1.0 release                                █
```

---

## 8. First two weeks, concretely

| Action | Where | Why it is first |
|---|---|---|
| Submit the ADNI Data Use Agreement | External | Longest lead time on the plan; everything in Phases 03–05 waits on it. |
| Open `cognivance-core` | New repo | Keeps scientific code out of reach of the Lovable editor. |
| Write `NeuralDataSource` and `UnifiedNeuralRecord` | core | Every later module is shaped by them; changing them at month four is a rewrite. |
| Commit the evaluation cohort manifest | core | Both documents put the benchmark subset before the models. |
| Delete the 13 dead components | web | Two thousand lines of abandoned rewrites obscure which viewer is real. |
| Replace `localStorage` auth | web | Currently the only thing between the public and `/research`. |
| Add lint, typecheck and build CI | web | The repository has no automated checks at all. |
| Choose and document the evaluation hardware | Both | Processing-time and latency metrics are meaningless without it. |

---

## Uniqueness formula, restated as an engineering gate

> multi-modal Alzheimer's analysis (Phase 05)
> — degeneration simulation (Phase 06)
> — hardware abstraction (Phases 01, 07)
> — measurable benchmarks (Phases 02, 09)

Drop any one and the platform converges on tools that already exist.
