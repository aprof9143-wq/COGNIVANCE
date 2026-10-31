# Research gene library and cross-species comparison

Status: **research and demonstration**, 2026-10-31. Not a medical device, not clinically validated, and not
for clinical decision-making. A gene–condition curation describes published evidence about a gene. It is not
a diagnosis, a risk estimate or proof of cause for any person. Decision: GOV-5 in
[DECISIONS.md](DECISIONS.md).

## 1. What it is

| Page | What it shows |
| --- | --- |
| `/genomics` | The library. Genes with a ClinGen gene–disease validity curation for autism spectrum disorder or Alzheimer disease. Search and filters for condition, classification, inheritance, and species with an orthologue. |
| `/genomics/$symbol` | One gene: curations with report links, HGNC identifiers linking to each source, orthologues against the baseline, HPO phenotypes, evidence files with digests, JSON export, a ClinVar link-out (no ClinVar data) and a live check. |
| `/genomics/compare` | Species tree and an orthology matrix (genes × species), by gene or by HPO phenotype. Every cell opens the record behind it. |

## 2. Where every value comes from

```
GitHub Actions (vision-snapshot.yml, what: genome-library, started by hand)
  tools/genome-library/capture_library.py
    ClinGen   GET https://search.clinicalgenome.org/kb/gene-validity/download   (CSV)
    HGNC      GET https://rest.genenames.org/fetch/symbol/<symbol>
    Ensembl   GET https://rest.ensembl.org/info/data
              GET https://rest.ensembl.org/homology/id/human/<ENSG>?type=orthologues;format=full;...
              GET https://rest.ensembl.org/taxonomy/classification/<taxon>
    HPO       GET https://api.github.com/repos/obophenotype/human-phenotype-ontology/releases/latest
              GET <its genes_to_phenotype.txt asset>
  -> data/genome/library/          raw responses, manifest.json, SHA256SUMS (not served)
  -> public/genomics/library.json  display copy: only the fields the pages show
Browser
  src/lib/genomics/load.ts         reads library.json, validates it (schema.ts), or falls back to the sample
  src/lib/genomics/library.ts      search, filters, orthology cells, baseline, species tree
  src/components/genomics/*        the three pages
Server
  GET /api/genomics/live?symbol=   src/routes/api.genomics.live.ts -> src/lib/genomics/live.ts
                                   re-reads HGNC and Ensembl now; shown beside the snapshot, never written into it
```

| On screen | Comes from | Field |
| --- | --- | --- |
| Classification, disease label, disease ID, inheritance, expert panel, date, report link | ClinGen download | `CLASSIFICATION`, `DISEASE LABEL`, `DISEASE ID (MONDO)`, `MOI`, `GCEP`, `CLASSIFICATION DATE`, `ONLINE REPORT`, verbatim |
| Name, HGNC ID, NCBI Gene ID, Ensembl gene, UniProt, location | HGNC | `name`, `hgnc_id`, `entrez_id`, `ensembl_gene_id`, `uniprot_ids`, `location` |
| Orthology type, gene ID, identity, "split at" | Ensembl Compara | `type`, `target.id`, `target.perc_id` and `source.perc_id`, `taxonomy_level` |
| Species tree | Ensembl taxonomy | ancestors per species (`id`, `scientific_name`) |
| Phenotypes | HPO release | `hpo_id`, `hpo_name`, `frequency`, `disease_id` |
| Baseline, deviation, tree layout, conflict flag | Computed here (`library.ts`) | Labelled as computed on every page |

## 3. Sources, terms and attribution

| Source | Research use | Redistribution | Terms | Attribution shown |
| --- | --- | --- | --- | --- |
| ClinGen gene–disease validity | fetch, store, display allowed (GOV-5) | pending review | read 2026-10-31: CC0, attribution with date accessed requested, logo needs approval ([TERMS-REVIEW.md](TERMS-REVIEW.md)) | ClinGen's example attribution with the capture date, and each curation's report link |
| HGNC | allowed (since 2026-10-27) | not permitted | CC0, read 2026-10-27 | "Identifiers from HGNC" |
| Ensembl Compara | allowed (GOV-5) | not permitted | Ensembl disclaimer and EMBL-EBI terms read; not yet confirmed for Compara | "Ensembl Compara" and its release on every orthology view |
| HPO annotations | allowed (GOV-5) | pending review | read 2026-10-31: free to use if cited, version shown and content not altered; commercial use not mentioned ([TERMS-REVIEW.md](TERMS-REVIEW.md)) | HPO's requested statement with the release tag |
| ClinVar, NCBI | withheld | — | blocked until NCBI's notice and legal review | link-out to NCBI only |

The terms are recorded in `config/genome/licences.json` and [LICENCES.md](LICENCES.md). The terms-check
workflow fetches each terms page and records its hash in `terms-check.json`. A person still has to read
ClinGen's and HPO's terms (review REV-LIBRARY-TERMS).

## 4. Refresh and freshness

- **Snapshot.** The library is a snapshot. It changes only when a person runs the workflow: Actions →
  vision-snapshot → Run workflow, with `what: genome-library`. The run commits `data/genome/library/` and
  `public/genomics/library.json` to the branch it ran on. Use `allow_partial` to keep a capture in which some
  source failed; the failure is recorded in the manifest and shown on the pages.
- **Freshness.** Every page shows the capture date. A snapshot older than 90 days is marked out of date
  (`STALE_AFTER_DAYS` in `library.ts`, a product choice).
- **Live check.** "Check now" on a gene page asks HGNC and Ensembl from the server and shows the answer with
  its time, per source, beside the snapshot. It has an 8-second timeout and retries network errors, 429 and
  5xx up to twice; a 404 is not retried. Nothing is real-time and nothing is streamed.
- **No credentials** are needed: ClinGen, HGNC, Ensembl and the HPO release are public. No environment
  variable is required. NCBI is not called, so no NCBI key is used.

## 5. Sample mode

If `public/genomics/library.json` is absent, the pages show `SAMPLE_LIBRARY` (`src/lib/genomics/sample.ts`).
It is labelled on every page: a "Sample data · synthetic" badge, a banner, and a note in every export. The
genes are named `SAMPLE-A` to `SAMPLE-I`, every identifier starts with `SAMPLE:`, and no taxonomy is made up,
so the species tree is not drawn. If the file exists but cannot be read or validated, the page shows an error
and does not fall back to the sample.

## 6. Definitions used on the pages

- **Orthologue:** a gene in another species descended from the same ancestral gene, separated by
  speciation, as Ensembl Compara reports it. Related by descent; not shown to have the same function.
- **None reported / not retrieved:** "none reported" means Ensembl was read and reported no orthologue in
  that species, which is not proof the gene is absent. "Not retrieved" means Ensembl was not read for that
  gene.
- **Baseline:** for one species, the distribution of percent identity across the one-to-one orthologues of
  every gene in this library. It needs at least 8 genes, and describes this gene set, not the genome.
- **Comparison set:** the species where this library has at least 8 one-to-one orthologues with a reported
  identity. In the current capture these are macaque, rat, dog and chicken. Chimpanzee and mouse (7) and
  zebrafish (3) have fewer, so they are shown for orthology only, without a baseline. The set is constrained
  by what the sources report, not chosen for a result.
- **Candidate for review:** identity below Q1 − 1.5 × IQR or above Q3 + 1.5 × IQR (Tukey fences). It marks a
  pair to check, not a biological anomaly. Each candidate shows the other species' gene record, both aligned
  proteins' lengths and the retrieval date.
- **Gene-model check:** if the two aligned proteins differ in length by more than a fifth, the pair is flagged
  as a likely gene-model issue to check first. Such a difference lowers identity without any biological
  difference.

## 7. Limitations of the capture of 2026-10-31

- **Autism.** 8 genes: ADNP, AVPR1A, CAPRIN1, PAX5, SLC6A4, SLC9A9, TANC2 and TMLHE. Four of them (AVPR1A,
  SLC6A4, SLC9A9, TMLHE) are classified Disputed, and the pages show that. ClinGen's Intellectual Disability
  and Autism expert panel curated 370 more genes under other disease labels (for example "complex
  neurodevelopmental disorder"). They are not included, because their curations do not name autism.
- **Alzheimer disease.** No ClinGen curation's disease label names Alzheimer disease. APP is curated for
  cerebral amyloid angiopathy, and PSEN1 and PSEN2 only for cardiomyopathy. Nothing is added by hand. The
  page shows "Source under review". Source options and proposed inclusion criteria are in
  [ALZHEIMER-SOURCES.md](ALZHEIMER-SOURCES.md) (review REV-ALZHEIMER-SOURCE).
- **Baseline.** With 8 genes, at most 8 one-to-one orthologues exist per species. Macaque, rat, dog and
  chicken have exactly 8; mouse and chimpanzee 7; zebrafish 3. Only the first four get a baseline.
- **Candidates for review, and the first check.** Three pairs fall outside their species' baseline. Ensembl
  reports identity relative to each protein's own length, so the ratio of the two identities gives the ratio
  of the two proteins' lengths:

  | Pair | Identity (other / human) | Median, fences | Implied length, other ÷ human |
  | --- | --- | --- | --- |
  | PAX5, macaque (ENSMMUG00000019639) | 66.3% / 69.1% | 96.8%, 87.0–106.2 | 1.04 |
  | TMLHE, rat (ENSRNOG00000000729) | 65.8% / 69.6% | 92.3%, 81.3–102.0 | 1.06 |
  | AVPR1A, dog (ENSCAFG00845009998) | 81.9% / 81.1% | 95.8%, 84.2–106.1 | 0.99 |

  The aligned proteins are of similar length, so a truncated or partial gene model is unlikely to explain the
  low identity. Still open: which isoform Ensembl chose for each protein (an alternative exon could explain a
  low identity at similar length), the alignment itself, and the orthology call. A capture now in progress
  records both proteins' lengths and the other species' gene records directly; the pages show them once it
  lands. No conclusion is drawn about biology.
- **Species tree.** It uses the ancestors Ensembl lists. Where that list does not separate species (chicken
  and zebrafish here), they branch from the same point.
- **Phenotypes.** HPO phenotypes belong to diseases linked with the gene, not specifically to the library's
  conditions.
- **No variant data.** ClinVar is withheld.

## 8. Running and testing

```
pnpm dev                                    # then sign in with Enter Demo, open Gene library
pnpm test src/lib/genomics src/lib/company.test.ts
python -m unittest discover -s tools/genome-library -p "test_*.py"
python tools/genome-library/capture_library.py --build-only   # rebuild library.json from data/genome/library
```

The tests use synthetic fixtures and need no network. A full capture needs the sources, so it runs in
GitHub Actions.

## 9. Related neurodevelopmental evidence: proposed, not built

Autism stays narrowly defined: only curations whose disease label names autism. ClinGen's Intellectual
Disability and Autism expert panel also curated 370 genes under other labels, mostly "complex
neurodevelopmental disorder", "syndromic intellectual disability" and "intellectual disability". They are
**not** autism genes and are not counted as such.

They could be shown separately, as "related neurodevelopmental evidence". This is not built, and it will not
be until a genomics reviewer approves the rule (review REV-LIBRARY-SCOPE). **No reviewer has decided yet.**
Proposed rule:

1. **Included:** curations by that expert panel whose disease label does not name autism.
2. **Shown:** each curation's own disease label and MONDO ID, verbatim, with its classification, date and
   report link.
3. **Placement:** a separate section headed "Related neurodevelopmental evidence (not autism-specific)". It
   is never added to the autism count, filter or cross-species baseline.
4. **Excluded:** curations by other panels, and any label the reviewer marks as too broad.

