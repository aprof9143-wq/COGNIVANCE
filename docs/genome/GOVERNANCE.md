# Genome governance

Status: **research software**, 2026-10-29; updated 2026-10-31 for the research gene library (GOV-5,
[LIBRARY.md](LIBRARY.md)). Not a medical device, not clinically validated, and not for clinical
decision-making. Clinical use is a future goal. Nothing in this document, in the records it describes, or in
the tests that check them establishes clinical validity, analytical validity or regulatory status. The tests
check that the records are consistent and that the software does what the records say. They do not show the
software is correct for any clinical purpose.

The records live in `config/genome/governance/` and `config/genome/licences.json`. They are read and checked
by `src/lib/genome/governance.ts` and `src/lib/genome/release.ts`. The status panel on `/vision` is built from
them.

## 1. Intended use and exclusions

Recorded in `intended-use.json`, status `research-only`.

**Intended use.** Research and demonstration: an evidence layer that shows public reference records for
registered inherited-retinal-disease genes (gene, transcript, protein and predicted structure), and a research
gene library of the genes ClinGen's gene–disease validity curations associate with autism spectrum disorder or
Alzheimer disease, with their identifiers, orthologues in other species and annotated phenotypes. Each value
carries its source, release and retrieval time, alongside clearly labelled hypothetical models.

**Excluded uses:**

- clinical decision-making of any kind;
- diagnosis, screening or prognosis for any person;
- patient-specific interpretation of genomic data;
- determining whether a variant is pathogenic;
- selecting, recommending or ranking treatments or therapies;
- predicting a patient's response to a therapy;
- processing identifiable patient genomic, clinical or neural data;
- uploading clinical VCF files or other patient data;
- designing, generating or recommending genome edits or engineered genomes.

**Scope.** RPE65-associated inherited retinal dystrophy (a product decision made on 2026-10-19, not a
diagnosis). A research library for autism spectrum disorder and Alzheimer disease, whose genes are whatever
ClinGen's curations name at capture time (GOV-5). Gene records are Homo sapiens only; other species appear
only as orthologues. GRCh38 only, and VCF header validation only (versions 4.2 to 4.5, no variant records, no
upload screen).

**Not a clinical intended-use statement.** None exists. Writing one needs a qualified clinical reviewer
(release gate item `INTENDED-USE`).

## 2. What the software does today

| Group | Items |
| --- | --- |
| Works today, for research | Reference evidence for RPE65 from Ensembl, UniProt and AlphaFold DB, with provenance; the gene library (ClinGen, HGNC, HPO); labelled models (therapy time course, eye optics, retina-to-cortex response) |
| Built, not validated | VCF header check; source policy; cross-species comparison (Ensembl Compara) |
| Blocked | ClinVar variant records; commercial-pilot use |
| Proposed | First IRD gene panel (D5) |
| Needed before any clinical use | Clinical use itself |

"Built, not validated" means the code exists and its tests pass. It does not mean it has been validated.
The list is `product-status.json`; each item names the requirements it rests on.

## 3. Source rights and review status

Each source has a permission per action and purpose in `licences.json`. Anything not recorded as `allowed`
is refused, in every mode.

| Source | Research: fetch / store / display | Redistribute | Terms review | Commercial pilot | Clinical |
| --- | --- | --- | --- | --- | --- |
| Ensembl REST | allowed | pending review | terms read, review pending | not approved | not approved |
| UniProt REST | allowed | pending review | awaiting human review | not approved | not approved |
| AlphaFold DB | allowed | pending review | awaiting human review | not approved | not approved |
| HGNC REST | allowed | pending review | terms read, review pending | not approved | not approved |
| RCSB PDB | allowed | pending review | terms read, review pending | not approved | not approved |
| ClinVar (NCBI E-utilities) | **denied** | denied | requires legal review | not approved | not approved |
| ClinGen gene–disease validity | allowed (GOV-5) | pending review | terms not yet read | not approved | not approved |
| Ensembl Compara (REST) | allowed (GOV-5) | pending review | Ensembl terms read; not confirmed for Compara | not approved | not approved |
| HPO annotations | allowed (GOV-5) | pending review | terms not yet read | not approved | not approved |

**What the research permissions rest on.** "Allowed" for research fetch, store and display records the
product owner's decision that app use of these sources is not restricted while their terms reviews are open.
It is not the outcome of a legal review, and no legal review has been done. For ClinGen, Ensembl Compara
and HPO the same decision was made on 2026-10-31 (GOV-5), before their terms had been read.

**How it is enforced.**

1. **Capture** (`tools/vision-snapshot/capture.py`): a source that may not be fetched and stored is never
   requested; the step is recorded as `withheld`.
2. **Storage:** raw responses are kept in `data/genome/snapshot/`, which the web app does not serve.
3. **Display copy** (`tools/genome-display/build_display.py`): only sources whose display is allowed, and only
   the fields the app reads, are copied to `public/vision/display/`.
4. **Loader and screens** (`src/lib/vision/snapshot.ts`): each file is checked against the policy before it
   is read; a refused source is shown as withheld, with the policy's reason, and never requested.
5. **Export** (`src/lib/vision/export.ts`): carries the withheld sources and the not-for-clinical-use
   statement, and no withheld content.

**ClinVar.** NCBI data use is blocked for the app until NCBI's required disclaimer and copyright notice are
displayed. That notice has **not** been added, because its exact wording must come from NCBI's own pages
through legal review. ClinVar's captured files were removed from the served folder and the snapshot; the
removal is recorded in `data/genome/snapshot/rpe65/REDACTIONS.json`.

## 4. Limitations

- Public reference data only, captured on the dates in each manifest; sources may have changed since.
- No variant is shown, because ClinVar is withheld.
- The gene-therapy time course is a hypothetical model with illustrative, unfitted parameters. It predicts
  nothing for any patient.
- The cortex response comes from a reduced network model, not from any person's brain.
- The eye model is a population-average schematic eye. The eye page can show a visitor's own picture through
  it; the picture stays in the browser, is never stored or sent, and is not meant for medical images.
- AlphaFold structures are predictions with their own per-residue confidence, not measurements.
- The Vision target list comes from the gene registry, but the evidence loader, therapy model and copy are
  RPE65-specific.
- The gene library is as small as ClinGen's curations make it: 8 autism-related genes and no Alzheimer disease
  gene in the capture of 2026-10-31. A curation is not a diagnosis or proof of cause. An orthologue is not
  shown to share function, and a deviation from the baseline is not a biological finding. Details are in
  [LIBRARY.md](LIBRARY.md) §7.
- No analytical or clinical validation has been performed.

## 5. Traceability: requirement, implementation, test, release

`requirements.json` lists REQ-001 to REQ-021. Each names the files that implement it and the tests that check
it. A test (`governance.test.ts`, "trace every requirement's implementation and tests to files and tests that
exist") fails if any named file or test is missing. `risks.json` links each risk to the requirements that
mitigate it. `changes.json` records each change and the requirements it touched.

| Status | Requirements |
| --- | --- |
| Implemented (code and tests exist; not validated) | REQ-001 to REQ-014, REQ-017 to REQ-021 |
| Requires qualified review | REQ-015 (clinical intended use, regulatory determination, validation, quality release); REQ-016 (NCBI notice and ClinVar legal review) |

**Release.** Every requirement's `release` is empty: no version of this software has been released for any
purpose, and there is no quality release process yet.

The records have a deterministic SHA-256 digest (`governanceDigest()`), so a change to any record changes it.

## 6. Verification and validation

`verification-validation.json`:

| Protocol | Status | What it is |
| --- | --- | --- |
| VER-001 | implemented | Software verification: automated tests of REQ-001 to REQ-014 and REQ-017 to REQ-021, on synthetic fixtures, the public RPE65 snapshot and the gene library capture |
| VER-002 | incomplete | Accessibility check: automated markup checks of the status, warning, withheld and loading states only; no audit against an accessibility standard and no testing with assistive technology |
| VAL-001 | requires qualified review | Analytical validation (displayed reference values match their sources); not started, needs a protocol approved by a qualified genomics reviewer |
| VAL-002 | requires qualified review | Clinical validation; cannot be defined until a clinical intended use exists |

No protocol has results or an approver. "Implemented" for VER-001 means the tests exist and are run, not
that anything has been validated.

## 7. Why clinical use is not enabled

Clinical use is computed by `clinicalModeAvailability()` in `src/lib/genome/release.ts` from
`config/genome/governance/release-gate.json`. It is available only when every required item has verified
evidence and recorded approvals. The `status` field is ignored, so it cannot be switched on by editing a
setting. Today all six items are missing:

1. `INTENDED-USE`: a clinical intended-use statement for a defined condition, population, user and setting,
   approved by the project owner and a qualified clinical reviewer.
2. `REGULATORY-PATHWAY`: a documented determination of regulatory status and pathway for that intended use,
   by a qualified regulatory reviewer. No pathway has been chosen.
3. `SOURCE-RIGHTS`: legal sign-off that every source and component in the clinical path may be used for it,
   recorded as `clinicalUse: approved`.
4. `ANALYTICAL-VALIDATION`: an approved protocol, dataset description, metrics, acceptance criteria and
   results.
5. `CLINICAL-VALIDATION`: clinical validation evidence with its protocol and acceptance criteria, approved by
   a qualified clinical reviewer.
6. `QUALITY-RELEASE`: a release review under a documented quality and change-control process.

## 8. Reviews and decisions still needed

From `reviews.json`. None has started, and no reviewer has been appointed.

| Review | Who | Blocks |
| --- | --- | --- |
| First IRD panel gene list (D5) | qualified genomics and clinical reviewers | the panel |
| Decision D4's question | project owner | nothing yet |
| ClinVar reuse and redistribution, including what earlier commits contain | legal reviewer | ClinVar |
| NCBI's required disclaimer and copyright notice: exact wording and placement | legal reviewer | ClinVar |
| UniProt and AlphaFold DB terms | a person reading the providers' terms pages | commercial pilot |
| Whether serving each source's display copy is permitted, with what attribution, and whether raw responses served before 2026-10-29 need action | legal reviewer | redistribution |
| Clinical intended use and regulatory determination | qualified clinical and regulatory reviewers | clinical use |
| ClinGen and HPO terms and attribution, and whether Ensembl's terms cover Compara | person reading the terms; legal reviewer for redistribution | gene library, cross-species comparison |
| Library scope: whether to add genes ClinGen's Intellectual Disability and Autism panel curated under other labels, and a source for Alzheimer disease genes | qualified genomics reviewer and product owner | gene library |

A completed review is recorded in `reviews.json` with the reviewer, date and outcome; nothing is recorded as
completed until it has happened.

## 9. Checking the records

```
pnpm test src/lib/genome
python -m unittest discover -s tools/vision-snapshot -p "test_*.py"
python -m unittest discover -s tools/genome-display -p "test_*.py"
```

The tests check, among other things, that the records agree with each other, that no review, approval or
result is recorded, that the intended use keeps its exclusions, that no record or document in
`docs/genome/` claims approval, clearance or clinical validation, that RHO stays outside every panel, and that
the Genome and Vision pages offer no genomic or clinical upload.
