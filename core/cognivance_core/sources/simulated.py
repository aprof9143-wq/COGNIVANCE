"""A signal source with known ground truth.

Its job is not to look realistic — it is to let feature code be *proved* correct.
Band-power code that finds a 10 Hz peak in a recording might be right, or might
be reporting an artefact of its own windowing. Band-power code that finds a 10 Hz
peak which was deliberately planted there, at a known amplitude, and finds
nothing at 10 Hz when the peak is removed, is right.

The noise floor is pink (1/f) because real EEG is, and a feature that only works
against white noise will mislead the first time it meets a recording.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from cognivance_core.abstraction.source import (
    Capability,
    NeuralDataSource,
    SourceHealth,
    SourceMetadata,
    SourceStateError,
)

__all__ = ["Band", "SimulatedSource"]


@dataclass(frozen=True)
class Band:
    """A sinusoid planted in the signal at a known frequency and amplitude.

    `channels` restricts it to a subset, so a test can assert a rhythm is
    present occipitally and absent frontally — the spatial pattern matters as
    much as the spectral one for the Alzheimer's markers this feeds.
    """

    freq_hz: float
    amplitude_uv: float
    channels: tuple[int, ...] | None = None  # None means every channel


class SimulatedSource(NeuralDataSource):
    """Deterministic pink noise plus planted rhythms.

    Seeded: the same seed and configuration produce byte-identical output, which
    is what makes it usable as a fixture rather than merely as a demo.
    """

    def __init__(
        self,
        *,
        n_channels: int = 19,
        sampling_rate_hz: float = 256.0,
        duration_s: float = 60.0,
        bands: tuple[Band, ...] = (),
        noise_uv: float = 10.0,
        seed: int = 0,
        source_id: str = "simulated",
        channel_names: tuple[str, ...] | None = None,
    ) -> None:
        if n_channels < 1:
            raise ValueError(f"n_channels must be at least 1: {n_channels}")
        if sampling_rate_hz <= 0:
            raise ValueError(f"sampling_rate_hz must be positive: {sampling_rate_hz}")
        if duration_s < 0:
            raise ValueError(f"duration_s must not be negative: {duration_s}")
        if channel_names is not None and len(channel_names) != n_channels:
            raise ValueError(
                f"channel_names has {len(channel_names)} entries but n_channels is {n_channels}"
            )

        self._n_channels = n_channels
        self._sampling_rate_hz = sampling_rate_hz
        self._n_total = int(round(duration_s * sampling_rate_hz))
        self._bands = bands
        self._noise_uv = noise_uv
        self._seed = seed
        self._source_id = source_id
        self._channel_names = channel_names or tuple(f"sim{i:02d}" for i in range(n_channels))

        self._signal: np.ndarray | None = None
        self._cursor = 0
        self._connected = False
        self._closed = False

    # -- lifecycle ----------------------------------------------------------

    def connect(self) -> bool:
        if self._closed:
            raise SourceStateError("cannot reconnect a closed SimulatedSource")
        if self._signal is None:
            self._signal = self._generate()
        self._connected = True
        return True

    def close(self) -> None:
        # Idempotent by contract: a caller unwinding through several `finally`
        # blocks must not have to track whether close already happened.
        self._closed = True
        self._connected = False
        self._signal = None

    # -- reading ------------------------------------------------------------

    def read_chunk(self, n_samples: int) -> np.ndarray:
        if self._closed:
            raise SourceStateError("read_chunk called on a closed SimulatedSource")
        if not self._connected or self._signal is None:
            raise SourceStateError("connect() must be called before read_chunk()")
        if n_samples < 0:
            raise ValueError(f"n_samples must not be negative: {n_samples}")

        end = min(self._cursor + n_samples, self._n_total)
        chunk = self._signal[:, self._cursor : end]
        self._cursor = end
        # Contract: a short read means exhausted, so the copy keeps callers from
        # mutating the backing buffer and silently changing a later re-read.
        return np.ascontiguousarray(chunk, dtype=np.float32)

    def seek(self, sample: int) -> None:
        """Rewind or skip. Present because this source advertises SEEKABLE."""
        if self._closed:
            raise SourceStateError("seek called on a closed SimulatedSource")
        if not 0 <= sample <= self._n_total:
            raise ValueError(f"sample must be within 0–{self._n_total}: {sample}")
        self._cursor = sample

    # -- description --------------------------------------------------------

    def get_sampling_rate(self) -> float:
        return self._sampling_rate_hz

    def get_metadata(self) -> SourceMetadata:
        return SourceMetadata(
            source_id=self._source_id,
            n_channels=self._n_channels,
            sampling_rate_hz=self._sampling_rate_hz,
            channel_names=self._channel_names,
            details={
                "kind": "simulated",
                "seed": str(self._seed),
                "duration_s": str(self._n_total / self._sampling_rate_hz),
                "planted_bands": ", ".join(
                    f"{b.freq_hz:g}Hz@{b.amplitude_uv:g}uV" for b in self._bands
                )
                or "none",
            },
        )

    def capabilities(self) -> set[Capability]:
        # Not LIVE: it returns instantly and never drops, so treating it as a
        # real-time source would make latency numbers meaningless.
        return {Capability.SEEKABLE}

    def health(self) -> SourceHealth:
        remaining = self._n_total - self._cursor
        fill = remaining / self._n_total if self._n_total else 0.0
        return SourceHealth(dropped_samples=0, latency_ms=0.0, buffer_fill=fill)

    # -- generation ---------------------------------------------------------

    def _generate(self) -> np.ndarray:
        rng = np.random.default_rng(self._seed)
        signal = self._pink_noise(rng) * self._noise_uv

        t = np.arange(self._n_total, dtype=np.float64) / self._sampling_rate_hz
        for band in self._bands:
            wave = band.amplitude_uv * np.sin(2.0 * np.pi * band.freq_hz * t)
            targets = (
                range(self._n_channels) if band.channels is None else band.channels
            )
            for ch in targets:
                if not 0 <= ch < self._n_channels:
                    raise ValueError(
                        f"band targets channel {ch}, outside 0–{self._n_channels - 1}"
                    )
                signal[ch] += wave
        return np.ascontiguousarray(signal, dtype=np.float32)

    def _pink_noise(self, rng: np.random.Generator) -> np.ndarray:
        """White noise shaped to 1/f, normalised to unit standard deviation.

        Built in the frequency domain: scale each component by 1/sqrt(f) and
        transform back. DC is zeroed — a constant offset is a recording artefact,
        not a rhythm, and leaving it in skews every relative-power figure.
        """
        if self._n_total == 0:
            return np.zeros((self._n_channels, 0), dtype=np.float64)

        white = rng.standard_normal((self._n_channels, self._n_total))
        spectrum = np.fft.rfft(white, axis=1)

        freqs = np.fft.rfftfreq(self._n_total, d=1.0 / self._sampling_rate_hz)
        scale = np.ones_like(freqs)
        scale[1:] = 1.0 / np.sqrt(freqs[1:])
        scale[0] = 0.0  # drop DC

        shaped: np.ndarray = np.asarray(
            np.fft.irfft(spectrum * scale, n=self._n_total, axis=1), dtype=np.float64
        )
        std = shaped.std(axis=1, keepdims=True)
        # A degenerate channel (all-constant) would divide by zero; leave it flat.
        std[std == 0] = 1.0
        normalised: np.ndarray = np.divide(shaped, std)
        return normalised
