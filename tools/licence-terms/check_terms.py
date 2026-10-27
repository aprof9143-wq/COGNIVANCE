"""Fetch every terms page named in config/genome/licences.json and record what was seen.

For each URL it records the HTTP status, the final URL after redirects, the
time, the size and the SHA-256 of the page as served, in
docs/genome/terms-check.json. The page itself is not stored (it is the
provider's copyrighted text); lines that mention licences, commercial use,
attribution or restrictions are printed to the job log for a person to read.

This records evidence for a review. It does not decide anything: approval for
commercial-pilot use is a person's decision, recorded in licences.json.

Run by .github/workflows/licence-terms.yml (the build sandbox cannot reach
these hosts). Standard library only.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
INVENTORY = ROOT / "config" / "genome" / "licences.json"
OUT = ROOT / "docs" / "genome" / "terms-check.json"
UA = "Cognivance-licence-terms-check/1 (+https://github.com/aprof9143-wq/COGNIVANCE)"
KEYWORDS = re.compile(r"licen[cs]e|commercial|attribut|restrict|copyright|cc[- ]by|cc0|public domain|terms of use|permission", re.I)


def visible_text(raw: bytes, content_type: str) -> str:
    text = raw.decode("utf-8", errors="replace")
    if "html" in content_type:
        text = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", text)
        text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h\d|tr)>", "\n", text)
        text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return "\n".join(line for line in (re.sub(r"\s+", " ", l).strip() for l in text.splitlines()) if line)


def check(url: str) -> dict:
    entry: dict = {"url": url, "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/pdf,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            ctype = r.headers.get("Content-Type", "")
            entry.update(
                status=r.status,
                finalUrl=r.geturl(),
                contentType=ctype,
                bytes=len(body),
                sha256=hashlib.sha256(body).hexdigest(),
                lastModified=r.headers.get("Last-Modified"),
            )
    except Exception as e:  # noqa: BLE001 - recorded, not fatal
        entry.update(status=None, error=str(e))
        print(f"!! {url}: {e}")
        return entry
    print(f"\n==== {url} -> {entry['finalUrl']} ({entry['status']}, {len(body)} B)")
    if "pdf" in ctype:
        print("   (PDF: read it directly; its SHA-256 is recorded)")
    else:
        lines = [l for l in visible_text(body, ctype).splitlines() if KEYWORDS.search(l)]
        for line in lines[:40]:
            print("   | " + line[:400])
    return entry


def main() -> int:
    inv = json.loads(INVENTORY.read_text())
    results = []
    for item in inv["items"]:
        for url in item.get("termsUrls", []):
            results.append({"id": item["id"], **check(url)})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "note": "Evidence that each terms page was fetched, and what it hashed to. Not a review outcome.",
                "inventoryVersion": inv["inventoryVersion"],
                "pages": sorted(results, key=lambda r: (r["id"], r["url"])),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    failed = [r for r in results if r.get("status") != 200]
    print(f"\n{len(results) - len(failed)} of {len(results)} pages fetched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
