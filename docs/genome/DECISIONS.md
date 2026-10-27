# Genome decision log

Decisions about the Genome platform. These are separate from the 14 Vision benchmark decisions shown on
`/vision` (`src/lib/vision/targets.ts`). Those carry their own numbers: Vision decision 4 is "Intended
population" and decision 5 is "Input data and quality requirements", which are **not** D4 and D5 below.

## D4: not recorded

The Genome v1 brief (2026-10-27) refers to a decision D4, but no D4 entry exists in the repository and the
brief does not state its content.

**Status: unknown.** The product owner needs to supply it. Nothing has been assumed.

## D5: first-panel gene list

| Field | Value |
| --- | --- |
| **Question** | Which genes make up the first inherited-retinal-disease panel for Genome v1? |
| **Status** | **Unresolved.** |
| **Configured** | `config/genome/panels/ird-first-panel.json` v0.1.0: `reviewStatus: proposed`, `decisionStatus: unresolved`, members RPE65 only. |
| **Proposed** | Ten candidates for confirmation are listed in [GENOME_V1.md §3](GENOME_V1.md#3-first-ird-panel-d5-proposed-not-approved). They are not entered in the configuration. |
| **Needs** | Product-owner confirmation of the list, then the steps in GENOME_V1.md §3. Clinical approval of a panel is a separate review that the repository does not yet document. |

## GV1-INPUT: Genome v1 input scope

| Field | Value |
| --- | --- |
| **Question** | Which reference build and file versions does Genome v1 accept? |
| **Answer** | GRCh38 only. VCF 4.2 or later; the header gate knows 4.2–4.5. Other builds and versions are rejected clearly. No liftover, conversion or downgrading. |
| **Source** | Stated in the product owner's Genome v1 brief, 2026-10-27. |
| **Status** | Decided. It may be the D4 the brief refers to; to be confirmed by the product owner. |
| **Implemented in** | `src/lib/genome/vcf.ts`, `config/genome/*.json` (assembly pinned), `tools/vision-snapshot/capture.py` (refuses non-GRCh38 answers), `src/lib/vision/snapshot.ts` (GRCh38 ClinVar locations only). |

## GV1-LICENCE: Commercial-pilot use of external components

| Field | Value |
| --- | --- |
| **Question** | When may a data source, library or predictor be used in a commercial-pilot path? |
| **Answer** | Only once `config/genome/licences.json` marks it `commercialPilot: approved`, after a named person has reviewed its current software licence and data/service terms. Until then the capture tool and `assertSourceAllowed` refuse it in commercial-pilot mode. |
| **Source** | Genome v1 brief, 2026-10-27. |
| **Status** | Decided. No item is approved yet. |
