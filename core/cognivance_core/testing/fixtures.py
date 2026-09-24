"""Deterministic fixtures, so nobody waits on a data use agreement.

The ADNI DUA is weeks out. Everything in the imaging and EEG pipelines can be
built and tested today against these: they are seeded, byte-reproducible, and
carry structure that is deliberately known — a planted rhythm, an injected
activation — so a test can assert that a feature found what was put there rather
than merely that it ran without raising.

These are fixtures, not simulations. They make no claim to be physiologically
faithful and must never stand in for real data in a benchmark figure.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:  # pragma: no cover - typing only
    import nibabel as nib

__all__ = ["DEFAULT_EEG_CHANNELS", "synthetic_bold", "synthetic_eeg_raw"]

#: Standard 10-20 names, so a fixture can be handed straight to montage code.
DEFAULT_EEG_CHANNELS: tuple[str, ...] = (
    "Fp1", "Fp2", "F7", "F3", "Fz", "F4", "F8",
    "T3", "C3", "Cz", "C4", "T4",
    "T5", "P3", "Pz", "P4", "T6",
    "O1", "O2",
)


def synthetic_bold(
    shape: tuple[int, int, int, int] = (64, 64, 36, 120),
    tr: float = 2.0,
    seed: int = 0,
    activation_amplitude: float = 4.0,
) -> nib.Nifti1Image:
    """A 4D BOLD image with a plausible header and one known activation.

    `nibabel` is imported inside the function on purpose: it lives in the
    `[imaging]` extra, and importing it at module scope would force that extra
    on anyone who only installed `[eeg]`.

    A slow block-design signal is injected into a cube near the centre, so a
    connectivity or activation test has a region that genuinely differs from
    background rather than being pure noise throughout.
    """
    import nibabel as nib  # noqa: PLC0415 - lazy: keeps the [imaging] extra optional

    if len(shape) != 4:
        raise ValueError(f"shape must be 4D (x, y, z, t): {shape}")
    if tr <= 0:
        raise ValueError(f"tr must be positive: {tr}")

    nx, ny, nz, nt = shape
    rng = np.random.default_rng(seed)

    # Baseline around a typical BOLD intensity, with mild spatial structure so a
    # brain mask has something to separate from background.
    data = rng.normal(loc=1000.0, scale=25.0, size=shape).astype(np.float32)
    centre_mask = np.zeros((nx, ny, nz), dtype=bool)
    centre_mask[
        nx // 4 : 3 * nx // 4, ny // 4 : 3 * ny // 4, nz // 4 : 3 * nz // 4
    ] = True
    data[~centre_mask] *= 0.15  # background is near-empty, as in a real acquisition

    # Block design: 20-volume on/off, injected into a small cube.
    t = np.arange(nt, dtype=np.float64)
    block = ((t // 20) % 2).astype(np.float64)
    percent = activation_amplitude / 100.0
    roi = (
        slice(nx // 2 - 4, nx // 2 + 4),
        slice(ny // 2 - 4, ny // 2 + 4),
        slice(nz // 2 - 2, nz // 2 + 2),
    )
    data[roi] *= (1.0 + percent * block).astype(np.float32)

    affine = np.diag([3.0, 3.0, 3.5, 1.0])  # 3mm in-plane, 3.5mm slices
    # nibabel ships no stubs for these constructors; the calls are checked by tests.
    image: nib.Nifti1Image = nib.Nifti1Image(data, affine)  # type: ignore[no-untyped-call]
    image.header.set_xyzt_units("mm", "sec")  # type: ignore[no-untyped-call]
    image.header["pixdim"][4] = tr
    return image


def synthetic_eeg_raw(
    n_channels: int = 19,
    sfreq: float = 256.0,
    seconds: float = 60.0,
    seed: int = 0,
    alpha_uv: float = 20.0,
) -> tuple[np.ndarray, list[str]]:
    """Pink-noise EEG with a planted occipital alpha rhythm.

    Returns `(data, channel_names)` where data is `(n_channels, n_samples)`
    float32 in microvolts — a plain array, not an `mne.io.Raw`. `mne` may only be
    imported under `cognivance_core/eeg/`, so the EEG module wraps this in a
    `RawArray` itself.

    The 10 Hz rhythm is placed only on the occipital channels present in the
    default montage, so a test can assert both that alpha is found where it was
    planted and that it is absent where it was not.
    """
    from cognivance_core.sources.simulated import Band, SimulatedSource

    names = list(DEFAULT_EEG_CHANNELS[:n_channels])
    if n_channels > len(DEFAULT_EEG_CHANNELS):
        names += [f"EXT{i}" for i in range(len(DEFAULT_EEG_CHANNELS), n_channels)]

    occipital = tuple(i for i, name in enumerate(names) if name.startswith("O"))
    bands = (Band(freq_hz=10.0, amplitude_uv=alpha_uv, channels=occipital or None),)

    source = SimulatedSource(
        n_channels=n_channels,
        sampling_rate_hz=sfreq,
        duration_s=seconds,
        bands=bands,
        seed=seed,
        source_id="synthetic_eeg_raw",
        channel_names=tuple(names),
    )
    source.connect()
    try:
        data = source.read_chunk(int(round(seconds * sfreq)))
    finally:
        source.close()
    return data, names


def describe(fixture: Any) -> str:
    """One-line description, handy in test failure messages."""
    if isinstance(fixture, tuple) and len(fixture) == 2:
        data, names = fixture
        return f"EEG {data.shape} over {len(names)} channels"
    return f"{type(fixture).__name__} {getattr(fixture, 'shape', '')}"
