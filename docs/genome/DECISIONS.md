# Genome decision log

Decisions about the Genome platform. These are separate from the 14 Vision benchmark decisions shown on
`/vision` (`src/lib/vision/targets.ts`). Those carry their own numbers: Vision decision 4 is "Intended
population" and decision 5 is "Input data and quality requirements", which are **not** D4 and D5 below.

## D4: new decision (no prior entry)

| Field | Value |
| --- | --- |
| **Status** | **Created 2026-10-27 as a new decision**, at the project owner's instruction. |
| **History** | The repository had no existing D4 entry (checked 2026-10-27), so D4's original meaning, if it ever had one, is **unknown**. It has not been backfilled, and no earlier meaning is assumed. |
| **Question** | Not yet stated. |
| **Answer** | None yet. |
| **Needs** | The project owner to state the question this new D4 decides. |

## D5: first-panel gene list

| Field | Value |
| --- | --- |
| **Question** | Which genes make up the first inherited-retinal-disease panel for Genome v1? |
| **Status** | **Proposed, awaiting genomics/clinical review.** Not resolved, not approved, not authoritative. |
| **Proposed list** | RPE65, ABCA4, USH2A, RPGR, PRPH2, CRB1, RDH12, CEP290, BEST1, CHM. Proposed by the product owner on 2026-10-27, and recorded in [GENOME_V1.md §3](GENOME_V1.md#3-first-ird-panel-d5-proposed-awaiting-genomicsclinical-review) only. |
| **Configured** | `config/genome/panels/ird-first-panel.json` is deliberately unchanged in membership: RPE65 only, `reviewStatus: proposed`, `decisionStatus: unresolved`. |
| **Needs** | Genomics and clinical review of the proposed list. After approval, follow the steps in GENOME_V1.md §3. |
| **Caveat** | The proposed list does not imply clinical validity or diagnostic completeness. |

## GV1-INPUT: Genome v1 input scope

| Field | Value |
| --- | --- |
| **Question** | Which reference build and file versions does Genome v1 accept? |
| **Answer** | GRCh38 only. VCF 4.2 or later; the header gate knows 4.2–4.5. Other builds and versions are rejected clearly. No liftover, conversion or downgrading. |
| **Source** | Stated in the product owner's Genome v1 brief, 2026-10-27. |
| **Status** | Decided. A separate entry; it is not D4. |
| **Implemented in** | `src/lib/genome/vcf.ts`, `config/genome/*.json` (assembly pinned), `tools/vision-snapshot/capture.py` (refuses non-GRCh38 answers), `src/lib/vision/snapshot.ts` (GRCh38 ClinVar locations only). |

## GV1-LICENCE: Commercial-pilot use of external components

| Field | Value |
| --- | --- |
| **Question** | When may a data source, library or predictor be used in a commercial-pilot path? |
| **Answer** | Only once `config/genome/licences.json` marks it `commercialPilot: approved`, after a named person has reviewed its current software licence and data/service terms. Until then the capture tool and `assertSourceAllowed` refuse it in commercial-pilot mode. |
| **Source** | Genome v1 brief, 2026-10-27. |
| **Status** | Decided. No item is approved yet. |
| **Current review states** | Set by the product owner on 2026-10-27. **UniProt and AlphaFold DB:** terms awaiting human review. **ClinVar:** reuse requires legal review. **NCBI data:** use blocked for the app until NCBI's required disclaimer and copyright notice are displayed to users (`appUse: blocked` in `licences.json`). |
