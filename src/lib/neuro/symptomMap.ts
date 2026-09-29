/**
 * Symptom → network research associations.
 *
 * Each row is a probabilistic, network-level association reported in the
 * literature — NOT a localisation, and never evidence that a region explains
 * a symptom in a given person. Atypical presentations and mixed pathologies
 * produce different patterns. Every association carries its source and a
 * confidence, and the table is editable so a group can record its own.
 */

import { ATLAS, idsForKey, region } from "./atlas";
import type { Citation, SymptomDomain } from "./schema";

export const CITATIONS: Citation[] = [
  {
    id: "dickerson2010",
    text: "Dickerson BC, Eichenbaum H. The episodic memory system: neurocircuitry and disorders. Neuropsychopharmacology 2010;35:86–104.",
    doi: "10.1038/npp.2009.126",
  },
  {
    id: "gornotempini2011",
    text: "Gorno-Tempini ML, et al. Classification of primary progressive aphasia and its variants. Neurology 2011;76:1006–1014.",
    doi: "10.1212/WNL.0b013e31821103e6",
  },
  {
    id: "stuss2000",
    text: "Stuss DT, Alexander MP. Executive functions and the frontal lobes: a conceptual view. Psychol Res 2000;63:289–298.",
    doi: "10.1007/s004269900007",
  },
  {
    id: "ossenkoppele2015",
    text: "Ossenkoppele R, et al. The behavioural/dysexecutive variant of Alzheimer's disease: clinical, neuroimaging and pathological features. Brain 2015;138:2732–2749.",
    doi: "10.1093/brain/awv191",
  },
  {
    id: "crutch2017",
    text: "Crutch SJ, et al. Consensus classification of posterior cortical atrophy. Alzheimers Dement 2017;13:870–884.",
    doi: "10.1016/j.jalz.2017.01.014",
  },
  {
    id: "coughlan2018",
    text: "Coughlan G, et al. Spatial navigation deficits — overlooked cognitive marker for preclinical Alzheimer disease? Nat Rev Neurol 2018;14:496–506.",
    doi: "10.1038/s41582-018-0031-x",
  },
  {
    id: "corbetta2002",
    text: "Corbetta M, Shulman GL. Control of goal-directed and stimulus-driven attention in the brain. Nat Rev Neurosci 2002;3:201–215.",
    doi: "10.1038/nrn755",
  },
  {
    id: "rascovsky2011",
    text: "Rascovsky K, et al. Sensitivity of revised diagnostic criteria for the behavioural variant of frontotemporal dementia. Brain 2011;134:2456–2477.",
    doi: "10.1093/brain/awr179",
  },
  {
    id: "seeley2009",
    text: "Seeley WW, et al. Neurodegenerative diseases target large-scale human brain networks. Neuron 2009;62:42–52.",
    doi: "10.1016/j.neuron.2009.03.024",
  },
  {
    id: "mckeith2017",
    text: "McKeith IG, et al. Diagnosis and management of dementia with Lewy bodies: fourth consensus report of the DLB Consortium. Neurology 2017;89:88–100.",
    doi: "10.1212/WNL.0000000000004058",
  },
  {
    id: "wardlaw2013",
    text: "Wardlaw JM, et al. Neuroimaging standards for research into small vessel disease and its contribution to ageing and neurodegeneration (STRIVE). Lancet Neurol 2013;12:822–838.",
    doi: "10.1016/S1474-4422(13)70124-8",
  },
  {
    id: "jack2018",
    text: "Jack CR Jr, et al. NIA-AA Research Framework: toward a biological definition of Alzheimer's disease. Alzheimers Dement 2018;14:535–562.",
    doi: "10.1016/j.jalz.2018.02.018",
  },
  {
    id: "scheltens1992",
    text: "Scheltens P, et al. Atrophy of medial temporal lobes on MRI in 'probable' Alzheimer's disease and normal ageing. J Neurol Neurosurg Psychiatry 1992;55:967–972.",
    doi: "10.1136/jnnp.55.10.967",
  },
  {
    id: "koedam2011",
    text: "Koedam ELGE, et al. Visual assessment of posterior atrophy development of a MRI rating scale. Eur Radiol 2011;21:2618–2625.",
    doi: "10.1007/s00330-011-2205-4",
  },
  {
    id: "pasquier1996",
    text: "Pasquier F, et al. Inter- and intraobserver reproducibility of cerebral atrophy assessment on MRI scans with hemispheric infarcts. Eur Neurol 1996;36:268–272.",
    doi: "10.1159/000117270",
  },
  {
    id: "fazekas1987",
    text: "Fazekas F, et al. MR signal abnormalities at 1.5 T in Alzheimer's dementia and normal aging. AJR Am J Roentgenol 1987;149:351–356.",
    doi: "10.2214/ajr.149.2.351",
  },
];

export type Strength = "strong" | "moderate" | "supporting";

export type Association = {
  id: string;
  domain: SymptomDomain;
  network: string;
  /** Region keys in the atlas (resolved to stable atlas IDs below). */
  regionKeys: string[];
  /** "left" when the literature reports dominant-hemisphere emphasis. */
  laterality: "left" | "right" | "bilateral";
  strength: Strength;
  confidence: "low" | "medium" | "high";
  citations: string[];
  caveat: string;
};

export const DOMAIN_LABEL: Record<SymptomDomain, string> = {
  "episodic-memory": "Episodic memory",
  language: "Language / word-finding",
  executive: "Executive function",
  visuospatial: "Visuospatial",
  disorientation: "Disorientation / navigation",
  attention: "Attention",
  behaviour: "Behaviour / personality",
  adl: "Activities of daily living",
  "motor-gait": "Motor / gait",
};

export const DEFAULT_ASSOCIATIONS: Association[] = [
  {
    id: "mem-mtl",
    domain: "episodic-memory",
    network: "Medial temporal lobe memory system",
    regionKeys: ["hippocampus", "entorhinal", "parahippocampal"],
    laterality: "bilateral",
    strength: "strong",
    confidence: "high",
    citations: ["dickerson2010"],
    caveat: "Medial temporal atrophy also occurs in hippocampal sclerosis, LATE and normal ageing.",
  },
  {
    id: "mem-pmc",
    domain: "episodic-memory",
    network: "Posteromedial (default-mode) hub",
    regionKeys: ["posterior-cingulate", "isthmus-cingulate", "precuneus"],
    laterality: "bilateral",
    strength: "moderate",
    confidence: "medium",
    citations: ["dickerson2010", "seeley2009"],
    caveat: "Posteromedial involvement is more prominent in early-onset presentations.",
  },
  {
    id: "lang-tp",
    domain: "language",
    network: "Dominant temporoparietal language network (logopenic pattern)",
    regionKeys: [
      "supramarginal",
      "inferior-parietal",
      "banks-of-superior-temporal-sulcus",
      "middle-temporal",
      "superior-temporal",
    ],
    laterality: "left",
    strength: "strong",
    confidence: "medium",
    citations: ["gornotempini2011"],
    caveat:
      "Dominance is usually left; confirm handedness. Non-fluent and semantic variants have other patterns.",
  },
  {
    id: "exec-fp",
    domain: "executive",
    network: "Frontoparietal control network",
    regionKeys: [
      "rostral-middle-frontal",
      "caudal-middle-frontal",
      "caudal-anterior-cingulate",
      "rostral-anterior-cingulate",
      "superior-parietal",
      "inferior-parietal",
    ],
    laterality: "bilateral",
    strength: "moderate",
    confidence: "medium",
    citations: ["stuss2000", "ossenkoppele2015"],
    caveat:
      "Executive dysfunction is common to many conditions, including vascular disease and depression.",
  },
  {
    id: "exec-subcortical",
    domain: "executive",
    network: "Frontostriatal circuits",
    regionKeys: ["caudate", "thalamus"],
    laterality: "bilateral",
    strength: "supporting",
    confidence: "low",
    citations: ["stuss2000"],
    caveat:
      "Subcortical executive syndromes point toward vascular or other non-Alzheimer's causes.",
  },
  {
    id: "vis-post",
    domain: "visuospatial",
    network: "Posterior cortical (dorsal and ventral visual streams)",
    regionKeys: [
      "superior-parietal",
      "inferior-parietal",
      "precuneus",
      "lateral-occipital",
      "cuneus",
      "fusiform",
    ],
    laterality: "bilateral",
    strength: "strong",
    confidence: "high",
    citations: ["crutch2017"],
    caveat:
      "Posterior cortical atrophy is an atypical presentation; Lewy body disease also impairs visuospatial function.",
  },
  {
    id: "orient-nav",
    domain: "disorientation",
    network: "Navigation network",
    regionKeys: [
      "hippocampus",
      "entorhinal",
      "isthmus-cingulate",
      "posterior-cingulate",
      "precuneus",
      "parahippocampal",
    ],
    laterality: "bilateral",
    strength: "moderate",
    confidence: "medium",
    citations: ["coughlan2018"],
    caveat: "The retrosplenial cortex is approximated by the isthmus cingulate in this atlas.",
  },
  {
    id: "attn-dan",
    domain: "attention",
    network: "Dorsal attention / frontoparietal",
    regionKeys: ["superior-parietal", "caudal-middle-frontal", "precuneus"],
    laterality: "bilateral",
    strength: "supporting",
    confidence: "low",
    citations: ["corbetta2002"],
    caveat:
      "Fluctuating attention suggests delirium or Lewy body disease; attention is not region-specific.",
  },
  {
    id: "beh-salience",
    domain: "behaviour",
    network: "Salience and orbitofrontal–limbic networks",
    regionKeys: [
      "lateral-orbitofrontal",
      "medial-orbitofrontal",
      "caudal-anterior-cingulate",
      "rostral-anterior-cingulate",
      "insula",
      "temporal-pole",
      "amygdala",
    ],
    laterality: "bilateral",
    strength: "moderate",
    confidence: "medium",
    citations: ["rascovsky2011", "seeley2009", "ossenkoppele2015"],
    caveat:
      "Prominent early behavioural change warrants assessment for frontotemporal dementia and psychiatric causes.",
  },
  {
    id: "motor",
    domain: "motor-gait",
    network: "Motor, basal ganglia, cerebellar and white-matter pathways",
    regionKeys: [
      "precentral",
      "paracentral",
      "putamen",
      "pallidum",
      "caudate",
      "cerebellum-cortex",
      "wm-hypointensities",
    ],
    laterality: "bilateral",
    strength: "supporting",
    confidence: "low",
    citations: ["mckeith2017", "wardlaw2013"],
    caveat:
      "Not specific to typical Alzheimer's disease: requires broader differential assessment (vascular disease, Lewy body disease, parkinsonism, normal-pressure hydrocephalus).",
  },
];

/** Stable atlas IDs for an association, honouring its laterality. */
export function associationRegionIds(a: Association): number[] {
  return a.regionKeys.flatMap((k) =>
    idsForKey(k).filter(
      (id) => a.laterality === "bilateral" || region(id)?.hemisphere === a.laterality,
    ),
  );
}

export const ASSOCIATION_ATLAS = ATLAS;

/** Explanations that must accompany any pattern shown in this module. */
export const ALTERNATIVE_EXPLANATIONS = [
  "Normal ageing",
  "Cerebrovascular disease / small vessel disease",
  "Frontotemporal lobar degeneration",
  "Lewy body disease",
  "Depression and other psychiatric conditions",
  "Medication effects",
  "Sleep disorders",
  "Tumour",
  "Normal-pressure hydrocephalus",
  "Seizures",
  "Infection or inflammation",
  "Image-processing or segmentation artefact",
];
