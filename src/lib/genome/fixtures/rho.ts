/**
 * SYNTHETIC test fixtures for a second gene, RHO, shaped like the real
 * responses of each source. The identifiers are those in the gene registry
 * (confirmed by a live capture on 2026-10-27); coordinates, sequences,
 * versions and variant records are made up for testing and are not real data.
 * Not a panel decision (D5).
 */

export const RHO_SEQ = "MNGTEGPNFYVPFSNATGVV";

export const rhoEnsemblLookup = {
  id: "ENSG00000163914",
  version: 99,
  display_name: "RHO",
  description: "rhodopsin [Source:HGNC Symbol;Acc:HGNC:10012]",
  biotype: "protein_coding",
  assembly_name: "GRCh38",
  seq_region_name: "3",
  start: 1000,
  end: 7000,
  strand: 1,
  canonical_transcript: "ENST00000999901.1",
  Transcript: [
    {
      id: "ENST00000999901",
      version: 1,
      biotype: "protein_coding",
      is_canonical: 1,
      Exon: [
        { id: "ENSE00000999901", start: 1000, end: 1400 },
        { id: "ENSE00000999902", start: 6000, end: 7000 },
      ],
      Translation: { id: "ENSP00000999901", length: RHO_SEQ.length },
    },
  ],
};

export const rhoUniProtSearch = {
  results: [
    {
      primaryAccession: "P08100",
      uniProtkbId: "OPSD_HUMAN",
      entryType: "UniProtKB reviewed (Swiss-Prot)",
      entryAudit: { entryVersion: 1, sequenceVersion: 1 },
      organism: { scientificName: "Homo sapiens", taxonId: 9606 },
      proteinDescription: { recommendedName: { fullName: { value: "Rhodopsin" } } },
      genes: [{ geneName: { value: "RHO" } }],
      uniProtKBCrossReferences: [
        { database: "HGNC", id: "HGNC:10012" },
        {
          database: "Ensembl",
          id: "ENST00000999901.1",
          properties: [
            { key: "ProteinId", value: "ENSP00000999901.1" },
            { key: "GeneId", value: "ENSG00000163914.99" },
          ],
        },
      ],
      sequence: { value: RHO_SEQ, length: RHO_SEQ.length },
    },
  ],
};

export const rhoAlphaFold = [
  {
    entryId: "AF-P08100-F1",
    uniprotAccession: "P08100",
    uniprotStart: 1,
    uniprotEnd: RHO_SEQ.length,
    uniprotSequence: RHO_SEQ,
    modelCreatedDate: "2026-01-01T00:00:00Z",
    latestVersion: 9,
    pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-P08100-F1-model_v9.pdb",
    globalMetricValue: 90.5,
  },
  {
    entryId: "AF-Q00000-F1",
    uniprotAccession: "Q00000",
    pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-Q00000-F1-model_v9.pdb",
  },
];

const record = (
  uid: string,
  title: string,
  genes: string[],
  classification: string,
  locs: object[],
) => ({
  uid,
  accession: `VCV${uid.padStart(9, "0")}`,
  title,
  obj_type: "single nucleotide variant",
  genes: genes.map((symbol) => ({ symbol })),
  germline_classification: {
    description: classification,
    review_status: "criteria provided, single submitter",
    last_evaluated: "2026/01/01 00:00",
    trait_set: [{ trait_name: "Synthetic condition" }],
  },
  molecular_consequence_list: ["missense variant"],
  variation_set: [{ cdna_change: "c.68C>A", variation_loc: locs }],
});

export const rhoClinVarBatch = {
  result: {
    uids: ["9001", "9002", "9003", "9004", "9005"],
    "9001": record("9001", "NM_000000.0(RHO):c.68C>A (p.Pro23His)", ["RHO"], "Pathogenic", [
      { status: "current", assembly_name: "GRCh38", start: "1068", stop: "1068" },
      { status: "previous", assembly_name: "GRCh37", start: "5068", stop: "5068" },
    ]),
    "9002": record(
      "9002",
      "NM_000000.0(RHO):c.10G>A (p.Gly4Ser)",
      ["RHO"],
      "Uncertain significance",
      [{ status: "previous", assembly_name: "GRCh37", start: "5010", stop: "5010" }],
    ),
    "9003": record("9003", "GRCh38/hg38 3q22 deletion", ["RHO", "OTHERGENE"], "Pathogenic", []),
    "9004": { uid: "9004", error: "cannot get document summary" },
    // 9005 is listed but has no summary at all.
  },
};
