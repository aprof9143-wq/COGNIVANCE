"""The layer lint must catch a planted violation, not merely run.

A lint that has never been shown to fail is indistinguishable from a lint that
does nothing. Each test here plants a specific violation in a temporary tree and
asserts the lint reports it, and each is paired with the neighbouring legal case
so a lint that simply rejects everything would not pass either.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from check_layers import check_tree, main  # noqa: E402


def build(root: Path, files: dict[str, str]) -> Path:
    """Write a miniature package tree and return its root."""
    package = root / "cognivance_core"
    for rel, body in files.items():
        path = package / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
    return package


# -- violations that must be caught -------------------------------------------


def test_module_level_nibabel_outside_imaging_is_caught(tmp_path: Path) -> None:
    root = build(tmp_path, {"eeg/leaky.py": "import nibabel\n"})
    violations = check_tree(root)
    assert len(violations) == 1
    assert violations[0].library == "nibabel"
    assert violations[0].line == 1


def test_module_level_mne_outside_eeg_is_caught(tmp_path: Path) -> None:
    root = build(tmp_path, {"imaging/leaky.py": "import mne\n"})
    assert [v.library for v in check_tree(root)] == ["mne"]


def test_from_import_is_caught(tmp_path: Path) -> None:
    root = build(tmp_path, {"sources/leaky.py": "from nilearn import datasets\n"})
    assert [v.library for v in check_tree(root)] == ["nilearn"]


def test_lazy_import_under_fusion_is_caught(tmp_path: Path) -> None:
    """Fusion reads records only — a lazy import there is still the wrong layer."""
    root = build(
        tmp_path,
        {"fusion/leaky.py": "def load():\n    import mne\n    return mne\n"},
    )
    violations = check_tree(root)
    assert len(violations) == 1
    assert "at any scope" in violations[0].reason


def test_module_level_import_under_fusion_is_caught(tmp_path: Path) -> None:
    root = build(tmp_path, {"fusion/leaky.py": "import nibabel\n"})
    assert len(check_tree(root)) == 1


def test_every_violation_is_reported_not_just_the_first(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {
            "eeg/a.py": "import nibabel\n",
            "imaging/b.py": "import mne\n",
            "fusion/c.py": "import nilearn\n",
        },
    )
    assert len(check_tree(root)) == 3


def test_a_syntax_error_fails_rather_than_passing_silently(tmp_path: Path) -> None:
    root = build(tmp_path, {"imaging/broken.py": "def f(\n"})
    violations = check_tree(root)
    assert len(violations) == 1
    assert "could not parse" in violations[0].reason


# -- legal code that must NOT be flagged --------------------------------------


def test_owning_package_may_import_at_module_level(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {
            "imaging/fmri.py": "import nibabel\nimport nilearn\nimport SimpleITK\n",
            "eeg/io.py": "import mne\n",
        },
    )
    assert check_tree(root) == []


def test_lazy_import_outside_fusion_is_allowed(tmp_path: Path) -> None:
    """This is the pattern fixtures.py uses to keep [imaging] optional."""
    root = build(
        tmp_path,
        {"testing/fixtures.py": "def make():\n    import nibabel\n    return nibabel\n"},
    )
    assert check_tree(root) == []


def test_unguarded_libraries_are_ignored(tmp_path: Path) -> None:
    root = build(tmp_path, {"fusion/ok.py": "import numpy\nimport pandas\n"})
    assert check_tree(root) == []


def test_relative_imports_are_ignored(tmp_path: Path) -> None:
    root = build(tmp_path, {"fusion/ok.py": "from ..abstraction import record\n"})
    assert check_tree(root) == []


# -- the real tree and the CLI -------------------------------------------------


def test_the_actual_package_is_clean() -> None:
    """The tree we ship must pass its own lint."""
    package = Path(__file__).resolve().parents[2] / "cognivance_core"
    violations = check_tree(package)
    assert violations == [], "\n".join(v.render(package) for v in violations)


def test_cli_exit_codes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    clean = build(tmp_path / "clean", {"imaging/ok.py": "import nibabel\n"})
    assert main(["check_layers.py", str(clean)]) == 0

    dirty = build(tmp_path / "dirty", {"eeg/bad.py": "import nibabel\n"})
    assert main(["check_layers.py", str(dirty)]) == 1
    assert "nibabel" in capsys.readouterr().err


def test_cli_reports_a_missing_directory(tmp_path: Path) -> None:
    assert main(["check_layers.py", str(tmp_path / "nope")]) == 2
