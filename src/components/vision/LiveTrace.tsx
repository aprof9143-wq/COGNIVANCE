import { useEffect, useRef } from "react";
import { TRACE_SECONDS, type TraceSample } from "./useAdaptingEye";

const LANES = [
  {
    key: "pupil",
    target: "pupilTarget",
    label: "Pupil diameter",
    colour: "#2a78d6",
    min: 1.5,
    max: 8,
    fmt: (v: number) => `${v.toFixed(1)} mm`,
  },
  {
    key: "acc",
    target: "accTarget",
    label: "Focusing effort",
    colour: "#eb6834",
    min: 0,
    max: 1,
    fmt: (v: number) => `${Math.round(v * 100)}%`,
  },
] as const;

/**
 * The last ten seconds of pupil and lens, drawn on a canvas from the hook's
 * history at display rate, without going through React. Solid: the eye.
 * Dashed: where it is heading.
 */
export function LiveTrace({ trace }: { trace: () => TraceSample[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const read = useRef(trace);
  read.current = trace;

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
      if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const data = read.current();
      const tNow = performance.now() / 1000;
      const L = 8;
      const R = 74;
      const laneH = (H - 18) / LANES.length;
      const x = (t: number) => L + ((t - (tNow - TRACE_SECONDS)) / TRACE_SECONDS) * (W - L - R);
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      LANES.forEach((lane, i) => {
        const top = i * laneH + 6;
        const y = (v: number) =>
          top + (1 - (v - lane.min) / (lane.max - lane.min)) * (laneH - 14) + 2;
        ctx.strokeStyle = "rgba(22,21,29,0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(L, top + laneH - 10);
        ctx.lineTo(W - R, top + laneH - 10);
        ctx.stroke();
        ctx.fillStyle = "#55526a";
        ctx.fillText(lane.label, L, top + 9);
        if (!data.length) return;
        for (const [k, dash, width] of [
          [lane.target, [4, 4], 1.5],
          [lane.key, [], 2.25],
        ] as const) {
          ctx.setLineDash([...dash]);
          ctx.strokeStyle = lane.colour;
          ctx.globalAlpha = dash.length ? 0.55 : 1;
          ctx.lineWidth = width;
          ctx.beginPath();
          data.forEach((d, j) => {
            const px = x(d.t);
            const py = y(d[k]);
            if (j) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          });
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const last = data[data.length - 1]!;
        const ly = y(last[lane.key]);
        ctx.fillStyle = lane.colour;
        ctx.beginPath();
        ctx.arc(x(last.t), ly, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#16151d";
        ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(lane.fmt(last[lane.key]), W - R + 8, ly + 4);
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      });
      ctx.fillStyle = "#8f8ca3";
      ctx.fillText(`${TRACE_SECONDS} s ago`, L, H - 3);
      ctx.textAlign = "right";
      ctx.fillText("now", W - R, H - 3);
      ctx.textAlign = "left";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div>
      <canvas
        ref={ref}
        className="h-[170px] w-full"
        role="img"
        aria-label="Pupil diameter and focusing effort over the last ten seconds"
      />
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--v-ink-2)]">
        {LANES.map((l) => (
          <li key={l.key} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" x2="18" y1="3" y2="3" stroke={l.colour} strokeWidth="2" />
            </svg>
            {l.label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line
              x1="0"
              x2="18"
              y1="3"
              y2="3"
              stroke="#8f8ca3"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          </svg>
          Where it is heading
        </li>
      </ul>
    </div>
  );
}
