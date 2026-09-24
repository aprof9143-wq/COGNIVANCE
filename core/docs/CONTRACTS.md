# The frozen contract

Everything `imaging/` and `eeg/` emit, and everything downstream reads. Diff your
`_contracts_stub.py` against this, then delete the stub and import from
`cognivance_core.abstraction`.

Changing anything here is a conversation, not a commit.

---

## `UnifiedNeuralRecord`

```python
from cognivance_core.abstraction.record import (
    Modality, Provenance, QualityReport, UnifiedNeuralRecord, RecordValidationError,
)

@dataclass(frozen=True)
class UnifiedNeuralRecord:
    subject_id: str              # pseudonymous — never a site MRN
    session_id: str
    timepoint: date
    modality: Modality
    features: dict[str, float]
    arrays: dict[str, np.ndarray] = field(default_factory=dict)
    quality: QualityReport | None = None
    provenance: Provenance | None = None
```

Call `record.validate()` before returning one. It raises `RecordValidationError`
with the offending key or value named.

### Feature keys

Flat, lowercase, `snake_case`, matching `^[a-z][a-z0-9_]*$`, and **prefixed with
the modality value** — `fmri_`, `eeg_`, `mri_`, `pet_`, `clinical_`, `live_`.
Units live in the name, not the value: `fmri_mean_fd_mm`, `eeg_theta_alpha_ratio`.

### Feature values

Every value is a `float`.

| Value | Accepted | Why |
| --- | --- | --- |
| `0.18` | yes | |
| `float("nan")` | yes | the only correct way to say "not measured" |
| `np.float64(0.18)` | **yes** | it genuinely subclasses `float`, and `np.mean` returns it |
| `np.float32(0.18)` | **no** | not a `float` subclass — cast with `float(x)` |
| `1` (int) | no | survives arithmetic until it hits a type-strict model |
| `True` | no | `bool` is an `int`; a flag is not a measurement |
| `float("inf")` | no | use NaN for missing, or clip to a documented bound |
| `None`, `"0.5"` | no | |

**Never use `0.0` to mean missing.** Once it reaches fusion it is
indistinguishable from a real zero, and nothing downstream will catch it.

The `np.float64` / `np.float32` asymmetry is real and deliberate — the rule is
literally "is it a `float`", so that the `dict[str, float]` annotation stays
honest. It is pinned by a test.

### `subject_id`

Rejected if it matches `^\d{6,}$` — six or more digits and nothing else reads as
a site medical record number. `sub-123456` and `ADNI-002-S-0413` are fine;
`123456` is not.

### Two sharp edges

`arrays` holds numpy arrays, so on `UnifiedNeuralRecord`:

- `record_a == record_b` **raises** (`ValueError: truth value of an array…`)
- `hash(record)` **raises** (`TypeError: unhashable`)

Compare the fields you care about explicitly. These come with implementing the
frozen shape verbatim; if they bite, raise it and we change the contract
together rather than working around it locally.

---

## `QualityReport`

```python
@dataclass(frozen=True)
class QualityReport:
    passed: bool
    metrics: dict[str, float]
    flags: tuple[str, ...] = ()
```

`passed` is a decision, not a score. Set it false when the record should not
feed a model, and put the reason in `flags` (`"high_motion"`,
`"excessive_epoch_rejection"`).

---

## `Provenance`

```python
from cognivance_core.abstraction.provenance import capture

prov = capture({"atlas": "schaefer_100", "fd_threshold": 0.5}, seed=0)
```

Records the git sha, a key-order-independent hash of the config, versions of the
tracked libraries that are installed, and the seed. Two calls with the same
inputs at the same commit differ only in `created_at` — compare with
`prov_a.same_run_as(prov_b)`, not `==`.

---

## `NeuralDataSource`

```python
from cognivance_core.abstraction.source import (
    Capability, NeuralDataSource, SourceHealth, SourceMetadata, SourceStateError,
)
```

| Method | Contract |
| --- | --- |
| `connect() -> bool` | True once ready |
| `get_sampling_rate() -> float` | samples/sec/channel |
| `read_chunk(n) -> np.ndarray` | `(n_channels, n)` float32, microvolts |
| `get_metadata() -> SourceMetadata` | valid before connect and after close |
| `close() -> None` | **idempotent** |
| `capabilities() -> set[Capability]` | `LIVE`, `SEEKABLE`, `MULTI_SESSION` |
| `health() -> SourceHealth` | counters never negative |

**A short read means exhausted** — never "try again". Past the end, `read_chunk`
returns an empty `(n_channels, 0)` array rather than raising. Reading after
`close()` raises `SourceStateError`.

Any new source must pass `tests/contract/test_source_contract.py` by adding one
entry to its `SOURCES` list. If it cannot without loosening a test, the
abstraction has failed.

---

## Fixtures — use these, do not wait for ADNI

```python
from cognivance_core.testing.fixtures import synthetic_bold, synthetic_eeg_raw

img = synthetic_bold(shape=(64, 64, 36, 120), tr=2.0, seed=0)   # nibabel Nifti1Image
data, names = synthetic_eeg_raw(n_channels=19, sfreq=256.0, seconds=60.0, seed=0)
```

Both are seeded and byte-reproducible.

- `synthetic_bold` injects a 20-volume block design into a central cube, so an
  activation or connectivity test has something real to find. It imports nibabel
  lazily, keeping the `[imaging]` extra optional.
- `synthetic_eeg_raw` plants a 10 Hz rhythm **on the occipital channels only**,
  so you can assert alpha is found where it was planted and absent where it was
  not. It returns a plain `(n_channels, n_samples)` float32 array plus channel
  names — wrap it in `mne.io.RawArray` yourself, since `mne` may only be imported
  under `eeg/`.

`SimulatedSource` takes arbitrary `Band(freq_hz, amplitude_uv, channels)` entries
if you need a different planted signal.

---

## The layer boundary

`scripts/check_layers.py`, run in CI.

- **Module-level** import of `nibabel` / `nilearn` / `SimpleITK` outside
  `imaging/`, or `mne` outside `eeg/` → violation.
- **Any** import of those under `fusion/`, lazy included → violation. Fusion
  reads `UnifiedNeuralRecord` and nothing else.
- **Function-scope imports elsewhere are fine.** That is how `testing/fixtures.py`
  uses nibabel while keeping the extra optional.

---

## One place the implementation is stricter than the stub

`Modality` and `Capability` are `enum.StrEnum`, not `class X(str, Enum)`.

Equality is unchanged — `Modality.FMRI == "fmri"` is still true, and `.value`
still gives `"fmri"`. What changes is `str()`:

```python
str(Modality.FMRI)   # StrEnum:      "fmri"
                     # (str, Enum):  "Modality.FMRI"
```

So an f-string interpolating a modality now yields the value. This is the more
useful behaviour and it is what ruff enforces on Python 3.11+, but it is a
difference from the stub — if you interpolated a modality anywhere, check it.
