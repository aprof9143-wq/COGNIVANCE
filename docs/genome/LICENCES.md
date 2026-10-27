# Genome v1 licence inventory

Inventory version 1.0.0, reviewed 2026-10-27. Machine-readable copy: `config/genome/licences.json`. The safeguards read that file, and a test checks that this page and the file list the same items.

**This is not legal advice and reaches no legal conclusion.** Software licences and data/service terms are recorded separately. A public API or a permissive software licence is not taken to mean the data may be used commercially.

## How this review was done

- **Software licences** of bundled libraries were read from their licence files in `node_modules` on 2026-10-27.
- **Data and service terms** could not be read from the authoritative pages: the build environment cannot reach ensembl.org, uniprot.org, alphafold.ebi.ac.uk, ncbi.nlm.nih.gov, genenames.org or rcsb.org (DNS failure). Web search returned only secondary copies and summaries, which this review does not rely on. Every data source is therefore **unverified** below.
- **Evidence for a reviewer:** `.github/workflows/licence-terms.yml` fetches every terms URL listed here from GitHub's runner. It records status, final URL, time and SHA-256 in [`terms-check.json`](terms-check.json) and prints the licence-related lines to the job log. This is evidence only; a person must read the current pages and record the outcome.
- **Approval rule:** an item is `approved` for commercial-pilot use only when a named person has reviewed it. **No item is approved.** In commercial-pilot mode the capture tool and `assertSourceAllowed` refuse every unapproved item.

## Summary

| Item | Kind | Used | Commercial use | Review status | Commercial pilot |
| --- | --- | --- | --- | --- | --- |
| Ensembl REST API (gene, transcript, sequence) (`ensembl-rest`) | data-source | yes | unverified | unverified | **not-approved** |
| UniProtKB REST API (`uniprot-rest`) | data-source | yes | unverified | unverified | **not-approved** |
| AlphaFold Protein Structure Database (API and model files) (`alphafold-db`) | data-source | yes | unverified | unverified | **not-approved** |
| NCBI ClinVar via E-utilities (esearch, esummary) (`clinvar-eutils`) | data-source | yes | unclear | needs-legal-review | **not-approved** |
| HGNC REST service (genenames.org) (`hgnc-rest`) | data-source | yes | unverified | unverified | **not-approved** |
| RCSB PDB file service (`rcsb-pdb`) | data-source | yes | unverified | unverified | **not-approved** |
| zod (`zod`) | library | yes | permitted | software-licence-checked | **not-approved** |
| Mol* (molstar) (`molstar`) | library | yes | permitted | software-licence-checked | **not-approved** |
| Python standard library (capture tool) (`python-stdlib`) | tool | yes | unverified | unverified | **not-approved** |
| AlphaMissense pathogenicity predictions (`alphamissense`) | predictor | no | unverified | not-reviewed | **not-approved** |
| Other variant effect predictors (e.g. CADD, REVEL, SpliceAI, PolyPhen-2, SIFT) (`other-variant-predictors`) | predictor | no | unverified | not-reviewed | **not-approved** |

## Items

### Ensembl REST API (gene, transcript, sequence) (`ensembl-rest`)

| Field | Value |
| --- | --- |
| Version / release | Ensembl release 116 (RPE65 snapshot, 2026-10-20) |
| Supplies | Gene coordinates (GRCh38), canonical transcript and exons, coding and genomic sequence, release number. |
| Software licence | Not applicable: only the public REST service is called; no Ensembl code is bundled. |
| Data / service terms | Ensembl disclaimer; EMBL-EBI terms of use. Not verified from the authoritative pages (unreachable from the build environment). |
| Commercial use | unverified |
| Attribution | Citation requested by Ensembl; confirm wording on the terms page. |
| Redistribution | Raw responses are redistributed in public/vision/snapshot/. Confirm this is permitted. |
| Terms URLs | <https://www.ensembl.org/info/about/legal/disclaimer.html>, <https://www.ebi.ac.uk/about/terms-of-use/> |
| Terms checked on | not yet |
| Review status | unverified |
| Commercial pilot | **not-approved** |
| Follow-up | Read the current disclaimer and EMBL-EBI terms; note any third-party data constraints the disclaimer mentions. |

### UniProtKB REST API (`uniprot-rest`)

| Field | Value |
| --- | --- |
| Version / release | UniProt release 2026_03 (X-UniProt-Release header, RPE65 snapshot) |
| Supplies | Reviewed protein entry: sequence, function, tissue, catalytic activity, cross-references (HGNC, Ensembl, Reactome, PDB). |
| Software licence | Not applicable: only the public REST service is called. |
| Data / service terms | Indicated as CC BY 4.0 by secondary sources; not verified from the authoritative page. |
| Commercial use | unverified |
| Attribution | If CC BY 4.0 is confirmed: attribution and a link to the licence are required. |
| Redistribution | Raw responses are redistributed in public/vision/snapshot/. Confirm attribution is displayed alongside. |
| Terms URLs | <https://www.uniprot.org/help/license>, <https://www.uniprot.org/help/copyright> |
| Terms checked on | not yet |
| Review status | unverified |
| Commercial pilot | **not-approved** |
| Follow-up | Confirm the licence and required attribution text; confirm cross-referenced content (e.g. Reactome names) carries no separate terms. |

### AlphaFold Protein Structure Database (API and model files) (`alphafold-db`)

| Field | Value |
| --- | --- |
| Version / release | Model AF-Q16518-F1 version 6 (RPE65 snapshot) |
| Supplies | Predicted structure coordinates and per-residue confidence (pLDDT). |
| Software licence | Not applicable: AlphaFold code and model parameters are not used or bundled. |
| Data / service terms | Indicated as CC BY 4.0 with EMBL-EBI terms by secondary sources; not verified from the authoritative page. The API also links AlphaMissense annotation files, which are a separate component (see alphamissense) and are not used. |
| Commercial use | unverified |
| Attribution | If CC BY 4.0 is confirmed: attribution and citation of the AlphaFold DB papers. |
| Redistribution | A model file is redistributed in public/vision/snapshot/. Confirm this is permitted. |
| Terms URLs | <https://alphafold.ebi.ac.uk/faq>, <https://alphafold.ebi.ac.uk/assets/License-Disclaimer.pdf>, <https://www.ebi.ac.uk/about/terms-of-use/> |
| Terms checked on | not yet |
| Review status | unverified |
| Commercial pilot | **not-approved** |
| Follow-up | Read the licence disclaimer PDF and FAQ; keep model parameters and AlphaMissense out of scope unless separately reviewed. |

### NCBI ClinVar via E-utilities (esearch, esummary) (`clinvar-eutils`)

| Field | Value |
| --- | --- |
| Version / release | No release number in the response; snapshot retrieved 2026-10-20 |
| Supplies | Submitted variant records for a gene: HGVS, classification, review status, conditions, GRCh38 location. |
| Software licence | Not applicable: only the public E-utilities service is called. |
| Data / service terms | NCBI policies and E-utilities usage guidelines. Government-created content is described as public domain by secondary sources, but ClinVar holds content submitted by third parties, which may carry its own rights. Not verified from the authoritative pages. |
| Commercial use | unclear |
| Attribution | NLM requests acknowledgment; confirm wording. |
| Redistribution | Raw esummary batches are redistributed in public/vision/snapshot/. Needs legal review because of submitter content. |
| Terms URLs | <https://www.ncbi.nlm.nih.gov/home/about/policies/>, <https://www.ncbi.nlm.nih.gov/books/NBK25497/>, <https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/> |
| Terms checked on | not yet |
| Review status | needs-legal-review |
| Commercial pilot | **not-approved** |
| Follow-up | Legal review of reuse and redistribution of submitted records; confirm E-utilities rate limits and the tool/email parameters NCBI asks for. |

### HGNC REST service (genenames.org) (`hgnc-rest`)

| Field | Value |
| --- | --- |
| Version / release | Recorded per capture (response timestamp); not yet captured |
| Supplies | Authoritative approved gene symbol and HGNC ID, with Ensembl and UniProt cross-references, used to validate the gene registry. |
| Software licence | Not applicable: only the public REST service is called. |
| Data / service terms | Indicated as CC0 by secondary sources; not verified from the authoritative page. |
| Commercial use | unverified |
| Attribution | Citation recommended (not required if CC0 is confirmed). |
| Redistribution | The HGNC response is saved in each gene's snapshot. |
| Terms URLs | <https://www.genenames.org/about/license/>, <https://www.genenames.org/help/rest/> |
| Terms checked on | not yet |
| Review status | unverified |
| Commercial pilot | **not-approved** |
| Follow-up | Confirm licence and REST usage limits. |

### RCSB PDB file service (`rcsb-pdb`)

| Field | Value |
| --- | --- |
| Version / release | Per entry; RPE65 has no experimental entry |
| Supplies | Experimental structure coordinates, when UniProt cross-references one (Vision structure stage). |
| Software licence | Not applicable. |
| Data / service terms | Shown in the app as CC0 1.0; not verified from the authoritative page. |
| Commercial use | unverified |
| Attribution | Citation of the entry and RCSB PDB requested; confirm. |
| Redistribution | Not redistributed: fetched live by the browser only. |
| Terms URLs | <https://www.rcsb.org/pages/usage-policy> |
| Terms checked on | not yet |
| Review status | unverified |
| Commercial pilot | **not-approved** |
| Follow-up | Confirm usage policy. |

### zod (`zod`)

| Field | Value |
| --- | --- |
| Version / release | 3.25.76 |
| Supplies | Schema validation of every source response. |
| Software licence | MIT (node_modules/zod/LICENSE, checked 2026-10-27) |
| Data / service terms | Not applicable. |
| Commercial use | permitted |
| Attribution | Keep the MIT copyright and permission notice in distributions. |
| Redistribution | Bundled into the web build. |
| Terms URLs | <https://github.com/colinhacks/zod/blob/main/LICENSE> |
| Terms checked on | 2026-10-27 |
| Review status | software-licence-checked |
| Commercial pilot | **not-approved** |
| Follow-up | Named reviewer sign-off; confirm notices are shipped with the build. |

### Mol* (molstar) (`molstar`)

| Field | Value |
| --- | --- |
| Version / release | 5.12.0 |
| Supplies | 3D structure viewer for the predicted protein model. |
| Software licence | MIT (node_modules/molstar/LICENSE, checked 2026-10-27) |
| Data / service terms | Not applicable. |
| Commercial use | permitted |
| Attribution | Keep the MIT notice; Mol* asks that publications cite it. |
| Redistribution | Bundled into the web build. |
| Terms URLs | <https://github.com/molstar/molstar/blob/master/LICENSE> |
| Terms checked on | 2026-10-27 |
| Review status | software-licence-checked |
| Commercial pilot | **not-approved** |
| Follow-up | Named reviewer sign-off; confirm notices are shipped with the build. |

### Python standard library (capture tool) (`python-stdlib`)

| Field | Value |
| --- | --- |
| Version / release | Python 3.12 on the CI runner |
| Supplies | HTTP, gzip, hashing and JSON for tools/vision-snapshot/capture.py. |
| Software licence | PSF License (not re-checked in this review) |
| Data / service terms | Not applicable. |
| Commercial use | unverified |
| Attribution | Not distributed: runs only in CI. |
| Redistribution | Not redistributed. |
| Terms URLs | <https://docs.python.org/3/license.html> |
| Terms checked on | not yet |
| Review status | unverified |
| Commercial pilot | **not-approved** |
| Follow-up | Confirm; low priority because nothing is distributed. |

### AlphaMissense pathogenicity predictions (`alphamissense`)

| Field | Value |
| --- | --- |
| Version / release | n/a |
| Supplies | Not used. Linked from AlphaFold DB API responses (amAnnotationsUrl); not downloaded or shown. |
| Software licence | Not reviewed. |
| Data / service terms | Not reviewed. Predictor scores are separately licensed and some predictors are distributed under non-commercial terms. |
| Commercial use | unverified |
| Attribution | Not reviewed. |
| Redistribution | Not redistributed. |
| Terms URLs | none recorded |
| Terms checked on | not yet |
| Review status | not-reviewed |
| Commercial pilot | **not-approved** |
| Follow-up | Review terms before any use; must not enter a commercial-pilot path until approved. |

### Other variant effect predictors (e.g. CADD, REVEL, SpliceAI, PolyPhen-2, SIFT) (`other-variant-predictors`)

| Field | Value |
| --- | --- |
| Version / release | n/a |
| Supplies | Not used and not planned for Genome v1. |
| Software licence | Not reviewed. |
| Data / service terms | Not reviewed. Each predictor's scores and software must be reviewed separately; some may carry non-commercial or registration terms. |
| Commercial use | unverified |
| Attribution | Not reviewed. |
| Redistribution | Not redistributed. |
| Terms URLs | none recorded |
| Terms checked on | not yet |
| Review status | not-reviewed |
| Commercial pilot | **not-approved** |
| Follow-up | Per-predictor review before any use. |

## Needs legal review

- **ClinVar.** It holds content submitted by third parties. Reuse and redistribution of submitted records, including the raw esummary batches committed in `public/vision/snapshot/`, need legal review whatever the status of NCBI-created content.
- **Redistribution of raw responses.** Raw responses from every source are committed and served from `public/vision/snapshot/`. Whether each provider's terms allow this, and what attribution must accompany it, is unconfirmed.
- **AlphaFold DB.** Its responses link AlphaMissense annotation files. AlphaMissense is a separate component, is not used, and must not be used before its own review.
- **Variant-effect predictors.** None is used. Some may carry non-commercial or registration terms. Each needs its own review before any use, and none may enter a commercial-pilot path until approved.

## Not in this inventory

Components of the wider web app that Genome v1 does not use are out of scope for this inventory: the MNI152 brain template (see `public/sim/NOTICE.md`), three.js and the UI libraries.
