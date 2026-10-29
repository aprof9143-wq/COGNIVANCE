/**
 * Governance records for Genome v1 (config/genome/governance/), typed and
 * validated: intended use, product status, requirements with their
 * traceability, risks, verification and validation plans, reviews, changes
 * and the clinical release gate (release.ts).
 *
 * These are records for later independent review. Their existence, and the
 * tests that check them, do not show that the software is clinically valid,
 * safe, or compliant with any standard or regulation.
 */

import { z } from "zod";
import changesJson from "../../../config/genome/governance/changes.json";
import intendedUseJson from "../../../config/genome/governance/intended-use.json";
import productStatusJson from "../../../config/genome/governance/product-status.json";
import requirementsJson from "../../../config/genome/governance/requirements.json";
import reviewsJson from "../../../config/genome/governance/reviews.json";
import risksJson from "../../../config/genome/governance/risks.json";
import vvJson from "../../../config/genome/governance/verification-validation.json";
import { RELEASE_GATE } from "./release";

const Version = z.string().regex(/^\d+\.\d+\.\d+$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Record = { schemaVersion: z.literal(1), recordVersion: Version, note: z.string().min(1) };

export const ITEM_STATUS = [
  "implemented",
  "proposed",
  "incomplete",
  "requires-qualified-review",
] as const;
export type ItemStatus = (typeof ITEM_STATUS)[number];

export const IntendedUse = z.object({
  ...Record,
  effectiveFrom: Day,
  status: z.literal("research-only"),
  intendedUse: z.string().min(1),
  excludedUses: z.array(z.string()).min(1),
  targetUsers: z.array(z.string()).min(1),
  notTargetUsers: z.array(z.string()),
  useEnvironment: z.string(),
  scope: z.object({
    conditions: z.array(z.object({ name: z.string(), basis: z.string() })),
    genes: z.object({ registry: z.string(), panel: z.string(), note: z.string() }),
    referenceBuilds: z.array(z.literal("GRCh38")).length(1),
    inputTypes: z.array(
      z.object({
        type: z.string(),
        versions: z.array(z.string()),
        scope: z.string(),
        status: z.enum(["implemented-unvalidated", "proposed"]),
      }),
    ),
    species: z.array(z.object({ taxonId: z.number(), name: z.string() })),
  }),
  limitations: z.array(z.string()).min(1),
  speciesCaveats: z.array(z.string()),
});

export const STATUS_CATEGORIES = [
  "research",
  "implemented-unvalidated",
  "blocked",
  "proposed",
  "future-clinical-readiness",
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** Plain-language headings for the five status groups, in reading order. */
export const STATUS_HEADINGS: Record<StatusCategory, string> = {
  research: "Works today, for research",
  "implemented-unvalidated": "Built, not validated",
  blocked: "Blocked",
  proposed: "Proposed",
  "future-clinical-readiness": "Needed before any clinical use",
};

export const ProductStatus = z.object({
  ...Record,
  effectiveFrom: Day,
  softwareVersion: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      category: z.enum(STATUS_CATEGORIES),
      name: z.string(),
      description: z.string(),
      requirements: z.array(z.string()),
    }),
  ),
});
export type ProductStatus = z.infer<typeof ProductStatus>;

export const Requirements = z.object({
  ...Record,
  effectiveFrom: Day,
  requirements: z.array(
    z.object({
      id: z.string().regex(/^REQ-\d{3}$/),
      statement: z.string().min(1),
      source: z.string().min(1),
      status: z.enum(ITEM_STATUS),
      implementation: z.array(z.string()),
      verification: z.array(z.object({ file: z.string(), test: z.string() })),
      note: z.string().optional(),
      /** The release that first shipped it; null until there is a release. */
      release: z.string().nullable(),
    }),
  ),
});
export type Requirements = z.infer<typeof Requirements>;

export const Risks = z.object({
  ...Record,
  effectiveFrom: Day,
  risks: z.array(
    z.object({
      id: z.string().regex(/^RISK-\d{3}$/),
      issue: z.string(),
      mitigation: z.string(),
      requirements: z.array(z.string()),
      owner: z.string().min(1),
      status: z.enum(["open", "mitigated-in-software-pending-review", "closed"]),
      residual: z.string().optional(),
    }),
  ),
});

export const VerificationValidation = z.object({
  ...Record,
  effectiveFrom: Day,
  protocols: z.array(
    z.object({
      id: z.string(),
      kind: z.enum([
        "software-verification",
        "accessibility-check",
        "analytical-validation",
        "clinical-validation",
      ]),
      purpose: z.string(),
      dataset: z.string().nullable(),
      metrics: z.array(z.string()),
      acceptanceCriteria: z.string().nullable(),
      results: z.unknown().nullable(),
      approver: z.string().nullable(),
      status: z.enum(ITEM_STATUS),
      note: z.string().optional(),
    }),
  ),
});

const CompletedReview = z.object({
  id: z.string(),
  reviewId: z.string(),
  reviewer: z.string().min(1),
  role: z.string().min(1),
  date: Day,
  outcome: z.enum(["approved", "approved-with-conditions", "rejected"]),
  rationale: z.string().min(1),
  documentRef: z.string().min(1),
});

export const Reviews = z.object({
  ...Record,
  effectiveFrom: Day,
  required: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      reviewerRole: z.string(),
      status: z.enum(["not-started", "in-progress", "completed"]),
      blocks: z.array(z.string()),
    }),
  ),
  completed: z.array(CompletedReview),
});

export const Changes = z.object({
  ...Record,
  changes: z.array(
    z.object({
      id: z.string(),
      date: Day,
      summary: z.string(),
      requirements: z.array(z.string()),
      reference: z.string(),
      release: z.string().nullable(),
    }),
  ),
});

export const GOVERNANCE = {
  intendedUse: IntendedUse.parse(intendedUseJson),
  productStatus: ProductStatus.parse(productStatusJson),
  requirements: Requirements.parse(requirementsJson),
  risks: Risks.parse(risksJson),
  verificationValidation: VerificationValidation.parse(vvJson),
  reviews: Reviews.parse(reviewsJson),
  changes: Changes.parse(changesJson),
  releaseGate: RELEASE_GATE,
};
export type Governance = typeof GOVERNANCE;

/**
 * Cross-record consistency: every requirement a status item, risk or change
 * names exists; implemented requirements name implementation and tests; a
 * completed review needs a required review to answer. Returns problems found.
 */
export function consistencyProblems(g: Governance = GOVERNANCE): string[] {
  const reqs = new Map(g.requirements.requirements.map((r) => [r.id, r]));
  const out: string[] = [];
  const check = (where: string, ids: string[]) => {
    for (const id of ids) if (!reqs.has(id)) out.push(`${where} names unknown requirement ${id}.`);
  };
  for (const i of g.productStatus.items) check(`Status item ${i.id}`, i.requirements);
  for (const r of g.risks.risks) check(`Risk ${r.id}`, r.requirements);
  for (const c of g.changes.changes) check(`Change ${c.id}`, c.requirements);
  for (const r of g.requirements.requirements) {
    if (r.status === "implemented" && (!r.implementation.length || !r.verification.length))
      out.push(`${r.id} is implemented but names no implementation or no test.`);
    if (r.status !== "implemented" && r.release)
      out.push(`${r.id} is ${r.status} but records a release.`);
  }
  const required = new Set(g.reviews.required.map((r) => r.id));
  for (const c of g.reviews.completed)
    if (!required.has(c.reviewId)) out.push(`Completed review ${c.id} answers no required review.`);
  if (new Set(reqs.keys()).size !== g.requirements.requirements.length)
    out.push("Requirement ids are not unique.");
  return out;
}

/** JSON with keys sorted at every level, 2-space indent and a final newline. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, sort((v as { [k: string]: unknown })[k])]),
          )
        : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** SHA-256 (hex) of the canonical JSON of every governance record. */
export async function governanceDigest(g: Governance = GOVERNANCE): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(g));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
