"""Build the display-only copy of each gene's reference snapshot.

Raw responses live in data/genome/snapshot/<gene>/, which the website does not
serve: no source's redistribution is permitted yet (config/genome/licences.json).
The website serves public/vision/display/<gene>/ instead, built here:

  - only files the app reads, and only from sources whose display the source
    policy permits (tools/vision-snapshot/policy.py); anything else is listed
    as withheld, with the policy's reason, and not written;
  - each JSON file cut down to exactly the fields the app's parsers read. The
    field lists mirror the zod schemas in src/lib/vision/sources.ts, and a test
    (src/lib/genome/display.test.ts) checks that every display file equals what
    those schemas keep from the raw file, so the two cannot drift apart;
  - the AlphaFold model file unchanged: the 3D view renders all of it;
  - a manifest recording, per file, the raw response it came from (URL,
    retrieval time, size, SHA-256) and the digest of the display file.

Output is deterministic (sorted keys, 2-space indent, no build time), so
rebuilding from the same snapshot gives identical bytes; a test checks the
committed copy is current. No hgnc_symbol.json: the app never displays it.

Usage: python tools/genome-display/build_display.py [--gene RPE65 ...]
Standard library only.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import pathlib
import shutil
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "vision-snapshot"))
from policy import permitted  # noqa: E402

RAW_ROOT = ROOT / "data" / "genome" / "snapshot"
OUT_ROOT = ROOT / "public" / "vision" / "display"
CONFIG = ROOT / "config" / "genome"
SCHEMA_VERSION = 1

# --------------------------------------------------------------- field lists
# 1 keeps a value as it is; a dict keeps those keys; [spec] applies spec to
# every element. They mirror the zod schemas in src/lib/vision/sources.ts.

TEXT = {"value": 1}
ENSEMBL_GENE = {
    "id": 1, "version": 1, "display_name": 1, "description": 1, "biotype": 1, "assembly_name": 1,
    "seq_region_name": 1, "start": 1, "end": 1, "strand": 1, "canonical_transcript": 1,
    "Transcript": [{
        "id": 1, "version": 1, "biotype": 1, "is_canonical": 1,
        "Exon": [{"id": 1, "start": 1, "end": 1}],
        "Translation": {"id": 1, "length": 1},
    }],
}  # fmt: skip
UNIPROT_SEARCH = {
    "results": [{
        "primaryAccession": 1, "uniProtkbId": 1, "entryType": 1,
        "entryAudit": {"lastAnnotationUpdateDate": 1, "entryVersion": 1, "sequenceVersion": 1},
        "organism": {"scientificName": 1, "taxonId": 1},
        "proteinDescription": {"recommendedName": {"fullName": TEXT}},
        "genes": [{"geneName": TEXT}],
        "comments": [{
            "commentType": 1, "texts": [TEXT], "reaction": {"name": 1, "ecNumber": 1},
            "subcellularLocations": [{"location": TEXT}],
            "disease": {"diseaseId": 1, "acronym": 1, "diseaseCrossReference": {"database": 1, "id": 1}},
        }],
        "uniProtKBCrossReferences": [{"database": 1, "id": 1, "properties": [{"key": 1, "value": 1}]}],
        "sequence": {"value": 1, "length": 1},
    }],
}  # fmt: skip
ALPHAFOLD_PREDICTION = [{
    "entryId": 1, "uniprotAccession": 1, "uniprotStart": 1, "uniprotEnd": 1, "uniprotSequence": 1,
    "modelCreatedDate": 1, "latestVersion": 1, "pdbUrl": 1, "globalMetricValue": 1,
}]  # fmt: skip
SEQUENCE = {"id": 1, "seq": 1}

# file -> (licence item, field list, or None to keep the file unchanged)
DISPLAY: dict[str, tuple[str, Any]] = {
    "ensembl_lookup.json": ("ensembl-rest", ENSEMBL_GENE),
    "ensembl_release.json": ("ensembl-rest", {"releases": 1}),
    "ensembl_cds.json": ("ensembl-rest", SEQUENCE),
    "ensembl_gene_region.json": ("ensembl-rest", SEQUENCE),
    "uniprot_search.json": ("uniprot-rest", UNIPROT_SEARCH),
    "alphafold_prediction.json": ("alphafold-db", ALPHAFOLD_PREDICTION),
    "alphafold_model.pdb.gz": ("alphafold-db", None),
}

NOTICE = (
    "Display-only copy for the Cognivance Vision research pages: the fields the app shows, from sources whose "
    "display the source policy permits. Not a redistribution of the source databases; their raw responses are "
    "not served. Research software. Not a medical device, not clinically validated, and not for clinical "
    "decision-making."
)


def prune(value: Any, spec: Any) -> Any:
    """Keep only the fields in `spec`, as zod's default parse does."""
    if spec == 1 or value is None:
        return value
    if isinstance(spec, list):
        return [prune(v, spec[0]) for v in value] if isinstance(value, list) else value
    if isinstance(spec, dict) and isinstance(value, dict):
        return {k: prune(value[k], s) for k, s in spec.items() if k in value}
    return value


def dumps(obj: Any) -> bytes:
    return (json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def build_gene(raw_dir: pathlib.Path, out_dir: pathlib.Path, licences: dict) -> dict:
    """Write one gene's display copy into out_dir (replaced). Returns its manifest."""
    manifest = json.loads((raw_dir / "manifest.json").read_text())
    by_name = {f["file"]: f for f in manifest["files"]}
    files: list[dict] = []
    withheld: dict[str, str] = {}
    staged: dict[str, bytes] = {}

    for name, (licence_id, spec) in DISPLAY.items():
        ok, reason = permitted(licences, licence_id, "display")
        if not ok:
            withheld[licence_id] = reason
            continue
        meta = by_name.get(name)
        path = raw_dir / name
        if meta is None or not path.exists():
            continue  # not captured; the app shows the gap
        stored = path.read_bytes()
        if hashlib.sha256(stored).hexdigest() != meta.get("storedSha256", meta["sha256"]):
            raise SystemExit(f"{path}: digest does not match its manifest; refusing to build from it.")
        if spec is None:
            out = stored
        else:
            raw = gzip.decompress(stored) if meta.get("gzip") else stored
            out = dumps(prune(json.loads(raw), spec))
            if meta.get("gzip"):
                out = gzip.compress(out, mtime=0)
        staged[name] = out
        files.append(
            {
                "file": name,
                "licenceId": licence_id,
                "url": meta["url"],
                "status": meta["status"],
                "retrievedAt": meta["retrievedAt"],
                "headers": meta.get("headers", {}),
                "gzip": bool(meta.get("gzip")),
                # The raw response this was derived from.
                "bytes": meta["bytes"],
                "sha256": meta["sha256"],
                # The display file as served.
                "storedSha256": hashlib.sha256(out).hexdigest(),
                "displayBytes": len(out),
                "transform": "unchanged" if spec is None else "fields-read-by-the-app",
            }
        )

    # Sources the snapshot holds (or held) that are not displayed at all.
    for src in manifest.get("sources", []):
        lid = src.get("licenceId")
        if lid and lid not in withheld:
            ok, reason = permitted(licences, lid, "display")
            if not ok:
                withheld[lid] = reason

    out_manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "display-only",
        "notice": NOTICE,
        "gene": manifest["gene"],
        "hgncId": manifest.get("hgncId"),
        "taxonId": manifest["taxonId"],
        "assembly": manifest.get("assembly", "GRCh38"),
        "capturedAt": manifest["capturedAt"],
        "rawManifestSha256": hashlib.sha256((raw_dir / "manifest.json").read_bytes()).hexdigest(),
        "inventoryVersion": licences["inventoryVersion"],
        "files": sorted(files, key=lambda f: f["file"]),
        "withheld": [{"licenceId": k, "reason": v} for k, v in sorted(withheld.items())],
    }

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    for name, data in staged.items():
        (out_dir / name).write_bytes(data)
    (out_dir / "manifest.json").write_bytes(dumps(out_manifest))
    return out_manifest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--gene", action="append", help="HGNC symbol; default: every captured gene")
    ap.add_argument("--raw-root", type=pathlib.Path, default=RAW_ROOT)
    ap.add_argument("--out-root", type=pathlib.Path, default=OUT_ROOT)
    ap.add_argument("--config-dir", type=pathlib.Path, default=CONFIG)
    a = ap.parse_args(argv)
    licences = json.loads((a.config_dir / "licences.json").read_text())
    genes = [g.lower() for g in a.gene] if a.gene else sorted(p.name for p in a.raw_root.iterdir() if p.is_dir())
    for g in genes:
        m = build_gene(a.raw_root / g, a.out_root / g, licences)
        print(f"{m['gene']}: {len(m['files'])} display files, withheld {[w['licenceId'] for w in m['withheld']]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
