from __future__ import annotations

import re
from datetime import date

import nibabel as nib
import numpy as np
import pytest

from cognivance_core.imaging import load_bold, to_record
from cognivance_core.imaging._contracts_stub import UnifiedNeuralRecord


def _synthetic_bold_motionless() -> nib.Nifti1Image:
    data = np.zeros((6, 6, 4, 12), dtype=np.float32)
    center = data.shape[:3]
    for i in range(12):
        volume = np.zeros_like(data[..., 0], dtype=np.float32)
        x, y, z = np.indices(volume.shape)
        radius = ((x - center[0] / 2) ** 2 + (y - center[1] / 2) ** 2 + (z - center[2] / 2) ** 2)
        volume[radius <= 8.0] = 1.0 + 0.1 * i
        data[..., i] = volume
    img = nib.Nifti1Image(data, np.eye(4))
    img.header.set_data_dtype(np.float32)
    img.header["pixdim"][4] = 2.0
    return img


def _synthetic_bold_shifted() -> nib.Nifti1Image:
    base = _synthetic_bold_motionless()
    data = np.asarray(base.get_fdata(dtype=np.float32))
    shifted = np.roll(data, 1, axis=0)
    shifted[..., 0] = data[..., 0]
    img = nib.Nifti1Image(shifted, np.eye(4))
    img.header["pixdim"][4] = 2.0
    return img


def test_load_bold_parses_known_tr(tmp_path):
    img = _synthetic_bold_motionless()
    path = tmp_path / "bold.nii.gz"
    nib.save(img, path)
    loaded = load_bold(path)
    assert loaded.ndim == 4
    assert float(loaded.header.get_zooms()[-1]) == pytest.approx(2.0)


def test_load_bold_rejects_3d_file(tmp_path):
    img = nib.Nifti1Image(np.zeros((8, 8, 8), dtype=np.float32), np.eye(4))
    path = tmp_path / "bad.nii.gz"
    nib.save(img, path)
    with pytest.raises(ValueError, match="4D BOLD"):
        load_bold(path)


def test_estimate_motion_motionless_is_zero_and_shifted_is_nonzero():
    motionless = _synthetic_bold_motionless()
    motion = __import__("cognivance_core.imaging.fmri", fromlist=["estimate_motion"]).estimate_motion(motionless)
    assert np.allclose(motion.framewise_displacement, 0.0)

    shifted = _synthetic_bold_shifted()
    shifted_motion = __import__("cognivance_core.imaging.fmri", fromlist=["estimate_motion"]).estimate_motion(shifted)
    assert np.any(shifted_motion.framewise_displacement > 0.0)


def test_feature_names_are_valid_and_values_are_float():
    record = to_record(
        _synthetic_bold_motionless(),
        subject_id="S-001",
        session_id="sess-001",
        timepoint=date(2025, 1, 2),
    )
    for key, value in record.features.items():
        assert re.fullmatch(r"fmri_[a-z0-9_]*", key)
        assert isinstance(value, float)


@pytest.mark.slow
def test_slow_integration_fetch_and_run(tmp_path):
    try:
        from nilearn import datasets
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("nilearn is required for the slow integration test.") from exc

    data_dir = tmp_path / "nilearn_data"
    data_dir.mkdir(exist_ok=True)
    dataset = datasets.fetch_development_fmri(n_subjects=1, data_dir=str(data_dir))
    bold_path = dataset.func[0]
    record = to_record(
        load_bold(bold_path),
        subject_id="subject-0",
        session_id="session-0",
        timepoint=date.today(),
        atlas="schaefer_100",
    )
    assert isinstance(record, UnifiedNeuralRecord)
    matrix = record.arrays["connectivity_matrix"]
    assert matrix.shape[0] == matrix.shape[1]
    assert np.allclose(matrix, matrix.T, atol=1e-8)
    assert np.allclose(np.diag(matrix), np.ones(matrix.shape[0]), atol=1e-3)
    assert record.quality is not None
    assert isinstance(record.quality.passed, bool)


# Ensure the module remains importable without running the slow tests.
__all__ = [
    "test_load_bold_parses_known_tr",
    "test_load_bold_rejects_3d_file",
    "test_estimate_motion_motionless_is_zero_and_shifted_is_nonzero",
    "test_feature_names_are_valid_and_values_are_float",
    "test_slow_integration_fetch_and_run",
]
