"""One interface for every signal origin: simulator, file, MCU, future implant.

This is the hardware abstraction layer. Its value is measured, not asserted —
the source-switch metric is "how much code and config changes to move from the
simulator to a real MCU", and the target is zero code and one config line. That
is only achievable if every origin genuinely satisfies the same contract, which
is what `tests/contract/test_source_contract.py` exists to prove.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum

import numpy as np

__all__ = [
    "Capability",
    "NeuralDataSource",
    "SourceHealth",
    "SourceMetadata",
    "SourceStateError",
]


class SourceStateError(RuntimeError):
    """Raised when a source is used outside its lifecycle — reading after close."""


class Capability(StrEnum):
    """What a source can do, so callers adapt without type-checking it.

    A caller asking `Capability.SEEKABLE in source.capabilities()` stays correct
    when a new source type appears; a caller doing `isinstance(source,
    SimulatedSource)` does not.
    """

    #: Produces samples in real time; reads block until data is available.
    LIVE = "live"
    #: Supports rewinding and re-reading the same stream.
    SEEKABLE = "seekable"
    #: Holds more than one recording session behind one handle.
    MULTI_SESSION = "multi_session"


@dataclass(frozen=True)
class SourceMetadata:
    """What a source is, independent of what it currently holds."""

    source_id: str
    n_channels: int
    sampling_rate_hz: float
    channel_names: tuple[str, ...]
    #: Free-form origin detail — device model, file path, simulator config.
    details: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SourceHealth:
    """Live condition of a source. No counter here is ever negative.

    `dropped_samples` is cumulative across the session. A live source that never
    reports drops is either perfect or not counting; prefer the latter
    assumption when reviewing a new implementation.
    """

    dropped_samples: int
    latency_ms: float
    buffer_fill: float  # 0.0–1.0

    def __post_init__(self) -> None:
        if self.dropped_samples < 0:
            raise ValueError(f"dropped_samples must not be negative: {self.dropped_samples}")
        if self.latency_ms < 0:
            raise ValueError(f"latency_ms must not be negative: {self.latency_ms}")
        if not 0.0 <= self.buffer_fill <= 1.0:
            raise ValueError(f"buffer_fill must be within 0.0–1.0: {self.buffer_fill}")


class NeuralDataSource(ABC):
    """Every signal origin implements this — simulator, MCU, future implant."""

    @abstractmethod
    def connect(self) -> bool:
        """Open the source. Returns True once it is ready to read."""

    @abstractmethod
    def get_sampling_rate(self) -> float:
        """Samples per second per channel."""

    @abstractmethod
    def read_chunk(self, n_samples: int) -> np.ndarray:
        """Read up to `n_samples` per channel.

        Returns `(n_channels, n_samples)` float32 in microvolts. Returning fewer
        than `n_samples` means the stream is exhausted and nothing else will
        arrive — it never means "try again". A source with nothing left returns
        an empty `(n_channels, 0)` array rather than raising.
        """

    @abstractmethod
    def get_metadata(self) -> SourceMetadata:
        """Describe the source. Valid before `connect` and after `close`."""

    @abstractmethod
    def close(self) -> None:
        """Release the source. Idempotent: closing twice is not an error."""

    @abstractmethod
    def capabilities(self) -> set[Capability]:
        """What this source supports. Valid at any point in the lifecycle."""

    @abstractmethod
    def health(self) -> SourceHealth:
        """Current condition. Valid at any point in the lifecycle."""

    # -- convenience, not part of what an implementer must write ------------

    def __enter__(self) -> NeuralDataSource:
        self.connect()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
