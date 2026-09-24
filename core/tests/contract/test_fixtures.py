"""Fixtures must be deterministic and carry the structure they claim."""

from __future__ import annotations

import numpy as np
import pytest

from cognivance_core.testing.fixtures import (
    DEFAULT_EEG_CHANNELS,
    synthetic_eeg_raw,
)


def test_eeg_fixture_shape_and_dtype() -> None:
    data, names = synthetic_eeg_raw(n_channels=19, sfreq=256.0, seconds=4.0)
    assert data.shape == (19, 1024)
    assert data.dtype == np.float32
    assert names[:3] == list(DEFAULT_EEG_CHANNELS[:3])


def test_eeg_fixture_is_deterministic() -> None:
    a, _ = synthetic_eeg_raw(seconds=2.0, seed=11)
    b, _ = synthetic_eeg_raw(seconds=2.0, seed=11)
    np.testing.assert_array_equal(a, b)


def test_eeg_fixture_seeds_differ() -> None:
    a, _ = synthetic_eeg_raw(seconds=2.0, seed=1)
    b, _ = synthetic_eeg_raw(seconds=2.0, seed=2)
    assert not np.array_equal(a, b)


def test_alpha_is_planted_occipitally_and_absent_frontally() -> None:
    """The spatial claim in the docstring has to be true, or EEG tests built on
    it will assert the wrong thing."""
    fs, seconds = 256.0, 8.0
    data, names = synthetic_eeg_raw(sfreq=fs, seconds=seconds, seed=4, alpha_uv=30.0)

    spectrum = np.abs(np.fft.rfft(data.astype(np.float64), axis=1))
    freqs = np.fft.rfftfreq(data.shape[1], d=1.0 / fs)
    alpha_bin = int(np.argmin(np.abs(freqs - 10.0)))

    occipital = [i for i, n in enumerate(names) if n.startswith("O")]
    frontal = [i for i, n in enumerate(names) if n.startswith("Fp")]
    assert occipital and frontal, "the default montage should carry both"

    planted = np.mean([spectrum[i][alpha_bin] for i in occipital])
    elsewhere = np.mean([spectrum[i][alpha_bin] for i in frontal])
    assert planted > 5 * elsewhere


def test_extra_channels_get_generated_names() -> None:
    _, names = synthetic_eeg_raw(n_channels=22, seconds=1.0)
    assert len(names) == 22
    assert names[-1].startswith("EXT")


def test_eeg_fixture_does_not_import_mne() -> None:
    """mne belongs to eeg/ only; the fixture returns a plain array on purpose."""
    import subprocess
    import sys

    probe = (
        "import sys;"
        "from cognivance_core.testing.fixtures import synthetic_eeg_raw;"
        "synthetic_eeg_raw(n_channels=2, seconds=0.5);"
        "sys.exit(1 if 'mne' in sys.modules else 0)"
    )
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


nibabel = pytest.importorskip("nibabel", reason="synthetic_bold needs the [imaging] extra")


def test_bold_fixture_header_and_shape() -> None:
    from cognivance_core.testing.fixtures import synthetic_bold

    image = synthetic_bold(shape=(16, 16, 8, 30), tr=2.5, seed=0)
    assert image.shape == (16, 16, 8, 30)
    assert image.header["pixdim"][4] == pytest.approx(2.5)


def test_bold_fixture_is_deterministic() -> None:
    from cognivance_core.testing.fixtures import synthetic_bold

    a = synthetic_bold(shape=(8, 8, 4, 10), seed=3)
    b = synthetic_bold(shape=(8, 8, 4, 10), seed=3)
    np.testing.assert_array_equal(a.get_fdata(), b.get_fdata())


def test_bold_fixture_rejects_a_3d_shape() -> None:
    from cognivance_core.testing.fixtures import synthetic_bold

    with pytest.raises(ValueError, match="4D"):
        synthetic_bold(shape=(8, 8, 4))  # type: ignore[arg-type]
