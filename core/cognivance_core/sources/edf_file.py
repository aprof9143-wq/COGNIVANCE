"""EDF / BrainVision file source — interface-complete, deliberately unimplemented.

Owner: Ruhma, as part of the EEG pipeline (`cognivance_core/eeg/io.py`).

It exists as a stub rather than as nothing so the contract suite has a second
entry to point at the moment it is real, and so the shape of the work is visible
to everyone. Reading EDF means `mne`, which may only be imported under
`cognivance_core/eeg/` — so the implementation belongs there, and this class will
delegate to it rather than importing mne here.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cognivance_core.abstraction.source import (
    Capability,
    NeuralDataSource,
    SourceHealth,
    SourceMetadata,
)

__all__ = ["EDFFileSource"]

_OWNER = (
    "EDFFileSource is owned by Ruhma and lands with the EEG pipeline. "
    "Until then, use SimulatedSource for deterministic fixtures."
)


class EDFFileSource(NeuralDataSource):
    """Not yet implemented. Every method raises with the owner named."""

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    def connect(self) -> bool:
        raise NotImplementedError(_OWNER)

    def get_sampling_rate(self) -> float:
        raise NotImplementedError(_OWNER)

    def read_chunk(self, n_samples: int) -> np.ndarray:
        raise NotImplementedError(_OWNER)

    def get_metadata(self) -> SourceMetadata:
        raise NotImplementedError(_OWNER)

    def close(self) -> None:
        raise NotImplementedError(_OWNER)

    def capabilities(self) -> set[Capability]:
        raise NotImplementedError(_OWNER)

    def health(self) -> SourceHealth:
        raise NotImplementedError(_OWNER)
