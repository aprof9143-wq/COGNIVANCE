import { useMemo, useState } from "react";
import { PLDDT_BANDS, plddtBand, type Residue } from "@/lib/vision/pdb";

const W = 320;
const H = 120;
const PAD = { l: 4, r: 22, t: 8, b: 4 };

const BAND_LABEL = Object.fromEntries(PLDDT_BANDS.map((b) => [b.band, b.label]));

/**
 * pLDDT along the chain, read from the model file. One series in ink; the band
 * edges are labelled rules, so nothing depends on colour.
 */
export function PlddtChart({ residues }: { residues: Residue[] }) {
  const pts = useMemo(() => residues.filter((r) => Number.isFinite(r.b)), [residues]);
  const [hover, setHover] = useState<number | null>(null);
  if (pts.length < 2) return null;

  const x = (i: number) => PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - p / 100) * (H - PAD.t - PAD.b);
  const d = pts.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.b).toFixed(1)}`).join("");
  const h = hover === null ? null : pts[hover]!;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={`Per-residue pLDDT for ${pts.length} residues`}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const fx = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((fx - PAD.l) / (W - PAD.l - PAD.r)) * (pts.length - 1));
          setHover(Math.max(0, Math.min(pts.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[50, 70, 90].map((t) => (
          <g key={t}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--v-line)"
              strokeDasharray="3 3"
            />
            <text
              x={W - PAD.r + 4}
              y={y(t) + 3}
              fontSize="8"
              fill="var(--v-ink-3)"
              fontFamily="var(--font-mono)"
            >
              {t}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--v-ink)" strokeWidth="1.25" strokeLinejoin="round" />
        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--v-ink-3)" />
            <circle
              cx={x(hover)}
              cy={y(h.b)}
              r="3.5"
              fill="var(--v-ink)"
              stroke="#fff"
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-[var(--v-ink)] px-2 py-1 text-[11px] text-[var(--v-on-ink)] shadow"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          {h.name} {h.seq}
          {h.icode} · pLDDT {h.b.toFixed(1)} · {BAND_LABEL[plddtBand(h.b)]}
        </div>
      )}
    </div>
  );
}
