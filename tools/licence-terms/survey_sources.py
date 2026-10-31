"""Render candidate sources' pages in a browser and print what they say, for a person to read.

For every URL in config/genome/source-candidates.json, and for links on those
pages whose text names terms, licences, citation, downloads, releases or
updates, it opens the page in headless Chromium (so pages built by JavaScript
are read too) and prints the page's visible text to the job log. It records
the status, final URL, title, time and the SHA-256 of the visible text in
docs/genome/source-survey.json. The text itself is not stored: it is the
provider's copyrighted text.

This gathers evidence for a review. It decides nothing, and no candidate is
used by the app because it appears here.

Run by .github/workflows/licence-terms.yml (the build sandbox cannot reach
these hosts). Needs the playwright package and its Chromium.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import pathlib
import re
import sys
from urllib.parse import urljoin, urlparse

ROOT = pathlib.Path(__file__).resolve().parents[2]
CANDIDATES = ROOT / "config" / "genome" / "source-candidates.json"
OUT = ROOT / "docs" / "genome" / "source-survey.json"
FOLLOW = re.compile(
    r"terms|licen[cs]e|cit(e|ing|ation)|attribution|copyright|disclaimer|legal|download|release|update|about|policy|polic(y|ies)|agreement",
    re.I,
)
MAX_FOLLOW = 6
MAX_LINES = 160


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def clean(text: str) -> list[str]:
    seen, out = set(), []
    for line in (re.sub(r"\s+", " ", l).strip() for l in text.splitlines()):
        if line and line not in seen:
            seen.add(line)
            out.append(line)
    return out


def visit(page, url: str) -> tuple[dict, list[tuple[str, str]]]:
    entry: dict = {"url": url, "checkedAt": now()}
    try:
        resp = page.goto(url, wait_until="domcontentloaded", timeout=45000)
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:  # noqa: BLE001 - some pages never go idle
            pass
        page.wait_for_timeout(1500)
        text = page.evaluate("() => document.body ? document.body.innerText : ''")
        links = page.evaluate(
            "() => [...document.querySelectorAll('a[href]')].map(a => [a.innerText.trim(), a.getAttribute('href')])"
        )
        lines = clean(text)
        entry.update(
            status=resp.status if resp else None,
            finalUrl=page.url,
            title=page.title(),
            textChars=len(text),
            textSha256=hashlib.sha256(text.encode()).hexdigest(),
        )
    except Exception as e:  # noqa: BLE001 - recorded, not fatal
        entry.update(status=None, error=str(e)[:300])
        print(f"\n!! {url}: {str(e)[:300]}")
        return entry, []
    print(f"\n==== {url} -> {entry['finalUrl']} ({entry['status']}) {entry['title']!r}")
    for line in lines[:MAX_LINES]:
        print("   | " + line[:600])
    if len(lines) > MAX_LINES:
        print(f"   | ... {len(lines) - MAX_LINES} more lines")
    found = []
    for label, href in links:
        if not href or href.startswith(("mailto:", "javascript:", "#")):
            continue
        if FOLLOW.search(label or "") or FOLLOW.search(urlparse(href).path):
            found.append((label[:80], urljoin(page.url, href)))
    return entry, found


def main() -> int:
    from playwright.sync_api import sync_playwright

    cfg = json.loads(CANDIDATES.read_text())
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent="Mozilla/5.0 (X11; Linux x86_64) Cognivance-source-survey/1")
        for c in cfg["candidates"]:
            print(f"\n######## {c['id']}: {c['name']}\n######## {c['question']}")
            seen: set[str] = set()
            followed: list[tuple[str, str]] = []
            for url in c["urls"]:
                seen.add(url)
                entry, links = visit(page, url)
                results.append({"id": c["id"], "via": None, **entry})
                followed += links
            n = 0
            for label, url in followed:
                key = url.split("#")[0]
                if key in seen or n >= MAX_FOLLOW:
                    continue
                if not re.search(r"terms|licen|cit|attribution|copyright|disclaimer|legal|agreement|download|update|release", label + url, re.I):
                    continue
                seen.add(key)
                n += 1
                entry, _ = visit(page, key)
                results.append({"id": c["id"], "via": label, **entry})
        browser.close()
    OUT.write_text(
        json.dumps(
            {
                "note": "Evidence that each candidate page was rendered and what its visible text hashed to. The text is printed in the job log, not stored. Not a review outcome.",
                "pages": sorted(results, key=lambda r: (r["id"], r["url"])),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    ok = sum(1 for r in results if r.get("status") == 200)
    print(f"\n{ok} of {len(results)} pages rendered with HTTP 200")
    return 0


if __name__ == "__main__":
    sys.exit(main())
