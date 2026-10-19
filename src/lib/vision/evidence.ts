/**
 * Every value the Vision module shows says where it came from and what kind of
 * evidence it is. A value without a source cannot be constructed.
 *
 * Seven kinds, never mixed:
 *
 *   measured      directly measured (an experimentally determined structure)
 *   reference     retrieved from an external reference database
 *   user          entered by a person in this app
 *   computed      calculated by this software from other values
 *   inferred      reasoned from other evidence, not stated by any source
 *   hypothetical  a design scenario; asserts nothing about the world
 *   validated     clinically validated for a stated intended use. Requires a
 *                 validation record; nothing in this module carries one.
 *
 * Missing and conflicting values are states of their own, so the UI can show a
 * gap as a gap instead of filling it.
 */

export type EvidenceKind =
  "measured" | "reference" | "user" | "computed" | "inferred" | "hypothetical" | "validated";

export const EVIDENCE: Record<EvidenceKind, { label: string; description: string }> = {
  measured: {
    label: "Measured",
    description: "Directly measured, e.g. an experimentally determined structure.",
  },
  reference: {
    label: "Reference",
    description: "Retrieved from an external reference database, as that source states it.",
  },
  user: { label: "User-entered", description: "Entered by a person in this app." },
  computed: {
    label: "Computed",
    description: "Calculated by this software or by a model from other values.",
  },
  inferred: {
    label: "Inferred",
    description: "Reasoned from other evidence; no source states it directly.",
  },
  hypothetical: {
    label: "Hypothetical",
    description: "A design scenario. It asserts nothing about biology or patients.",
  },
  validated: {
    label: "Clinically validated",
    description:
      "Validated for a stated intended use, with a validation record. Nothing in this module is.",
  },
};

export type Provenance = {
  /** Human-readable source, e.g. "Ensembl REST". */
  source: string;
  /** The exact request that produced the value. */
  url: string;
  /** The source's identifier for the record, versioned where it has one. */
  recordId?: string | undefined;
  /** Database release or entry version, as the source reports it. */
  release?: string | undefined;
  /** ISO 8601 time the response was received. */
  retrievedAt: string;
  note?: string | undefined;
};

export type Sourced<T> =
  | { state: "value"; value: T; kind: EvidenceKind; provenance: Provenance }
  | { state: "missing"; reason: string; provenance?: Provenance | undefined }
  | {
      state: "conflict";
      reason: string;
      values: { value: T; provenance: Provenance }[];
    };

export function sourced<T>(value: T, kind: EvidenceKind, provenance: Provenance): Sourced<T> {
  if (kind === "validated")
    throw new Error("A validated value needs a validation record; this module has none.");
  return { state: "value", value, kind, provenance };
}

export function missing<T>(reason: string, provenance?: Provenance): Sourced<T> {
  return { state: "missing", reason, provenance };
}

export function valueOf<T>(s: Sourced<T>): T | undefined {
  return s.state === "value" ? s.value : undefined;
}

/** Map a present value; gaps and conflicts pass through unchanged. */
export function mapSourced<T, U>(s: Sourced<T>, f: (v: T) => U): Sourced<U> {
  if (s.state === "value") return { ...s, value: f(s.value) };
  if (s.state === "missing") return s;
  return { ...s, values: s.values.map((x) => ({ ...x, value: f(x.value) })) };
}
