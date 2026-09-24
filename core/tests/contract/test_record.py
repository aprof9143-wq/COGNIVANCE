"""Validation rules for UnifiedNeuralRecord.

Each rule here exists because the thing it catches is otherwise silent. The
tests are written to fail for the stated reason rather than for any reason —
where a rule rejects something, there is a matching case proving the neighbouring
valid input is accepted.
"""

from __future__ import annotations

import math
from datetime import date

import numpy as np
import pytest

from cognivance_core.abstraction.record import (
    Modality,
    Provenance,
    QualityReport,
    RecordValidationError,
    UnifiedNeuralRecord,
)


def make_record(**overrides: object) -> UnifiedNeuralRecord:
    fields: dict[str, object] = {
        "subject_id": "sub-0042",
        "session_id": "ses-01",
        "timepoint": date(2026, 9, 24),
        "modality": Modality.FMRI,
        "features": {"fmri_mean_fd_mm": 0.18},
    }
    fields.update(overrides)
    return UnifiedNeuralRecord(**fields)  # type: ignore[arg-type]


# -- the happy path -----------------------------------------------------------


def test_a_well_formed_record_validates() -> None:
    make_record().validate()


def test_nan_is_an_accepted_feature_value() -> None:
    """Explicitly missing is legal; it is 0.0-as-missing that is not."""
    record = make_record(features={"fmri_alff_hippo_l": float("nan")})
    record.validate()
    assert math.isnan(record.features["fmri_alff_hippo_l"])


def test_arrays_and_quality_are_optional() -> None:
    record = make_record()
    assert record.arrays == {}
    assert record.quality is None
    assert record.provenance is None


def test_arrays_carry_numpy_payloads() -> None:
    matrix = np.eye(4, dtype=np.float64)
    record = make_record(arrays={"fmri_connectivity": matrix})
    record.validate()
    np.testing.assert_array_equal(record.arrays["fmri_connectivity"], matrix)


# -- subject_id ---------------------------------------------------------------


@pytest.mark.parametrize("subject_id", ["123456", "0000000", "987654321012"])
def test_mrn_like_subject_id_is_refused(subject_id: str) -> None:
    with pytest.raises(RecordValidationError, match="medical record number"):
        make_record(subject_id=subject_id).validate()


@pytest.mark.parametrize("subject_id", ["sub-123456", "12345", "ADNI-002-S-0413", "s123456"])
def test_pseudonymous_subject_ids_are_accepted(subject_id: str) -> None:
    """Five digits, or digits with any non-digit, are not the MRN shape."""
    make_record(subject_id=subject_id).validate()


def test_empty_subject_id_is_refused() -> None:
    with pytest.raises(RecordValidationError, match="must not be empty"):
        make_record(subject_id="").validate()


# -- feature values -----------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [1, 0, True, False, "0.5", None, np.float32(0.5)],
    ids=["int", "int-zero", "bool-true", "bool-false", "str", "none", "numpy-float32"],
)
def test_non_float_feature_values_are_refused(value: object) -> None:
    with pytest.raises(RecordValidationError, match="must be a float"):
        make_record(features={"fmri_x": value}).validate()


def test_numpy_float64_is_accepted() -> None:
    """The common case must not need a cast.

    `np.float64` genuinely subclasses Python `float`, and `np.mean` and friends
    return it, so requiring `float(...)` everywhere would be friction with no
    safety gain. `np.float32` is a different type and is refused above — the
    asymmetry is real, so it is pinned here rather than left to be discovered.
    """
    record = make_record(features={"fmri_mean_fd_mm": np.float64(0.18)})
    record.validate()
    assert isinstance(record.features["fmri_mean_fd_mm"], float)


@pytest.mark.parametrize("value", [float("inf"), float("-inf")])
def test_infinite_feature_values_are_refused(value: float) -> None:
    with pytest.raises(RecordValidationError, match="infinite"):
        make_record(features={"fmri_x": value}).validate()


def test_the_error_names_the_offending_key() -> None:
    with pytest.raises(RecordValidationError) as excinfo:
        make_record(features={"fmri_good": 1.0, "fmri_bad": 3}).validate()
    assert "fmri_bad" in str(excinfo.value)


# -- feature keys -------------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    ["FMRI_MeanFd", "fmri-mean-fd", "fmri mean fd", "_fmri_x", "1fmri_x", "fmri.x"],
)
def test_malformed_feature_keys_are_refused(key: str) -> None:
    with pytest.raises(RecordValidationError, match="must match"):
        make_record(features={key: 1.0}).validate()


def test_feature_key_must_carry_the_modality_prefix() -> None:
    with pytest.raises(RecordValidationError, match="must start with 'fmri_'"):
        make_record(features={"eeg_theta_alpha_ratio": 1.0}).validate()


@pytest.mark.parametrize(
    ("modality", "key"),
    [
        (Modality.MRI, "mri_hippo_vol_norm"),
        (Modality.FMRI, "fmri_conn_dmn_dan"),
        (Modality.PET, "pet_suvr_precuneus"),
        (Modality.EEG, "eeg_theta_alpha_ratio"),
        (Modality.CLINICAL, "clinical_mmse"),
        (Modality.LIVE, "live_rms_uv"),
    ],
)
def test_every_modality_accepts_its_own_prefix(modality: Modality, key: str) -> None:
    make_record(modality=modality, features={key: 1.0}).validate()


def test_empty_features_is_allowed() -> None:
    """A record can legitimately carry only arrays — a mask, a raw volume."""
    make_record(features={}).validate()


# -- Modality -----------------------------------------------------------------


def test_modality_is_a_string_enum() -> None:
    assert Modality.FMRI == "fmri"
    assert Modality("eeg") is Modality.EEG


# -- QualityReport ------------------------------------------------------------


def test_quality_report_defaults_to_no_flags() -> None:
    report = QualityReport(passed=True, metrics={"mean_fd": 0.12})
    assert report.flags == ()


def test_quality_report_carries_a_decision_not_just_numbers() -> None:
    report = QualityReport(
        passed=False, metrics={"mean_fd": 0.9}, flags=("high_motion",)
    )
    assert report.passed is False
    assert "high_motion" in report.flags


# -- Provenance ---------------------------------------------------------------


def test_same_run_as_ignores_created_at() -> None:
    base = {
        "git_sha": "abc123",
        "config_hash": "def456",
        "library_versions": {"numpy": "1.26.0"},
        "seed": 0,
    }
    first = Provenance(**base, created_at="2026-09-24T10:00:00+00:00")  # type: ignore[arg-type]
    second = Provenance(**base, created_at="2026-09-24T11:30:00+00:00")  # type: ignore[arg-type]
    assert first.same_run_as(second)
    assert first != second  # they are genuinely different objects


def test_same_run_as_notices_a_different_seed() -> None:
    base = {
        "git_sha": "abc123",
        "config_hash": "def456",
        "library_versions": {"numpy": "1.26.0"},
        "created_at": "2026-09-24T10:00:00+00:00",
    }
    assert not Provenance(**base, seed=0).same_run_as(  # type: ignore[arg-type]
        Provenance(**base, seed=1)  # type: ignore[arg-type]
    )
