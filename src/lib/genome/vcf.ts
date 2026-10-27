/**
 * Genome v1 input gate: a VCF is accepted only if its header says VCF 4.2 or
 * later (4.2–4.5, the versions this check knows) and its reference build can
 * be confirmed as GRCh38. Anything else is rejected with the reason. Nothing
 * is converted: no liftover, no version rewriting, no guessing a build from
 * chromosome names alone.
 *
 * This checks the header only. Reading and annotating variant records is not
 * implemented yet (docs/genome/GENOME_V1.md). Sample names are counted, never
 * returned, because they can identify people.
 */

export const ACCEPTED_VERSIONS = ["4.2", "4.3", "4.4", "4.5"] as const;
export type VcfVersion = (typeof ACCEPTED_VERSIONS)[number];

type Build = "GRCh38" | "GRCh37" | "NCBI36" | "T2T-CHM13";

export type VcfRejectionCode =
  | "not-vcf"
  | "compressed"
  | "version-unsupported"
  | "build-unsupported"
  | "build-unconfirmed"
  | "header-malformed";

export type VcfRejection = { ok: false; code: VcfRejectionCode; message: string; line?: number };

export type VcfAccepted = {
  ok: true;
  version: VcfVersion;
  assembly: "GRCh38";
  /** The header lines that established GRCh38, e.g. "##reference: GRCh38". */
  evidence: string[];
  contigs: number;
  sampleCount: number;
};

/** Primary GRCh38 sequence lengths (GRCh38 primary assembly). */
const GRCH38_LENGTHS: Record<string, number> = {
  "1": 248956422,
  "2": 242193529,
  "3": 198295559,
  "4": 190214555,
  "5": 181538259,
  "6": 170805979,
  "7": 159345973,
  "8": 145138636,
  "9": 138394717,
  "10": 133797422,
  "11": 135086622,
  "12": 133275309,
  "13": 114364328,
  "14": 107043718,
  "15": 101991189,
  "16": 90338345,
  "17": 83257441,
  "18": 80373285,
  "19": 58617616,
  "20": 64444167,
  "21": 46709983,
  "22": 50818468,
  X: 156040895,
  Y: 57227415,
  M: 16569,
};

/** A few GRCh37 lengths, only to name the build in a rejection message. */
const GRCH37_LENGTHS: Record<string, number> = { "1": 249250621, "2": 243199373, X: 155270560 };

/** Which build a free-text header value names, if any. */
export function buildNamed(value: string): Build | null {
  const v = value.toLowerCase();
  if (/t2t|chm13|\bhs1\b/.test(v)) return "T2T-CHM13";
  if (
    /grch38|hg38|gca_000001405\.(1[5-9]|2\d)|gcf_000001405\.(2[6-9]|3\d|4\d)|assembly38|\bb38\b/.test(
      v,
    )
  )
    return "GRCh38";
  if (
    /grch37|hg19|\bb37\b|hs37d5|human_g1k_v37|gca_000001405\.(1|[2-9]|1[0-4])\b|gcf_000001405\.(1\d|2[0-5])\b/.test(
      v,
    )
  )
    return "GRCh37";
  if (/ncbi36|hg18|\bb36\b/.test(v)) return "NCBI36";
  return null;
}

const contigName = (id: string) => {
  const n = id.replace(/^chr/i, "");
  return n === "MT" ? "M" : n;
};

const reject = (code: VcfRejectionCode, message: string, line?: number): VcfRejection =>
  line === undefined ? { ok: false, code, message } : { ok: false, code, message, line };

const REQUIRED = ["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO"];

export function validateVcfHeader(text: string): VcfAccepted | VcfRejection {
  if (text.startsWith("\u001f\u008b"))
    return reject(
      "compressed",
      "This is a gzip/bgzip-compressed file. Compressed VCF is not read yet; decompress it first.",
    );
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = lines[0] ?? "";
  const m = /^##fileformat=VCFv(\d+)\.(\d+)\s*$/.exec(first);
  if (!m)
    return reject("not-vcf", "The first line must be ##fileformat=VCFv4.x. This is not a VCF.", 1);
  const version = `${m[1]}.${m[2]}`;
  if (!(ACCEPTED_VERSIONS as readonly string[]).includes(version))
    return reject(
      "version-unsupported",
      Number(m[1]) < 4 || (Number(m[1]) === 4 && Number(m[2]) < 2)
        ? `VCF ${version} is older than Genome v1 accepts (4.2 or later). The file was not converted.`
        : `VCF ${version} is not a version Genome v1 recognises (accepted: ${ACCEPTED_VERSIONS.join(", ")}).`,
      1,
    );

  const grch38: string[] = [];
  const other: string[] = [];
  let contigs = 0;
  let header: string[] | null = null;
  let headerLine = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("#CHROM")) {
      header = line.split("\t");
      headerLine = i + 1;
      break;
    }
    if (!line.startsWith("##")) {
      if (line.trim() === "") continue;
      return reject(
        "header-malformed",
        "A data line appears before the #CHROM header line.",
        i + 1,
      );
    }
    const meta = /^##([^=]+)=(.*)$/.exec(line);
    if (!meta) continue;
    const [, key, value] = meta as unknown as [string, string, string];
    if (key === "reference" || key === "assembly") {
      const b = buildNamed(value);
      if (b === "GRCh38") grch38.push(`##${key}: ${value}`);
      else if (b) other.push(`##${key} names ${b} (${value})`);
    }
    if (key === "contig") {
      contigs++;
      const id = /[<,]ID=([^,>]+)/.exec(value)?.[1];
      const length = Number(/[<,]length=(\d+)/.exec(value)?.[1]);
      const asm = /[<,]assembly=([^,>]+)/.exec(value)?.[1];
      if (asm) {
        const b = buildNamed(asm);
        if (b === "GRCh38") grch38.push(`##contig ${id} assembly=${asm}`);
        else if (b) other.push(`##contig ${id} assembly names ${b}`);
      }
      if (id && Number.isFinite(length) && length > 0) {
        const name = contigName(id);
        const expected = GRCH38_LENGTHS[name];
        if (expected !== undefined) {
          if (length === expected) grch38.push(`##contig ${id} length matches GRCh38`);
          else
            other.push(
              `##contig ${id} has length ${length}` +
                (GRCH37_LENGTHS[name] === length ? " (GRCh37)" : `, not the GRCh38 ${expected}`),
            );
        }
      }
    }
  }

  if (!header) return reject("header-malformed", "No #CHROM header line was found.");
  if (REQUIRED.some((c, i) => header![i] !== c))
    return reject(
      "header-malformed",
      `The #CHROM line must start with ${REQUIRED.join(", ")}, separated by tabs.`,
      headerLine,
    );
  if (header.length > 8 && header[8] !== "FORMAT")
    return reject(
      "header-malformed",
      "The ninth column must be FORMAT when samples are present.",
      headerLine,
    );

  if (other.length)
    return reject(
      "build-unsupported",
      `Genome v1 accepts GRCh38 only, and this file is not GRCh38: ${other.slice(0, 3).join("; ")}. ` +
        "It was not lifted over or converted.",
    );
  if (!grch38.length)
    return reject(
      "build-unconfirmed",
      "The header does not establish the reference build (no ##reference, contig assembly or GRCh38 contig lengths). " +
        "Genome v1 does not guess the build; add a GRCh38 ##reference or ##contig lines.",
    );

  return {
    ok: true,
    version: version as VcfVersion,
    assembly: "GRCh38",
    evidence: [...new Set(grch38)],
    contigs,
    sampleCount: Math.max(0, header.length - 9),
  };
}
