# Genome v1 specification

Status: **draft for review**, 2026-10-27. Decision D5 (the first-panel gene list) is unresolved; see
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
| GRCh38 only | Registry and panels are pinned to GRCh38; capture refuses an Ensembl answer on another assembly; ClinVar parser keeps GRCh38 locations only; VCF gate rejects other builds | Done |
| VCF 4.2 or later | `src/lib/genome/vcf.ts` accepts VCF 4.2–4.5 headers | Header gate only (see §6) |
| Reject other builds and versions clearly; no silent conversion | Coded rejections with reasons; no liftover or version rewriting exists anywhere in the repository | Done |
| Explicit out-of-scope list | §7 | Done |
| Central, versioned gene and panel configuration | §2; nothing else in the Genome code carries a gene list | Done (Vision UI still names RPE65; see §8) |
| IRD panel of about 10 genes | Proposed candidates in §3 for confirmation; the configured panel lists RPE65 only and is `proposed` | **Awaiting D5** |
| Generalised snapshot capture, any registered HGNC symbol | `tools/vision-snapshot/capture.py --gene SYMBOL` | Done |
| One SHA-256 manifest per gene | `public/vision/snapshot/<gene>/manifest.json` and `SHA256SUMS` (§5) | Done |
| Parser tests per source, RPE65 and a second gene, offline | `src/lib/genome/sources.test.ts`, `tools/vision-snapshot/test_capture.py` | Done |
| Licence inventory and commercial-pilot safeguard | [LICENCES.md](LICENCES.md), `config/genome/licences.json`, enforced in capture and `assertSourceAllowed` | Done. Terms read from the official pages for Ensembl/EMBL-EBI, NCBI, HGNC and RCSB; UniProt and AlphaFold still unverified; nothing approved |

## 2. Gene registry and panels

**Registry**: `config/genome/genes.json`, versioned by `registryVersion`.

- Each entry records the HGNC symbol, HGNC ID, Ensembl gene ID, UniProt accession and taxon (9606).
- `idsVerified` says whether the identifiers have been confirmed against the sources, and how. RPE65's were
  confirmed from the 2026-10-20 snapshot. RHO's are not yet confirmed.
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

## 3. First IRD panel (D5): proposed, not approved

The configured panel `ird-first-panel` v0.1.0 lists **RPE65 only**. RPE65 is the condition recorded on
2026-10-19 (Vision decision 1). No approved first-panel gene list exists in the repository.

The ten candidates below are offered **for the product owner to confirm, change or reject**. They are not in
the configuration, are not validated, and are not a diagnostically complete IRD panel. Being listed here
implies nothing clinical.

| Candidate | Why it is proposed (product narrative, not clinical evidence) |
| --- | --- |
| RPE65 | Current focus; the existing Vision evidence and simulation are built on it |
| LRAT | Visual-cycle enzyme acting with RPE65 |
| RLBP1 | Visual-cycle retinoid-binding protein |
| RDH5 | Visual-cycle dehydrogenase |
| RHO | Rod photoreceptor pigment; also the capture tool's second test gene |
| ABCA4 | Photoreceptor retinoid transporter, linked to the visual cycle |
| USH2A | Frequently discussed IRD gene |
| RPGR | Frequently discussed IRD gene |
| CEP290 | Frequently discussed IRD gene |
| CHM | Frequently discussed IRD gene |

To adopt a list:

1. Record D5 as resolved.
2. Register each gene.
3. Capture each gene so its identifiers are verified.
4. Set the panel's members, bump `panelVersion`, and set `reviewStatus` to `approved` only after the review
   the product owner requires.

## 4. Data sources

The sources are HGNC, Ensembl REST, UniProtKB REST, AlphaFold DB and NCBI ClinVar (E-utilities). RCSB PDB is
used by the Vision structure view when an experimental entry exists.

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
- **Output folder:** each gene writes `public/vision/snapshot/<symbol in lower case>/`.
- **Collision guard:** a folder that already holds another gene's capture (by symbol or HGNC ID) is never
  overwritten.
- **Steps captured:** HGNC symbol record, Ensembl lookup, release, CDS and gene region, UniProt search,
  AlphaFold prediction and model, ClinVar esearch and esummary batches.

**Failure handling**

- Each step is recorded as `ok`, `failed` (with the error) or `skipped` (with why, e.g. a dependency failed).
- The capture is built in a temporary folder.
- If any step failed or was skipped, the existing snapshot is left unchanged and the exit code is 1, unless
  `--allow-partial` is given. In that case the incomplete capture is written with `complete: false`.

**Commercial-pilot mode.** In `commercial-pilot` mode, steps whose licence item is not `approved` are skipped
without any request being sent. Today that is every step, so the exit code is 3 and nothing is written.

**Exit codes:**

| Code | Meaning |
| --- | --- |
| 0 | Complete (or written with `--allow-partial`) |
| 1 | Incomplete; nothing replaced |
| 2 | Invalid or unknown symbol, identifier mismatch, non-GRCh38 answer, or collision |
| 3 | No source allowed in this mode |

**Manifest format** (`manifest.json`, schema version 2). The JSON has sorted keys and 2-space indent. Paths
are relative to the gene folder. The fields are:

- `schemaVersion` (2), `gene` (HGNC symbol), `hgncId`, `ensemblGeneId`, `uniprotAccession`, `taxonId`,
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

**Older manifests.** The original RPE65 manifest is version 1 (no `schemaVersion`). The web loader reads both.

**CI.** `.github/workflows/vision-snapshot.yml` runs the offline tests, then captures RPE65. Run it by hand
for other registered genes; it has inputs to allow partial captures or to upload without committing.
`.github/workflows/genome-tools.yml` runs the offline tests on pull requests.

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
| Panel-driven Vision UI and VCF upload UI | Vision pages still show RPE65 only; there is no upload UI. |

## 8. Known limitations and follow-ups

- **RHO identifiers:** they come from the developers' knowledge until the first RHO capture confirms them.
- **Licences:** UniProt and AlphaFold DB terms are still unverified, ClinVar needs legal review, and no item
  is approved for commercial-pilot use. NCBI requires its disclaimer and copyright notice to be shown to users
  of a service built on its data; the app does not show them yet.
- **Hard-coded RPE65 in the UI:** the Vision UI (`targets.ts`, `useEvidence`) still names RPE65 directly.
  Moving it onto the registry is a UI change left for a later pull request.
- **Unrecorded decisions:** D4 is not recorded anywhere in the repository (see DECISIONS.md).

## 9. Verifying

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
python -m unittest discover -s tools/vision-snapshot -p "test_*.py"
```

None of the tests need network access.
