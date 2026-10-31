# Alzheimer disease: source options and evidence criteria

Status: **proposal, not approved; nothing captured.** The library shows Alzheimer disease as "Source under
review" and holds no Alzheimer association. Nothing will be captured until a genomics reviewer and the product
owner approve a source and the inclusion criteria below (review REV-ALZHEIMER-SOURCE). Anything that is
eventually shown will be labelled research evidence, not clinical interpretation.

Every finding below comes from the providers' own pages, rendered on **2026-10-31** by the licence-terms
workflow (run 41200763872; page hashes in `source-survey.json`). Nothing is taken from memory.

## 1. Why ClinGen alone is not enough

ClinGen's gene–disease validity download of 2026-10-31 has no curation whose disease label names Alzheimer
disease. APP is curated for cerebral amyloid angiopathy, and PSEN1 and PSEN2 only for dilated
cardiomyopathy. Relabelling those curations as Alzheimer evidence is ruled out.

## 2. Candidates

| Source | Available on 2026-10-31 | Evidence type | Provenance and updates | Terms | Fit |
| --- | --- | --- | --- | --- | --- |
| **AlzGene** | **No.** `www.alzgene.org` does not resolve over http or https. | Meta-analyses of published genetic association studies | Could not be checked | Could not be read | **Not usable.** It cannot be fetched, so its provenance and update status cannot be verified. |
| **GenCC** (Gene Curation Coalition) | Yes | Gene–disease validity curations from several submitters, mapped to standard terms and to MONDO disease IDs | Submissions carry a stable ID and version; files are served with Last-Modified; the download quota is 20 per IP per day | "available free of restriction under a CC0 1.0 Universal (CC0 1.0) Public Domain Dedication"; attribution requested; "does not include OMIM data" because of OMIM's licensing | **Recommended for monogenic, early-onset forms**, if the data contain Alzheimer curations. This is not yet checked: a capture is needed. |
| **NHGRI-EBI GWAS Catalog** | Yes | Genome-wide significant variant–trait associations; the "mapped gene" is assigned by genomic location | Curated from publications; "the data is released on a bi-weekly cycle"; trait MONDO_0004975 page lists 7158 associations from 269 studies | "available under the general Terms of Use for EMBL-EBI Services"; summary statistics CC0 unless stated | **Recommended for common-variant risk loci**, shown as associations at loci, never as causal genes |
| **Orphadata** (Orphanet) | Yes | Genes associated with rare diseases | "Orphanet Knowledge base release of July 2026" | CC BY 4.0: attribution required; extra wording required if used in an AI tool shown to third parties | **Cross-check** for rare forms, with attribution |
| **Open Targets Platform** | Docs yes; the disease page did not render | Aggregated target–disease evidence and scores | Release notes published | "marked with CC0 1.0" | **Not recommended as the source of record.** Its scores aggregate other sources; better used to find primary sources. |
| **Alzforum Mutations** | Blocked the automated browser (HTTP 403) | Curated variant records | Could not be checked | Could not be read | **Unknown.** A person would need to read its terms. |
| **OMIM** | Blocked the automated browser (HTTP 403) | Mendelian gene–phenotype entries | Could not be checked | Could not be read; GenCC excludes OMIM data from its downloads "due to licensing restrictions" | **Not suitable** without a licence |
| **Primary literature** | n/a | Individual studies | Each paper is fixed | Per publisher | **Only with a named curator**, recorded per association; this needs its own protocol |

## 3. Proposed inclusion criteria (for approval)

The two evidence types answer different questions. They stay in **separate sections** and are never combined
into one score.

**A. Gene–disease validity (monogenic forms) — GenCC**

- **Included:** a GenCC submission whose MONDO disease ID is Alzheimer disease (MONDO:0004975) or a
  descendant the reviewer approves, for example early-onset forms. The approved MONDO list is recorded in
  `config/genome/library.json`.
- **Shown per association:**
  - gene;
  - the disease as submitted, and its MONDO ID;
  - submitter;
  - classification, in GenCC's standard term (Definitive, Strong, Moderate, Supportive, Limited, Disputed,
    Animal Model Only, Refuted);
  - mode of inheritance;
  - submission ID and version;
  - submission date;
  - link;
  - retrieval date.
- **Evidence type label:** "Gene–disease validity curation".
- **Confidence:** the submitter's classification, as stated. Disputed, Refuted and Animal Model Only stay
  visible. Different submitters' classifications are shown side by side, never merged.

**B. Common-variant association (risk loci) — GWAS Catalog**

- **Included:** associations reported for trait MONDO_0004975 itself. Child traits are included only if the
  reviewer approves them. Associations must reach genome-wide significance (p ≤ 5 × 10⁻⁸); the reviewer
  confirms the threshold.
- **Shown per association:**
  - variant and risk allele;
  - p-value;
  - effect (OR or beta) with its interval;
  - reported trait;
  - study accession and publication;
  - the mapped gene, labelled "mapped by genomic location; not shown to be causal";
  - retrieval date.
- **Evidence type label:** "Genome-wide association (common variant)".
- **Confidence:** the p-value, and how many independent studies report the locus. Not a gene-level verdict.

**Excluded in both:**
- candidate-gene studies without genome-wide significance;
- any association asserted from memory;
- OMIM content;
- any variant interpretation for a person.

## 4. What happens after approval

1. Record the decision, with reviewer and date, in DECISIONS.md, and the approved criteria in
   `config/genome/library.json`.
2. Add GenCC (and, if approved, the GWAS Catalog) to `config/genome/licences.json`, with their terms as read
   above.
3. Extend the capture tool and run it in GitHub Actions; the existing provenance, display-copy and
   sample-separation rules apply unchanged.
