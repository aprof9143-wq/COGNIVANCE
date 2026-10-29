"""Capture the public reference records the Vision module shows, per gene, with provenance.

The web app can read these databases live, but a pitch room's Wi-Fi, a
browser's CORS rules or a provider outage should not decide whether the demo
works, and results should be reproducible. So this script downloads the raw
responses once, unchanged, and records for every file the exact request, the
HTTP status, the time it was received, its size and its SHA-256.

Usage:
  python tools/vision-snapshot/capture.py --gene RPE65 [--gene RHO ...]
      [--mode research|commercial-pilot] [--allow-partial]

Genes must be in the registry (config/genome/genes.json). Before anything is
written, the registry's identifiers are checked against what HGNC, Ensembl and
UniProt report; a mismatch stops that gene's capture. Each gene gets its own
folder, data/genome/snapshot/<symbol in lower case>/, holding:
  manifest.json  one SHA-256 manifest per gene (format: docs/genome/GENOME_V1.md)
  SHA256SUMS     the same digests of the stored files, for `sha256sum -c`
and the raw files. That folder is not served by the website: no source's
redistribution is permitted yet. A folder already holding another gene's
capture is never overwritten. Every source is recorded as ok, failed, skipped
(a dependency failed) or withheld (refused by the source policy); a capture with
failures replaces nothing unless --allow-partial is given.

Source policy (policy.py, read from config/genome/licences.json): a step runs
only if its source may be both fetched and stored. Otherwise it is withheld and
nothing is requested. ClinVar is withheld in every mode while its app use is
blocked. In commercial-pilot mode, sources not marked approved are withheld too.

Exit codes: 0 complete (or partial with --allow-partial), 1 partial and not
written, 2 invalid or unknown symbol or identifier mismatch, 3 no source
allowed in this mode.

Run by .github/workflows/vision-snapshot.yml (the build sandbox cannot reach
these hosts). Standard library only. Source terms: docs/genome/LICENCES.md.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import pathlib
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from policy import permitted  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config" / "genome"
# Raw responses are kept out of public/: no source's redistribution is
# permitted yet (config/genome/licences.json). tools/genome-display builds the
# display-only copy the website serves.
OUT_ROOT = ROOT / "data" / "genome" / "snapshot"
UA = "Cognivance-vision-snapshot/2 (+https://github.com/aprof9143-wq/COGNIVANCE)"
KEEP_HEADERS = ("Content-Type", "X-UniProt-Release", "X-UniProt-Release-Date", "Last-Modified", "ETag")
SYMBOL = re.compile(r"^[A-Z0-9][A-Za-z0-9-]{0,29}$")
# 3: a source step may be "withheld" by the source policy.
MANIFEST_SCHEMA = 3

ENSEMBL = "https://rest.ensembl.org"
UNIPROT = "https://rest.uniprot.org"
ALPHAFOLD = "https://alphafold.ebi.ac.uk"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
HGNC = "https://rest.genenames.org"

# Which licence-inventory item governs each step.
LICENCE = {
    "hgnc": "hgnc-rest",
    "ensembl_lookup": "ensembl-rest",
    "ensembl_release": "ensembl-rest",
    "ensembl_cds": "ensembl-rest",
    "ensembl_gene_region": "ensembl-rest",
    "uniprot_search": "uniprot-rest",
    "alphafold_prediction": "alphafold-db",
    "alphafold_model": "alphafold-db",
    "clinvar": "clinvar-eutils",
}

Fetch = Callable[[str, str], "tuple[int, dict[str, str], bytes]"]


class CaptureError(Exception):
    """A gene that must not be captured: invalid, unknown, or its identifiers disagree."""


class SourceError(Exception):
    """One source could not be read; recorded in the manifest, not fatal to the others."""


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def http_fetch(url: str, accept: str) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": UA})
    last: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500 and e.code != 429:
                return e.code, dict(e.headers), e.read()  # a definite answer; retrying will not change it
            last = e
            time.sleep(2**attempt)
        except Exception as e:  # noqa: BLE001 - retried, then reported
            last = e
            time.sleep(2**attempt)
    raise SourceError(f"{url}: {last}")


def load_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text())


def registry_entry(symbol: str, registry: dict) -> dict:
    """The registered gene for `symbol`, or CaptureError saying exactly why not."""
    if not SYMBOL.match(symbol or ""):
        raise CaptureError(f'"{symbol}" is not a valid HGNC gene symbol.')
    for g in registry["genes"]:
        if g["symbol"] == symbol:
            return g
    raise CaptureError(
        f"{symbol} is not in the gene registry (config/genome/genes.json). Register it, with its HGNC, "
        "Ensembl and UniProt identifiers, before capturing it."
    )


def gene_dir(symbol: str, out_root: pathlib.Path) -> pathlib.Path:
    return out_root / symbol.lower()


class Capture:
    """One gene's capture into a staging folder; `commit` moves it into place."""

    def __init__(
        self,
        gene: dict,
        registry: dict,
        licences: dict,
        *,
        fetch: Fetch = http_fetch,
        mode: str = "research",
        pause: float = 0.5,
    ) -> None:
        self.gene = gene
        self.symbol = gene["symbol"]
        self.fetch = fetch
        self.mode = mode
        self.pause = pause
        self.licences = licences
        self.stage = pathlib.Path(tempfile.mkdtemp(prefix=f"capture-{self.symbol}-"))
        self.files: list[dict] = []
        self.sources: list[dict] = []
        self.checks: list[dict] = []
        self.manifest: dict = {
            "schemaVersion": MANIFEST_SCHEMA,
            "gene": self.symbol,
            "hgncId": gene["hgncId"],
            "ensemblGeneId": gene["ensemblGeneId"],
            "uniprotAccession": gene["uniprotAccession"],
            "taxonId": gene["taxonId"],
            "assembly": registry["assembly"],
            "registryVersion": registry["registryVersion"],
            "mode": mode,
            "tool": "tools/vision-snapshot/capture.py",
            "capturedAt": None,
            "complete": None,
            "note": "Raw responses, unchanged. Files ending .gz are gzip of the raw bytes. "
            "sha256 is of the raw response; storedSha256 is of the file as stored.",
        }

    # ------------------------------------------------------------ bookkeeping

    def denied(self, step: str) -> str:
        """Why the source policy refuses this step (it must be both fetched and stored), or ""."""
        for action in ("fetch", "store"):
            ok, reason = permitted(self.licences, LICENCE[step], action, self.mode)
            if not ok:
                return reason
        return ""

    def record(self, step: str, status: str, reason: str = "", files: list[str] | None = None) -> None:
        entry: dict = {"step": step, "licenceId": LICENCE[step], "status": status, "files": files or []}
        if reason:
            entry["reason"] = reason
        self.sources.append(entry)

    def skip(self, step: str, reason: str) -> None:
        self.record(step, "skipped", reason)

    def save(self, name: str, url: str, *, accept: str = "application/json", gz: bool = False, note: str = "") -> bytes:
        status, headers, body = self.fetch(url, accept)
        if not 200 <= status < 300:
            raise SourceError(f"{url}: HTTP {status}")
        data = gzip.compress(body, mtime=0) if gz else body
        (self.stage / name).write_bytes(data)
        self.files.append(
            {
                "file": name,
                "url": url,
                "status": status,
                "retrievedAt": now(),
                "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "gzip": gz,
                "storedBytes": len(data),
                "storedSha256": hashlib.sha256(data).hexdigest(),
                "headers": {k: headers[k] for k in KEEP_HEADERS if k in headers},
                **({"note": note} if note else {}),
            }
        )
        print(f"  {status} {len(body):>9} B  {name}  <- {url}")
        return body

    def step(self, step: str, fn: Callable[[], Any], needs: str = "") -> Any:
        """Run one source step; record ok, failed, skipped or withheld. Returns its result or None."""
        refused = self.denied(step)
        if refused:
            # Nothing is requested from the source.
            self.record(step, "withheld", f"Withheld by the source policy: {refused}")
            return None
        if needs:
            self.skip(step, needs)
            return None
        before = len(self.files)
        try:
            out = fn()
        except CaptureError:
            raise
        except Exception as e:  # noqa: BLE001 - recorded, the capture continues
            self.record(step, "failed", str(e), [f["file"] for f in self.files[before:]])
            print(f"  FAILED {step}: {e}")
            return None
        self.record(step, "ok", files=[f["file"] for f in self.files[before:]])
        return out

    def check(self, what: str, source: str, expected: str, reported: str | None) -> None:
        """Compare a registry identifier with what a source reports; disagreement stops the capture."""
        result = "not-reported" if reported is None else ("agree" if reported == expected else "differ")
        self.checks.append(
            {"check": what, "source": source, "expected": expected, "reported": reported, "result": result}
        )
        print(f"  check {source} {what}: {result} (expected {expected}, reported {reported})")
        if result == "differ":
            raise CaptureError(
                f"{self.symbol}: {source} reports {what} {reported}, the registry says {expected}. "
                "Nothing was written. Correct the registry or investigate the source."
            )

    # ------------------------------------------------------------ sources

    def hgnc(self) -> None:
        raw = json.loads(self.save("hgnc_symbol.json", f"{HGNC}/fetch/symbol/{urllib.parse.quote(self.symbol)}"))
        docs = raw.get("response", {}).get("docs", [])
        if len(docs) != 1 or docs[0].get("symbol") != self.symbol:
            raise CaptureError(f"HGNC has no approved symbol {self.symbol} (found {len(docs)} records).")
        d = docs[0]
        if d.get("status") != "Approved":
            raise CaptureError(f"HGNC lists {self.symbol} with status {d.get('status')!r}, not Approved.")
        self.check("HGNC ID", "HGNC", self.gene["hgncId"], d.get("hgnc_id"))
        self.check("Ensembl gene ID", "HGNC", self.gene["ensemblGeneId"], d.get("ensembl_gene_id"))
        ups = d.get("uniprot_ids") or []
        acc = self.gene["uniprotAccession"]
        self.check("UniProt accession", "HGNC", acc, acc if acc in ups else (",".join(ups) or None))

    def ensembl_lookup(self) -> dict:
        lookup = json.loads(
            self.save(
                "ensembl_lookup.json",
                f"{ENSEMBL}/lookup/symbol/homo_sapiens/{urllib.parse.quote(self.symbol)}"
                "?content-type=application/json;expand=1",
            )
        )
        self.check("symbol", "Ensembl", self.symbol, lookup.get("display_name"))
        self.check("Ensembl gene ID", "Ensembl", self.gene["ensemblGeneId"], lookup.get("id"))
        m = re.search(r"Acc:(HGNC:\d+)", lookup.get("description") or "")
        self.check("HGNC ID", "Ensembl", self.gene["hgncId"], m.group(1) if m else None)
        if lookup.get("assembly_name") != self.manifest["assembly"]:
            raise CaptureError(
                f"Ensembl returned assembly {lookup.get('assembly_name')!r}; Genome v1 accepts GRCh38 only."
            )
        return lookup

    def uniprot(self) -> dict:
        query = f"gene_exact:{self.symbol} AND organism_id:{self.gene['taxonId']} AND reviewed:true"
        raw = json.loads(
            self.save(
                "uniprot_search.json",
                f"{UNIPROT}/uniprotkb/search?" + urllib.parse.urlencode({"query": query, "format": "json", "size": 5}),
            )
        )
        results = raw.get("results", [])
        if not results:
            raise SourceError(f"UniProt returned no reviewed human entry for {self.symbol}.")
        accs = ",".join(r.get("primaryAccession", "?") for r in results)
        self.check("UniProt accession", "UniProt", self.gene["uniprotAccession"], accs)
        return results[0]

    def alphafold(self, acc: str) -> dict:
        af = json.loads(self.save("alphafold_prediction.json", f"{ALPHAFOLD}/api/prediction/{acc}"))
        entry = next((e for e in af if e.get("entryId") == f"AF-{acc}-F1"), None)
        if not entry:
            raise SourceError(f"AlphaFold DB returned no AF-{acc}-F1 entry.")
        return entry

    def clinvar(self) -> None:
        common = {"db": "clinvar", "retmode": "json", "tool": "cognivance-vision-snapshot"}
        search = json.loads(
            self.save(
                "clinvar_esearch.json",
                f"{EUTILS}/esearch.fcgi?" + urllib.parse.urlencode({**common, "term": f"{self.symbol}[gene]", "retmax": 5000}),
            )
        )
        ids = search["esearchresult"]["idlist"]
        for i in range(0, len(ids), 200):
            time.sleep(self.pause)  # NCBI asks for at most 3 requests per second without a key
            self.save(
                f"clinvar_esummary_{i // 200:03d}.json.gz",
                f"{EUTILS}/esummary.fcgi?" + urllib.parse.urlencode({**common, "id": ",".join(ids[i : i + 200])}),
                gz=True,
            )

    # ------------------------------------------------------------ run

    def run(self) -> dict:
        self.manifest["capturedAt"] = now()
        self.step("hgnc", self.hgnc)
        lookup = self.step("ensembl_lookup", self.ensembl_lookup)
        self.step("ensembl_release", lambda: self.save("ensembl_release.json", f"{ENSEMBL}/info/data?content-type=application/json"))
        no_lookup = "" if lookup else "Needs the Ensembl lookup, which did not succeed."
        canon = (lookup or {}).get("canonical_transcript", "").split(".")[0]
        self.step(
            "ensembl_cds",
            lambda: self.save(
                "ensembl_cds.json",
                f"{ENSEMBL}/sequence/id/{canon}?type=cds;content-type=application/json",
                note="Coding sequence of the canonical transcript.",
            ),
            needs=no_lookup or ("" if canon else "Ensembl reported no canonical transcript."),
        )
        self.step(
            "ensembl_gene_region",
            lambda: self.save(
                "ensembl_gene_region.json",
                f"{ENSEMBL}/sequence/region/human/{lookup['seq_region_name']}:{lookup['start']}..{lookup['end']}:{lookup['strand']}"
                "?content-type=application/json",
                note="Genomic sequence of the whole gene, on the gene's strand.",
            ),
            needs=no_lookup,
        )
        protein = self.step("uniprot_search", self.uniprot)
        acc = self.gene["uniprotAccession"]
        entry = self.step(
            "alphafold_prediction",
            lambda: self.alphafold(acc),
            needs="" if protein else "Needs the UniProt entry, which did not succeed.",
        )
        self.step(
            "alphafold_model",
            lambda: self.save("alphafold_model.pdb.gz", entry["pdbUrl"], accept="chemical/x-pdb, text/plain, */*", gz=True),
            needs="" if entry and entry.get("pdbUrl") else "Needs an AlphaFold entry with a model file.",
        )
        self.step("clinvar", self.clinvar)

        failed = [s for s in self.sources if s["status"] == "failed"]
        skipped = [s for s in self.sources if s["status"] == "skipped"]
        # Complete means every step the policy permits succeeded; withheld steps
        # were never meant to be captured.
        self.manifest["complete"] = not failed and not skipped
        self.manifest["identifierChecks"] = self.checks
        self.manifest["sources"] = self.sources
        self.manifest["files"] = sorted(self.files, key=lambda f: f["file"])
        return self.manifest

    def write_manifest(self) -> None:
        (self.stage / "manifest.json").write_text(json.dumps(self.manifest, indent=2, sort_keys=True) + "\n")
        (self.stage / "SHA256SUMS").write_text(
            "".join(f"{f['storedSha256']}  {f['file']}\n" for f in self.manifest["files"])
        )

    def commit(self, out_root: pathlib.Path) -> pathlib.Path:
        """Replace this gene's folder with the staged capture. Never touches another gene's folder."""
        dest = gene_dir(self.symbol, out_root)
        existing = dest / "manifest.json"
        if existing.exists():
            prev = load_json(existing)
            prev_id = (prev.get("gene"), prev.get("hgncId", self.gene["hgncId"]))
            if prev_id != (self.symbol, self.gene["hgncId"]):
                raise CaptureError(
                    f"{dest} holds a capture of {prev.get('gene')} ({prev.get('hgncId', 'no HGNC ID')}); "
                    f"refusing to overwrite it with {self.symbol}."
                )
        elif dest.exists() and any(dest.iterdir()):
            raise CaptureError(f"{dest} exists, is not empty and has no manifest; refusing to overwrite it.")
        self.write_manifest()
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(self.stage, dest)
        return dest

    def cleanup(self) -> None:
        shutil.rmtree(self.stage, ignore_errors=True)


def capture_gene(
    symbol: str,
    *,
    registry: dict,
    licences: dict,
    out_root: pathlib.Path = OUT_ROOT,
    fetch: Fetch = http_fetch,
    mode: str = "research",
    allow_partial: bool = False,
    pause: float = 0.5,
) -> tuple[int, dict | None]:
    """Capture one gene. Returns (exit code, manifest or None)."""
    print(f"== {symbol} ({mode})")
    try:
        gene = registry_entry(symbol, registry)
    except CaptureError as e:
        print(f"ERROR {e}", file=sys.stderr)
        return 2, None
    cap = Capture(gene, registry, licences, fetch=fetch, mode=mode, pause=pause)
    try:
        manifest = cap.run()
        if all(s["status"] in ("skipped", "withheld") for s in cap.sources):
            print(f"ERROR {symbol}: no source is allowed in {mode} mode; nothing written.", file=sys.stderr)
            return 3, manifest
        if not manifest["complete"] and not allow_partial:
            for s in manifest["sources"]:
                if s["status"] != "ok":
                    print(f"  {s['status']}: {s['step']}: {s.get('reason', '')}", file=sys.stderr)
            print(f"ERROR {symbol}: capture incomplete; the existing snapshot was left unchanged.", file=sys.stderr)
            return 1, manifest
        dest = cap.commit(out_root)
        print(f"   {len(manifest['files'])} files -> {dest}")
        return 0, manifest
    except CaptureError as e:
        print(f"ERROR {e}", file=sys.stderr)
        return 2, None
    finally:
        cap.cleanup()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--gene", action="append", required=True, help="HGNC symbol from config/genome/genes.json; repeatable")
    ap.add_argument("--mode", choices=["research", "commercial-pilot"], default="research")
    ap.add_argument("--allow-partial", action="store_true", help="write a capture even if some sources failed")
    ap.add_argument("--out-root", type=pathlib.Path, default=OUT_ROOT)
    ap.add_argument("--config-dir", type=pathlib.Path, default=CONFIG)
    a = ap.parse_args(argv)
    registry = load_json(a.config_dir / "genes.json")
    licences = load_json(a.config_dir / "licences.json")
    code = 0
    for symbol in dict.fromkeys(a.gene):
        c, _ = capture_gene(
            symbol, registry=registry, licences=licences, out_root=a.out_root, mode=a.mode, allow_partial=a.allow_partial
        )
        code = max(code, c)
    return code


if __name__ == "__main__":
    sys.exit(main())
