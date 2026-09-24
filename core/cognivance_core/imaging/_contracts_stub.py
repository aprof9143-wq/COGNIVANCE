from __future__ import annotations

from enum import Enum
from dataclasses import dataclass
from datetime import date
import numpy as np


class Modality(str, Enum):
    MRI = "mri"
    FMRI = "fmri"
    PET = "pet"
    EEG = "eeg"
    CLINICAL = "clinical"
    LIVE = "live"


@dataclass(frozen=True)
class Provenance:
    git_sha: str
    config_hash: str
    library_versions: dict[str, str]
    seed: int | None
    created_at: str


@dataclass(frozen=True)
class QualityReport:
    passed: bool
    metrics: dict[str, float]
    flags: tuple[str, ...] = ()


@dataclass(frozen=True)
class UnifiedNeuralRecord:
    subject_id: str
    session_id: str
    timepoint: date
    modality: Modality
    features: dict[str, float]
    arrays: dict[str, np.ndarray] = {}
    quality: QualityReport | None = None
    provenance: Provenance | None = None
