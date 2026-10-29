/**
 * The governance records: valid, consistent, traced to code and tests that
 * exist, and free of any claim the project cannot support. These checks keep
 * the records honest; they do not show the software is clinically valid.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TARGETS, selectableTargets } from "@/lib/vision/targets";
import { PANELS, REGISTRY } from "./config";
import { canonicalJson, consistencyProblems, GOVERNANCE, governanceDigest } from "./governance";
import { clinicalModeAvailability } from "./release";

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Every file under a folder, as repository-relative paths. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("governance records", () => {
  it("are consistent with each other", () => {
    expect(consistencyProblems()).toEqual([]);
  });

  it("trace every requirement's implementation and tests to files and tests that exist", () => {
    for (const r of GOVERNANCE.requirements.requirements) {
      for (const p of r.implementation)
        expect(existsSync(join(ROOT, p)), `${r.id}: ${p}`).toBe(true);
      for (const v of r.verification) {
        expect(existsSync(join(ROOT, v.file)), `${r.id}: ${v.file}`).toBe(true);
        const src = read(v.file);
        const found = v.file.endsWith(".py")
          ? src.includes(`def ${v.test}(`)
          : src.includes(`"${v.test}"`);
        expect(found, `${r.id}: "${v.test}" in ${v.file}`).toBe(true);
      }
    }
  });

  it("gives the same digest for the same records in any key order", async () => {
    const a = await governanceDigest();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await governanceDigest()).toBe(a);
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: [2, { e: 0, f: 1 }] }, b: 1 }),
    );
  });

  it("records no completed review, approval or validation result yet", () => {
    expect(GOVERNANCE.reviews.completed).toEqual([]);
    expect(GOVERNANCE.releaseGate.clinicalMode.approvals).toEqual([]);
    for (const p of GOVERNANCE.verificationValidation.protocols) {
      expect(p.results, p.id).toBeNull();
      expect(p.approver, p.id).toBeNull();
    }
    expect(clinicalModeAvailability().available).toBe(false);
    for (const r of GOVERNANCE.requirements.requirements) expect(r.release, r.id).toBeNull();
  });

  it("keeps the intended use research-only, with the required exclusions", () => {
    const u = GOVERNANCE.intendedUse;
    expect(u.status).toBe("research-only");
    const ex = u.excludedUses.join(" | ").toLowerCase();
    for (const term of [
      "clinical decision-making",
      "diagnosis",
      "patient-specific interpretation",
      "pathogenic",
      "recommending or ranking treatments",
      "identifiable patient",
      "clinical vcf",
      "engineered genomes",
    ])
      expect(ex, term).toContain(term);
    expect(u.scope.referenceBuilds).toEqual(["GRCh38"]);
  });

  it("makes no claim of approval, clearance, clinical validation or compliance", () => {
    const affirmative =
      /\b(is|are|has been|have been|was|were)\s+(now\s+)?(clinically[- ]validated|clinical[- ]grade|fda[- ](approved|cleared)|ce[- ]marked|ukca[- ]marked|compliant with)/i;
    const texts = [
      ...walk("config/genome/governance").map((p) => [p, read(p)] as const),
      ...walk("docs/genome")
        .filter((p) => p.endsWith(".md"))
        .map((p) => [p, read(p)] as const),
      ["config/genome/licences.json", read("config/genome/licences.json")] as const,
    ];
    for (const [p, t] of texts) expect(t.match(affirmative)?.[0], p).toBeUndefined();
  });
});

describe("scope boundaries", () => {
  it("keeps RHO a test gene outside every panel", () => {
    const rho = REGISTRY.genes.find((g) => g.symbol === "RHO")!;
    expect(rho.role).toBe("test-gene");
    for (const p of PANELS) expect(p.members, p.panelId).not.toContain("RHO");
  });

  it("offers only current-focus, verified genes with a display copy as targets", () => {
    expect(TARGETS.map((t) => t.key)).toEqual(["rpe65"]);
    for (const t of TARGETS) {
      if (t.status !== "ready") continue;
      const g = REGISTRY.genes.find((x) => x.symbol === t.geneSymbol)!;
      expect(g.role).toBe("current-focus");
      expect(g.idsVerified).toBeTruthy();
      expect(existsSync(join(ROOT, "public/vision/display", t.key, "manifest.json"))).toBe(true);
    }
    // A gene promoted to current focus without a recorded condition is still not offered.
    const reg = structuredClone(REGISTRY);
    reg.genes.find((g) => g.symbol === "RHO")!.role = "current-focus";
    expect(selectableTargets(reg).map((t) => t.key)).toEqual(["rpe65"]);
    // And one without verified identifiers is not offered either.
    reg.genes.find((g) => g.symbol === "RPE65")!.idsVerified = null;
    expect(selectableTargets(reg)).toEqual([]);
  });

  it("offers no genomic or clinical data upload on the Genome and Vision pages", () => {
    const files = [
      ...walk("src/components/vision"),
      ...walk("src/routes").filter((p) => /vision/.test(p)),
    ].filter((p) => p.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(3);
    for (const p of files) {
      const src = read(p);
      expect(src, p).not.toMatch(/\.(vcf|bcf|fastq|fq|bam|cram|sam|dcm|dicom|nii|edf)\b/i);
      // The only file input is the eye page's picture picker: images only, kept in the browser.
      for (const m of src.matchAll(/type=["']file["'][^>]*/g))
        expect(m[0], p).toMatch(/accept=["']image\/\*["']/);
    }
  });

  it("contains no liftover or build conversion", () => {
    const code = [...walk("src"), ...walk("tools")].filter((p) => /\.(ts|tsx|py)$/.test(p));
    for (const p of code) {
      if (p === relative(ROOT, __filename)) continue;
      expect(read(p), p).not.toMatch(/\b(liftover|liftOver|lift_over|CrossMap|pyliftover)\s*\(/);
      expect(read(p), p).not.toMatch(/import[^\n]*(liftover|crossmap)/i);
    }
    expect(
      walk(".").filter((p) => /\.chain(\.gz)?$/.test(p) && !p.includes("node_modules")),
    ).toEqual([]);
  });

  it("keeps every record human, and cross-species comparison proposed", () => {
    expect(REGISTRY.genes.every((g) => g.taxonId === 9606)).toBe(true);
    const req = GOVERNANCE.requirements.requirements.find((r) => r.id === "REQ-014")!;
    expect(req.status).toBe("proposed");
    expect(GOVERNANCE.intendedUse.speciesCaveats.join(" ")).toMatch(/orthology/);
  });
});
