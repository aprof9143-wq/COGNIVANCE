# Genome v1 specification

Status: **draft for review**, 2026-10-27; updated 2026-10-29 for source governance (see
[GOVERNANCE.md](GOVERNANCE.md)). Decision D5 (the first-panel gene list) has a proposed list awaiting
genomics/clinical review and is not yet authoritative. D4 is a new decision whose question is not yet stated. See
[DECISIONS.md](DECISIONS.md).

Cognivance is being developed toward a clinically benchmarked vision-therapy platform and, in time, an
appropriate FDA regulatory pathway. That is the direction of travel only. This software is **not**
FDA-approved or cleared, **not** clinically validated, and **not** suitable for clinical decision-making.
Nothing in Genome v1 establishes clinical validity or regulatory status, and no regulatory pathway has been
chosen.

Genome v1 is the genomic evidence layer of the Vision module. It continues the inherited-retinal-disease
(IRD) work that began with RPE65. It is not a therapeutic predictor and not clinical decision support.

## 1. Requirements and where they are met

| Requirement | Implementation | Status |
| --- | --- | --- |
| Multi-gene target and panel model | `config/genome/genes.json` (registry), `config/genome/panels/*.json` (versioned panels), loaded by `src/lib/genome/config.ts` and `tools/vision-snapshot/capture.py` | Done |
| GRCh38 only | Registry and panels are pinned to GRCh38; capture refuses an Ensembl answer on another assembly; ClinVar parser keeps GRCh38 locations only (ClinVar is currently withheld, §8); VCF gate rejects other builds | Done |
| VCF 4.2 or later | `src/lib/genome/vcf.ts` accepts VCF 4.2–4.5 headers | Header gate only (see §6) |
| Reject other builds and versions clearly; no silent conversion | Coded rejections with reasons; no liftover or version rewriting exists anywhere in the repository | Done |
| Explicit out-of-scope list | §7 | Done |
| Central, versioned gene and panel configuration | §2; nothing else in the Genome code carries a gene list | Done. The Vision target list is read from the registry (§8 lists what is still RPE65-specific) |
| IRD panel of about 10 genes | Product owner's proposed list of 10 genes in §3, awaiting genomics/clinical review; the configured panel lists RPE65 only and is `proposed` | **Awaiting review (D5)** |
| Generalised snapshot capture, any registered HGNC symbol | `tools/vision-snapshot/capture.py --gene SYMBOL` | Done |
| One SHA-256 manifest per gene | `data/genome/snapshot/<gene>/manifest.json` and `SHA256SUMS` (§5), plus the display copy's own manifest (§5) | Done |
| Parser tests per source, RPE65 and a second gene, offline | `src/lib/genome/sources.test.ts`, `tools/vision-snapshot/test_capture.py` | Done |
| Licence inventory and commercial-pilot safeguard | [LICENCES.md](LICENCES.md), `config/genome/licences.json`, enforced in capture and `assertSourceAllowed` | Done. Terms read from the official pages for Ensembl/EMBL-EBI, NCBI, HGNC and RCSB; UniProt and AlphaFold still unverified; nothing approved |
| Per-action source policy (fetch, store, display, redistribute) for research, commercial-pilot and clinical use | `src/lib/genome/policy.ts`, `tools/vision-snapshot/policy.py`, `permissions` in `licences.json`; enforced in capture, the display-copy builder, the loader, the screens and the export | Done. Fails closed; see [GOVERNANCE.md](GOVERNANCE.md) |

## 2. Gene registry and panels

**Registry**: `config/genome/genes.json`, versioned by `registryVersion`.

- Each entry records the HGNC symbol, HGNC ID, Ensembl gene ID, UniProt accession and taxon (9606).
- `idsVerified` says whether the identifiers have been confirmed against the sources, and how. RPE65's were
  confirmed from the 2026-10-20 snapshot, and RHO's by a live capture on 2026-10-27.
- `role` is `current-focus`, `test-gene` or `panel-candidate`.
- Registration lets the tools capture a gene. It is not panel membership and says nothing about clinical
  relevance.
- Symbols are matched exactly and must be unique ignoring case, so two genes can never share a snapshot
  folder.

**Panels**: one file per panel in `config/genome/panels/`, each with:

- `panelVersion`;
- `reviewStatus`: `proposed`, `under-review`, `approved` or `retired`;
- the decision it depends on, with `decisionStatus`: `unresolved` or `resolved`.

A panel is authoritative only when it is `approved` **and** its decision is `resolved`. The loaders refuse a
panel that is marked approved while its decision is unresolved, and a panel that names an unregistered gene.

**Identifier validation.** Identifiers are checked, not assumed. On every capture:

- HGNC must report the symbol as `Approved`.
- HGNC, Ensembl and UniProt must report the same HGNC ID, Ensembl gene ID and UniProt accession as the
  registry.

Any disagreement stops that gene's capture before anything is written. In the app,
`src/lib/genome/identifiers.ts` performs the same comparison. It marks each value as **source-reported**
(stated by a source) or **inferred** (derived here by comparing sources).

**Adding a gene**:

1. Add it to `genes.json` with `idsVerified: null`.
2. Capture it (§5); the capture checks its identifiers.
3. Record the verification.
4. Bump `registryVersion`.

## 3. First IRD panel (D5): proposed, awaiting genomics/clinical review

**Status: proposed, not approved.** On 2026-10-27 the product owner proposed the ten genes below as the first
inherited-retinal-disease panel. The list is recorded **here, in the spec, only**. It awaits genomics and
clinical review. It is not authoritative, not validated, and not a diagnostically complete IRD panel. Being
listed here implies nothing clinical.

| # | Gene | Note |
| --- | --- | --- |
| 1 | RPE65 | Current focus of the Vision module; already registered and captured |
| 2 | ABCA4 | Proposed by the product owner, 2026-10-27 |
| 3 | USH2A | Proposed by the product owner, 2026-10-27 |
| 4 | RPGR | Proposed by the product owner, 2026-10-27 |
| 5 | PRPH2 | Proposed by the product owner, 2026-10-27 |
| 6 | CRB1 | Proposed by the product owner, 2026-10-27 |
| 7 | RDH12 | Proposed by the product owner, 2026-10-27 |
| 8 | CEP290 | Proposed by the product owner, 2026-10-27 |
| 9 | BEST1 | Proposed by the product owner, 2026-10-27 |
| 10 | CHM | Proposed by the product owner, 2026-10-27 |

**What is deliberately not done yet**

- **The authoritative configuration is unchanged.** `config/genome/panels/ird-first-panel.json` still lists
  RPE65 only, with `reviewStatus: proposed` and `decisionStatus: unresolved`.
- **The nine other genes are not registered.** Registering them means entering their HGNC, Ensembl and
  UniProt identifiers, and that waits for the review.
- **RHO is not in the proposed list.** It stays in the registry only as the capture tool's second test gene
  (`role: test-gene`).

**After genomics/clinical review approves a list**

1. Record D5 as resolved in DECISIONS.md, with the reviewers and date.
2. Register each gene in `genes.json`.
3. Capture each gene, so its identifiers are checked against HGNC, Ensembl and UniProt.
4. Set the panel's `members` and bump `panelVersion`.
5. Set `reviewStatus: approved` and `decisionStatus: resolved` only once the review the product owner requires
   is recorded.

## 4. Data sources

The sources are HGNC, Ensembl REST, UniProtKB REST, AlphaFold DB and NCBI ClinVar (E-utilities). RCSB PDB is
used by the Vision structure view when an experimental entry exists.

Each source has a recorded permission for each action (fetch, store, display, redistribute) and purpose.
Anything not recorded as `allowed` is refused. For research use, fetching, storing and displaying are allowed
for every source except ClinVar, which is denied every action; redistribution is pending review for all of
them. No source is approved for commercial-pilot or clinical use. The table is in [LICENCES.md](LICENCES.md).

Terms read on 2026-10-27 from the official pages (via the CI runner) are recorded for Ensembl/EMBL-EBI, NCBI,
HGNC and RCSB. UniProt and AlphaFold DB are still unverified. ClinVar needs legal review. None is approved
for commercial-pilot use. See
[LICENCES.md](LICENCES.md).

## 5. Snapshot capture and per-gene manifests

```
python tools/vision-snapshot/capture.py --gene RPE65 [--gene RHO ...] \
    [--mode research|commercial-pilot] [--allow-partial]
```

**Inputs and outputs**

- **Genes:** each must be registered; invalid or unknown symbols exit with code 2 and a reason.
- **Output folder:** each gene writes `data/genome/snapshot/<symbol in lower case>/`. This folder is in the
  repository but is **not served**: raw source responses are never published by the web app.
- **Collision guard:** a folder that already holds another gene's capture (by symbol or HGNC ID) is never
  overwritten.
- **Steps captured:** HGNC symbol record, Ensembl lookup, release, CDS and gene region, UniProt search,
  AlphaFold prediction and model, ClinVar esearch and esummary batches.
- **Source policy:** a step whose source may not be fetched and stored for the capture's purpose is not
  requested. It is recorded as `withheld` with the policy's reason. Today that applies to every ClinVar step.

**Failure handling**

- Each step is recorded as `ok`, `failed` (with the error) or `skipped` (with why, e.g. a dependency failed).
- The capture is built in a temporary folder.
- Withheld steps do not make a capture incomplete. If any other step failed or was skipped, the existing snapshot is left unchanged and the exit code is 1, unless
  `--allow-partial` is given. In that case the incomplete capture is written with `complete: false`.

**Commercial-pilot mode.** In `commercial-pilot` mode, steps whose licence item is not `approved` are skipped
without any request being sent. Today that is every step, so the exit code is 3 and nothing is written. The
same exit code is used whenever every step is skipped or withheld.

**Exit codes:**

| Code | Meaning |
| --- | --- |
| 0 | Complete (or written with `--allow-partial`) |
| 1 | Incomplete; nothing replaced |
| 2 | Invalid or unknown symbol, identifier mismatch, non-GRCh38 answer, or collision |
| 3 | No source allowed in this mode |

**Manifest format** (`manifest.json`, schema version 3; version 3 adds the `withheld` step status). The JSON has sorted keys and 2-space indent. Paths
are relative to the gene folder. The fields are:

- `schemaVersion` (3), `gene` (HGNC symbol), `hgncId`, `ensemblGeneId`, `uniprotAccession`, `taxonId`,
  `assembly`.
- `registryVersion`, `mode`, `tool`, `capturedAt`.
- `complete`: true only if every step succeeded.
- `identifierChecks[]`: `check`, `source`, `expected`, `reported`, `result` (`agree`, `differ` or
  `not-reported`).
- `sources[]`: `step`, `licenceId`, `status`, `reason`, `files`. These are in capture order, and failures are
  always listed.
- `files[]`, sorted by `file`:
  - `file`, `url`, `status`, `retrievedAt`, `headers` (content type and provider release headers only);
  - `bytes` and `sha256`: size and digest of the raw response;
  - `gzip`, plus `storedBytes` and `storedSha256`: size and digest of the file as stored (gzip of the raw
    bytes for `.gz` files).

**`SHA256SUMS`** repeats the stored digests in `sha256sum -c` format.

**What is not recorded:** manifests contain no credentials (none are used), no tokens, and no patient data.
Only public reference records are captured.

**Older manifests.** The committed RPE65 manifest is version 1 (no `schemaVersion`) and is kept unchanged so
its digests still verify. The ClinVar files it lists were removed on 2026-10-29; `REDACTIONS.json` beside it
records which files and why.

**Display copy.** The web app reads `public/vision/display/<gene>/`, built by
`tools/genome-display/build_display.py` from the snapshot. It holds only sources whose display is allowed,
and from each response only the fields the app's parsers read (a test checks the field lists against the
parsers). Its `manifest.json` records, per file, the raw digest, the stored digest and the display digest, the
transformation applied, the withheld sources, and the not-for-clinical-use statement. Rebuild it with:

```
python tools/genome-display/build_display.py --gene RPE65
```

**CI.** `.github/workflows/vision-snapshot.yml` runs by hand only. It runs the offline tests, captures the
chosen gene into `data/genome/snapshot/`, rebuilds the display copy and commits both. It has inputs to allow
partial captures or to upload without committing. `.github/workflows/genome-tools.yml` runs the offline tests
on pull requests.

## 6. Input validation: VCF

`validateVcfHeader` (`src/lib/genome/vcf.ts`) accepts a file only if both of the following hold:

1. **The first line is `##fileformat=VCFv4.2`, `4.3`, `4.4` or `4.5`.**
   - Older versions (4.1, 4.0, 3.x) are rejected as too old.
   - Unknown versions (e.g. 4.9, 5.0) are rejected as unrecognised.
   - Nothing is converted.
2. **The header establishes GRCh38.** Any of these counts: a `##reference` or `##assembly` naming GRCh38
   (GRCh38, hg38, GCA_000001405.15+, GCF_000001405.26+, Homo_sapiens_assembly38), a `##contig` assembly
   attribute, or primary contig lengths matching GRCh38.
   - Any sign of another build rejects the file, including mixed signals. Other builds are GRCh37, hg19, b37,
     hs37d5, NCBI36, hg18 and T2T-CHM13.
   - A header that does not establish the build is also rejected; the build is never guessed from chromosome
     names.

**Other header requirements**

- The `#CHROM` line must have the eight fixed tab-separated columns, then `FORMAT` before any sample.
- Compressed (gzip/bgzip) input is rejected with a request to decompress it.

**What it returns:** the version, the evidence lines and the number of contigs and samples. It never returns
sample names, because they can identify people.

**No liftover, anywhere.** Nothing in the repository lifts over, converts builds or rewrites versions.

## 7. Out of scope for Genome v1

Each item was checked against the repository on 2026-10-27.

**Excluded from Genome v1** (deliberately not part of this version):

| Item | Current repository state |
| --- | --- |
| Assemblies other than GRCh38, and any automatic liftover | Not present. Non-GRCh38 input is rejected (§6). ClinVar GRCh37 locations are ignored, not converted. |
| FASTQ (or BAM/CRAM) to VCF processing: alignment, variant calling | Not present. |
| Autonomous clinical diagnosis or treatment recommendation | Not present. The `/vision/therapy` page is a labelled hypothetical illustration, outside Genome v1, and makes no recommendation. |
| Automated final ACMG/AMP classification without qualified curator review | Not present. ClinVar classifications are shown as submitted. The grouping into pathogenic, uncertain and similar is for display only and is not a classification. |
| Patient-specific therapeutic efficacy or side-effect prediction | Not present. The therapy time course is explicitly not patient-specific and not a prediction. |
| Genome-editing recommendations or clinical intervention design | Not present. |
| Variant-effect predictor scores (AlphaMissense, CADD, REVEL, SpliceAI and similar) | Not used. Each needs its own licence review (LICENCES.md). |

**Not yet implemented** (possible later work, not excluded by decision):

| Item | Current repository state |
| --- | --- |
| Reading and annotating VCF variant records | Only the header gate exists. No record parser. |
| Compressed VCF (bgzip), tabix indexes, BCF | Rejected with a reason. |
| gVCF-specific handling, multi-sample genotype handling | Samples are counted only. |
| Variant normalisation (left-alignment, multi-allelic splitting) | Not present. |
| Structural variants, CNVs and multi-gene events | ClinVar multi-gene records are counted, not mapped. |
| Placing non-SNV variants on the coding sequence | `src/lib/vision/genome.ts` places coding single-nucleotide substitutions (`c.N>X`) only. |
| Multi-gene Vision UI and VCF upload UI | The target list comes from the registry, but only RPE65 qualifies, and the evidence loader, therapy model and page copy are RPE65-specific. There is no upload UI. |

## 8. Known limitations and follow-ups

- **Licences:**
  - UniProt and AlphaFold DB terms are awaiting human review.
  - ClinVar reuse requires legal review.
  - NCBI data use is **blocked for the app** until NCBI's required disclaimer and copyright notice are displayed
    to users. Since 2026-10-29 this is enforced: ClinVar is denied every action, its captured files were
    removed, and every screen and export says it is withheld. The notice's exact wording has not been added,
    because it must come from NCBI's own pages through legal review.
  - Redistribution of any source is pending review, so the display copy is served on the basis of the product
    owner's recorded research-use decision while those reviews are open.
  - Earlier commits still contain raw responses, including ClinVar, that were served before 2026-10-29. Whether
    that needs action is a legal question (GOVERNANCE.md).
  - No item is approved for commercial-pilot or clinical use.
- **RPE65-specific parts of the UI:** the Vision target list comes from the registry (`selectableTargets` in
  `targets.ts`), but the evidence loader defaults to RPE65 and the therapy model and page copy describe RPE65.
  A second current-focus gene would need that work first.
- **D4 is a new decision with no question yet.** The repository had no earlier D4, so its original meaning is
  unknown; nothing was backfilled. The project owner needs to state its question (see DECISIONS.md).

## 9. Verifying

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
python -m unittest discover -s tools/vision-snapshot -p "test_*.py"
python -m unittest discover -s tools/genome-display -p "test_*.py"
```

None of the tests need network access.
