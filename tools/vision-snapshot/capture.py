"""Capture the public reference records the Vision module shows, with provenance.

The web app can read these databases live, but a pitch room's Wi-Fi, a
browser's CORS rules or a provider outage should not decide whether the demo
works, and results should be reproducible. So this script downloads the raw
responses once, unchanged, and records for every file the exact request, the
HTTP status, the time it was received, its size and its SHA-256.

Run by .github/workflows/vision-snapshot.yml (the build sandbox cannot reach
these hosts). Writes public/vision/snapshot/rpe65/. Standard library only.

Sources and terms:
  Ensembl REST      https://rest.ensembl.org          no restrictions on data use
  UniProtKB REST    https://rest.uniprot.org          CC BY 4.0
  AlphaFold DB      https://alphafold.ebi.ac.uk       CC BY 4.0
  NCBI ClinVar      https://www.ncbi.nlm.nih.gov/clinvar/   public domain (US government work)
"""

from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import pathlib
import time
import urllib.parse
import urllib.request

GENE = "RPE65"
TAXON = 9606
OUT = pathlib.Path("public/vision/snapshot/rpe65")
UA = "Cognivance-vision-snapshot/1 (+https://github.com/aprof9143-wq/COGNIVANCE)"
KEEP_HEADERS = ("Content-Type", "X-UniProt-Release", "X-UniProt-Release-Date", "Last-Modified", "ETag")

manifest: dict = {
    "gene": GENE,
    "taxonId": TAXON,
    "capturedAt": None,
    "note": "Raw responses, unchanged. Files ending .gz are gzip of the raw bytes.",
    "files": [],
}


def now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def fetch(url: str, accept: str) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": UA})
    last: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.status, dict(r.headers), r.read()
        except Exception as e:  # noqa: BLE001 - retried, then re-raised
            last = e
            time.sleep(2**attempt)
    raise RuntimeError(f"{url}: {last}")


def save(name: str, url: str, *, accept: str = "application/json", gz: bool = False, note: str = "") -> bytes:
    status, headers, body = fetch(url, accept)
    data = gzip.compress(body, mtime=0) if gz else body
    (OUT / name).write_bytes(data)
    manifest["files"].append(
        {
            "file": name,
            "url": url,
            "status": status,
            "retrievedAt": now(),
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "gzip": gz,
            "headers": {k: headers[k] for k in KEEP_HEADERS if k in headers},
            **({"note": note} if note else {}),
        }
    )
    print(f"{status} {len(body):>9} B  {name}  <- {url}")
    return body


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest["capturedAt"] = now()

    ens = "https://rest.ensembl.org"
    lookup = json.loads(
        save("ensembl_lookup.json", f"{ens}/lookup/symbol/homo_sapiens/{GENE}?content-type=application/json;expand=1")
    )
    save("ensembl_release.json", f"{ens}/info/data?content-type=application/json")
    canon = lookup.get("canonical_transcript", "").split(".")[0]
    if canon:
        save(
            "ensembl_cds.json",
            f"{ens}/sequence/id/{canon}?type=cds;content-type=application/json",
            note="Coding sequence of the canonical transcript.",
        )
    region = f"{lookup['seq_region_name']}:{lookup['start']}..{lookup['end']}:{lookup['strand']}"
    save(
        "ensembl_gene_region.json",
        f"{ens}/sequence/region/human/{region}?content-type=application/json",
        note="Genomic sequence of the whole gene, on the gene's strand.",
    )

    query = f"gene_exact:{GENE} AND organism_id:{TAXON} AND reviewed:true"
    uni = json.loads(
        save(
            "uniprot_search.json",
            "https://rest.uniprot.org/uniprotkb/search?" + urllib.parse.urlencode({"query": query, "format": "json", "size": 5}),
        )
    )
    results = uni.get("results", [])
    if len(results) == 1:
        acc = results[0]["primaryAccession"]
        af = json.loads(save("alphafold_prediction.json", f"https://alphafold.ebi.ac.uk/api/prediction/{acc}"))
        entry = next((e for e in af if e.get("entryId") == f"AF-{acc}-F1"), af[0] if af else None)
        if entry and entry.get("pdbUrl"):
            save("alphafold_model.pdb.gz", entry["pdbUrl"], accept="chemical/x-pdb, text/plain, */*", gz=True)

    eu = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    common = {"db": "clinvar", "retmode": "json", "tool": "cognivance-vision-snapshot"}
    search = json.loads(
        save(
            "clinvar_esearch.json",
            f"{eu}/esearch.fcgi?" + urllib.parse.urlencode({**common, "term": f"{GENE}[gene]", "retmax": 5000}),
        )
    )
    ids = search["esearchresult"]["idlist"]
    for i in range(0, len(ids), 200):
        time.sleep(0.5)  # NCBI asks for at most 3 requests per second without a key
        batch = ids[i : i + 200]
        save(
            f"clinvar_esummary_{i // 200:03d}.json.gz",
            f"{eu}/esummary.fcgi?" + urllib.parse.urlencode({**common, "id": ",".join(batch)}),
            gz=True,
        )

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"manifest: {len(manifest['files'])} files")


if __name__ == "__main__":
    main()
