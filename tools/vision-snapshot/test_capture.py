"""Offline tests for capture.py. No network: every response is synthetic.

Run: python -m unittest discover -s tools/vision-snapshot -p "test_*.py"
"""

from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import capture  # noqa: E402
import policy  # noqa: E402

REGISTRY = json.loads((capture.CONFIG / "genes.json").read_text())
LICENCES = json.loads((capture.CONFIG / "licences.json").read_text())


def gene(symbol: str) -> dict:
    return next(g for g in REGISTRY["genes"] if g["symbol"] == symbol)


def responses(symbol: str, **override: object) -> dict[str, object]:
    """Synthetic responses for a registered gene, keyed by a URL fragment."""
    g = gene(symbol)
    acc = g["uniprotAccession"]
    base: dict[str, object] = {
        "rest.genenames.org/fetch/symbol/": {
            "response": {
                "numFound": 1,
                "docs": [
                    {
                        "symbol": symbol,
                        "hgnc_id": g["hgncId"],
                        "status": "Approved",
                        "ensembl_gene_id": g["ensemblGeneId"],
                        "uniprot_ids": [acc],
                    }
                ],
            }
        },
        "/lookup/symbol/": {
            "id": g["ensemblGeneId"],
            "display_name": symbol,
            "description": f"synthetic [Source:HGNC Symbol;Acc:{g['hgncId']}]",
            "assembly_name": "GRCh38",
            "seq_region_name": "1",
            "start": 100,
            "end": 200,
            "strand": -1,
            "canonical_transcript": "ENST00000000001.1",
        },
        "/info/data": {"releases": [116]},
        "/sequence/id/": {"id": "ENST00000000001", "seq": "ATGAAATGA"},
        "/sequence/region/": {"id": "chromosome:GRCh38:1:100:200:-1", "seq": "ACGT"},
        "rest.uniprot.org/uniprotkb/search": {"results": [{"primaryAccession": acc}]},
        "/api/prediction/": [{"entryId": f"AF-{acc}-F1", "pdbUrl": f"https://alphafold.ebi.ac.uk/files/AF-{acc}-F1-model_v6.pdb"}],
        "/files/AF-": b"ATOM      1  CA  MET A   1       0.000   0.000   0.000  1.00 90.00           C\n",
        "esearch.fcgi": {"esearchresult": {"idlist": ["11", "12"]}},
        "esummary.fcgi": {"result": {"uids": ["11", "12"]}},
    }
    base.update(override)
    return base


def fake_fetch(table: dict[str, object], log: list[str] | None = None):
    def fetch(url: str, accept: str) -> tuple[int, dict[str, str], bytes]:
        if log is not None:
            log.append(url)
        for key, value in table.items():
            if key in url:
                if isinstance(value, Exception):
                    raise value
                if isinstance(value, tuple):
                    return value  # (status, headers, body)
                body = value if isinstance(value, bytes) else json.dumps(value).encode()
                return 200, {"Content-Type": "application/json"}, body
        raise AssertionError(f"unexpected request {url}")

    return fetch


class CaptureTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.out = pathlib.Path(self.tmp.name) / "snapshot"
        self.out.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_capture(self, symbol: str, table: dict | None = None, **kw: object) -> tuple[int, dict | None, str]:
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            code, manifest = capture.capture_gene(
                symbol,
                registry=kw.pop("registry", REGISTRY),
                licences=kw.pop("licences", LICENCES),
                out_root=self.out,
                fetch=fake_fetch(table if table is not None else responses(symbol)),
                pause=0,
                **kw,
            )
        return code, manifest, err.getvalue()

    def stored(self, symbol: str) -> tuple[dict, pathlib.Path]:
        d = self.out / symbol.lower()
        return json.loads((d / "manifest.json").read_text()), d

    # ---------------------------------------------------------------- happy paths

    def test_rpe65_still_works(self) -> None:
        code, _, _ = self.run_capture("RPE65")
        self.assertEqual(code, 0)
        m, d = self.stored("RPE65")
        self.assertEqual((m["gene"], m["hgncId"], m["ensemblGeneId"]), ("RPE65", "HGNC:10294", "ENSG00000116745"))
        self.assertEqual(m["schemaVersion"], 3)
        self.assertEqual(m["assembly"], "GRCh38")
        self.assertTrue(m["complete"])
        # Every permitted source succeeded; ClinVar is withheld by the source policy.
        status = {s["step"]: s["status"] for s in m["sources"]}
        self.assertEqual(status.pop("clinvar"), "withheld")
        self.assertTrue(all(v == "ok" for v in status.values()), status)
        self.assertTrue(all(c["result"] == "agree" for c in m["identifierChecks"]))
        names = {f["file"] for f in m["files"]}
        self.assertTrue({"hgnc_symbol.json", "ensembl_lookup.json", "uniprot_search.json", "alphafold_model.pdb.gz"} <= names)
        self.assertEqual(names | {"manifest.json", "SHA256SUMS"}, {p.name for p in d.iterdir()})

    def test_a_second_gene_uses_the_same_path(self) -> None:
        code, _, _ = self.run_capture("RHO")
        self.assertEqual(code, 0)
        m, _ = self.stored("RHO")
        self.assertEqual((m["gene"], m["hgncId"], m["uniprotAccession"]), ("RHO", "HGNC:10012", "P08100"))
        self.assertTrue(m["complete"])

    def test_each_gene_has_its_own_folder_and_manifest(self) -> None:
        self.assertEqual(self.run_capture("RPE65")[0], 0)
        self.assertEqual(self.run_capture("RHO")[0], 0)
        a, da = self.stored("RPE65")
        b, db = self.stored("RHO")
        self.assertNotEqual(da, db)
        self.assertEqual((a["gene"], b["gene"]), ("RPE65", "RHO"))
        # Re-capturing one gene leaves the other untouched.
        before = (db / "manifest.json").read_bytes()
        self.assertEqual(self.run_capture("RPE65")[0], 0)
        self.assertEqual((db / "manifest.json").read_bytes(), before)

    # ---------------------------------------------------------------- digests

    def test_digests_match_the_stored_files(self) -> None:
        self.run_capture("RPE65")
        m, d = self.stored("RPE65")
        for f in m["files"]:
            self.assertEqual(hashlib.sha256((d / f["file"]).read_bytes()).hexdigest(), f["storedSha256"])
        sums = dict(reversed(line.split("  ")) for line in (d / "SHA256SUMS").read_text().splitlines())
        self.assertEqual(sums, {f["file"]: f["storedSha256"] for f in m["files"]})

    def test_changing_an_artifact_changes_its_digest(self) -> None:
        self.run_capture("RPE65")
        first = {f["file"]: f["sha256"] for f in self.stored("RPE65")[0]["files"]}
        changed = responses("RPE65", **{"/sequence/region/": {"id": "chromosome:GRCh38:1:100:200:-1", "seq": "ACGA"}})
        self.run_capture("RPE65", changed)
        second = {f["file"]: f["sha256"] for f in self.stored("RPE65")[0]["files"]}
        self.assertNotEqual(first["ensembl_gene_region.json"], second["ensembl_gene_region.json"])
        self.assertEqual(first["ensembl_lookup.json"], second["ensembl_lookup.json"])

    def test_manifest_is_deterministic_in_layout(self) -> None:
        self.run_capture("RPE65")
        m, d = self.stored("RPE65")
        text = (d / "manifest.json").read_text()
        self.assertEqual(text, json.dumps(m, indent=2, sort_keys=True) + "\n")
        self.assertEqual([f["file"] for f in m["files"]], sorted(f["file"] for f in m["files"]))
        self.assertTrue(all(not f["file"].startswith("/") and ".." not in f["file"] for f in m["files"]))

    # ---------------------------------------------------------------- refusals

    def test_invalid_and_unknown_symbols_fail_clearly(self) -> None:
        for bad, why in [("rpe 65", "not a valid HGNC gene symbol"), ("", "not a valid"), ("NOTAGENE1", "not in the gene registry")]:
            code, manifest, err = self.run_capture(bad, {})
            self.assertEqual(code, 2, bad)
            self.assertIsNone(manifest)
            self.assertIn(why, err)
        self.assertEqual(list(self.out.iterdir()), [])

    def test_a_symbol_hgnc_does_not_approve_is_refused(self) -> None:
        table = responses("RHO", **{"rest.genenames.org/fetch/symbol/": {"response": {"numFound": 0, "docs": []}}})
        code, _, err = self.run_capture("RHO", table)
        self.assertEqual(code, 2)
        self.assertIn("HGNC has no approved symbol RHO", err)
        self.assertFalse((self.out / "rho").exists())

    def test_identifier_mismatch_stops_the_capture_and_writes_nothing(self) -> None:
        self.run_capture("RPE65")
        before = (self.out / "rpe65" / "manifest.json").read_bytes()
        lookup = dict(responses("RPE65")["/lookup/symbol/"])  # type: ignore[arg-type]
        lookup["id"] = "ENSG00000999999"
        code, _, err = self.run_capture("RPE65", responses("RPE65", **{"/lookup/symbol/": lookup}))
        self.assertEqual(code, 2)
        self.assertIn("Ensembl reports Ensembl gene ID ENSG00000999999", err)
        self.assertEqual((self.out / "rpe65" / "manifest.json").read_bytes(), before)

    def test_a_non_grch38_answer_is_refused(self) -> None:
        lookup = dict(responses("RPE65")["/lookup/symbol/"])  # type: ignore[arg-type]
        lookup["assembly_name"] = "GRCh37"
        code, _, err = self.run_capture("RPE65", responses("RPE65", **{"/lookup/symbol/": lookup}))
        self.assertEqual(code, 2)
        self.assertIn("GRCh38 only", err)

    def test_another_genes_folder_is_never_overwritten(self) -> None:
        d = self.out / "rho"
        d.mkdir()
        (d / "manifest.json").write_text(json.dumps({"gene": "RPE65", "hgncId": "HGNC:10294"}))
        code, _, err = self.run_capture("RHO")
        self.assertEqual(code, 2)
        self.assertIn("refusing to overwrite", err)
        self.assertEqual(json.loads((d / "manifest.json").read_text())["gene"], "RPE65")

    # ---------------------------------------------------------------- partial failures

    def test_partial_failure_is_recorded_and_replaces_nothing_by_default(self) -> None:
        self.run_capture("RPE65")
        before = (self.out / "rpe65" / "manifest.json").read_bytes()
        table = responses("RPE65", **{"/api/prediction/": (500, {}, b"")})
        code, manifest, err = self.run_capture("RPE65", table)
        self.assertEqual(code, 1)
        self.assertIn("capture incomplete", err)
        self.assertEqual((self.out / "rpe65" / "manifest.json").read_bytes(), before)
        assert manifest is not None
        status = {s["step"]: s for s in manifest["sources"]}
        self.assertEqual(status["alphafold_prediction"]["status"], "failed")
        self.assertIn("HTTP 500", status["alphafold_prediction"]["reason"])
        self.assertEqual(status["alphafold_model"]["status"], "skipped")

    def test_partial_failure_written_with_allow_partial_is_explicit(self) -> None:
        table = responses("RHO", **{"/sequence/region/": capture.SourceError("connection reset")})
        code, _, _ = self.run_capture("RHO", table, allow_partial=True)
        self.assertEqual(code, 0)
        m, _ = self.stored("RHO")
        self.assertFalse(m["complete"])
        status = {s["step"]: s for s in m["sources"]}
        self.assertEqual(status["ensembl_gene_region"]["status"], "failed")
        self.assertIn("connection reset", status["ensembl_gene_region"]["reason"])
        self.assertEqual(status["ensembl_lookup"]["status"], "ok")
        self.assertFalse(any(f["file"] == "ensembl_gene_region.json" for f in m["files"]))

    def test_an_unreachable_hgnc_is_recorded_and_other_checks_still_run(self) -> None:
        table = responses("RHO", **{"rest.genenames.org/fetch/symbol/": capture.SourceError("timed out")})
        code, manifest, _ = self.run_capture("RHO", table, allow_partial=True)
        self.assertEqual(code, 0)
        assert manifest is not None
        self.assertEqual(manifest["sources"][0]["status"], "failed")
        self.assertTrue(any(c["source"] == "Ensembl" and c["result"] == "agree" for c in manifest["identifierChecks"]))

    # ---------------------------------------------------------------- commercial pilot

    def test_commercial_pilot_mode_fetches_nothing_unapproved(self) -> None:
        log: list[str] = []
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            code, _ = capture.capture_gene(
                "RPE65", registry=REGISTRY, licences=LICENCES, out_root=self.out,
                fetch=fake_fetch(responses("RPE65"), log), mode="commercial-pilot", pause=0,
            )
        self.assertEqual(code, 3)
        self.assertEqual(log, [])
        self.assertIn("no source is allowed", err.getvalue())
        self.assertEqual(list(self.out.iterdir()), [])

    def test_commercial_pilot_mode_uses_only_approved_sources(self) -> None:
        lic = copy.deepcopy(LICENCES)
        for i in lic["items"]:
            if i["id"] == "ensembl-rest":
                i["commercialPilot"] = "approved"
        code, manifest, _ = self.run_capture("RPE65", licences=lic, mode="commercial-pilot", allow_partial=True)
        self.assertEqual(code, 0)
        assert manifest is not None
        for s in manifest["sources"]:
            self.assertEqual(s["status"], "ok" if s["licenceId"] == "ensembl-rest" else "withheld", s["step"])

    # ---------------------------------------------------------------- source policy

    def test_clinvar_is_never_requested_and_is_recorded_as_withheld(self) -> None:
        log: list[str] = []
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            code, manifest = capture.capture_gene(
                "RPE65", registry=REGISTRY, licences=LICENCES, out_root=self.out,
                fetch=fake_fetch(responses("RPE65"), log), pause=0,
            )
        self.assertEqual(code, 0)
        self.assertFalse(any("eutils.ncbi" in u for u in log), log)
        assert manifest is not None
        clinvar = next(s for s in manifest["sources"] if s["step"] == "clinvar")
        self.assertEqual(clinvar["status"], "withheld")
        self.assertEqual(clinvar["files"], [])
        self.assertIn("source policy", clinvar["reason"])
        m, d = self.stored("RPE65")
        self.assertFalse(any("clinvar" in f["file"] for f in m["files"]))
        self.assertFalse(any("clinvar" in p.name for p in d.iterdir()))

    def test_the_policy_fails_closed_for_missing_pending_and_unknown_entries(self) -> None:
        for change in ("drop-permissions", "store-pending", "drop-item"):
            lic = copy.deepcopy(LICENCES)
            if change == "drop-item":
                lic["items"] = [i for i in lic["items"] if i["id"] != "uniprot-rest"]
            for i in lic["items"]:
                if i["id"] == "uniprot-rest" and change == "drop-permissions":
                    del i["permissions"]
                if i["id"] == "uniprot-rest" and change == "store-pending":
                    i["permissions"]["research"]["store"] = "pending-review"
            log: list[str] = []
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                _, manifest = capture.capture_gene(
                    "RPE65", registry=REGISTRY, licences=lic, out_root=self.out,
                    fetch=fake_fetch(responses("RPE65"), log), pause=0, allow_partial=True,
                )
            assert manifest is not None
            status = {s["step"]: s["status"] for s in manifest["sources"]}
            self.assertEqual(status["uniprot_search"], "withheld", change)
            self.assertFalse(any("rest.uniprot.org" in u for u in log), change)

    def test_policy_decisions_match_the_inventory(self) -> None:
        self.assertEqual(policy.permitted(LICENCES, "ensembl-rest", "fetch"), (True, ""))
        self.assertTrue(policy.permitted(LICENCES, "ensembl-rest", "display")[0])
        for action in policy.ACTIONS:
            ok, reason = policy.permitted(LICENCES, "clinvar-eutils", action)
            self.assertFalse(ok, action)
            self.assertIn("disclaimer", reason)
        # Redistribution is not permitted for any source yet.
        for i in LICENCES["items"]:
            self.assertFalse(policy.permitted(LICENCES, i["id"], "redistribute")[0], i["id"])
        # No source is approved for commercial-pilot use; libraries carry no data permissions.
        for i in LICENCES["items"]:
            self.assertFalse(policy.permitted(LICENCES, i["id"], "fetch", "commercial-pilot")[0], i["id"])
        self.assertFalse(policy.permitted(LICENCES, "zod", "fetch")[0])
        self.assertFalse(policy.permitted(LICENCES, "no-such-source", "fetch")[0])
        self.assertFalse(policy.permitted(LICENCES, "ensembl-rest", "fetch", "clinical")[0])
        self.assertFalse(policy.permitted(LICENCES, "ensembl-rest", "train")[0])

    # ---------------------------------------------------------------- CLI

    def test_cli_requires_a_gene(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            capture.main([])


if __name__ == "__main__":
    unittest.main()
