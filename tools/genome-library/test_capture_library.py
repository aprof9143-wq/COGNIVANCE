"""Offline tests for the library capture: parsers, source policy, failures and the display copy.

The fixtures are synthetic: made-up genes (SAMPLEA, SAMPLEB) and identifiers in
the shapes the sources are expected to return. No network access.
"""

from __future__ import annotations

import copy
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import capture_library as cl  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
CFG = json.loads((ROOT / "config/genome/library.json").read_text())
LICENCES = json.loads((ROOT / "config/genome/licences.json").read_text())

CLINGEN = (
    '"CLINGEN GENE DISEASE VALIDITY CURATIONS"\n'
    '"FILE CREATED: 2026-10-30"\n'
    '"WEBPAGE: https://search.clinicalgenome.org/kb/gene-validity"\n'
    '"+++++++++++","++++++++++++++","+++++++++++++","++++++++++++++++++","+++++++++","+++++++++","++++++++++++++","+++++++++++++","+++++++++++++++++++","+++++++++++++"\n'
    '"GENE SYMBOL","GENE ID (HGNC)","DISEASE LABEL","DISEASE ID (MONDO)","MOI","SOP","CLASSIFICATION","ONLINE REPORT","CLASSIFICATION DATE","GCEP"\n'
    '"+++++++++++","++++++++++++++","+++++++++++++","++++++++++++++++++","+++++++++","+++++++++","++++++++++++++","+++++++++++++","+++++++++++++++++++","+++++++++++++"\n'
    '"SAMPLEA","HGNC:900001","complex neurodevelopmental disorder with autism","MONDO:9000001","AD","SOP10","Definitive","https://example.org/a","2025-01-02T00:00:00.000Z","Sample GCEP"\n'
    '"SAMPLEA","HGNC:900001","Alzheimer disease type X","MONDO:9000002","AD","SOP10","Limited","https://example.org/a2","2024-05-06T00:00:00.000Z","Sample GCEP"\n'
    '"SAMPLEB","HGNC:900002","Autistic-like syndrome","MONDO:9000003","AR","SOP9","Disputed","https://example.org/b","2023-03-04T00:00:00.000Z","Other GCEP"\n'
    '"SAMPLEC","HGNC:900003","retinal dystrophy","MONDO:9000004","AR","SOP10","Strong","https://example.org/c","2022-01-01T00:00:00.000Z","Other GCEP"\n'
)


def hgnc(symbol: str, n: int) -> dict:
    return {
        "response": {
            "docs": [
                {
                    "symbol": symbol,
                    "name": f"sample gene {symbol}",
                    "status": "Approved",
                    "hgnc_id": f"HGNC:90000{n}",
                    "entrez_id": f"99900{n}",
                    "ensembl_gene_id": f"ENSG9000000000{n}",
                    "uniprot_ids": [f"Q9999{n}"],
                    "locus_group": "protein-coding gene",
                    "location": "1p1",
                }
            ]
        }
    }


HOMOLOGY = {
    "data": [
        {
            "id": "ENSG90000000001",
            "homologies": [
                {
                    "type": "ortholog_one2one",
                    "taxonomy_level": "Euarchontoglires",
                    "method_link_type": "ENSEMBL_ORTHOLOGUES",
                    "dn_ds": None,
                    "source": {"id": "ENSG90000000001", "species": "homo_sapiens", "perc_id": 91.234},
                    "target": {
                        "id": "ENSMUSG9000001",
                        "species": "mus_musculus",
                        "taxon_id": 10090,
                        "protein_id": "ENSMUSP9000001",
                        "perc_id": 90.1,
                        "perc_pos": 95.0,
                    },
                },
                {
                    "type": "ortholog_one2many",
                    "taxonomy_level": "Euteleostomi",
                    "method_link_type": "ENSEMBL_ORTHOLOGUES",
                    "source": {"id": "ENSG90000000001", "species": "homo_sapiens", "perc_id": 60},
                    "target": {"id": "ENSDARG9000001", "species": "danio_rerio", "taxon_id": 7955, "perc_id": 58.5},
                },
                {
                    "type": "within_species_paralog",
                    "target": {"id": "ENSG9", "species": "homo_sapiens", "taxon_id": 9606, "perc_id": 40},
                },
                {
                    "type": "ortholog_one2one",
                    "target": {"id": "ENSXETG1", "species": "xenopus_tropicalis", "taxon_id": 8364, "perc_id": 70},
                },
            ],
        }
    ]
}

TAXONOMY = [
    {"id": "9605", "scientific_name": "Homo", "children": [{"id": "9606", "scientific_name": "Homo sapiens"}]},
    {"id": "40674", "scientific_name": "Mammalia", "children": [{"id": "1", "scientific_name": "Sibling"}]},
]

HPO_TEXT = (
    "ncbi_gene_id\tgene_symbol\thpo_id\thpo_name\tfrequency\tdisease_id\n"
    "999001\tSAMPLEA\tHP:9000001\tSample phenotype one\t-\tOMIM:900001\n"
    "999001\tSAMPLEA\tHP:9000001\tSample phenotype one\t3/5\tORPHA:900001\n"
    "999002\tSAMPLEB\tHP:9000002\tSample phenotype two\t-\tOMIM:900002\n"
    "999003\tOTHER\tHP:9000003\tNot in the library\t-\tOMIM:900003\n"
)


class FakeNet:
    """Routes URLs to fixture bodies; records every request."""

    def __init__(self, fail: tuple[str, ...] = ()) -> None:
        self.fail = fail
        self.calls: list[str] = []

    def __call__(self, url: str, accept: str) -> tuple[int, dict, bytes]:
        self.calls.append(url)
        if any(f in url for f in self.fail):
            return 503, {}, b"unavailable"
        if url.startswith(cl.CLINGEN_CSV):
            return 200, {}, CLINGEN.encode()
        if "/fetch/symbol/SAMPLEA" in url:
            return 200, {}, json.dumps(hgnc("SAMPLEA", 1)).encode()
        if "/fetch/symbol/SAMPLEB" in url:
            return 200, {}, json.dumps(hgnc("SAMPLEB", 2)).encode()
        if "/info/data" in url:
            return 200, {}, b'{"releases":[116]}'
        if "/homology/id/human/ENSG90000000001" in url:
            return 200, {}, json.dumps(HOMOLOGY).encode()
        if "/homology/id/human/" in url:
            return 200, {}, b'{"data":[{"homologies":[]}]}'
        if "/taxonomy/classification/" in url:
            return 200, {}, json.dumps(TAXONOMY).encode()
        if url == cl.HPO_RELEASE:
            asset = {"name": cl.HPO_FILE, "browser_download_url": "https://example.org/g2p.txt"}
            return 200, {}, json.dumps({"tag_name": "v2026-09-01", "assets": [asset]}).encode()
        if url == "https://example.org/g2p.txt":
            return 200, {}, HPO_TEXT.encode()
        return 404, {}, b"not found"


def run(net: FakeNet, licences: dict = LICENCES) -> tuple[cl.LibraryCapture, dict]:
    cap = cl.LibraryCapture(CFG, licences, fetch=net, pause=0)
    return cap, cap.run()


class Parsers(unittest.TestCase):
    def test_clingen_header_found_by_title_and_separators_skipped(self):
        rows, cols = cl.parse_clingen_csv(CLINGEN)
        self.assertEqual([r["symbol"] for r in rows], ["SAMPLEA", "SAMPLEA", "SAMPLEB", "SAMPLEC"])
        self.assertEqual(cols["mondoId"], "DISEASE ID (MONDO)")
        self.assertEqual(rows[0]["classification"], "Definitive")
        self.assertEqual(rows[0]["date"], "2025-01-02T00:00:00.000Z")

    def test_clingen_without_required_columns_is_an_error(self):
        with self.assertRaises(cl.SourceError):
            cl.parse_clingen_csv('"GENE SYMBOL","CLASSIFICATION"\n"A","B"\n')
        with self.assertRaises(cl.SourceError):
            cl.parse_clingen_csv("nothing,here\n")

    def test_conditions_match_the_source_label_verbatim(self):
        rows, _ = cl.parse_clingen_csv(CLINGEN)
        sel = cl.select_curations(rows, CFG["conditions"])
        self.assertEqual(
            [(r["symbol"], r["condition"], r["diseaseLabel"]) for r in sel],
            [
                ("SAMPLEA", "alzheimer", "Alzheimer disease type X"),
                ("SAMPLEA", "autism", "complex neurodevelopmental disorder with autism"),
                ("SAMPLEB", "autism", "Autistic-like syndrome"),
            ],
        )

    def test_homology_keeps_orthologues_in_comparison_species_only(self):
        out = cl.parse_homology(HOMOLOGY, CFG["species"])
        self.assertEqual([(o["species"], o["type"]) for o in out], [("danio_rerio", "ortholog_one2many"), ("mus_musculus", "ortholog_one2one")])
        mouse = out[1]
        self.assertEqual((mouse["percId"], mouse["sourcePercId"], mouse["taxonomyLevel"]), (90.1, 91.23, "Euarchontoglires"))
        self.assertIsNone(out[0]["percPos"])

    def test_taxonomy_reads_nodes_not_their_children(self):
        anc = cl.parse_taxonomy(TAXONOMY, 9606)
        self.assertEqual(anc, [{"id": "9605", "name": "Homo"}, {"id": "40674", "name": "Mammalia"}])
        chain = {"id": "9606", "name": "Homo sapiens", "parent": {"id": "9605", "name": "Homo", "parent": None}}
        self.assertEqual(cl.parse_taxonomy(chain, 9606), [{"id": "9605", "name": "Homo"}])

    def test_hpo_rows_for_library_genes_only(self):
        rows, cols = cl.parse_hpo(HPO_TEXT, {"SAMPLEA", "SAMPLEB"})
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[1]["frequency"], "3/5")
        self.assertIn("hpo_id", cols)
        with self.assertRaises(cl.SourceError):
            cl.parse_hpo("a\tb\n1\t2\n", {"A"})


class Capture(unittest.TestCase):
    def test_complete_capture_and_display_copy(self):
        net = FakeNet()
        cap, m = run(net)
        try:
            self.assertTrue(m["complete"], m["sources"])
            self.assertFalse(any("ncbi.nlm.nih.gov" in u for u in net.calls), "NCBI must never be called")
            with tempfile.TemporaryDirectory() as d:
                cap.commit(pathlib.Path(d) / "lib")
                disp = cl.build_display(pathlib.Path(d) / "lib", LICENCES)
        finally:
            cap.cleanup()
        self.assertEqual(disp["mode"], "snapshot")
        self.assertEqual([g["symbol"] for g in disp["genes"]], ["SAMPLEA", "SAMPLEB"])
        a = disp["genes"][0]
        self.assertEqual(a["hgnc"]["ncbiGeneId"], "999001")
        self.assertEqual(a["hgncIdCheck"], "agree")
        self.assertEqual({c["classification"] for c in a["curations"]}, {"Definitive", "Limited"})
        self.assertEqual(a["phenotypes"][0]["diseaseIds"], ["OMIM:900001", "ORPHA:900001"])
        self.assertEqual(disp["genes"][1]["orthologues"], [])
        self.assertEqual({c["key"]: c["geneCount"] for c in disp["conditions"]}, {"autism": 2, "alzheimer": 1})
        self.assertEqual(disp["releases"], {"ensembl": 116, "hpo": "v2026-09-01"})
        self.assertTrue(all(s["status"] == "ok" for s in disp["sources"]), disp["sources"])
        self.assertIn("not for clinical decision-making", disp["notice"])

    def test_a_failing_source_makes_the_capture_incomplete_and_is_recorded(self):
        cap, m = run(FakeNet(fail=("/homology/",)))
        cap.cleanup()
        self.assertFalse(m["complete"])
        failed = [s for s in m["sources"] if s["status"] == "failed"]
        self.assertEqual({s["step"] for s in failed}, {"homology"})

    def test_clingen_outage_leaves_nothing_to_build(self):
        cap, m = run(FakeNet(fail=(cl.CLINGEN_CSV,)))
        cap.cleanup()
        self.assertFalse(m["complete"])
        self.assertEqual([s["step"] for s in m["sources"]], ["clingen"])

    def test_policy_withholds_a_source_without_requesting_it(self):
        lic = copy.deepcopy(LICENCES)
        item = next(i for i in lic["items"] if i["id"] == "hpo-annotations")
        item["permissions"]["research"]["fetch"] = "denied"
        net = FakeNet()
        cap, m = run(net, lic)
        cap.cleanup()
        self.assertFalse(any("github" in u or "example.org/g2p" in u for u in net.calls))
        self.assertEqual([s["status"] for s in m["sources"] if s["step"] == "hpo"], ["withheld"])

    def test_display_copy_drops_a_source_whose_display_is_refused(self):
        cap, _ = run(FakeNet())
        lic = copy.deepcopy(LICENCES)
        next(i for i in lic["items"] if i["id"] == "ensembl-compara")["permissions"]["research"]["display"] = "denied"
        try:
            with tempfile.TemporaryDirectory() as d:
                cap.commit(pathlib.Path(d) / "lib")
                disp = cl.build_display(pathlib.Path(d) / "lib", lic)
        finally:
            cap.cleanup()
        self.assertTrue(all(g["orthologues"] is None for g in disp["genes"]))
        self.assertTrue(all(s["ancestors"] is None for s in disp["species"]))
        src = next(s for s in disp["sources"] if s["id"] == "ensembl-compara")
        self.assertEqual(src["status"], "withheld")
        self.assertIn("display", src["reason"])


if __name__ == "__main__":
    unittest.main()
