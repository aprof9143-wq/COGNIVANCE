"""Scaffold smoke tests.

These guard the two structural promises the scaffold makes, so they are worth
running from the first commit rather than being placeholders: every package
imports, and importing the top-level package does not drag a modality library
in with it. The second one is what keeps `[imaging]` and `[eeg]` genuinely
optional — if it ever fails, someone has added a module-level `import nibabel`
or `import mne` somewhere it does not belong.

The file-scanning layer lint (which package may import what) is a separate,
stricter check and lives in core/scripts/.
"""

from __future__ import annotations

import importlib
import subprocess
import sys

import pytest

SUBPACKAGES = [
    "cognivance_core.abstraction",
    "cognivance_core.sources",
    "cognivance_core.imaging",
    "cognivance_core.eeg",
    "cognivance_core.fusion",
    "cognivance_core.testing",
]

# Libraries that must stay behind their optional extra.
MODALITY_LIBRARIES = ["nibabel", "nilearn", "SimpleITK", "mne"]


def test_package_imports_and_is_versioned() -> None:
    import cognivance_core

    assert isinstance(cognivance_core.__version__, str)
    assert cognivance_core.__version__.count(".") >= 2, "expected a semver-ish version"


@pytest.mark.parametrize("name", SUBPACKAGES)
def test_subpackage_imports(name: str) -> None:
    module = importlib.import_module(name)
    assert module.__doc__, f"{name} should document what it is and who owns it"


@pytest.mark.parametrize("library", MODALITY_LIBRARIES)
def test_top_level_import_does_not_pull_in_modality_library(library: str) -> None:
    """`import cognivance_core` must not import nibabel, nilearn or mne.

    Run in a clean interpreter: this test process may already have imported one
    of them for unrelated reasons, so checking our own sys.modules would pass
    vacuously or fail spuriously.
    """
    probe = (
        "import sys; import cognivance_core; "
        f"sys.exit(1 if {library!r} in sys.modules else 0)"
    )
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True)
    assert result.returncode == 0, (
        f"importing cognivance_core pulled in {library!r}. "
        "Move that import inside the function that needs it, so the optional "
        f"extra stays optional.\n{result.stderr}"
    )
