"""Provenance capture — the basis of the reproducibility gate."""

from __future__ import annotations

from cognivance_core.abstraction.provenance import (
    capture,
    config_hash,
    git_sha,
    library_versions,
)


def test_two_captures_of_the_same_run_differ_only_in_time() -> None:
    config = {"pipeline": "fmri", "atlas": "schaefer_100", "fd_threshold": 0.5}
    first = capture(config, seed=42)
    second = capture(config, seed=42)
    assert first.same_run_as(second)


def test_a_different_seed_is_a_different_run() -> None:
    config = {"pipeline": "eeg"}
    assert not capture(config, seed=1).same_run_as(capture(config, seed=2))


def test_a_different_config_is_a_different_run() -> None:
    assert not capture({"atlas": "schaefer_100"}).same_run_as(capture({"atlas": "aal"}))


def test_config_hash_ignores_key_order() -> None:
    """Two runs configured identically but written differently are one run."""
    assert config_hash({"a": 1, "b": 2}) == config_hash({"b": 2, "a": 1})


def test_config_hash_notices_a_changed_value() -> None:
    assert config_hash({"fd": 0.5}) != config_hash({"fd": 0.4})


def test_config_hash_survives_values_json_cannot_encode() -> None:
    """A pipeline must not die mid-run because a config held an odd object."""
    from pathlib import Path

    assert len(config_hash({"path": Path("/tmp/x"), "n": 1})) == 64


def test_git_sha_is_a_sha_or_an_explicit_unknown() -> None:
    sha = git_sha()
    assert sha == "unknown" or (len(sha) == 40 and all(c in "0123456789abcdef" for c in sha))


def test_library_versions_records_what_is_installed() -> None:
    versions = library_versions()
    assert "numpy" in versions, "numpy is a hard dependency and must always be recorded"
    assert all(isinstance(v, str) and v for v in versions.values())


def test_capture_records_the_seed_verbatim() -> None:
    assert capture({}, seed=None).seed is None
    assert capture({}, seed=0).seed == 0
