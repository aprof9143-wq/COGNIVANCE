import { useEffect, useRef } from "react";
import type { ChannelSpectrum } from "@/lib/signal";
import { MONTAGE_1020 } from "@/lib/montage";
import { viridis } from "@/components/workstation/colormaps";

/* ------------------------------------------------------------------ Topomap */

/**
 * Scalp topography of one band's relative power.
 *
 * Inverse-distance weighting between electrodes, clipped to the head circle.
 * It is an interpolation for display — the real measurements are the electrode
 * dots, which are drawn on top so the viewer can always see what was measured
 * versus what was filled in.
 */
export function Topomap({
  values,
  hovered,
  onHover,
  colormap = "neural",
}: {
  /** label -> 0..1 */
  values: Map<string, number>;
  hovered: string | null;
  onHover?: (label: string | null) => void;
  /** "neural" is the console's blue ramp; "viridis" is perceptually uniform. */
  colormap?: "neural" | "viridis";
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const S = 280;
    canvas.width = S;
    canvas.height = S;
    const r = S * 0.42;
    const c = S / 2;

    const points = MONTAGE_1020.filter((e) => values.has(e.label)).map((e) => ({
      x: c + e.topo[0] * r,
      y: c - e.topo[1] * r,
      v: values.get(e.label)!,
      label: e.label,
    }));

    const img = ctx.createImageData(S, S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const dx = px - c;
        const dy = py - c;
        const o = (py * S + px) * 4;
        if (dx * dx + dy * dy > r * r) {
          img.data[o + 3] = 0;
          continue;
        }
        let num = 0;
        let den = 0;
        for (const p of points) {
          const d2 = (px - p.x) ** 2 + (py - p.y) ** 2 + 1;
          const w = 1 / (d2 * d2);
          num += w * p.v;
          den += w;
        }
        const v = den ? num / den : 0;
        const [cr, cg, cb] = colormap === "viridis" ? viridisRgb(v) : neuralRamp(v);
        img.data[o] = cr;
        img.data[o + 1] = cg;
        img.data[o + 2] = cb;
        img.data[o + 3] = 235;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Head outline, nose and ears — the orientation cues a topomap needs.
    ctx.strokeStyle = "rgba(127,216,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c - 10, c - r + 1);
    ctx.lineTo(c, c - r - 12);
    ctx.lineTo(c + 10, c - r + 1);
    ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(c + side * (r + 5), c, 5, 16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Measured electrodes on top of the interpolation.
    ctx.font = "600 8.5px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (const p of points) {
      const isHover = p.label === hovered;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isHover ? 5.5 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = isHover ? "#ffffff" : "rgba(0,3,11,0.85)";
      ctx.fill();
      ctx.strokeStyle = isHover ? "#7fd8ff" : "rgba(230,239,255,0.75)";
      ctx.lineWidth = isHover ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(230,239,255,0.92)";
      ctx.fillText(p.label, p.x, p.y - 7);
    }
  }, [values, hovered, colormap]);

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onHover) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const S = 280;
    const x = ((e.clientX - rect.left) / rect.width) * S;
    const y = ((e.clientY - rect.top) / rect.height) * S;
    const r = S * 0.42;
    const c = S / 2;
    let best: string | null = null;
    let bestD = 14 * 14;
    for (const el of MONTAGE_1020) {
      if (!values.has(el.label)) continue;
      const d = (x - (c + el.topo[0] * r)) ** 2 + (y - (c - el.topo[1] * r)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = el.label;
      }
    }
    onHover(best);
  };

  return (
    <canvas
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={() => onHover?.(null)}
      className="aspect-square h-auto w-full max-w-[17rem] cursor-crosshair"
      aria-label="Scalp topography of relative band power"
    />
  );
}

function neuralRamp(v: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [8, 28, 90],
    [30, 99, 196],
    [127, 216, 255],
    [245, 250, 255],
  ];
  const t = Math.max(0, Math.min(1, v)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  const f = t - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Viridis: perceptually uniform, so equal steps in power look equal. */
function viridisRgb(v: number): [number, number, number] {
  const [r, g, b] = viridis(v);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/* ------------------------------------------------------------------ Traces */

/**
 * Stacked EEG traces, scrolling through the real recording.
 *
 * The window advances in real time at the recording's own sample rate, so what
 * scrolls past is the actual signal at its actual speed — not a looped sine.
 */
export function EegTraces({
  channels,
  sampleRate,
  hovered,
  windowSeconds = 4,
  playing,
}: {
  channels: { label: string; data: Float32Array }[];
  sampleRate: number;
  hovered: string | null;
  windowSeconds?: number;
  playing: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cursor = useRef(0);
  const live = useRef({ channels, hovered, playing });
  live.current = { channels, hovered, playing };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const { channels: chs, hovered: hov, playing: play } = live.current;
      const dt = (now - last) / 1000;
      last = now;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.clientWidth || 600;
      const H = canvas.clientHeight || 200;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, W, H);

      const total = chs[0]?.data.length ?? 0;
      const win = Math.round(windowSeconds * sampleRate);
      if (!total || !win) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (play) cursor.current = (cursor.current + dt * sampleRate) % Math.max(1, total - win);
      const start = Math.floor(cursor.current);

      // Time grid: one line per second.
      ctx.strokeStyle = "rgba(61,139,245,0.10)";
      ctx.lineWidth = 1;
      for (let s = 0; s <= windowSeconds; s++) {
        const x = 34 + (s / windowSeconds) * (W - 34);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }

      const shown = chs.slice(0, 24);
      const lane = H / Math.max(1, shown.length);
      // Robust gain: scale by the median absolute amplitude across shown
      // channels, so one noisy lead cannot flatten all the others.
      const amps: number[] = [];
      for (const ch of shown) {
        let s = 0;
        const step = Math.max(1, Math.floor(win / 200));
        let n = 0;
        for (let i = start; i < start + win && i < ch.data.length; i += step) {
          s += Math.abs(ch.data[i]!);
          n++;
        }
        amps.push(n ? s / n : 1);
      }
      amps.sort((a, b) => a - b);
      const typical = amps[Math.floor(amps.length / 2)] || 1;
      // A sinusoid's peak is ~1.57× its mean absolute value, and real EEG adds
      // drift on top. 0.15 keeps the typical channel's peaks inside its own lane
      // so neighbours stay visually separate instead of weaving together.
      const gain = (lane * 0.15) / typical;
      const gutter = 34;
      const plotW = W - gutter;

      shown.forEach((ch, idx) => {
        const mid = lane * (idx + 0.5);
        const isHover = ch.label === hov;
        ctx.beginPath();
        const stepPx = Math.max(1, Math.floor(win / plotW));
        for (let px = 0; px < plotW; px++) {
          const i = start + Math.floor((px / plotW) * win);
          let v = 0;
          // Average within the pixel column to avoid aliasing.
          let n = 0;
          for (let k = 0; k < stepPx && i + k < ch.data.length; k++) {
            v += ch.data[i + k]!;
            n++;
          }
          v = n ? v / n : 0;
          const y = mid - Math.max(-lane * 0.46, Math.min(lane * 0.46, v * gain));
          if (px === 0) ctx.moveTo(gutter + px, y);
          else ctx.lineTo(gutter + px, y);
        }
        ctx.strokeStyle = isHover
          ? "rgba(255,255,255,0.95)"
          : `rgba(127,216,255,${0.78 - idx * 0.018})`;
        ctx.lineWidth = isHover ? 1.6 : 1;
        ctx.stroke();

        ctx.fillStyle = isHover ? "#ffffff" : "rgba(128,149,191,0.95)";
        ctx.font = "600 9px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(ch.label, 4, mid);
        ctx.textBaseline = "alphabetic";
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sampleRate, windowSeconds]);

  return <canvas ref={ref} className="h-full w-full" aria-label="EEG traces" />;
}

/* ---------------------------------------------------------------- Spectrum */

/** Log-power spectrum of one channel, with the clinical bands shaded. */
export function SpectrumPlot({ spectrum }: { spectrum: ChannelSpectrum | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth || 300;
    const H = canvas.clientHeight || 140;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const padL = 30;
    const padB = 16;
    const plotW = W - padL - 6;
    const plotH = H - padB - 6;
    const fMax = 45;
    const xOf = (f: number) => padL + (f / fMax) * plotW;

    const bands: [number, number, string][] = [
      [1, 4, "δ"],
      [4, 8, "θ"],
      [8, 13, "α"],
      [13, 30, "β"],
      [30, 45, "γ"],
    ];
    bands.forEach(([lo, hi, name], i) => {
      ctx.fillStyle = i % 2 ? "rgba(61,139,245,0.05)" : "rgba(61,139,245,0.10)";
      ctx.fillRect(xOf(lo), 6, xOf(hi) - xOf(lo), plotH);
      ctx.fillStyle = "rgba(128,149,191,0.9)";
      ctx.font = "600 9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(name, (xOf(lo) + xOf(hi)) / 2, 16);
    });

    // Axis ticks.
    ctx.fillStyle = "rgba(128,149,191,0.85)";
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (const f of [0, 10, 20, 30, 40]) ctx.fillText(`${f}`, xOf(f), H - 3);
    ctx.textAlign = "left";
    ctx.fillText("Hz", W - 16, H - 3);

    if (!spectrum || !spectrum.freqs.length) {
      ctx.fillStyle = "rgba(128,149,191,0.8)";
      ctx.textAlign = "center";
      ctx.fillText("Hover an electrode", padL + plotW / 2, 6 + plotH / 2);
      return;
    }

    let lo = Infinity;
    let hi = -Infinity;
    const pts: [number, number][] = [];
    for (let k = 0; k < spectrum.freqs.length; k++) {
      const f = spectrum.freqs[k]!;
      if (f < 0.5 || f > fMax) continue;
      const v = Math.log10(Math.max(1e-6, spectrum.psd[k]!));
      pts.push([f, v]);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo || 1;
    const yOf = (v: number) => 6 + plotH - ((v - lo) / span) * plotH * 0.9;

    // Area under the curve, then the curve itself with an emphasised peak.
    const grad = ctx.createLinearGradient(0, 6, 0, 6 + plotH);
    grad.addColorStop(0, "rgba(127,216,255,0.42)");
    grad.addColorStop(1, "rgba(30,99,196,0.02)");
    ctx.beginPath();
    ctx.moveTo(xOf(pts[0]![0]), 6 + plotH);
    for (const [f, v] of pts) ctx.lineTo(xOf(f), yOf(v));
    ctx.lineTo(xOf(pts[pts.length - 1]![0]), 6 + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach(([f, v], i) => (i ? ctx.lineTo(xOf(f), yOf(v)) : ctx.moveTo(xOf(f), yOf(v))));
    ctx.strokeStyle = "#7fd8ff";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    if (Number.isFinite(spectrum.peakFrequency)) {
      const pk = pts.reduce(
        (best, p) =>
          Math.abs(p[0] - spectrum.peakFrequency) < Math.abs(best[0] - spectrum.peakFrequency)
            ? p
            : best,
        pts[0]!,
      );
      ctx.beginPath();
      ctx.arc(xOf(pk[0]), yOf(pk[1]), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.fillStyle = "#e6efff";
      ctx.font = "600 9.5px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        `${spectrum.peakFrequency.toFixed(1)} Hz`,
        Math.min(W - 52, xOf(pk[0]) + 6),
        yOf(pk[1]) - 4,
      );
    }
  }, [spectrum]);

  return <canvas ref={ref} className="h-full w-full" aria-label="Power spectrum" />;
}
