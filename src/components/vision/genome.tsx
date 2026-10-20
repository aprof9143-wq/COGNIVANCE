import { useMemo, useState } from "react";
import { Check, ExternalLink, TriangleAlert } from "lucide-react";
import type { GeneRecord } from "@/lib/vision/sources";
import type { Variant, VariantGroup } from "@/lib/vision/snapshot";
import { parseCodingSnv, placeOnCds } from "@/lib/vision/genome";
import { PLDDT_BANDS, plddtBand } from "@/lib/vision/pdb";
import { EvidenceTag } from "./ui";

/** ClinVar classification groups, in order of concern. Colour always comes with its label. */
export const GROUPS: { key: VariantGroup; label: string; colour: string }[] = [
  { key: "pathogenic", label: "Pathogenic / likely", colour: "#d0507c" },
  { key: "conflicting", label: "Conflicting", colour: "#b57d12" },
  { key: "uncertain", label: "Uncertain", colour: "#8f8ca3" },
  { key: "benign", label: "Benign / likely", colour: "#0f8f7e" },
  { key: "other", label: "Not classified", colour: "#c9c6d6" },
];
const COLOUR = Object.fromEntries(GROUPS.map((g) => [g.key, g.colour])) as Record<
  VariantGroup,
  string
>;
const RANK: Record<VariantGroup, number> = {
  pathogenic: 0,
  conflicting: 1,
  uncertain: 2,
  benign: 3,
  other: 4,
};

export function GroupFilter({
  value,
  onChange,
  counts,
}: {
  value: Set<VariantGroup>;
  onChange: (v: Set<VariantGroup>) => void;
  counts: Record<VariantGroup, number>;
}) {
  return (
    <div
      className="flex flex-wrap gap-1.5 text-[11px]"
      role="group"
      aria-label="Variant classes shown"
    >
      {GROUPS.map((g) => {
        const on = value.has(g.key);
        return (
          <button
            key={g.key}
            aria-pressed={on}
            onClick={() => {
              const n = new Set(value);
              if (on) n.delete(g.key);
              else n.add(g.key);
              onChange(n);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              on
                ? "border-[var(--v-ink)] bg-white"
                : "border-[var(--v-line)] bg-[var(--v-soft)] opacity-60"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: g.colour }} aria-hidden />
            {g.label}
            <span className="tabular-nums text-[var(--v-ink-3)]">{counts[g.key]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function countGroups(vs: Variant[]): Record<VariantGroup, number> {
  const c = { pathogenic: 0, conflicting: 0, uncertain: 0, benign: 0, other: 0 };
  for (const v of vs) c[v.group]++;
  return c;
}

const W = 1000;
const M = 24;

/** The locus, 5′ → 3′ along the direction of transcription, with variants at their GRCh38 positions. */
export function GenomeTrack({
  gene,
  variants,
  selected,
  onSelect,
}: {
  gene: GeneRecord;
  variants: Variant[];
  selected: Variant | null;
  onSelect: (v: Variant) => void;
}) {
  const [hover, setHover] = useState<Variant | null>(null);
  const span = gene.end - gene.start;
  const x = (pos: number) =>
    M + ((gene.strand < 0 ? gene.end - pos : pos - gene.start) / span) * (W - 2 * M);
  const exons = gene.canonical?.exons ?? [];

  const placed = useMemo(() => {
    const vs = variants
      .filter((v) => v.grch38)
      .map((v) => ({ v, x: x(v.grch38!.start) }))
      .filter((p) => p.x >= M - 4 && p.x <= W - M + 4)
      .sort((a, b) => a.x - b.x || RANK[b.v.group] - RANK[a.v.group]);
    const levels: number[] = [];
    return vs.map((p) => {
      let lvl = 0;
      while (levels[lvl] !== undefined && p.x - levels[lvl]! < 4.5) lvl++;
      levels[lvl] = p.x;
      return { ...p, lvl: Math.min(lvl, 9) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants, gene]);

  const shown = hover ?? selected;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} 132`}
        className="h-auto w-full"
        role="img"
        aria-label="RPE65 locus with ClinVar variants"
      >
        <line
          x1={M}
          x2={W - M}
          y1={100}
          y2={100}
          stroke="#16151d"
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
        {Array.from({ length: 14 }, (_, i) => (
          <path
            key={i}
            d={`M ${M + ((i + 0.5) * (W - 2 * M)) / 14 - 3} 96 l 4 4 l -4 4`}
            fill="none"
            stroke="#16151d"
            strokeOpacity="0.3"
          />
        ))}
        {exons.map((e, i) => {
          const a = x(gene.strand < 0 ? e.end : e.start);
          const b = x(gene.strand < 0 ? e.start : e.end);
          return (
            <g key={e.id}>
              <rect x={a} y={90} width={Math.max(3, b - a)} height={20} rx={2} fill="#6a58e0" />
              {(i === 0 || i === exons.length - 1 || i % 3 === 0) && (
                <text x={(a + b) / 2} y={124} fontSize="9" textAnchor="middle" fill="#6c6982">
                  {i + 1}
                </text>
              )}
            </g>
          );
        })}
        {placed.map(({ v, x: px, lvl }) => (
          <circle
            key={v.uid}
            cx={px}
            cy={82 - lvl * 7}
            r={selected?.uid === v.uid ? 4.5 : 2.6}
            fill={COLOUR[v.group]}
            stroke={selected?.uid === v.uid ? "#16151d" : "#fff"}
            strokeWidth={selected?.uid === v.uid ? 1.5 : 0.6}
            className="cursor-pointer"
            onMouseEnter={() => setHover(v)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(v)}
          />
        ))}
        <text x={M} y={12} fontSize="10" fill="#6c6982">
          5′ · chr{gene.chromosome}:{(gene.strand < 0 ? gene.end : gene.start).toLocaleString()}
        </text>
        <text x={W - M} y={12} fontSize="10" fill="#6c6982" textAnchor="end">
          chr{gene.chromosome}:{(gene.strand < 0 ? gene.start : gene.end).toLocaleString()} · 3′
        </text>
        <text x={W / 2} y={12} fontSize="10" fill="#55526a" textAnchor="middle">
          {gene.symbol} · {(span / 1000).toFixed(1)} kb · {gene.strand < 0 ? "minus" : "plus"}{" "}
          strand · transcription →
        </text>
      </svg>
      <p className="mt-0.5 text-[11px] text-[var(--v-ink-3)]">
        Purple blocks are the {exons.length} exons of {gene.canonical?.id}; numbers mark exons. Each
        dot is a ClinVar variant at its GRCh38 position.
      </p>
      {shown && <HoverLine v={shown} />}
    </div>
  );
}

function HoverLine({ v }: { v: Variant }) {
  return (
    <p className="mt-1 truncate text-[12px]">
      <span
        className="mr-1.5 inline-block h-2 w-2 rounded-full"
        style={{ background: COLOUR[v.group] }}
      />
      <span className="font-medium">{v.protein?.short ?? v.cdna ?? v.accession}</span>{" "}
      <span className="text-[var(--v-ink-2)]">
        {v.cdna} · {v.classification}
      </span>
    </p>
  );
}

/** Variants by amino-acid position, over the protein and its AlphaFold confidence. */
export function ProteinTrack({
  length,
  variants,
  selected,
  onSelect,
  plddt,
}: {
  length: number;
  variants: Variant[];
  selected: Variant | null;
  onSelect: (v: Variant) => void;
  plddt?: number[] | undefined;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const x = (pos: number) => M + ((pos - 0.5) / length) * (W - 2 * M);
  const byPos = useMemo(() => {
    const m = new Map<number, Variant[]>();
    for (const v of variants)
      if (v.protein && v.protein.pos >= 1 && v.protein.pos <= length)
        m.set(v.protein.pos, [...(m.get(v.protein.pos) ?? []), v]);
    for (const vs of m.values()) vs.sort((a, b) => RANK[a.group] - RANK[b.group]);
    return m;
  }, [variants, length]);
  const max = Math.max(1, ...[...byPos.values()].map((v) => v.length));
  const hv = hover !== null ? byPos.get(hover) : undefined;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} 150`}
        className="h-auto w-full"
        role="img"
        aria-label="Variants along the RPE65 protein"
      >
        {[...byPos.entries()].map(([pos, vs]) => {
          const h = 14 + (vs.length / max) * 70;
          const sel = vs.some((v) => v.uid === selected?.uid);
          return (
            <g
              key={pos}
              className="cursor-pointer"
              onMouseEnter={() => setHover(pos)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(vs[0]!)}
            >
              <line
                x1={x(pos)}
                x2={x(pos)}
                y1={108}
                y2={108 - h}
                stroke="#16151d"
                strokeOpacity="0.25"
              />
              <circle
                cx={x(pos)}
                cy={108 - h}
                r={sel ? 5 : 2.8 + Math.min(2, vs.length / 3)}
                fill={COLOUR[vs[0]!.group]}
                stroke={sel ? "#16151d" : "#fff"}
                strokeWidth={sel ? 1.5 : 0.6}
              />
            </g>
          );
        })}
        <rect x={M} y={110} width={W - 2 * M} height={10} rx={5} fill="#ece9fd" />
        {plddt &&
          plddt.map((p, i) => (
            <rect
              key={i}
              x={x(i + 1) - (W - 2 * M) / length / 2}
              y={123}
              width={(W - 2 * M) / length + 0.4}
              height={5}
              fill={PLDDT_BANDS.find((b) => b.band === plddtBand(p))!.colour}
            />
          ))}
        {[1, 100, 200, 300, 400, 500, length].map((t) => (
          <text key={t} x={x(t)} y={145} fontSize="9" textAnchor="middle" fill="#6c6982">
            {t}
          </text>
        ))}
      </svg>
      <p className="text-[11px] text-[var(--v-ink-3)]">
        Lollipop height: number of variants at that amino acid.{" "}
        {plddt && "The thin strip is AlphaFold's confidence."}
      </p>
      {hv && (
        <p className="mt-1 text-[12px]">
          <span className="font-medium">Amino acid {hover}</span>{" "}
          <span className="text-[var(--v-ink-2)]">
            · {hv.length} variant{hv.length === 1 ? "" : "s"}:{" "}
            {hv
              .slice(0, 4)
              .map((v) => v.protein!.short)
              .join(", ")}
            {hv.length > 4 ? "…" : ""}
          </span>
        </p>
      )}
    </div>
  );
}

/** One variant: what ClinVar says, and whether it agrees with Ensembl's sequence. */
export function VariantCard({ v, cds }: { v: Variant; cds?: string | undefined }) {
  const snv = parseCodingSnv(v.cdna);
  const placed = snv && cds ? placeOnCds(cds, snv) : null;
  const proteinAgrees =
    placed && v.protein
      ? placed.codonIndex === v.protein.pos &&
        (placed.aaAfter === v.protein.short.slice(-1) || v.protein.change === "=")
      : null;
  return (
    <div className="rounded-2xl bg-[var(--v-soft)] p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: COLOUR[v.group] }}
          aria-hidden
        />
        <p className="text-[14px] font-medium">{v.protein?.short ?? v.cdna ?? v.accession}</p>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px]">{v.classification}</span>
        <EvidenceTag kind="reference" label="ClinVar" />
      </div>
      <p className="mt-1 break-words font-mono text-[11px] text-[var(--v-ink-2)]">{v.title}</p>
      <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
        <dt className="text-[var(--v-ink-3)]">Review</dt>
        <dd>{v.reviewStatus ?? "not stated"}</dd>
        {v.lastEvaluated && (
          <>
            <dt className="text-[var(--v-ink-3)]">Last evaluated</dt>
            <dd>{v.lastEvaluated}</dd>
          </>
        )}
        <dt className="text-[var(--v-ink-3)]">Condition</dt>
        <dd>{v.conditions.join("; ") || "not stated"}</dd>
        <dt className="text-[var(--v-ink-3)]">Effect on RNA/protein</dt>
        <dd>{v.consequences.join(", ") || "not stated"}</dd>
        {v.grch38 && (
          <>
            <dt className="text-[var(--v-ink-3)]">Position</dt>
            <dd>chr1:{v.grch38.start.toLocaleString()} (GRCh38)</dd>
          </>
        )}
      </dl>
      {placed && (
        <div className="mt-2 rounded-xl bg-white p-2.5">
          <div className="flex items-center gap-2">
            <p className="font-medium">On Ensembl's coding sequence</p>
            <EvidenceTag kind="computed" />
          </div>
          <p className="mt-1 break-all font-mono text-[12px] tracking-wider">
            {placed.context.slice(0, placed.at)}
            <span className="rounded bg-[#d0507c] px-0.5 text-white">
              {placed.context[placed.at]}
            </span>
            {placed.context.slice(placed.at + 1)}
          </p>
          <p className="mt-1 text-[var(--v-ink-2)]">
            Codon {placed.codonIndex}: <span className="font-mono">{placed.codon}</span> →{" "}
            <span className="font-mono">{placed.mutantCodon}</span>, {placed.aaBefore} →{" "}
            {placed.aaAfter}
          </p>
          <p
            className={`mt-1 flex items-center gap-1 ${placed.refAgrees && proteinAgrees ? "text-[#0f8f7e]" : "text-[#b57d12]"}`}
          >
            {placed.refAgrees && proteinAgrees ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <TriangleAlert className="h-3.5 w-3.5" />
            )}
            {placed.refAgrees
              ? proteinAgrees
                ? "ClinVar's base and protein change match Ensembl's sequence."
                : "Base matches; the protein change differs from ClinVar's."
              : `ClinVar names ${placed.snv.ref} here; Ensembl has ${placed.cdsBase}.`}
          </p>
        </div>
      )}
      <a
        href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${v.uid}/`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-[var(--v-accent-ink)] underline underline-offset-2"
      >
        {v.accession} in ClinVar <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
