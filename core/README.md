# cognivance-core

The scientific core of the NIMBLE platform. Python, layered by responsibility,
and deliberately isolated from the web application that shares this repository.

## Boundary

Everything under `core/` is Python and is **not** touched by the web build.
Nothing outside `core/` is touched by the Python tooling. The web app lives in
`src/` and `public/`; do not edit those from Python work, and do not edit `core/`
from web work.

## Layers

| Package | Layer | Owns |
| --- | --- | --- |
| `abstraction/` | 2 | `UnifiedNeuralRecord`, `NeuralDataSource`, provenance |
| `sources/` | 1 | Simulator, file and live signal origins |
| `imaging/` | 3 | MRI / fMRI / PET — the only place `nibabel` and `nilearn` may be imported |
| `eeg/` | 3 | EEG — the only place `mne` may be imported |
| `fusion/` | 3 | Multi-modal assembly. Reads records only; no modality libraries |
| `testing/` | — | Deterministic fixtures |

## Running

```sh
cd core
uv venv && uv pip install -e ".[imaging,eeg,dev]"
uv run pytest -m "not slow"     # fast suite
uv run pytest                   # includes real-data downloads
uv run mypy --strict cognivance_core/
uv run ruff check
```

Downloaded datasets are cached outside the repository. Never commit imaging or
EEG data.
