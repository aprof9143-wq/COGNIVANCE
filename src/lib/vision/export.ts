/**
 * The Vision evidence export. Built here, not in the component, so a test can
 * check what it can and cannot contain: the not-for-clinical-use statement,
 * the source policy's withheld list, and no content from a withheld source.
 * Variant records are deliberately not a field of the export.
 */

import { LICENCES } from "@/lib/genome/config";
import { withheldSources } from "@/lib/genome/policy";
import { NOT_FOR_CLINICAL_USE } from "@/lib/genome/status";
import type { VisionRecord } from "./sources";

export type EvidenceExportInput = {
  exportedAt: string;
  target: { gene: string; taxonId: number; condition: string };
  record: VisionRecord | null;
  structure: unknown;
  crossChecks: unknown;
  decisions: unknown;
};

export function buildEvidenceExport(i: EvidenceExportInput) {
  return {
    module: "cognivance-vision-evidence",
    schema: 2,
    exportedAt: i.exportedAt,
    notice: `${NOT_FOR_CLINICAL_USE} Values are as each source reported them at retrieval.`,
    target: i.target,
    record: i.record,
    structure: i.structure,
    crossChecks: i.crossChecks,
    decisions: i.decisions,
    sourcePolicy: {
      inventoryVersion: LICENCES.inventoryVersion,
      withheld: withheldSources(),
    },
  };
}
