/**
 * The release gate for clinical mode. Clinical mode, patient-specific
 * interpretation and clinical claims are unavailable unless every required
 * piece of evidence is verified AND backed by a recorded approval with a named
 * approver, role, date and document reference.
 *
 * Availability is computed here from that evidence. The gate file's `status`
 * field is informational: setting it to "available" changes nothing, and no
 * environment variable or UI control is read. Today no evidence exists, so
 * clinical mode is unavailable.
 *
 * Passing this check would mean the records exist, not that the product is
 * clinically valid, safe or compliant with any regulation.
 */

import { z } from "zod";
import gateJson from "../../../config/genome/governance/release-gate.json";

const Evidence = z.object({
  id: z.string(),
  description: z.string(),
  reviewerRole: z.string(),
  status: z.enum(["missing", "in-progress", "verified"]),
  /** The approval that verifies it; required once status is "verified". */
  approvalId: z.string().optional(),
});

const Approval = z.object({
  id: z.string(),
  approver: z.string().min(1),
  role: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outcome: z.enum(["approved", "rejected"]),
  /** Where the signed record lives, under change control. */
  documentRef: z.string().min(1),
  rationale: z.string().min(1),
});

const ReleaseGate = z.object({
  schemaVersion: z.literal(1),
  gateVersion: z.string(),
  note: z.string(),
  clinicalMode: z.object({
    status: z.string(),
    requiredEvidence: z.array(Evidence).min(1),
    approvals: z.array(Approval),
  }),
});
export type ReleaseGate = z.infer<typeof ReleaseGate>;

export const parseReleaseGate = (raw: unknown): ReleaseGate => ReleaseGate.parse(raw);
export const RELEASE_GATE = parseReleaseGate(gateJson);

export type ClinicalAvailability = {
  available: boolean;
  /** Plain-language reasons it is unavailable, one per unmet requirement. */
  unmet: string[];
};

/** Whether clinical mode may be offered, computed from evidence and approvals only. */
export function clinicalModeAvailability(gate: ReleaseGate = RELEASE_GATE): ClinicalAvailability {
  const approvals = new Map(gate.clinicalMode.approvals.map((a) => [a.id, a]));
  const unmet: string[] = [];
  for (const e of gate.clinicalMode.requiredEvidence) {
    if (e.status !== "verified") {
      unmet.push(`${e.id}: ${e.status} (needs a ${e.reviewerRole}).`);
      continue;
    }
    const a = e.approvalId ? approvals.get(e.approvalId) : undefined;
    if (!a) unmet.push(`${e.id}: marked verified but no recorded approval backs it.`);
    else if (a.outcome !== "approved")
      unmet.push(`${e.id}: its approval ${a.id} was ${a.outcome}.`);
  }
  return { available: unmet.length === 0, unmet };
}
