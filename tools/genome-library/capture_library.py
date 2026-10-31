"""Capture the research gene library, with provenance, and build its display copy.

The library holds the genes that ClinGen's gene-disease validity curations
associate with the conditions in config/genome/library.json (autism spectrum
disorder and Alzheimer disease), at capture time. No gene is listed by hand.
For each gene it records:

  ClinGen   every matching curation, verbatim: disease label and MONDO ID,
            classification, mode of inheritance, expert panel, date, report link
  HGNC      approved symbol, name and cross-references (NCBI Gene, Ensembl, UniProt)
  Ensembl   orthologues in the comparison species (Compara), with orthology type
            and percent identity, and each species' taxonomic ancestors
  HPO       phenotype terms annotated to the gene, from the latest release's
            genes_to_phenotype.txt

Usage:
  python tools/genome-library/capture_library.py [--allow-partial] [--build-only]

Output:
  data/genome/library/          raw responses, manifest.json and SHA256SUMS; not served
  public/genomics/library.json  the display copy the website reads: only the
                                fields the app shows, from sources whose display
                                the source policy permits, with each file's digest

HPO's annotation file is about 20 MB and is an immutable release asset, so only
the rows for library genes are stored, with the digest, size and URL of the
full file. Everything else is stored as received.

Source policy (tools/vision-snapshot/policy.py, read from
config/genome/licences.json): a step runs only if its source may be fetched and
stored; a source is copied into the display file only if it may be displayed.
NCBI is never called: its app use is blocked (decision of 2026-10-27), so the
NCBI Gene ID shown is the cross-reference HGNC reports.

Exit codes: 0 complete (or partial with --allow-partial), 1 incomplete and
nothing written, 3 no source allowed.

Run by .github/workflows/vision-snapshot.yml (the build sandbox cannot reach
these hosts). Standard library only.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import pathlib
import re
import shutil
import sys
import tempfile
import time
import urllib.parse
from typing import Any, Callable

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools" / "vision-snapshot"))
from capture import SourceError, http_fetch  # noqa: E402
from policy import permitted  # noqa: E402

CONFIG = ROOT / "config" / "genome"
OUT_DIR = ROOT / "data" / "genome" / "library"
DISPLAY_FILE = ROOT / "public" / "genomics" / "library.json"
TOOL = "tools/genome-library/capture_library.py"
SCHEMA = 1

CLINGEN_CSV = "https://search.clinicalgenome.org/kb/gene-validity/download"
HGNC = "https://rest.genenames.org"
ENSEMBL = "https://rest.ensembl.org"
HPO_RELEASE = "https://api.github.com/repos/obophenotype/human-phenotype-ontology/releases/latest"
HPO_FILE = "genes_to_phenotype.txt"

# The same statement as src/lib/genome/status.ts (a test checks they match).
NOTICE = (
    "Research software. Not a medical device, not clinically validated, and not for clinical decision-making. "
    "A gene-condition curation describes published evidence about a gene; it is not a diagnosis, a risk "
    "estimate or proof of cause for any person. An orthologue is a gene related by descent, not a gene "
    "shown to have the same function."
)

# Which licence-inventory item governs each step.
LICENCE = {
    "clingen": "clingen-gene-validity",
    "hgnc": "hgnc-rest",
    "ensembl_release": "ensembl-compara",
    "homology": "ensembl-compara",
    "taxonomy": "ensembl-compara",
    "gene_models": "ensembl-compara",
    "hpo": "hpo-annotations",
}
SOURCE_NAME = {
    "clingen-gene-validity": "ClinGen gene-disease validity",
    "hgnc-rest": "HGNC",
    "ensembl-compara": "Ensembl Compara (REST)",
    "hpo-annotations": "Human Phenotype Ontology annotations",
}

# ClinGen's CSV column titles, normalised (upper case, single spaces), per field.
CLINGEN_COLUMNS = {
    "symbol": ("GENE SYMBOL",),
    "hgncId": ("GENE ID (HGNC)", "HGNC ID"),
    "diseaseLabel": ("DISEASE LABEL",),
    "mondoId": ("DISEASE ID (MONDO)", "MONDO ID"),
    "moi": ("MOI", "MODE OF INHERITANCE"),
    "sop": ("SOP",),
    "classification": ("CLASSIFICATION",),
    "reportUrl": ("ONLINE REPORT",),
    "date": ("CLASSIFICATION DATE",),
    "gcep": ("GCEP", "EXPERT PANEL"),
}
CLINGEN_REQUIRED = ("symbol", "diseaseLabel", "classification")
# Which stored files belong to each source, by path prefix.
SOURCE_FILES = {
    "clingen-gene-validity": "clingen",
    "hgnc-rest": "hgnc/",
    "ensembl-compara": "ensembl/",
    "hpo-annotations": "hpo/",
}

Fetch = Callable[[str, str], "tuple[int, dict[str, str], bytes]"]


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def load_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text())


def dump(obj: Any) -> str:
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------- parsers


def _norm(cell: str) -> str:
    return re.sub(r"\s+", " ", (cell or "").strip().strip('"')).upper()


def parse_clingen_csv(text: str) -> tuple[list[dict], dict[str, str | None]]:
    """ClinGen's gene-validity CSV: (rows keyed by field, field -> column title found or None).

    The download starts with a few title lines before the header row, and may
    hold separator rows; the header is found by its titles, not its position.
    """
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    for h, row in enumerate(rows):
        cells = [_norm(c) for c in row]
        if "GENE SYMBOL" in cells and "CLASSIFICATION" in cells:
            break
    else:
        raise SourceError("ClinGen CSV: no header row with 'GENE SYMBOL' and 'CLASSIFICATION' was found.")
    index: dict[str, int | None] = {}
    found: dict[str, str | None] = {}
    for field, titles in CLINGEN_COLUMNS.items():
        i = next((cells.index(t) for t in titles if t in cells), None)
        index[field] = i
        found[field] = cells[i] if i is not None else None
    missing = [f for f in CLINGEN_REQUIRED if index[f] is None]
    if missing:
        raise SourceError(f"ClinGen CSV: required columns missing: {', '.join(missing)}.")
    out: list[dict] = []
    for row in rows[h + 1 :]:
        if not row or not any(c.strip() for c in row):
            continue
        rec = {f: (row[i].strip() if i is not None and i < len(row) else None) for f, i in index.items()}
        if not rec["symbol"] or set(rec["symbol"]) <= set("+-=_ "):
            continue  # a separator row
        out.append({k: (v or None) for k, v in rec.items()})
    return out, found


def select_curations(rows: list[dict], conditions: list[dict]) -> list[dict]:
    """The curations whose disease label matches a library condition, each tagged with its condition key."""
    out = []
    for r in rows:
        label = r.get("diseaseLabel") or ""
        for c in conditions:
            if re.search(c["match"], label, re.IGNORECASE):
                out.append({**r, "condition": c["key"]})
    return sorted(out, key=lambda r: (r["symbol"], r["condition"], r["diseaseLabel"], r.get("date") or ""))


def parse_hgnc(raw: dict) -> dict | None:
    """The single HGNC record in a fetch response, reduced to the fields the library uses."""
    docs = (raw.get("response") or {}).get("docs") or []
    if len(docs) != 1:
        return None
    d = docs[0]
    return {
        "symbol": d.get("symbol"),
        "name": d.get("name"),
        "status": d.get("status"),
        "hgncId": d.get("hgnc_id"),
        "ncbiGeneId": str(d["entrez_id"]) if d.get("entrez_id") else None,
        "ensemblGeneId": d.get("ensembl_gene_id"),
        "uniprotIds": sorted(d.get("uniprot_ids") or []),
        "locusGroup": d.get("locus_group"),
        "location": d.get("location"),
    }


def _num(v: Any) -> float | None:
    try:
        return None if v is None else round(float(v), 2)
    except (TypeError, ValueError):
        return None


def parse_homology(raw: dict, species: list[dict]) -> list[dict]:
    """Orthologues reported by Ensembl Compara in the comparison species, as reported."""
    wanted = {s["ensembl"] for s in species if s["role"] == "comparison"}
    out = []
    for entry in raw.get("data") or []:
        for h in entry.get("homologies") or []:
            t = h.get("target") or {}
            s = h.get("source") or {}
            if not str(h.get("type", "")).startswith("ortholog") or t.get("species") not in wanted:
                continue
            out.append(
                {
                    "species": t.get("species"),
                    "taxonId": t.get("taxon_id"),
                    "type": h.get("type"),
                    "geneId": t.get("id"),
                    "proteinId": t.get("protein_id"),
                    "sourceProteinId": s.get("protein_id"),
                    "percId": _num(t.get("perc_id")),
                    "percPos": _num(t.get("perc_pos")),
                    "sourcePercId": _num(s.get("perc_id")),
                    "taxonomyLevel": h.get("taxonomy_level"),
                    "dnDs": _num(h.get("dn_ds")),
                    "method": h.get("method_link_type"),
                }
            )
    return sorted(out, key=lambda o: (o["species"] or "", o["geneId"] or ""))


def parse_lookup_gene(raw: dict) -> dict:
    """An Ensembl gene record (lookup/id, no expansion), reduced to what the review needs."""
    loc = None
    if raw.get("seq_region_name") and raw.get("start") and raw.get("end"):
        loc = f"{raw['seq_region_name']}:{raw['start']}-{raw['end']}"
    return {
        "id": raw.get("id"),
        "version": raw.get("version"),
        "symbol": raw.get("display_name"),
        "biotype": raw.get("biotype"),
        "assembly": raw.get("assembly_name"),
        "location": loc,
        "source": raw.get("source"),
        "description": raw.get("description"),
    }


def parse_lookup_translation(raw: dict) -> int | None:
    """The length, in amino acids, of an Ensembl translation (lookup/id on a protein ID)."""
    n = raw.get("length")
    return int(n) if isinstance(n, (int, float)) else None


def with_models(orthologues: list[dict], genes: dict[str, dict], proteins: dict[str, int | None]) -> list[dict]:
    """Each orthologue with the other species' gene record and both aligned proteins' lengths."""
    out = []
    for o in orthologues:
        out.append(
            {
                **o,
                "model": {
                    "targetGene": genes.get(o.get("geneId") or ""),
                    "targetProteinLength": proteins.get(o.get("proteinId") or ""),
                    "sourceProteinLength": proteins.get(o.get("sourceProteinId") or ""),
                },
            }
        )
    return out


def parse_taxonomy(raw: Any, taxon_id: int) -> list[dict]:
    """The ancestors Ensembl reports for a taxon, as an unordered set of {id, name}.

    Only the nodes themselves are read, never their `children` (which hold
    sibling taxa). Order is not used: the comparison view groups species by
    the ancestors they share.
    """
    nodes: list[dict] = []
    if isinstance(raw, list):
        nodes = [n for n in raw if isinstance(n, dict)]
    elif isinstance(raw, dict):
        n: Any = raw
        while isinstance(n, dict):
            nodes.append(n)
            n = n.get("parent")
    out = {}
    for n in nodes:
        nid = str(n.get("id", ""))
        name = n.get("scientific_name") or n.get("name")
        if nid and name and nid != str(taxon_id):
            out[nid] = {"id": nid, "name": name}
    return sorted(out.values(), key=lambda a: int(a["id"]) if a["id"].isdigit() else 0)


def parse_hpo(text: str, symbols: set[str]) -> tuple[list[dict], list[str]]:
    """Rows of genes_to_phenotype.txt for the given genes, and the file's column names."""
    lines = text.splitlines()
    header = next((ln for ln in lines if ln.strip()), "")
    cols = [c.strip().lstrip("#").strip() for c in header.split("\t")]
    lower = [c.lower() for c in cols]

    def col(*names: str) -> int | None:
        return next((lower.index(n) for n in names if n in lower), None)

    i_sym, i_hpo, i_name = col("gene_symbol"), col("hpo_id"), col("hpo_name")
    if None in (i_sym, i_hpo, i_name):
        raise SourceError(f"HPO {HPO_FILE}: expected gene_symbol, hpo_id and hpo_name columns, found {cols}.")
    i_freq, i_dis, i_gene = col("frequency"), col("disease_id"), col("ncbi_gene_id", "gene_id")
    out = []
    for ln in lines[lines.index(header) + 1 :]:
        f = ln.split("\t")
        if len(f) <= max(i_sym, i_hpo, i_name) or f[i_sym] not in symbols:
            continue
        get = lambda i: (f[i].strip() or None) if i is not None and i < len(f) else None  # noqa: E731
        out.append(
            {
                "symbol": f[i_sym],
                "hpoId": f[i_hpo],
                "name": f[i_name],
                "frequency": get(i_freq),
                "diseaseId": get(i_dis),
                "ncbiGeneId": get(i_gene),
            }
        )
    return out, cols


# ---------------------------------------------------------------- capture


class LibraryCapture:
    """The library's capture into a staging folder; `commit` moves it into place."""

    def __init__(self, cfg: dict, licences: dict, *, fetch: Fetch = http_fetch, pause: float = 0.15) -> None:
        self.cfg = cfg
        self.licences = licences
        self.fetch = fetch
        self.pause = pause
        self.stage = pathlib.Path(tempfile.mkdtemp(prefix="library-"))
        self.files: list[dict] = []
        self.sources: list[dict] = []

    def cleanup(self) -> None:
        shutil.rmtree(self.stage, ignore_errors=True)

    def denied(self, step: str) -> str:
        for action in ("fetch", "store"):
            ok, reason = permitted(self.licences, LICENCE[step], action)
            if not ok:
                return reason
        return ""

    def record(self, step: str, status: str, reason: str = "", **extra: Any) -> None:
        entry = {"step": step, "licenceId": LICENCE[step], "status": status, **extra}
        if reason:
            entry["reason"] = reason
        self.sources.append(entry)

    def get(self, url: str, accept: str = "application/json") -> bytes:
        status, _headers, body = self.fetch(url, accept)
        if not 200 <= status < 300:
            raise SourceError(f"{url}: HTTP {status}")
        if self.pause:
            time.sleep(self.pause)
        return body

    def keep(self, name: str, url: str, body: bytes, *, stored: bytes | None = None, note: str = "") -> None:
        data = body if stored is None else stored
        path = self.stage / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.files.append(
            {
                "file": name,
                "url": url,
                "retrievedAt": now(),
                "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "storedBytes": len(data),
                "storedSha256": hashlib.sha256(data).hexdigest(),
                **({"note": note} if note else {}),
            }
        )
        print(f"  {len(body):>9} B  {name}  <- {url}")

    def save(self, name: str, url: str, accept: str = "application/json") -> bytes:
        body = self.get(url, accept)
        self.keep(name, url, body)
        return body

    def run_step(self, step: str, fn: Callable[[], Any]) -> Any:
        refused = self.denied(step)
        if refused:
            self.record(step, "withheld", f"Withheld by the source policy: {refused}")
            return None
        try:
            out = fn()
        except Exception as e:  # noqa: BLE001 - recorded; other sources continue
            self.record(step, "failed", str(e))
            print(f"  FAILED {step}: {e}")
            return None
        self.record(step, "ok")
        return out

    # ------------------------------------------------------------ sources

    def clingen(self) -> list[dict]:
        body = self.save("clingen_gene_validity.csv", CLINGEN_CSV, "text/csv")
        rows, columns = parse_clingen_csv(body.decode("utf-8", errors="replace"))
        self.clingen_columns = columns
        print(f"  ClinGen: {len(rows)} curations")
        return select_curations(rows, self.cfg["conditions"])

    def hgnc(self, symbol: str, hgnc_id: str | None) -> dict:
        url = f"{HGNC}/fetch/symbol/{urllib.parse.quote(symbol)}"
        rec = parse_hgnc(json.loads(self.get(url)))
        if rec is None and hgnc_id:
            # The curation may carry a previous symbol; its HGNC ID is stable.
            url = f"{HGNC}/fetch/hgnc_id/{urllib.parse.quote(hgnc_id)}"
            rec = parse_hgnc(json.loads(self.get(url)))
        if rec is None:
            raise SourceError(f"HGNC has no single record for {symbol} ({hgnc_id}).")
        self.keep(f"hgnc/{symbol}.json", url, json.dumps(rec, sort_keys=True).encode(), note="Fields used")
        return rec

    def ensembl_release(self) -> list[int]:
        raw = json.loads(self.save("ensembl/info_data.json", f"{ENSEMBL}/info/data?content-type=application/json"))
        return sorted(int(r) for r in raw.get("releases") or [])

    def homology(self, symbol: str, ensg: str) -> list[dict]:
        targets = ";".join(f"target_species={s['ensembl']}" for s in self.cfg["species"] if s["role"] == "comparison")
        q = f"?content-type=application/json;type=orthologues;sequence=none;format=full;{targets}"
        name = f"ensembl/homology_{symbol}.json"
        try:
            body = self.save(name, f"{ENSEMBL}/homology/id/human/{urllib.parse.quote(ensg)}{q}")
        except SourceError as first:
            # Older Ensembl releases take the gene ID without the species.
            try:
                body = self.save(name, f"{ENSEMBL}/homology/id/{urllib.parse.quote(ensg)}{q}")
            except SourceError:
                raise first from None
        return parse_homology(json.loads(body), self.cfg["species"])

    def gene_models(self, orthologues: list[dict]) -> list[dict]:
        """Look up each orthologue's gene and both aligned proteins in Ensembl, to check gene models."""
        genes: dict[str, dict] = {}
        proteins: dict[str, int | None] = {}
        q = "?content-type=application/json"
        for o in orthologues:
            gid = o.get("geneId")
            if gid and gid not in genes:
                genes[gid] = parse_lookup_gene(
                    json.loads(self.save(f"ensembl/lookup/{gid}.json", f"{ENSEMBL}/lookup/id/{urllib.parse.quote(gid)}{q}"))
                )
            for pid in (o.get("proteinId"), o.get("sourceProteinId")):
                if pid and pid not in proteins:
                    proteins[pid] = parse_lookup_translation(
                        json.loads(self.save(f"ensembl/lookup/{pid}.json", f"{ENSEMBL}/lookup/id/{urllib.parse.quote(pid)}{q}"))
                    )
        return with_models(orthologues, genes, proteins)

    def taxonomy(self, taxon_id: int) -> list[dict]:
        url = f"{ENSEMBL}/taxonomy/classification/{taxon_id}?content-type=application/json"
        return parse_taxonomy(json.loads(self.save(f"ensembl/taxonomy_{taxon_id}.json", url)), taxon_id)

    def hpo(self, symbols: set[str]) -> dict:
        release = json.loads(self.get(HPO_RELEASE, "application/vnd.github+json"))
        asset = next((a for a in release.get("assets") or [] if a.get("name") == HPO_FILE), None)
        if asset is None:
            raise SourceError(f"HPO release {release.get('tag_name')} has no {HPO_FILE}.")
        url = asset["browser_download_url"]
        body = self.get(url, "text/plain")
        rows, cols = parse_hpo(body.decode("utf-8", errors="replace"), symbols)
        extract = "\t".join(["symbol", "hpoId", "name", "frequency", "diseaseId", "ncbiGeneId"]) + "\n"
        extract += "".join(
            "\t".join(r[k] or "" for k in ("symbol", "hpoId", "name", "frequency", "diseaseId", "ncbiGeneId")) + "\n"
            for r in sorted(rows, key=lambda r: (r["symbol"], r["hpoId"], r["diseaseId"] or ""))
        )
        self.keep(
            "hpo/genes_to_phenotype.extract.tsv",
            url,
            body,
            stored=extract.encode(),
            note=f"Rows for library genes only; bytes and sha256 are of the full release file. Columns: {cols}",
        )
        return {"release": release.get("tag_name"), "published": release.get("published_at"), "rows": rows}

    # ------------------------------------------------------------ run

    def run(self) -> dict:
        captured = now()
        curations = self.run_step("clingen", self.clingen) or []
        symbols = sorted({c["symbol"] for c in curations})
        genes: dict[str, dict] = {}
        for s in symbols:
            hgnc_id = next((c["hgncId"] for c in curations if c["symbol"] == s and c.get("hgncId")), None)
            genes[s] = {"symbol": s, "curations": [c for c in curations if c["symbol"] == s], "hgncIdClinGen": hgnc_id}

        if symbols:
            hgnc_status: dict[str, str] = {}
            for s in symbols:
                rec = self.run_step("hgnc", lambda s=s: self.hgnc(s, genes[s]["hgncIdClinGen"]))
                genes[s]["hgnc"] = rec
                hgnc_status[s] = self.sources[-1]["status"]
            releases = self.run_step("ensembl_release", self.ensembl_release)
            for s in symbols:
                ensg = (genes[s].get("hgnc") or {}).get("ensemblGeneId")
                if ensg:
                    genes[s]["orthologues"] = self.run_step("homology", lambda s=s, e=ensg: self.homology(s, e))
                    genes[s]["homologyStatus"] = self.sources[-1]["status"]
                    if genes[s]["orthologues"]:
                        checked = self.run_step("gene_models", lambda o=genes[s]["orthologues"]: self.gene_models(o))
                        if checked is not None:
                            genes[s]["orthologues"] = checked
                else:
                    self.record("homology", "skipped", f"{s}: no Ensembl gene ID from HGNC.")
                    genes[s]["orthologues"] = None
                    genes[s]["homologyStatus"] = "skipped"
            ancestors = {}
            for sp in self.cfg["species"]:
                ancestors[sp["taxonId"]] = self.run_step("taxonomy", lambda t=sp["taxonId"]: self.taxonomy(t))
            hpo = self.run_step("hpo", lambda: self.hpo(set(symbols)))
        else:
            releases, ancestors, hpo = None, {}, None

        statuses = [x["status"] for x in self.sources]
        manifest = {
            "schemaVersion": SCHEMA,
            "tool": TOOL,
            "libraryVersion": self.cfg["libraryVersion"],
            "capturedAt": captured,
            "complete": bool(symbols) and all(st in ("ok", "withheld") for st in statuses),
            "conditions": self.cfg["conditions"],
            "species": self.cfg["species"],
            "clingenColumns": getattr(self, "clingen_columns", None),
            "ensemblReleases": releases,
            "hpoRelease": (hpo or {}).get("release"),
            "hpoPublished": (hpo or {}).get("published"),
            "sources": self.sources,
            "files": sorted(self.files, key=lambda f: f["file"]),
            "note": "Raw responses as received, except: HGNC records are reduced to the fields used, and HPO's "
            "annotation file to the rows for library genes (bytes and sha256 describe the full file). "
            "ensembl/lookup/ holds the gene and protein records behind each orthologue, for checking gene models.",
        }
        # Parsed results, so the display copy can be rebuilt without the network.
        parsed = {
            "genes": [
                {
                    "symbol": g["symbol"],
                    "curations": g["curations"],
                    "hgnc": g.get("hgnc"),
                    "orthologues": g.get("orthologues"),
                    "homologyStatus": g.get("homologyStatus"),
                }
                for g in genes.values()
            ],
            "ancestors": {str(k): v for k, v in ancestors.items()},
            "hpoRows": (hpo or {}).get("rows"),
        }
        (self.stage / "parsed.json").write_text(dump(parsed))
        (self.stage / "manifest.json").write_text(dump(manifest))
        sums = "".join(f"{f['storedSha256']}  {f['file']}\n" for f in manifest["files"])
        (self.stage / "SHA256SUMS").write_text(sums)
        return manifest

    def commit(self, out_dir: pathlib.Path) -> None:
        if out_dir.exists():
            shutil.rmtree(out_dir)
        out_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(self.stage, out_dir)


# ---------------------------------------------------------------- display copy


def build_display(out_dir: pathlib.Path, licences: dict) -> dict:
    """The display copy: only what the app shows, from sources whose display is permitted."""
    manifest = load_json(out_dir / "manifest.json")
    parsed = load_json(out_dir / "parsed.json")
    shown = {lid: permitted(licences, lid, "display") for lid in SOURCE_NAME}
    ok = {lid for lid, (allowed, _) in shown.items() if allowed}

    def file_ref(prefix: str) -> list[dict]:
        return [
            {k: f[k] for k in ("file", "url", "retrievedAt", "sha256")}
            for f in manifest["files"]
            if f["file"].startswith(prefix)
        ]

    def status(step: str) -> str:
        sts = [s["status"] for s in manifest["sources"] if s["step"] == step]
        if not sts:
            return "not-run"
        if all(x == "ok" for x in sts):
            return "ok"
        if all(x == "withheld" for x in sts):
            return "withheld"
        return "partial" if any(x == "ok" for x in sts) else sts[0]

    hpo_by_gene: dict[str, dict[str, dict]] = {}
    for r in parsed.get("hpoRows") or []:
        term = hpo_by_gene.setdefault(r["symbol"], {}).setdefault(
            r["hpoId"], {"hpoId": r["hpoId"], "name": r["name"], "frequencies": set(), "diseaseIds": set()}
        )
        if r.get("frequency"):
            term["frequencies"].add(r["frequency"])
        if r.get("diseaseId"):
            term["diseaseIds"].add(r["diseaseId"])

    genes = []
    for g in sorted(parsed["genes"], key=lambda g: g["symbol"]):
        h = g.get("hgnc") if "hgnc-rest" in ok else None
        idcheck = None
        if h and g["curations"][0].get("hgncId"):
            idcheck = "agree" if h.get("hgncId") == g["curations"][0]["hgncId"] else "differ"
        terms = None
        if "hpo-annotations" in ok and parsed.get("hpoRows") is not None:
            terms = [
                {**t, "frequencies": sorted(t["frequencies"]), "diseaseIds": sorted(t["diseaseIds"])}
                for t in sorted(hpo_by_gene.get(g["symbol"], {}).values(), key=lambda t: t["name"].lower())
            ]
        genes.append(
            {
                "symbol": g["symbol"],
                "hgnc": h,
                "hgncIdCheck": idcheck,
                "curations": [
                    {k: c.get(k) for k in ("condition", *CLINGEN_COLUMNS.keys()) if k != "symbol"}
                    for c in g["curations"]
                ]
                if "clingen-gene-validity" in ok
                else [],
                "orthologues": g.get("orthologues") if "ensembl-compara" in ok else None,
                "orthologueStatus": g.get("homologyStatus") if "ensembl-compara" in ok else "withheld",
                "phenotypes": terms,
                "files": file_ref(f"hgnc/{g['symbol']}.")
                + file_ref(f"ensembl/homology_{g['symbol']}.")
                + [
                    f
                    for f in file_ref("ensembl/lookup/")
                    if f["file"].removeprefix("ensembl/lookup/").removesuffix(".json")
                    in {
                        x
                        for o in (g.get("orthologues") or [])
                        for x in (o.get("geneId"), o.get("proteinId"), o.get("sourceProteinId"))
                        if x
                    }
                ],
            }
        )
    species = []
    for sp in manifest["species"]:
        anc = parsed["ancestors"].get(str(sp["taxonId"])) if "ensembl-compara" in ok else None
        species.append({**sp, "ancestors": anc})
    sources = []
    for lid, name in SOURCE_NAME.items():
        sts = {status(step) for step, l in LICENCE.items() if l == lid} - {"not-run"}
        if lid not in ok:
            st = "withheld"
        elif not sts:
            st = "not-run"
        elif sts == {"ok"}:
            st = "ok"
        else:
            st = "failed" if sts <= {"failed", "skipped"} else "partial"
        refs = file_ref(SOURCE_FILES[lid])
        sources.append(
            {
                "id": lid,
                "name": name,
                "status": st,
                "retrievedAt": max((f["retrievedAt"] for f in refs), default=None),
                "fileCount": len(refs),
                # One representative file per source; each gene lists its own.
                "file": refs[0] if refs and lid in ("clingen-gene-validity", "hpo-annotations") else None,
                **({"reason": shown[lid][1]} if lid not in ok else {}),
            }
        )
    counts = {
        c["key"]: len({g["symbol"] for g in genes for x in g["curations"] if x["condition"] == c["key"]})
        for c in manifest["conditions"]
    }
    return {
        "schemaVersion": SCHEMA,
        "mode": "snapshot",
        "notice": NOTICE,
        "tool": TOOL,
        "libraryVersion": manifest["libraryVersion"],
        "capturedAt": manifest["capturedAt"],
        "complete": manifest["complete"],
        "releases": {"ensembl": (manifest.get("ensemblReleases") or [None])[-1], "hpo": manifest.get("hpoRelease")},
        "conditions": [{**c, "geneCount": counts[c["key"]]} for c in manifest["conditions"]],
        "species": species,
        "sources": sources,
        "genes": genes,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--allow-partial", action="store_true", help="write the capture even if some sources failed")
    ap.add_argument("--build-only", action="store_true", help="rebuild the display copy from the stored capture")
    ap.add_argument("--out-dir", type=pathlib.Path, default=OUT_DIR)
    ap.add_argument("--display-file", type=pathlib.Path, default=DISPLAY_FILE)
    ap.add_argument("--config-dir", type=pathlib.Path, default=CONFIG)
    a = ap.parse_args(argv)
    licences = load_json(a.config_dir / "licences.json")
    if not a.build_only:
        cap = LibraryCapture(load_json(a.config_dir / "library.json"), licences)
        try:
            manifest = cap.run()
            if all(s["status"] == "withheld" for s in manifest["sources"]):
                print("ERROR no source is allowed; nothing written.", file=sys.stderr)
                return 3
            if not manifest["complete"] and not a.allow_partial:
                for s in manifest["sources"]:
                    if s["status"] not in ("ok", "withheld"):
                        print(f"  {s['status']}: {s['step']}: {s.get('reason', '')}", file=sys.stderr)
                print("ERROR capture incomplete; the existing library was left unchanged.", file=sys.stderr)
                return 1
            cap.commit(a.out_dir)
            print(f"   {len(manifest['files'])} files -> {a.out_dir}")
        finally:
            cap.cleanup()
    display = build_display(a.out_dir, licences)
    a.display_file.parent.mkdir(parents=True, exist_ok=True)
    a.display_file.write_text(dump(display))
    print(f"   {len(display['genes'])} genes -> {a.display_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
