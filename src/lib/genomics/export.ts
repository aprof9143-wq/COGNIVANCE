/**
 * The JSON a gene page exports: the gene's record as shown, where it came
 * from, and the not-for-clinical-use statement. Sample data says so.
 */
import { NOT_FOR_CLINICAL_USE } from "@/lib/genome/status";
import type { Library, LibraryGene } from "./schema";

export function geneExport(lib: Library, g: LibraryGene, exportedAt: string) {
  return {
    schemaVersion: 1,
    exportedAt,
    notice: `${NOT_FOR_CLINICAL_USE} ${lib.mode === "sample" ? lib.sampleNote : ""}`.trim(),
    mode: lib.mode,
    capturedAt: lib.capturedAt,
    releases: lib.releases,
    sources: lib.sources.map(({ id, name, status, retrievedAt }) => ({
      id,
      name,
      status,
      retrievedAt,
    })),
    gene: g,
  };
}
