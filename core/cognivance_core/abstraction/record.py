"""The record every module emits and every downstream consumer reads.

This is the frozen day-one contract. Two engineers are building `imaging/` and
`eeg/` against it in parallel, so the field names and types here are not to be
changed without agreement — see `core/docs/CONTRACTS.md`.

The validation rules exist because the failure modes they catch are silent ones:
an int where a float belongs survives every arithmetic operation until it hits a
type-strict model; a 0.0 standing in for "not measured" is indistinguishable from
a real zero once it reaches fusion; and a site medical record number that leaks
into a subject_id is a privacy incident that no later step will notice.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - typing only
    import numpy as np

__all__ = [
    "Modality",
    "Provenance",
    "QualityReport",
    "RecordValidationError",
    "UnifiedNeuralRecord",
]

#: A feature key is lowercase, starts with a letter, and carries no units in the
#: value — `fmri_mean_fd_mm`, not `fmri_mean_fd` measured in millimetres.
FEATURE_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")

#: Anything that is only digits and six or more characters long is treated as a
#: site medical record number and refused.
MRN_LIKE_RE = re.compile(r"^\d{6,}$")


class RecordValidationError(ValueError):
    """Raised when a record breaks the contract. Carries the offending detail."""


class Modality(StrEnum):
    """Where a record's measurements came from.

    The value doubles as the mandatory prefix on every feature key, so
    `Modality.FMRI` records carry `fmri_*` features and nothing else.
    """

    MRI = "mri"
    FMRI = "fmri"
    PET = "pet"
    EEG = "eeg"
    CLINICAL = "clinical"
    LIVE = "live"


@dataclass(frozen=True)
class Provenance:
    """Everything needed to reproduce the run that produced a record.

    `created_at` is the one field that legitimately differs between two
    otherwise identical runs; `same_run_as` compares everything else.
    """

    git_sha: str
    config_hash: str
    library_versions: dict[str, str]
    seed: int | None
    created_at: str  # ISO-8601, UTC

    def same_run_as(self, other: Provenance) -> bool:
        """True when both describe the same computation, ignoring wall-clock time."""
        return (
            self.git_sha == other.git_sha
            and self.config_hash == other.config_hash
            and self.library_versions == other.library_versions
            and self.seed == other.seed
        )


@dataclass(frozen=True)
class QualityReport:
    """Whether a record is fit to use, and the numbers behind that judgement.

    `passed` is a decision, not a score. A consumer that only reads `metrics`
    and forms its own opinion defeats the point of having a gate.
    """

    passed: bool
    metrics: dict[str, float]
    flags: tuple[str, ...] = ()


@dataclass(frozen=True)
class UnifiedNeuralRecord:
    """One subject, one session, one modality.

    Note two sharp edges that come with implementing the frozen shape verbatim:
    `arrays` holds numpy arrays, so the generated `__eq__` raises on comparison
    and the generated `__hash__` raises on hashing. Compare fields you care
    about explicitly rather than comparing whole records.
    """

    subject_id: str
    session_id: str
    timepoint: date
    modality: Modality
    features: dict[str, float]
    arrays: dict[str, np.ndarray] = field(default_factory=dict)
    quality: QualityReport | None = None
    provenance: Provenance | None = None

    def validate(self) -> None:
        """Raise `RecordValidationError` if the record breaks the contract."""
        self._validate_subject_id()
        self._validate_features()

    def _validate_subject_id(self) -> None:
        if not self.subject_id:
            raise RecordValidationError("subject_id must not be empty")
        if MRN_LIKE_RE.match(self.subject_id):
            raise RecordValidationError(
                f"subject_id {self.subject_id!r} looks like a site medical record "
                "number (six or more digits and nothing else). Records must carry a "
                "pseudonymous identifier — map it outside this codebase and never "
                "commit the mapping."
            )

    def _validate_features(self) -> None:
        prefix = f"{self.modality.value}_"
        for key, value in self.features.items():
            if not FEATURE_KEY_RE.match(key):
                raise RecordValidationError(
                    f"feature key {key!r} must match {FEATURE_KEY_RE.pattern} — "
                    "lowercase, starting with a letter, words separated by underscores"
                )
            if not key.startswith(prefix):
                raise RecordValidationError(
                    f"feature key {key!r} must start with {prefix!r} so fusion can "
                    f"tell which modality produced it (this record is {self.modality.value})"
                )
            _validate_feature_value(key, value)


def _validate_feature_value(key: str, value: Any) -> None:
    """Every feature value is a real float: finite, or explicitly NaN.

    `bool` is rejected alongside `int` because it is a subclass of `int` and a
    boolean masquerading as a measurement is exactly the kind of thing that
    survives until it produces a nonsensical model coefficient.

    On numpy scalars: `np.float64` subclasses Python `float`, so it passes — and
    that is the common case, since `np.mean` and friends return it. `np.float32`
    does not subclass `float` and is refused; cast it with `float(x)`. The rule
    is "is it a `float`", deliberately, so that `dict[str, float]` in the record
    stays an honest annotation rather than one numpy quietly violates.
    """
    if isinstance(value, bool) or not isinstance(value, float):
        raise RecordValidationError(
            f"feature {key!r} is {type(value).__name__} {value!r}; every feature "
            "value must be a float. Use float('nan') for a measurement that is "
            "genuinely missing — never 0.0, which is indistinguishable from a real zero."
        )
    if math.isinf(value):
        raise RecordValidationError(
            f"feature {key!r} is infinite. Use float('nan') for missing, or clip "
            "to a documented bound for a saturated measurement."
        )
