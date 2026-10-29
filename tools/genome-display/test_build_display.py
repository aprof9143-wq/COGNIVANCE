"""Offline tests for build_display.py and the raw snapshot it reads. No network.

Run: python -m unittest discover -s tools/genome-display -p "test_*.py"
"""

from __future__ import annotations

import copy
import hashlib
import json
import pathlib
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import build_display as bd  # noqa: E402

LICENCES = json.loads((bd.CONFIG / "licences.json").read_text())
PUBLIC = bd.ROOT / "public"
GENES = sorted(p.name for p in bd.RAW_ROOT.iterdir() if p.is_dir())


class BuildDisplayTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.out = pathlib.Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_the_committed_display_copy_is_current_and_deterministic(self) -> None:
        for g in GENES:
            bd.build_gene(bd.RAW_ROOT / g, self.out / g, LICENCES)
            built = sorted(p.name for p in (self.out / g).iterdir())
            committed = sorted(p.name for p in (bd.OUT_ROOT / g).iterdir())
            self.assertEqual(built, committed, g)
            for name in built:
                self.assertEqual(
                    (self.out / g / name).read_bytes(),
                    (bd.OUT_ROOT / g / name).read_bytes(),
                    f"{g}/{name} is stale: run python tools/genome-display/build_display.py",
                )
            # Rebuilding gives the same bytes.
            again = self.out / "again"
            bd.build_gene(bd.RAW_ROOT / g, again, LICENCES)
            for name in built:
                self.assertEqual((again / name).read_bytes(), (self.out / g / name).read_bytes())

    def test_a_source_whose_display_is_refused_is_withheld_not_written(self) -> None:
        for value in ("pending-review", "denied", None):
            lic = copy.deepcopy(LICENCES)
            for i in lic["items"]:
                if i["id"] == "uniprot-rest":
                    if value is None:
                        del i["permissions"]
                    else:
                        i["permissions"]["research"]["display"] = value
            m = bd.build_gene(bd.RAW_ROOT / "rpe65", self.out / "x", lic)
            self.assertFalse((self.out / "x" / "uniprot_search.json").exists(), value)
            self.assertNotIn("uniprot-rest", {f["licenceId"] for f in m["files"]})
            self.assertIn("uniprot-rest", {w["licenceId"] for w in m["withheld"]})

    def test_clinvar_is_withheld_with_the_policy_reason(self) -> None:
        m = json.loads((bd.OUT_ROOT / "rpe65" / "manifest.json").read_text())
        self.assertEqual([w["licenceId"] for w in m["withheld"]], ["clinvar-eutils"])
        self.assertIn("disclaimer", m["withheld"][0]["reason"])
        self.assertFalse(any("clinvar" in f["file"] or "eutils" in f["url"] for f in m["files"]))

    def test_every_display_file_comes_from_a_source_whose_display_is_permitted(self) -> None:
        for g in GENES:
            m = json.loads((bd.OUT_ROOT / g / "manifest.json").read_text())
            for f in m["files"]:
                ok, why = bd.permitted(LICENCES, f["licenceId"], "display")
                self.assertTrue(ok, f"{g}/{f['file']}: {why}")
                data = (bd.OUT_ROOT / g / f["file"]).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), f["storedSha256"])

    def test_pruning_keeps_only_listed_fields(self) -> None:
        raw = {"a": 1, "b": {"c": 2, "d": 3}, "e": [{"f": 1, "g": 2}], "h": None, "x": "drop"}
        spec = {"a": 1, "b": {"c": 1}, "e": [{"f": 1}], "h": {"i": 1}, "missing": 1}
        self.assertEqual(bd.prune(raw, spec), {"a": 1, "b": {"c": 2}, "e": [{"f": 1}], "h": None})

    def test_a_raw_file_that_does_not_match_its_manifest_is_refused(self) -> None:
        src = self.out / "raw"
        shutil.copytree(bd.RAW_ROOT / "rpe65", src)
        (src / "ensembl_cds.json").write_text('{"id": "tampered", "seq": "ATG"}')
        with self.assertRaises(SystemExit):
            bd.build_gene(src, self.out / "x", LICENCES)


class RawSnapshotTest(unittest.TestCase):
    def test_every_manifest_file_is_present_with_its_digest_or_recorded_as_redacted(self) -> None:
        for g in GENES:
            d = bd.RAW_ROOT / g
            m = json.loads((d / "manifest.json").read_text())
            red_path = d / "REDACTIONS.json"
            redacted = {}
            if red_path.exists():
                for r in json.loads(red_path.read_text())["redactions"]:
                    for f in r["files"]:
                        redacted[f["file"]] = f
            for f in m["files"]:
                want = f.get("storedSha256", f["sha256"])
                if f["file"] in redacted:
                    self.assertFalse((d / f["file"]).exists(), f"{g}/{f['file']} is redacted but present")
                    self.assertEqual(redacted[f["file"]]["storedSha256"], want)
                else:
                    self.assertEqual(hashlib.sha256((d / f["file"]).read_bytes()).hexdigest(), want, f["file"])

    def test_no_stored_file_comes_from_a_source_whose_storage_is_refused(self) -> None:
        for g in GENES:
            d = bd.RAW_ROOT / g
            for p in d.iterdir():
                self.assertFalse(p.name.startswith("clinvar"), f"{g}/{p.name}")


class PublicTreeTest(unittest.TestCase):
    """Nothing the website serves may carry withheld or raw-only content."""

    def test_no_clinvar_file_or_request_url_is_served(self) -> None:
        for p in PUBLIC.rglob("*"):
            if not p.is_file():
                continue
            self.assertNotIn("clinvar", p.name.lower(), str(p))
            if p.suffix in (".json", ".txt", ".md", ".tsv", ".csv"):
                text = p.read_text(errors="ignore")
                self.assertNotIn("eutils.ncbi.nlm.nih.gov", text, str(p))
                self.assertNotIn("esummary", text, str(p))

    def test_raw_snapshots_are_not_served(self) -> None:
        self.assertFalse((PUBLIC / "vision" / "snapshot").exists())
        raw_digests = set()
        for g in GENES:
            for p in (bd.RAW_ROOT / g).iterdir():
                if p.name not in ("manifest.json", "SHA256SUMS", "REDACTIONS.json"):
                    raw_digests.add((p.name, hashlib.sha256(p.read_bytes()).hexdigest()))
        for p in PUBLIC.rglob("*"):
            if p.is_file():
                key = (p.name, hashlib.sha256(p.read_bytes()).hexdigest())
                # The AlphaFold model is the one file the display needs whole (the 3D view renders it).
                if key in raw_digests:
                    self.assertEqual(p.name, "alphafold_model.pdb.gz", str(p))


if __name__ == "__main__":
    unittest.main()
