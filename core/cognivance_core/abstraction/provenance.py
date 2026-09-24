"""Capture what a run was, so the run can be reproduced.

Reproducibility is one of the platform's published uniqueness metrics: the same
input and the same provenance record must reproduce byte-identical output on a
clean machine. That is only checkable if every run records the commit, the
configuration, the library versions and the seed at the moment it ran — which is
what `capture` does.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from cognivance_core.abstraction.record import Provenance

__all__ = ["TRACKED_LIBRARIES", "capture", "config_hash", "git_sha"]

#: Recorded when importable. `nibabel` and `mne` are optional extras, so a run
#: on an EEG-only install legitimately reports no nibabel version.
TRACKED_LIBRARIES = ("numpy", "pandas", "nibabel", "nilearn", "mne", "SimpleITK")

#: Stands in for the commit when the code is not running inside a git checkout
#: (an installed wheel, a container without .git). Better an explicit marker
#: than a plausible-looking wrong sha.
UNKNOWN_SHA = "unknown"


def git_sha(*, short: bool = False) -> str:
    """The current commit, or `UNKNOWN_SHA` outside a git checkout."""
    cmd = ["git", "rev-parse", "--short", "HEAD"] if short else ["git", "rev-parse", "HEAD"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return UNKNOWN_SHA
    if result.returncode != 0:
        return UNKNOWN_SHA
    return result.stdout.strip() or UNKNOWN_SHA


def config_hash(config: dict[str, Any]) -> str:
    """A stable sha256 over a config.

    Key order must not change the hash — two runs configured identically but
    written in a different order are the same run. `sort_keys` plus `default=str`
    gives that, and keeps the hash defined for values JSON cannot encode rather
    than raising in the middle of a pipeline.
    """
    encoded = json.dumps(config, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def library_versions() -> dict[str, str]:
    """Versions of the tracked libraries that are actually installed."""
    found: dict[str, str] = {}
    for name in TRACKED_LIBRARIES:
        try:
            found[name] = version(name)
        except PackageNotFoundError:
            continue
    return found


def capture(config: dict[str, Any], seed: int | None = None) -> Provenance:
    """Record everything needed to reproduce the run starting now.

    Two calls with the same config and seed at the same commit differ only in
    `created_at`; use `Provenance.same_run_as` to compare them.
    """
    return Provenance(
        git_sha=git_sha(),
        config_hash=config_hash(config),
        library_versions=library_versions(),
        seed=seed,
        created_at=datetime.now(UTC).isoformat(),
    )
