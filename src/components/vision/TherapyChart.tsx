import { useState } from "react";
import type { TherapyPoint } from "@/lib/vision/therapy";

/** Validated categorical slots 1–3 (dataviz palette); the untreated line is a dashed grey reference. */
const SERIES = [
  { key: "signalTreated", label: "Light response, treated area", colour: "#2a78d6", dash: "" },
  { key: "signalRetina", label: "Light response, whole retina", colour: "#eb6834", dash: "" },
  { key: "rpe65", label: "RPE65 activity, treated area", colour: "#1baf7a", dash: "" },
  { key: "signalNoTreatment", label: "Whole retina, untreated", colour: "#8f8ca3", dash: "5 4" },
] as const;

const W = 760;
const H = 300;
const P = { l: 40, r: 168, t: 14, b: 30 };

/** Fractions of healthy over time, with the current day marked and a crosshair on hover. */
export function TherapyChart({
  series,
  day,
  onScrub,
}: {
  series: TherapyPoint[];
  day: number;
  onScrub: (d: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const days = series.length - 1;
  const x = (d: number) => P.l + (d / days) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v) * (H - P.t - P.b);
  const path = (k: (typeof SERIES)[number]["key"]) =>
    series.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const yearly = days > 400;
  const ticks = yearly
    ? Array.from({ length: Math.floor(days / 365) + 1 }, (_, i) => i * 365)
    : [0, 30, 90, 180, 270, 365];
  const h = hover !== null ? series[hover] : null;
  const end = series[days]!;

  // Direct labels at the right edge, nudged apart so they never overlap.
  const ends = SERIES.map((s) => ({ ...s, y: y(end[s.key]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++)
    if (ends[i]!.y - ends[i - 1]!.y < 13) ends[i]!.y = ends[i - 1]!.y + 13;

  const toDay = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    return Math.round(Math.min(days, Math.max(0, ((px - P.l) / (W - P.l - P.r)) * days)));
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full cursor-crosshair touch-none"
        role="img"
        aria-label="Simulated time course of the therapy"
        onPointerMove={(e) => {
          setHover(toDay(e));
          if (e.buttons === 1) onScrub(toDay(e));
        }}
        onPointerDown={(e) => onScrub(toDay(e))}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--v-line)" />
            <text x={P.l - 6} y={y(v) + 3} fontSize="10" textAnchor="end" fill="var(--v-ink-3)">
              {v * 100}%
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--v-ink-3)">
            {yearly ? `${t / 365} y` : `${t} d`}
          </text>
        ))}
        {SERIES.map((s) => (
          <path
            key={s.key}
            d={path(s.key)}
            fill="none"
            stroke={s.colour}
            strokeWidth="2"
            strokeDasharray={s.dash}
            strokeLinejoin="round"
          />
        ))}
        <line
          x1={x(day)}
          x2={x(day)}
          y1={P.t}
          y2={H - P.b}
          stroke="var(--v-ink)"
          strokeWidth="1.5"
        />
        <rect x={x(day) - 18} y={P.t - 2} width={36} height={14} rx={7} fill="var(--v-ink)" />
        <text x={x(day)} y={P.t + 8} fontSize="9" textAnchor="middle" fill="#fff">
          {yearly ? `${(day / 365).toFixed(1)}y` : `d${day}`}
        </text>
        {h && hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={P.t}
              y2={H - P.b}
              stroke="var(--v-ink-3)"
              strokeDasharray="2 3"
            />
            {SERIES.map((s) => (
              <circle
                key={s.key}
                cx={x(hover)}
                cy={y(h[s.key])}
                r="3.5"
                fill={s.colour}
                stroke="#fff"
                strokeWidth="1.5"
              />
            ))}
          </g>
        )}
        {ends.map((s) => (
          <text key={s.key} x={W - P.r + 8} y={s.y + 3} fontSize="10" fill="var(--v-ink-2)">
            <tspan fill={s.colour}>●</tspan>{" "}
            {s.label.replace("Light response, ", "").replace(", treated area", "")}
          </text>
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute left-12 top-2 rounded-xl bg-[var(--v-ink)] px-3 py-2 text-[11px] text-white shadow">
          <p className="font-medium">
            {yearly ? `Year ${(h.day / 365).toFixed(2)}` : `Day ${h.day}`}
          </p>
          {SERIES.map((s) => (
            <p key={s.key}>
              <span style={{ color: s.colour }}>●</span> {s.label}: {(h[s.key] * 100).toFixed(1)}%
            </p>
          ))}
        </div>
      )}
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--v-ink-2)]">
        {SERIES.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line
                x1="0"
                x2="18"
                y1="3"
                y2="3"
                stroke={s.colour}
                strokeWidth="2"
                strokeDasharray={s.dash}
              />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The AAV construct. Element order as described for voretigene neparvovec;
 * only the cDNA length comes from data (Ensembl's coding sequence), the other
 * elements are drawn to an approximate scale.
 */
export function VectorMap({ cdsLength }: { cdsLength: number | null }) {
  const parts = [
    { label: "ITR", sub: "AAV2 end", w: 0.06, colour: "#8f8ca3" },
    {
      label: "CMV enhancer + chicken β-actin promoter",
      sub: "switches the gene on",
      w: 0.24,
      colour: "#eb6834",
    },
    {
      label: "Human RPE65 cDNA",
      sub: cdsLength
        ? `${cdsLength.toLocaleString()} bp, from Ensembl's coding sequence`
        : "coding sequence",
      w: 0.44,
      colour: "#2a78d6",
    },
    { label: "bGH poly(A)", sub: "ends the message", w: 0.14, colour: "#1baf7a" },
    { label: "ITR", sub: "AAV2 end", w: 0.06, colour: "#8f8ca3" },
  ];
  let acc = 0;
  return (
    <div>
      <svg
        viewBox="0 0 1000 120"
        className="h-auto w-full"
        role="img"
        aria-label="Gene therapy vector construct"
      >
        {parts.map((p, i) => {
          const x0 = 20 + acc * 960;
          acc += p.w + 0.01;
          const wpx = p.w * 960;
          return (
            <g key={i}>
              <rect
                x={x0}
                y={34}
                width={wpx}
                height={30}
                rx={i === 0 || i === parts.length - 1 ? 15 : 6}
                fill={p.colour}
              />
              <text
                x={x0 + wpx / 2}
                y={24}
                fontSize="12"
                textAnchor="middle"
                fill="#16151d"
                fontWeight="600"
              >
                {p.label.length > 26 && wpx < 260 ? p.label.split(" + ")[0] + " +" : p.label}
              </text>
              <text x={x0 + wpx / 2} y={84} fontSize="10.5" textAnchor="middle" fill="#55526a">
                {p.sub}
              </text>
            </g>
          );
        })}
        <text x={500} y={110} fontSize="10.5" textAnchor="middle" fill="#6c6982">
          Packed inside an AAV2 capsid (packaging limit about 4.7 kb) · delivered by injection under
          the retina
        </text>
      </svg>
    </div>
  );
}
