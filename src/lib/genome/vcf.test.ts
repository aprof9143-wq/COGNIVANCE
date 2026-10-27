import { describe, expect, it } from "vitest";
import { buildNamed, validateVcfHeader } from "./vcf";

/** Synthetic headers; no real samples or variants. */
const vcf = (lines: string[], version = "4.2", samples: string[] = []) =>
  [
    `##fileformat=VCFv${version}`,
    ...lines,
    [
      "#CHROM",
      "POS",
      "ID",
      "REF",
      "ALT",
      "QUAL",
      "FILTER",
      "INFO",
      ...(samples.length ? ["FORMAT", ...samples] : []),
    ].join("\t"),
    "1\t68446827\t.\tA\tG\t.\tPASS\t.",
  ].join("\n");

const REF38 = "##reference=GRCh38";

describe("VCF version", () => {
  it.each(["4.2", "4.3", "4.4", "4.5"])("accepts VCF %s", (v) => {
    const r = validateVcfHeader(vcf([REF38], v));
    expect(r.ok && r.version).toBe(v);
  });

  it.each(["4.1", "4.0", "3.3"])("rejects the older VCF %s without converting it", (v) => {
    const r = validateVcfHeader(vcf([REF38], v));
    expect(r).toMatchObject({ ok: false, code: "version-unsupported", line: 1 });
    expect(!r.ok && r.message).toMatch(
      /older than Genome v1 accepts \(4\.2 or later\)\. The file was not converted/,
    );
  });

  it("rejects versions it does not recognise", () => {
    expect(validateVcfHeader(vcf([REF38], "5.0"))).toMatchObject({ code: "version-unsupported" });
    expect(validateVcfHeader(vcf([REF38], "4.9"))).toMatchObject({ code: "version-unsupported" });
  });

  it("rejects files that are not VCF, or are compressed", () => {
    expect(validateVcfHeader("chr1\t100\tA\tG")).toMatchObject({ code: "not-vcf" });
    expect(validateVcfHeader("")).toMatchObject({ code: "not-vcf" });
    expect(validateVcfHeader("\u001f\u008b\b\u0000")).toMatchObject({ code: "compressed" });
  });
});

describe("reference build: GRCh38 only", () => {
  it("accepts GRCh38 named in ##reference, in several spellings", () => {
    for (const ref of [
      "GRCh38",
      "hg38",
      "file:///refs/Homo_sapiens_assembly38.fasta",
      "GCA_000001405.15_GRCh38_no_alt_analysis_set",
      "GCF_000001405.40",
    ]) {
      const r = validateVcfHeader(vcf([`##reference=${ref}`]));
      expect(r.ok, ref).toBe(true);
    }
  });

  it("accepts GRCh38 contig lengths, with or without the chr prefix", () => {
    for (const p of ["chr", ""]) {
      const r = validateVcfHeader(
        vcf([`##contig=<ID=${p}1,length=248956422>`, `##contig=<ID=${p}X,length=156040895>`]),
      );
      expect(r).toMatchObject({ ok: true, assembly: "GRCh38", contigs: 2 });
    }
  });

  it("accepts a contig assembly attribute", () => {
    expect(validateVcfHeader(vcf(["##contig=<ID=chr1,length=248956422,assembly=GRCh38>"])).ok).toBe(
      true,
    );
  });

  it.each([
    ["##reference=GRCh37", "GRCh37"],
    ["##reference=hg19", "GRCh37"],
    ["##reference=file:///refs/human_g1k_v37.fasta", "GRCh37"],
    ["##reference=hs37d5", "GRCh37"],
    ["##reference=NCBI36", "NCBI36"],
    ["##reference=T2T-CHM13v2.0", "T2T-CHM13"],
    ["##contig=<ID=1,length=249250621>", "GRCh37"],
  ])("rejects %s as not GRCh38, without liftover", (line, build) => {
    const r = validateVcfHeader(vcf([line]));
    expect(r).toMatchObject({ ok: false, code: "build-unsupported" });
    expect(!r.ok && r.message).toContain(build);
    expect(!r.ok && r.message).toMatch(/not lifted over or converted/);
  });

  it("rejects mixed evidence rather than picking a side", () => {
    const r = validateVcfHeader(vcf([REF38, "##contig=<ID=chr1,length=249250621>"]));
    expect(r).toMatchObject({ ok: false, code: "build-unsupported" });
  });

  it("does not guess a build from chromosome names alone", () => {
    const r = validateVcfHeader(vcf(["##contig=<ID=chr1>", "##source=caller"]));
    expect(r).toMatchObject({ ok: false, code: "build-unconfirmed" });
  });

  it("names builds from free text", () => {
    expect(buildNamed("GRCh38.p14")).toBe("GRCh38");
    expect(buildNamed("b37")).toBe("GRCh37");
    expect(buildNamed("my_reference.fa")).toBeNull();
  });
});

describe("header structure and privacy", () => {
  it("requires the #CHROM line with the fixed columns", () => {
    expect(validateVcfHeader(`##fileformat=VCFv4.2\n${REF38}\n`)).toMatchObject({
      code: "header-malformed",
    });
    expect(
      validateVcfHeader(`##fileformat=VCFv4.2\n${REF38}\n#CHROM POS ID REF ALT QUAL FILTER INFO`),
    ).toMatchObject({ code: "header-malformed" });
    expect(validateVcfHeader(`##fileformat=VCFv4.2\n${REF38}\n1\t1\t.\tA\tG`)).toMatchObject({
      code: "header-malformed",
      line: 3,
    });
  });

  it("requires FORMAT before sample columns", () => {
    const text = `##fileformat=VCFv4.2\n${REF38}\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tS1`;
    expect(validateVcfHeader(text)).toMatchObject({ code: "header-malformed" });
  });

  it("counts samples but never returns their names", () => {
    const r = validateVcfHeader(vcf([REF38], "4.2", ["PATIENT_A", "PATIENT_B"]));
    expect(r).toMatchObject({ ok: true, sampleCount: 2 });
    expect(JSON.stringify(r)).not.toContain("PATIENT");
  });

  it("handles CRLF line endings and a byte-order mark", () => {
    expect(validateVcfHeader("\uFEFF" + vcf([REF38]).replace(/\n/g, "\r\n")).ok).toBe(true);
  });
});
