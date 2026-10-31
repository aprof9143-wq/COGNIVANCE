# Terms of use: ClinGen and HPO

Read on **2026-10-31** from each provider's own pages, rendered in a browser by the licence-terms workflow
(run 41200763872). Page hashes are in `source-survey.json`. The quotes below are copied from those pages.

**This is a reading of the terms, not a legal review.** No named reviewer has confirmed it. Until one does:
- the licence inventory keeps redistribution of every source at "pending review";
- no source is marked approved for commercial use;
- the app shows these data only as research evidence.

## ClinGen gene–disease validity

| | |
| --- | --- |
| Terms page | https://www.clinicalgenome.org/docs/terms-of-use/ ("Citing ClinGen & Terms of Use") |
| Licence | "All curated content published by ClinGen is available free of restriction under the CC0 1.0 Universal (CC0 1.0) Public Domain Dedication." |
| Attribution | "ClinGen requests that you give attribution to ClinGen and provide the date accessed whenever possible and appropriate." Their example: "The following curated content was obtained from the Clinical Genome Resource (www.clinicalgenome.org): Gene-Disease Validity classifications [date accessed]". |
| Restrictions | "The ClinGen logo cannot be used without prior approval of the ClinGen Steering Committee." |
| Disclaimer | "The information on this website is not intended for direct diagnostic use or medical decision-making without review by a genetics professional." |

| Planned use | What the terms say | What the app does |
| --- | --- | --- |
| Display | CC0: "free of restriction"; "You can freely capture the data" | Shows curations verbatim, with ClinGen's example attribution and the capture date on the library and gene pages |
| Storage | CC0 | Raw CSV in `data/genome/library/` (not served) |
| Caching / serving a display copy | CC0 | `public/genomics/library.json` |
| Investor demos | CC0 places no restriction on audience or purpose | Shown as research evidence, not clinical interpretation |
| Redistribution | CC0 places no restriction | Still "pending review" in the inventory, as you asked |
| Commercial use | CC0 places no restriction | Not marked approved until a named reviewer confirms |
| Logo | Needs Steering Committee approval | Not used |

## Human Phenotype Ontology (HPO)

| | |
| --- | --- |
| Terms page | https://hpo.jax.org/license. The server returns HTTP 404 for this address, but the page renders its licence text in a browser. The repository's LICENSE.md points to it. |
| Licence | "The HPO vocabularies, annotation files, tools and documentation are freely available." "The HPO is copyrighted to protect the integrity of the vocabularies … However, anyone can download the HPO and use the ontologies or other HPO files under three conditions" (listed below). |
| Conditions | 1. "That the Human Phenotype Ontology Consortium is acknowledged and cited properly." 2. "That any HPO Consortium file(s) displayed publicly include the date(s) and/or version number(s) of the relevant HPO file(s)." 3. "That neither the content of the HPO file(s) nor the logical relationships embedded within the HPO file(s) be altered in any way." |
| Requested statement | "Users of the HPO should add the following statement to their online presence. This service/product uses the Human Phenotype Ontology (version information). Find out more at http://www.human-phenotype-ontology.org We request that the HPO logo be included as well." |
| Commercial use | Not mentioned on the page. |

| Planned use | What the terms say | What the app does |
| --- | --- | --- |
| Display | Allowed under the three conditions | Shows term IDs and names unchanged, the release tag (v2026-09-01) and the requested statement on the gene pages and the sources list |
| Storage | "anyone can download the HPO and use … HPO files" | Rows for library genes kept in `data/genome/library/hpo/`, with the full file's digest |
| Caching / display copy | Allowed if not altered and the version is shown | The display copy groups rows by term per gene. Whether a filtered, grouped extract counts as "not altered" is a question for a reviewer. |
| Investor demos | Not restricted beyond the conditions | Shown with version and statement |
| Redistribution | Not stated beyond the conditions | "Pending review" |
| Commercial use | Not stated | Recorded as "unclear"; not approved |
| Logo | "We request that the HPO logo be included" | Not added yet; a request, not a condition. Product owner to decide. |

## Questions for a named reviewer

1. ClinGen: confirm that CC0 covers the gene–disease validity download as used, and that the attribution
   shown is adequate.
2. HPO: confirm that showing a filtered, grouped subset of `genes_to_phenotype.txt`, with term labels
   unchanged, meets "not altered"; that the version shown meets condition 2; and whether commercial use
   needs anything further.
3. Both: whether redistribution and commercial use may then be marked approved in
   `config/genome/licences.json`.
