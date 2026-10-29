"""Render docs/genome/LICENCES.md from config/genome/licences.json.

Run after editing the inventory: python tools/licence-terms/render_inventory.py
A test (src/lib/genome/config.test.ts) checks the page lists the same items.
"""

from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
INVENTORY = ROOT / "config" / "genome" / "licences.json"
OUT = ROOT / "docs" / "genome" / "LICENCES.md"

INTRO = """\
**This is not legal advice and reaches no legal conclusion.** Software licences and data/service terms are
recorded separately. A public API, or a permissive licence on a provider's software, is not taken to mean the
data may be used commercially.

## How this review was done

- **Software licences** of bundled libraries were read from their licence files in `node_modules` and
  upstream, on 2026-10-27.
- **Data and service terms:**
  - The build environment cannot reach the providers' sites (DNS failure). Web search returned only secondary
    copies and summaries, which this review does not rely on.
  - Instead, `.github/workflows/licence-terms.yml` fetches every terms URL below from GitHub's runner. It
    records status, final URL, time and SHA-256 in [`terms-check.json`](terms-check.json) and prints the
    licence-related lines to the job log.
  - Quotations below come from that log. Where a page is rendered by JavaScript or is a PDF that was not
    read, the item stays **unverified**.
- **Approval rule:** an item is `approved` for commercial-pilot use only after a named person has reviewed its
  current terms. **No item is approved.** In commercial-pilot mode the capture tool and `assertSourceAllowed`
  refuse every unapproved item.
- **Separate decisions per action.** Each data source records whether it may be fetched, stored, displayed and
  redistributed for research and demo use (`permissions`), with the basis for that decision. Only `allowed`
  permits an action; `pending-review`, `unknown`, `denied` or a missing entry refuse it. Commercial-pilot use
  also needs `commercialPilot: approved`, and clinical use needs `clinicalUse: approved` and the clinical release
  gate (`config/genome/governance/release-gate.json`). **No item is approved for either.** One policy enforces
  this everywhere: `src/lib/genome/policy.ts` in the app and `tools/vision-snapshot/policy.py` in the tools.
"""

LEGAL = """\
## Needs legal review

- **ClinVar: requires legal review.** It holds content submitted by third parties, which NCBI says may be
  protected by copyright. Reuse and redistribution of submitted records require legal review. Every action on
  ClinVar is denied: the capture tool no longer requests it, the previously captured ClinVar files were removed
  from the repository's working tree (listed with their digests in
  `data/genome/snapshot/rpe65/REDACTIONS.json`), and the app shows no ClinVar content. Earlier commits still
  contain those files; whether that history needs action is part of the legal review.
- **UniProt and AlphaFold DB: awaiting human review.** The CI runner could not extract their terms text. A
  person must read the current pages directly.
- **NCBI notice: app use blocked.** NCBI states that its disclaimer and copyright notice must be evident to
  users of a service built on its data. NCBI data use is **blocked for the app** (`appUse: blocked`) and the
  app enforces it. The notice's exact wording has not been verified from NCBI and is not reproduced anywhere in
  the app; it must come from NCBI's own pages, checked by a person, before the block can be lifted.
- **Redistribution of raw responses.** No source's redistribution is confirmed, so it is denied for all.
  Raw responses are kept in `data/genome/snapshot/`, which the website does not serve. The website serves only
  `public/vision/display/`: for sources whose display is permitted, the fields the app's parsers read, plus the
  AlphaFold model file the 3D view renders. Whether serving even these display fields is permitted, and what
  attribution must accompany them, needs confirming. EMBL-EBI's terms defer to original data owners' rights.
- **AlphaFold DB.** Its responses link AlphaMissense annotation files. AlphaMissense is a separate component,
  is not used, and must not be used before its own review.
- **Variant-effect predictors.** None is used. Some may carry non-commercial or registration terms. Each
  needs its own review before any use, and none may enter a commercial-pilot path until approved.

## Not in this inventory

Components of the wider web app that Genome v1 does not use are out of scope for this inventory: the MNI152
brain template (see `public/sim/NOTICE.md`), three.js and the UI libraries.
"""


def cell(v: object) -> str:
    return str(v if v not in (None, "") else "n/a").replace("|", "\\|")


def perms(i: dict) -> str:
    p = (i.get("permissions") or {}).get("research")
    if not p:
        return "none recorded (all refused)"
    return " / ".join(p[a] for a in ("fetch", "store", "display", "redistribute"))


def render(inv: dict) -> str:
    out = [
        "# Genome v1 licence inventory\n",
        f"Inventory version {inv['inventoryVersion']}, reviewed {inv['reviewedOn']}.\n",
        "- **Machine-readable copy:** `config/genome/licences.json`. The safeguards read that file.",
        "- **This page:** generated by `tools/licence-terms/render_inventory.py`. A test checks that it lists the same items as the JSON.\n",
        INTRO,
        "## Summary\n",
        "| Item | Kind | Used | Commercial use (per terms read) | Review status | Commercial pilot | App use | Research: fetch / store / display / redistribute | Clinical use |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for i in inv["items"]:
        out.append(
            f"| {i['name']} (`{i['id']}`) | {i['kind']} | {'yes' if i['used'] else 'no'} | "
            f"{i['commercialUse']} | {i['reviewStatus']} | **{i['commercialPilot']}** | "
            f"{'**blocked**' if i['appUse'] == 'blocked' else 'not restricted'} | {perms(i)} | "
            f"**{i['clinicalUse']}** |"
        )
    out.append("\n## Items\n")
    for i in inv["items"]:
        out.append(f"### {i['name']} (`{i['id']}`)\n")
        out.append("| Field | Value |\n| --- | --- |")
        for k, v in [
            ("Version / release", i["version"]),
            ("Supplies", i["supplies"]),
            ("Software licence", i["softwareLicence"]),
            ("Data / service terms", i["dataTerms"]),
            ("Commercial use", i["commercialUse"]),
            ("Attribution", i["attribution"]),
            ("Redistribution", i["redistribution"]),
            ("Terms URLs", ", ".join(f"<{u}>" for u in i["termsUrls"]) or "none recorded"),
            ("Terms checked on", i["termsCheckedOn"] or "not yet"),
            ("Review status", i["reviewStatus"]),
            ("Commercial pilot", f"**{i['commercialPilot']}**"),
            ("App use", "**blocked**: " + i.get("appUseCondition", "") if i["appUse"] == "blocked" else "not restricted"),
            ("Research permissions (fetch / store / display / redistribute)", perms(i)),
            ("Permission basis", (i.get("permissions") or {}).get("basis", "No data permissions recorded: every data action is refused.")),
            ("Clinical use", f"**{i['clinicalUse']}**"),
            ("Follow-up", i["followUp"]),
        ]:
            out.append(f"| {k} | {cell(v)} |")
        out.append("")
    out.append(LEGAL)
    return "\n".join(out)


if __name__ == "__main__":
    OUT.write_text(render(json.loads(INVENTORY.read_text())))
    print(f"wrote {OUT.relative_to(ROOT)}")
