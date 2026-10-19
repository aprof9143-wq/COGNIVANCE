import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { CYCLE_STATIONS, CYCLE_TEXT, type CycleMode } from "@/lib/vision/eyeContent";
import { EvidenceTag } from "./ui";

type P = [number, number];

/** Loop waypoints: the five stations, then back across the top to the start. */
const WAY: P[] = [
  [130, 82],
  [235, 162],
  [235, 258],
  [365, 258],
  [430, 162],
  [300, 66],
  [130, 82],
];
const STATION_AT = [0, 1, 2, 3, 4];
const LABEL_POS: P[] = [
  [130, 42],
  [148, 162],
  [235, 300],
  [365, 300],
  [505, 162],
];

const seg = WAY.slice(1).map((p, i) => Math.hypot(p[0] - WAY[i]![0], p[1] - WAY[i]![1]));
const total = seg.reduce((a, b) => a + b, 0);
const cumAt = (k: number) => seg.slice(0, k).reduce((a, b) => a + b, 0);
const STORE_AT = cumAt(2);
const RESET_AT = cumAt(3);

function along(d: number): P {
  let r = ((d % total) + total) % total;
  for (let i = 0; i < seg.length; i++) {
    if (r <= seg[i]!) {
      const t = r / seg[i]!;
      const a = WAY[i]!;
      const b = WAY[i + 1]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    r -= seg[i]!;
  }
  return WAY[0]!;
}

const N = 6;
const LOOP_S = 7;
const READY = "#6a58e0";
const USED = "#9a97ab";

export function VisualCycle() {
  const [mode, setMode] = useState<CycleMode>("healthy");
  const [station, setStation] = useState(3);
  const [t, setT] = useState(0);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      setT((now - t0) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  // Gene therapy: the carrier arrives over 2.5 s, then the enzyme is made.
  const delivered = mode !== "therapy" || t > 2.5;
  const working = mode === "healthy" || (mode === "therapy" && delivered);
  const speed = total / LOOP_S;

  const molecules = Array.from({ length: N }, (_, k) => {
    const start = (k * total) / N;
    let d = start + t * speed;
    let stacked = -1;
    if (!working) {
      // Moving towards the stalled reset step; once there, they pile up.
      const firstArrival = start <= STORE_AT ? STORE_AT - start : total - start + STORE_AT;
      if (t * speed >= firstArrival) {
        stacked = k;
        d = STORE_AT;
      }
    }
    const pos = along(d);
    if (stacked >= 0) {
      pos[0] += -14 + (stacked % 3) * 12;
      pos[1] += -14 + Math.floor(stacked / 3) * 12;
    }
    const r = ((d % total) + total) % total;
    const ready = r >= RESET_AT || r < 1;
    return { pos, ready };
  });

  const flash = working && molecules.some((m) => Math.hypot(m.pos[0] - 130, m.pos[1] - 82) < 14);
  const carrier: P =
    mode === "therapy"
      ? [560 - Math.min(1, t / 2.5) * 150, 300 - Math.min(1, t / 2.5) * 20]
      : [0, 0];
  const text = CYCLE_TEXT[mode];

  return (
    <div>
      <div
        role="tablist"
        aria-label="Visual cycle scenario"
        className="flex flex-wrap gap-1 rounded-full bg-[var(--v-soft)] p-1 text-[12px]"
      >
        {(
          [
            ["healthy", "Healthy"],
            ["missing", "RPE65 not working"],
            ["therapy", "Gene therapy"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={`flex-1 rounded-full px-3 py-1.5 ${mode === k ? "bg-[var(--v-accent)] text-white" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      <svg
        viewBox="0 0 580 330"
        className="mt-3 h-auto w-full"
        role="img"
        aria-label={`Visual cycle: ${text.title}`}
      >
        <defs>
          <radialGradient id="vc-flash">
            <stop offset="0" stopColor="#ffd166" stopOpacity="0.95" />
            <stop offset="1" stopColor="#ffd166" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Rod or cone */}
        <rect
          x="20"
          y="16"
          width="540"
          height="122"
          rx="22"
          fill={working ? "#fde8e3" : "#eeeaf0"}
        />
        {Array.from({ length: 22 }, (_, i) => (
          <line
            key={i}
            x1={40 + i * 23}
            x2={40 + i * 23}
            y1="30"
            y2="124"
            stroke={working ? "#f5c6bb" : "#dcd7e0"}
            strokeWidth="6"
            strokeLinecap="round"
          />
        ))}
        <text x="36" y="132" fontSize="11" fill="#55526a" fontWeight="600">
          ROD OR CONE · catches light
        </text>
        {!working && (
          <g>
            <rect x="404" y="28" width="140" height="24" rx="12" fill="#16151d" />
            <text x="474" y="44" fontSize="11" fill="#fff" textAnchor="middle">
              Can't respond to light
            </text>
          </g>
        )}

        {/* Light arriving */}
        <g opacity={working ? 1 : 0.35}>
          <path d="M70 -4 L118 70" stroke="#f4a261" strokeWidth="2" strokeDasharray="4 4" />
          <text x="62" y="12" fontSize="11" fill="#b5651d" textAnchor="end">
            light
          </text>
        </g>
        {flash && <circle cx="130" cy="82" r="26" fill="url(#vc-flash)" />}

        {/* RPE cell */}
        <rect x="20" y="192" width="540" height="122" rx="22" fill="#6b4232" />
        <text x="36" y="212" fontSize="11" fill="#f6e6dc" fontWeight="600">
          RPE CELL · recycles the molecule
        </text>
        <ellipse cx="470" cy="270" rx="44" ry="26" fill="#83543f" />
        <text x="470" y="274" fontSize="10" fill="#f6e6dc" textAnchor="middle">
          nucleus
        </text>

        {/* The loop */}
        <polyline
          points={WAY.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke="#16151d"
          strokeOpacity="0.18"
          strokeWidth="2"
          strokeDasharray="5 5"
        />

        {STATION_AT.map((w, i) => {
          const [x, y] = WAY[w]!;
          const st = CYCLE_STATIONS[i]!;
          const isReset = st.key === "rpe65";
          const [lx, ly] = LABEL_POS[i]!;
          const inRpe = ly > 180;
          return (
            <g key={st.key} onClick={() => setStation(i)} className="cursor-pointer">
              <circle
                cx={x}
                cy={y}
                r={isReset ? 15 : 9}
                fill={isReset ? (working ? "#2a9d8f" : "#e76f51") : "#fff"}
                stroke={station === i ? "#6a58e0" : "#16151d"}
                strokeWidth={station === i ? 3 : 1.5}
              />
              {isReset && (
                <text
                  x={x}
                  y={y + 4}
                  fontSize="11"
                  fill="#fff"
                  textAnchor="middle"
                  fontWeight="700"
                >
                  {working ? "✓" : "✕"}
                </text>
              )}
              <text
                x={lx}
                y={ly}
                fontSize="11.5"
                textAnchor="middle"
                fill={inRpe ? "#fff" : "#16151d"}
                fontWeight={station === i ? 700 : 500}
              >
                {i + 1}. {st.label}
              </text>
            </g>
          );
        })}

        {molecules.map((m, i) => (
          <circle
            key={i}
            cx={m.pos[0]}
            cy={m.pos[1]}
            r="6"
            fill={m.ready ? READY : USED}
            stroke="#fff"
            strokeWidth="1.5"
          />
        ))}

        {mode === "therapy" && (
          <g transform={`translate(${carrier[0]} ${carrier[1]})`}>
            <polygon
              points="0,-13 11,-6.5 11,6.5 0,13 -11,6.5 -11,-6.5"
              fill="#f7d6e0"
              stroke="#d0507c"
              strokeWidth="2"
              opacity={delivered ? 0.5 : 1}
            />
            <text y="28" fontSize="10" fill="#fff" textAnchor="middle">
              {delivered ? "RPE65 gene delivered" : "AAV carrier"}
            </text>
          </g>
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[var(--v-ink-2)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: READY }} /> Ready to catch
          light (11-cis)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: USED }} /> Used, needs
          resetting
        </span>
        <span className="inline-flex items-center gap-1.5">
          {working ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <X className="h-3 w-3" aria-hidden />
          )}{" "}
          RPE65 step {working ? "working" : "blocked"}
        </span>
      </div>

      <div className="mt-3 rounded-2xl bg-[var(--v-soft)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[14px] font-medium">{text.title}</p>
          <EvidenceTag kind={text.kind} />
        </div>
        <p className="mt-1 text-[13px] text-[var(--v-ink-2)]">{text.text}</p>
        <p className="mt-2 text-[12px]">
          <span className="font-medium">
            Step {station + 1} · {CYCLE_STATIONS[station]!.where}:
          </span>{" "}
          <span className="text-[var(--v-ink-2)]">{CYCLE_STATIONS[station]!.detail}</span>
        </p>
      </div>
      <p className="mt-2 text-[11px] text-[var(--v-ink-3)]">
        An illustration of the mechanism. Positions, speeds and amounts are not to scale, and it
        does not simulate how much any treatment helps.
      </p>
    </div>
  );
}
