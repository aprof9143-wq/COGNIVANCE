#!/usr/bin/env python3
"""Enforce the layer boundary: a modality library stays in its own package.

Why this exists: the platform's source-switch claim is that the same analysis
runs against a simulator, a real MCU and a future implant without rewriting
downstream code. That only holds if downstream code has no idea which modality
produced its input. The moment `fusion/` can `import mne`, EEG assumptions leak
into code the implant path will reuse, and "same analysis on simulated and real
signals" stops being provable.

A lint costs nothing today and is unaffordable to retrofit at month six.

Two kinds of violation, deliberately treated differently:

* A **module-level** import of a guarded library outside its owning package.
  This is the real leak — it makes the dependency mandatory for anyone importing
  that module, and it is what breaks the optional `[imaging]` / `[eeg]` extras.

* **Any** import of a guarded library under `fusion/`, module-level or inside a
  function. Fusion reads `UnifiedNeuralRecord` and nothing else; a lazy import
  there is still a modality assumption in the wrong layer.

Function-scope imports elsewhere are allowed on purpose. `testing/fixtures.py`
has to build a real `Nifti1Image`, and does it with a lazy import precisely so
the extra stays optional — that is the pattern working, not a hole in it.

Usage:
    python scripts/check_layers.py [package_root]

Exits non-zero and prints `file:line` for each violation.
"""

from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path

#: library -> the single package path fragment allowed to import it at module level.
OWNED_BY: dict[str, str] = {
    "nibabel": "imaging",
    "nilearn": "imaging",
    "SimpleITK": "imaging",
    "mne": "eeg",
}

#: Packages that may not touch a guarded library at all, at any scope.
NO_MODALITY_AT_ALL = ("fusion",)


@dataclass(frozen=True)
class Violation:
    path: Path
    line: int
    library: str
    reason: str

    def render(self, root: Path) -> str:
        try:
            shown = self.path.relative_to(root.parent)
        except ValueError:
            shown = self.path
        return f"{shown}:{self.line}: {self.library} — {self.reason}"


def _imported_libraries(node: ast.AST) -> list[tuple[str, int]]:
    """Top-level module name and line for an import node, if any."""
    found: list[tuple[str, int]] = []
    if isinstance(node, ast.Import):
        for alias in node.names:
            found.append((alias.name.split(".")[0], node.lineno))
    elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
        found.append((node.module.split(".")[0], node.lineno))
    return found


def _package_of(path: Path, root: Path) -> str:
    """The first package segment under the root — 'imaging', 'eeg', 'fusion'…"""
    try:
        parts = path.relative_to(root).parts
    except ValueError:
        return ""
    return parts[0] if len(parts) > 1 else ""


def check_file(path: Path, root: Path) -> list[Violation]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except SyntaxError as exc:  # a broken file is a failure, not a pass
        return [Violation(path, exc.lineno or 0, "<syntax>", f"could not parse: {exc.msg}")]

    package = _package_of(path, root)

    # Imports sitting directly in the module body are the mandatory ones.
    module_level: set[int] = set()
    for node in tree.body:
        for _, line in _imported_libraries(node):
            module_level.add(line)

    violations: list[Violation] = []
    for node in ast.walk(tree):
        for library, line in _imported_libraries(node):
            owner = OWNED_BY.get(library)
            if owner is None:
                continue

            if package in NO_MODALITY_AT_ALL:
                violations.append(
                    Violation(
                        path,
                        line,
                        library,
                        f"{package}/ must read UnifiedNeuralRecord only — no modality "
                        "library at any scope, lazy imports included",
                    )
                )
                continue

            if package != owner and line in module_level:
                violations.append(
                    Violation(
                        path,
                        line,
                        library,
                        f"module-level import outside {owner}/. Move it inside the "
                        f"function that needs it, or move the code into {owner}/",
                    )
                )
    return violations


def check_tree(root: Path) -> list[Violation]:
    violations: list[Violation] = []
    for path in sorted(root.rglob("*.py")):
        violations.extend(check_file(path, root))
    return violations


def main(argv: list[str]) -> int:
    default_root = Path(__file__).resolve().parent.parent / "cognivance_core"
    root = Path(argv[1]) if len(argv) > 1 else default_root
    root = root.resolve()
    if not root.is_dir():
        print(f"check_layers: not a directory: {root}", file=sys.stderr)
        return 2

    violations = check_tree(root)
    if not violations:
        print(f"check_layers: clean ({sum(1 for _ in root.rglob('*.py'))} files)")
        return 0

    print(f"check_layers: {len(violations)} violation(s)", file=sys.stderr)
    for violation in violations:
        print(f"  {violation.render(root)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
