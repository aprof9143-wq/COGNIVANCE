"""The suite every NeuralDataSource must pass.

Adding a new source is one entry in `SOURCES` — that is the whole point. If a
real MCU source cannot be added here without loosening a test, the abstraction
has failed and the source-switch metric is not real.

The contract under test, restated: a short read means exhausted and never "try
again"; shape and dtype are fixed; `close` is idempotent; reading after close
raises; health counters are never negative.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pytest

from cognivance_core.abstraction.source import (
    Capability,
    NeuralDataSource,
    SourceHealth,
    SourceStateError,
)
from cognivance_core.sources.simulated import Band, SimulatedSource

SourceFactory = Callable[[], NeuralDataSource]


def _simulated() -> NeuralDataSource:
    return SimulatedSource(
        n_channels=8,
        sampling_rate_hz=100.0,
        duration_s=2.0,  # 200 samples
        bands=(Band(freq_hz=10.0, amplitude_uv=25.0),),
        seed=7,
    )


#: One entry per source. EDFFileSource joins this list when Ruhma implements it.
SOURCES: list[pytest.param] = [
    pytest.param(_simulated, id="SimulatedSource"),
]

EXPECTED_TOTAL_SAMPLES = 200
EXPECTED_CHANNELS = 8


@pytest.fixture(params=SOURCES)
def source(request: pytest.FixtureRequest) -> NeuralDataSource:
    factory: SourceFactory = request.param
    src = factory()
    src.connect()
    yield src
    src.close()


def test_connect_reports_ready(source: NeuralDataSource) -> None:
    # Already connected by the fixture; connecting again must stay truthful.
    assert source.connect() is True


def test_metadata_is_consistent_with_sampling_rate(source: NeuralDataSource) -> None:
    meta = source.get_metadata()
    assert meta.n_channels == EXPECTED_CHANNELS
    assert meta.sampling_rate_hz == source.get_sampling_rate()
    assert len(meta.channel_names) == meta.n_channels


def test_read_chunk_shape_and_dtype(source: NeuralDataSource) -> None:
    chunk = source.read_chunk(32)
    assert chunk.shape == (EXPECTED_CHANNELS, 32)
    assert chunk.dtype == np.float32


def test_read_chunk_returns_full_count_until_exhaustion(source: NeuralDataSource) -> None:
    """A short read is the end-of-stream signal, so it may happen exactly once."""
    size = 64
    reads: list[int] = []
    while True:
        chunk = source.read_chunk(size)
        reads.append(chunk.shape[1])
        if chunk.shape[1] < size:
            break
        if len(reads) > 100:  # guard against a source that never exhausts
            pytest.fail("source did not exhaust within 100 reads")

    assert sum(reads) == EXPECTED_TOTAL_SAMPLES
    full, short = reads[:-1], reads[-1]
    assert all(n == size for n in full), f"a short read appeared mid-stream: {reads}"
    assert short < size


def test_reads_past_the_end_are_empty_not_errors(source: NeuralDataSource) -> None:
    source.read_chunk(EXPECTED_TOTAL_SAMPLES)
    tail = source.read_chunk(16)
    assert tail.shape == (EXPECTED_CHANNELS, 0)
    assert tail.dtype == np.float32


def test_close_is_idempotent(source: NeuralDataSource) -> None:
    source.close()
    source.close()  # must not raise


def test_read_after_close_raises(source: NeuralDataSource) -> None:
    source.close()
    with pytest.raises(SourceStateError):
        source.read_chunk(8)


def test_health_counters_are_never_negative(source: NeuralDataSource) -> None:
    for _ in range(4):
        source.read_chunk(32)
        health = source.health()
        assert isinstance(health, SourceHealth)
        assert health.dropped_samples >= 0
        assert health.latency_ms >= 0
        assert 0.0 <= health.buffer_fill <= 1.0


def test_capabilities_are_known_values(source: NeuralDataSource) -> None:
    for capability in source.capabilities():
        assert isinstance(capability, Capability)


# -- behaviour specific to SimulatedSource, not part of the shared contract ---


def test_simulated_source_is_deterministic() -> None:
    """Same seed, same bytes. This is what makes it usable as a fixture."""
    first = _simulated()
    second = _simulated()
    first.connect()
    second.connect()
    try:
        a = first.read_chunk(EXPECTED_TOTAL_SAMPLES)
        b = second.read_chunk(EXPECTED_TOTAL_SAMPLES)
    finally:
        first.close()
        second.close()
    np.testing.assert_array_equal(a, b)


def test_different_seeds_differ() -> None:
    a = SimulatedSource(n_channels=4, sampling_rate_hz=100.0, duration_s=1.0, seed=1)
    b = SimulatedSource(n_channels=4, sampling_rate_hz=100.0, duration_s=1.0, seed=2)
    a.connect()
    b.connect()
    try:
        assert not np.array_equal(a.read_chunk(100), b.read_chunk(100))
    finally:
        a.close()
        b.close()


def test_planted_rhythm_is_recoverable() -> None:
    """The fixture's whole purpose: a feature must find what was planted.

    Not a spectral-analysis test — it checks that the ground truth is really in
    the signal, so a failure in EEG feature code cannot be blamed on the fixture.
    """
    freq, fs, seconds = 10.0, 256.0, 8.0
    source = SimulatedSource(
        n_channels=2,
        sampling_rate_hz=fs,
        duration_s=seconds,
        bands=(Band(freq_hz=freq, amplitude_uv=40.0, channels=(0,)),),
        noise_uv=5.0,
        seed=3,
    )
    source.connect()
    try:
        data = source.read_chunk(int(fs * seconds))
    finally:
        source.close()

    spectrum = np.abs(np.fft.rfft(data.astype(np.float64), axis=1))
    freqs = np.fft.rfftfreq(data.shape[1], d=1.0 / fs)
    target = int(np.argmin(np.abs(freqs - freq)))

    planted, clean = spectrum[0], spectrum[1]
    assert planted[target] > 5 * clean[target], (
        "the 10 Hz peak planted on channel 0 is not clearly above channel 1, "
        "which had no band planted"
    )
    assert target == int(np.argmax(planted)), "10 Hz is not the dominant component"


def test_seek_rewinds() -> None:
    source = SimulatedSource(n_channels=2, sampling_rate_hz=50.0, duration_s=2.0, seed=5)
    source.connect()
    try:
        first = source.read_chunk(20)
        source.seek(0)
        again = source.read_chunk(20)
    finally:
        source.close()
    np.testing.assert_array_equal(first, again)


def test_read_before_connect_raises() -> None:
    source = SimulatedSource(n_channels=2, sampling_rate_hz=50.0, duration_s=1.0)
    with pytest.raises(SourceStateError):
        source.read_chunk(4)


def test_context_manager_closes() -> None:
    source = SimulatedSource(n_channels=2, sampling_rate_hz=50.0, duration_s=1.0)
    with source:
        assert source.read_chunk(4).shape == (2, 4)
    with pytest.raises(SourceStateError):
        source.read_chunk(4)


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"n_channels": 0}, "n_channels"),
        ({"sampling_rate_hz": 0.0}, "sampling_rate_hz"),
        ({"duration_s": -1.0}, "duration_s"),
        ({"channel_names": ("only_one",)}, "channel_names"),
    ],
)
def test_invalid_configuration_is_refused(kwargs: dict[str, object], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        SimulatedSource(**kwargs)  # type: ignore[arg-type]


def test_health_rejects_negative_counters() -> None:
    """The dataclass guards the invariant, so no source can report a negative."""
    with pytest.raises(ValueError, match="dropped_samples"):
        SourceHealth(dropped_samples=-1, latency_ms=0.0, buffer_fill=0.0)
    with pytest.raises(ValueError, match="latency_ms"):
        SourceHealth(dropped_samples=0, latency_ms=-0.5, buffer_fill=0.0)
    with pytest.raises(ValueError, match="buffer_fill"):
        SourceHealth(dropped_samples=0, latency_ms=0.0, buffer_fill=1.5)


# -- the unimplemented source ------------------------------------------------


def test_edf_source_raises_with_its_owner_named() -> None:
    """A stub that fails silently is worse than none; every method says who owns it."""
    from cognivance_core.sources.edf_file import EDFFileSource

    source = EDFFileSource("nowhere.edf")
    for call in (
        source.connect,
        source.get_sampling_rate,
        source.get_metadata,
        source.close,
        source.capabilities,
        source.health,
    ):
        with pytest.raises(NotImplementedError, match="Ruhma"):
            call()
    with pytest.raises(NotImplementedError, match="Ruhma"):
        source.read_chunk(1)
