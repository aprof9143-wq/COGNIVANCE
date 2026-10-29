import { useEffect, useRef } from "react";

/**
 * The landing page's hero visual: one signal traced from the gene to the
 * visual cortex, the path the platform models.
 *
 * Gene and protein read the real RPE65 coding sequence from the reference
 * snapshot (Ensembl ENST00000262340) and translate it codon by codon, so the
 * readout under the canvas is real data. The retina and cortex stages are an
 * illustration of the model, and the stage labels say so.
 *
 * Draws once on load, then a pulse runs the path on a loop. Pauses when off
 * screen or in a background tab; with reduced motion it shows a still frame.
 */

const CDS_URL = "/vision/display/rpe65/ensembl_cds.json";
// Opening of the same transcript, used until the snapshot has loaded.
const FALLBACK =
  "ATGTCTATCCAGGTTGAGCATCCTGCTGGTGGTTACAAGAAACTGTTTGAAACTGTGGAGGAACTGTCCTCGCCGCTCACAGCTCATGTAACAGGCAGGATCCCCCTCTGGCTCACCGGCAGTCTCCTTCGATGTGGGCCAGGACTCTTTGAAGTTGGATCTGAGCCATTTTACCACCTG";

const AA: Record<string, string> = {};
{
  const bases = "TCAG";
  const code = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
  let i = 0;
  for (const a of bases) for (const b of bases) for (const c of bases) AA[a + b + c] = code[i++]!;
}
const AA3: Record<string, string> = {
  A: "Ala",
  R: "Arg",
  N: "Asn",
  D: "Asp",
  C: "Cys",
  Q: "Gln",
  E: "Glu",
  G: "Gly",
  H: "His",
  I: "Ile",
  L: "Leu",
  K: "Lys",
  M: "Met",
  F: "Phe",
  P: "Pro",
  S: "Ser",
  T: "Thr",
  W: "Trp",
  Y: "Tyr",
  V: "Val",
  "*": "Stop",
};
const COMP: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };
const BASE_RGB: Record<string, string> = {
  A: "110,168,255",
  C: "139,224,196",
  G: "255,207,122",
  T: "255,143,163",
};

const PULSE = "255,180,92"; // the light, warm
const STRUCT = "120,150,210"; // the anatomy, cool
const INK = "230,239,255";

// Stage bounds as fractions of the canvas width.
const STAGES = [
  [0.0, 0.235],
  [0.255, 0.49],
  [0.51, 0.745],
  [0.765, 1.0],
] as const;

const SWEEP = 6.2; // seconds for the pulse to cross
const REST = 1.4; // seconds between sweeps
const INTRO = 2.0; // seconds to draw the path on load

type Spike = { lane: number; x: number; t: number };

export function Trace({ className = "" }: { className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const baseOut = useRef<HTMLSpanElement>(null);
  const codonOut = useRef<HTMLSpanElement>(null);
  const residueOut = useRef<HTMLSpanElement>(null);
  const stageEls = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const cv = canvas.current;
    const box = wrap.current;
    if (!cv || !box) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let seq = FALLBACK;
    let alive = true;
    fetch(CDS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { seq?: string } | null) => {
        if (alive && j?.seq && /^[ACGT]+$/.test(j.seq)) seq = j.seq;
      })
      .catch(() => {});

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = box.clientWidth;
      H = box.clientHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    const spikes: Spike[] = [];
    const lastLit: number[] = [];
    let lastStage = -1;
    let lastReadout = -1;

    // Seeded noise so the raster looks the same on every visit.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    // Tight turns inside a helix, a slow drift through the loops.
    const phaseAt = (x: number, a: number, helix: number) => (x - a) * (0.05 + 0.15 * helix);
    const helixAt = (x: number, a: number, b: number) => {
      const u = (x - a) / (b - a);
      return 0.5 + 0.5 * Math.tanh(4 * Math.sin(u * Math.PI * 3.2 + 0.6));
    };

    const ribbonY = (x: number, a: number, b: number, t: number, cy: number) => {
      const u = (x - a) / (b - a);
      const env = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 0.6;
      // Helices with short loops between them, as in a folded protein.
      const helix = helixAt(x, a, b);
      const amp = (H * 0.06 + H * 0.06 * helix) * env;
      return cy + amp * Math.sin(phaseAt(x, a, helix) + t * 0.9);
    };

    const draw = (t: number, now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (W < 10) return;
      const cy = H * 0.5;
      const reveal = still ? 1 : Math.min(1, t / INTRO);
      const revealX = W * (1 - (1 - reveal) ** 3);

      // Pulse position along x (null while resting or during the intro).
      let px: number | null = null;
      if (still) px = W * 0.6;
      else if (t > INTRO) {
        const c = (t - INTRO) % (SWEEP + REST);
        if (c < SWEEP) px = (c / SWEEP) * W * 1.04 - W * 0.02;
      }
      const glow = (x: number) => (px === null ? 0 : Math.exp(-(((x - px) / (W * 0.035)) ** 2)));

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, revealX, H);
      ctx.clip();

      // Spine joining the stages.
      ctx.strokeStyle = `rgba(${STRUCT},0.28)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < STAGES.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(W * STAGES[i]![1], cy);
        ctx.lineTo(W * STAGES[i + 1]![0], cy);
        ctx.stroke();
      }

      // ---- 1. Gene: the coding sequence as a turning double strand.
      {
        const [a, b] = [W * STAGES[0][0], W * STAGES[0][1]];
        const step = 9.5;
        const n = Math.floor((b - a) / step);
        const amp = H * 0.075;
        ctx.font = `500 ${Math.max(9, Math.min(11, H * 0.034))}px "Geist Mono", ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < n; i++) {
          const x = a + step * (i + 0.5);
          const base = seq[i % seq.length]!;
          const ph = i * 0.42 - t * 0.9;
          const yT = cy - amp * Math.cos(ph);
          const yB = cy + amp * Math.cos(ph);
          const depth = 0.5 + 0.5 * Math.sin(ph);
          const g = glow(x);
          const rgb = BASE_RGB[base] ?? INK;
          ctx.strokeStyle = `rgba(${rgb},${0.08 + 0.1 * depth + 0.5 * g})`;
          ctx.beginPath();
          ctx.moveTo(x, yT);
          ctx.lineTo(x, yB);
          ctx.stroke();
          ctx.fillStyle = `rgba(${rgb},${0.25 + 0.45 * depth + 0.4 * g})`;
          ctx.fillText(base, x, yT);
          ctx.fillStyle = `rgba(${BASE_RGB[COMP[base]!]},${0.2 + 0.35 * (1 - depth) + 0.4 * g})`;
          ctx.fillText(COMP[base]!, x, yB);
        }
      }

      // ---- 2. Protein: the translated chain folding into helices.
      {
        const [a, b] = [W * STAGES[1][0], W * STAGES[1][1]];
        let prevT: [number, number] | null = null;
        let prevB: [number, number] | null = null;
        for (let x = a; x <= b; x += 1.5) {
          const y = ribbonY(x, a, b, t, cy);
          const ph = phaseAt(x, a, helixAt(x, a, b)) + t * 0.9;
          const face = Math.cos(ph);
          const w = 1.4 + 7.5 * Math.abs(face);
          const T: [number, number] = [x, y - w];
          const B: [number, number] = [x, y + w];
          if (prevT && prevB) {
            const g = glow(x);
            const front = face > 0;
            ctx.fillStyle = front
              ? `rgba(${g > 0.05 ? PULSE : "61,139,245"},${0.55 + 0.4 * g})`
              : `rgba(${STRUCT},${0.22 + 0.3 * g})`;
            ctx.beginPath();
            ctx.moveTo(prevT[0], prevT[1]);
            ctx.lineTo(T[0], T[1]);
            ctx.lineTo(B[0], B[1]);
            ctx.lineTo(prevB[0], prevB[1]);
            ctx.closePath();
            ctx.fill();
          }
          prevT = T;
          prevB = B;
        }
      }

      // ---- 3. Retina: rods and cones; the light bleaches their outer segments.
      {
        const [a, b] = [W * STAGES[2][0], W * STAGES[2][1]];
        const n = Math.max(10, Math.round((b - a) / 15));
        const gap = (b - a) / n;
        ctx.strokeStyle = `rgba(${STRUCT},0.3)`;
        ctx.beginPath();
        ctx.moveTo(a, cy + H * 0.16);
        ctx.lineTo(b, cy + H * 0.16);
        ctx.stroke();
        for (let i = 0; i < n; i++) {
          const x = a + gap * (i + 0.5);
          const cone = i % 4 === 2;
          const g = glow(x);
          if (g > 0.6) lastLit[i] = now;
          const after = lastLit[i] ? Math.exp(-(now - lastLit[i]!) / 900) : 0;
          const lit = Math.max(g, after);
          const top = cy - H * (cone ? 0.14 : 0.22);
          const w = cone ? 7 : 4;
          // Inner segment and synapse.
          ctx.strokeStyle = `rgba(${STRUCT},${0.35 + 0.4 * lit})`;
          ctx.beginPath();
          ctx.moveTo(x, cy + 2);
          ctx.lineTo(x, cy + H * 0.16);
          ctx.stroke();
          ctx.fillStyle = `rgba(${lit > 0.1 ? PULSE : STRUCT},${0.35 + 0.6 * lit})`;
          ctx.beginPath();
          ctx.arc(x, cy + H * 0.16, 2, 0, Math.PI * 2);
          ctx.fill();
          // Outer segment with its stacked discs.
          ctx.fillStyle = `rgba(${PULSE},${0.06 + 0.7 * lit})`;
          ctx.strokeStyle = `rgba(${lit > 0.1 ? PULSE : STRUCT},${0.4 + 0.5 * lit})`;
          ctx.beginPath();
          if (cone) {
            ctx.moveTo(x - w / 2, cy);
            ctx.lineTo(x - 1, top);
            ctx.lineTo(x + 1, top);
            ctx.lineTo(x + w / 2, cy);
          } else {
            ctx.rect(x - w / 2, top, w, cy - top);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = `rgba(${STRUCT},${0.18 + 0.3 * lit})`;
          for (let y = cy - 4; y > top + 3; y -= 4) {
            const hw = cone ? ((y - top) / (cy - top)) * (w / 2) : w / 2;
            ctx.beginPath();
            ctx.moveTo(x - hw + 0.5, y);
            ctx.lineTo(x + hw - 0.5, y);
            ctx.stroke();
          }
          if (lit > 0.05) {
            const my = (top + cy) / 2;
            const R = H * 0.13;
            const r = ctx.createRadialGradient(x, my, 0, x, my, R);
            r.addColorStop(0, `rgba(${PULSE},${0.2 * lit})`);
            r.addColorStop(1, `rgba(${PULSE},0)`);
            ctx.fillStyle = r;
            ctx.fillRect(x - R, my - R, 2 * R, 2 * R);
          }
        }
      }

      // ---- 4. Visual cortex: a spike raster that answers the signal.
      {
        const [a, b] = [W * STAGES[3][0], W * STAGES[3][1]];
        const lanes = 16;
        const span = H * 0.5;
        const laneY = (l: number) => cy - span / 2 + (span * (l + 0.5)) / lanes;
        ctx.strokeStyle = `rgba(${STRUCT},0.12)`;
        for (let l = 0; l < lanes; l++) {
          ctx.beginPath();
          ctx.moveTo(a, laneY(l));
          ctx.lineTo(b, laneY(l));
          ctx.stroke();
        }
        if (!still) {
          // Spontaneous activity, then a volley where the signal arrives.
          for (let l = 0; l < lanes; l++) {
            if (rnd() < 0.012) spikes.push({ lane: l, x: a + rnd() * (b - a), t: now });
            if (px !== null && px > a && px < b) {
              const delay = Math.abs(l - lanes / 2) * 0.012 * W;
              const front = px - delay;
              if (front > a && rnd() < 0.42)
                spikes.push({ lane: l, x: front - rnd() * W * 0.02, t: now });
            }
          }
        }
        for (let i = spikes.length - 1; i >= 0; i--) {
          const s = spikes[i]!;
          const age = (now - s.t) / 2600;
          if (age > 1) {
            spikes.splice(i, 1);
            continue;
          }
          ctx.strokeStyle = `rgba(${INK},${0.9 * (1 - age)})`;
          ctx.lineWidth = 1.4;
          const y = laneY(s.lane);
          ctx.beginPath();
          ctx.moveTo(s.x, y - 4);
          ctx.lineTo(s.x, y + 4);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }

      // ---- The light itself.
      if (px !== null && px > 0 && px < W * STAGES[3][0]) {
        let y = cy;
        if (px > W * STAGES[1][0] && px < W * STAGES[1][1])
          y = ribbonY(px, W * STAGES[1][0], W * STAGES[1][1], t, cy);
        const r = ctx.createRadialGradient(px, y, 0, px, y, 26);
        r.addColorStop(0, `rgba(${PULSE},0.9)`);
        r.addColorStop(0.25, `rgba(${PULSE},0.35)`);
        r.addColorStop(1, `rgba(${PULSE},0)`);
        ctx.fillStyle = r;
        ctx.fillRect(px - 26, y - 26, 52, 52);
        ctx.fillStyle = "rgba(255,240,220,1)";
        ctx.beginPath();
        ctx.arc(px, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ---- Readout and stage highlight, only when they change.
      const stage = px === null ? -1 : STAGES.findIndex(([s, e]) => px! >= W * s && px! <= W * e);
      if (stage !== lastStage) {
        stageEls.current.forEach((el, i) => el?.toggleAttribute("data-active", i === stage));
        lastStage = stage;
      }
      if (px !== null && (stage === 0 || stage === 1)) {
        const [s, e] = STAGES[stage];
        const u = (px - W * s) / (W * (e - s));
        const codons = Math.floor(seq.length / 3);
        const c = Math.min(codons - 1, Math.max(0, Math.floor(u * codons)));
        if (c !== lastReadout) {
          lastReadout = c;
          const codon = seq.slice(c * 3, c * 3 + 3);
          const aa = AA[codon] ?? "?";
          if (baseOut.current) baseOut.current.textContent = `c.${c * 3 + 1}`;
          if (codonOut.current) codonOut.current.textContent = codon;
          if (residueOut.current)
            residueOut.current.textContent = aa === "*" ? "Stop" : `${AA3[aa] ?? aa}${c + 1}`;
        }
      }
    };

    let raf = 0;
    let start = performance.now();
    let visible = true;
    let pausedAt = 0;
    const loop = (now: number) => {
      draw((now - start) / 1000, now);
      raf = requestAnimationFrame(loop);
    };
    const play = () => {
      if (raf || still) return;
      if (pausedAt) start += performance.now() - pausedAt;
      pausedAt = 0;
      raf = requestAnimationFrame(loop);
    };
    const pause = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      pausedAt = performance.now();
    };
    if (still) {
      draw(INTRO + 1, performance.now());
      ro.disconnect();
      const redraw = new ResizeObserver(() => {
        resize();
        draw(INTRO + 1, performance.now());
      });
      redraw.observe(box);
      return () => {
        alive = false;
        redraw.disconnect();
      };
    }
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible && !document.hidden) play();
      else pause();
    });
    io.observe(box);
    const onVis = () => (document.hidden || !visible ? pause() : play());
    document.addEventListener("visibilitychange", onVis);
    play();
    return () => {
      alive = false;
      pause();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const labels = [
    { name: "Gene", src: "RPE65 coding sequence, Ensembl", kind: "Reference" },
    { name: "Protein", src: "Translated codon by codon", kind: "Computed" },
    { name: "Retina", src: "Rods and cones respond to light", kind: "Model" },
    { name: "Visual cortex", src: "The response it carries to V1", kind: "Model" },
  ];

  return (
    <figure
      className={className}
      aria-label="One signal traced from the RPE65 gene to the visual cortex"
    >
      <div ref={wrap} className="relative h-[clamp(220px,26vw,320px)] w-full">
        <canvas ref={canvas} className="absolute inset-0" aria-hidden />
      </div>
      <ol className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
        {labels.map((l, i) => (
          <li
            key={l.name}
            ref={(el) => {
              stageEls.current[i] = el;
            }}
            className="group border-t border-white/12 pt-3 transition-colors duration-500 data-[active]:border-[#ffb45c]"
          >
            <p className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-medium text-white/90">{l.name}</span>
              <span className="text-[11.5px] text-white/45">{l.kind}</span>
            </p>
            <p className="mt-1 text-[12.5px] leading-snug text-white/50">{l.src}</p>
          </li>
        ))}
      </ol>
      <figcaption className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[12.5px] text-white/50">
        <span>Reading RPE65 (ENST00000262340), live</span>
        <span>
          Base{" "}
          <span ref={baseOut} className="font-[family-name:var(--font-code)] text-white/85">
            c.1
          </span>
        </span>
        <span>
          Codon{" "}
          <span ref={codonOut} className="font-[family-name:var(--font-code)] text-white/85">
            ATG
          </span>
        </span>
        <span>
          Residue{" "}
          <span ref={residueOut} className="font-[family-name:var(--font-code)] text-white/85">
            Met1
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
