import { useState } from "react";
import { Reveal } from "@/components/Reveal";

/**
 * The novelty, shown rather than asserted.
 *
 * The platform does not try to beat every tool on every feature — it occupies
 * the intersection three mature categories leave empty. The diagram below is
 * that argument: three fields, each strong on its own axis, each missing
 * something the other two have, and one core where all three overlap.
 */

type Field = {
  id: "imaging" | "bci" | "ad";
  label: string;
  examples: string;
  strength: string;
  gap: string;
  /** lobe centre in the 0–100 viewBox */
  cx: number;
  cy: number;
  hue: string;
};

const fields: Field[] = [
  {
    id: "imaging",
    label: "Imaging suites",
    examples: "FreeSurfer · 3D Slicer",
    strength: "Strong structural analysis",
    gap: "No live hardware, no implant path, limited EEG",
    cx: 38,
    cy: 38,
    hue: "var(--beam)",
  },
  {
    id: "bci",
    label: "EEG / BCI tools",
    examples: "MNE · BrainFlow · OpenBCI",
    strength: "Live signals, real time",
    gap: "Weak Alzheimer's imaging focus, no degeneration simulation",
    cx: 62,
    cy: 38,
    hue: "var(--ion)",
  },
  {
    id: "ad",
    label: "AD platforms",
    examples: "ADNI tools · AI products",
    strength: "Good Alzheimer's data focus",
    gap: "Usually closed or offline-only, no hardware abstraction",
    cx: 50,
    cy: 60,
    hue: "var(--nebula)",
  },
];

const pillars = [
  {
    n: "01",
    title: "Multi-modal analysis",
    body: "MRI, fMRI, PET, EEG and clinical data through one coherent pipeline — five modalities, not one with footnotes.",
  },
  {
    n: "02",
    title: "Degeneration simulation",
    body: "Regional atrophy ordering and rates drawn from the literature, so simulated cohorts test algorithms real follow-up data cannot yet reach.",
  },
  {
    n: "03",
    title: "Hardware abstraction",
    body: "Simulator, real MCU and a future implant behind one interface. Switching source costs a config line, not a rewrite.",
  },
  {
    n: "04",
    title: "Measurable benchmarks",
    body: "Every claim gated on a number: subject-level splits, a locked hold-out, confidence intervals on every figure.",
  },
];

export function NoveltySection() {
  const [active, setActive] = useState<Field["id"] | null>(null);

  return (
    <section
      id="novelty"
      className="haze relative overflow-hidden border-t border-foreground/10 px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(4rem,9vw,8rem)]"
    >
      <div className="mx-auto max-w-[1500px]">
        <Reveal>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <p className="t-marker text-ash">The novelty</p>
              <h2 className="t-section mt-4 max-w-[24ch] text-foreground">
                We are not a better version of anything.
              </h2>
            </div>
            <p className="max-w-[40ch] text-[0.95rem] leading-relaxed text-ash">
              Three mature categories each solve one part of the problem. None of them solve it
              together. That empty intersection is the whole platform.
            </p>
          </div>
        </Reveal>

        <div className="mt-[clamp(2.25rem,4vw,3.5rem)] grid gap-[clamp(1.5rem,3vw,3rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-center">
          {/* ---------------- intersection diagram ---------------- */}
          <Reveal>
            <figure className="relative">
              <div className="relative aspect-square w-full max-w-[34rem] mx-auto">
                <svg
                  viewBox="0 0 100 100"
                  className="h-full w-full overflow-visible"
                  role="img"
                  aria-label="Three overlapping research fields — imaging suites, EEG and BCI tools, and Alzheimer's platforms — with Cognivance at the intersection all three leave empty."
                >
                  <defs>
                    {fields.map((f) => (
                      <radialGradient key={f.id} id={`lobe-${f.id}`}>
                        <stop offset="0%" stopColor={f.hue} stopOpacity="0.30" />
                        <stop offset="70%" stopColor={f.hue} stopOpacity="0.10" />
                        <stop offset="100%" stopColor={f.hue} stopOpacity="0.02" />
                      </radialGradient>
                    ))}
                    <radialGradient id="core-glow">
                      <stop offset="0%" stopColor="var(--ion)" stopOpacity="0.42" />
                      <stop offset="55%" stopColor="var(--beam)" stopOpacity="0.16" />
                      <stop offset="100%" stopColor="var(--beam)" stopOpacity="0" />
                    </radialGradient>
                    <filter id="soften" x="-40%" y="-40%" width="180%" height="180%">
                      <feGaussianBlur stdDeviation="0.5" />
                    </filter>
                  </defs>

                  {/* lobes */}
                  <g filter="url(#soften)">
                    {fields.map((f) => {
                      const dim = active !== null && active !== f.id;
                      return (
                        <circle
                          key={f.id}
                          cx={f.cx}
                          cy={f.cy}
                          r="26"
                          fill={`url(#lobe-${f.id})`}
                          stroke={f.hue}
                          strokeWidth={dim ? 0.4 : 0.6}
                          strokeOpacity={dim ? 0.2 : 0.9}
                          style={{
                            transition:
                              "opacity 500ms ease, stroke-opacity 500ms ease, stroke-width 500ms ease",
                            opacity: dim ? 0.35 : 1,
                          }}
                        />
                      );
                    })}
                  </g>

                  {/* the empty middle, filled */}
                  <circle cx="50" cy="45" r="17" fill="url(#core-glow)" />
                  <circle
                    cx="50"
                    cy="45"
                    r="11.8"
                    fill="none"
                    stroke="var(--ion)"
                    strokeWidth="0.25"
                    strokeOpacity="0.35"
                    strokeDasharray="1.5 2.5"
                    className="flow-line"
                  />
                  {/* solid node so the wordmark reads on its own ground, not on the glow */}
                  <circle cx="50" cy="45" r="8.8" fill="var(--void)" fillOpacity="0.88" />
                  <circle
                    cx="50"
                    cy="45"
                    r="8.8"
                    fill="none"
                    stroke="var(--ion)"
                    strokeWidth="0.45"
                    strokeOpacity="0.85"
                  />

                  {/* core wordmark */}
                  <text
                    x="50"
                    y="44.3"
                    textAnchor="middle"
                    fill="#ffffff"
                    style={{ font: "600 3.5px var(--font-sans)", letterSpacing: "-0.05px" }}
                  >
                    COGNIVANCE
                  </text>
                  <text
                    x="50"
                    y="48.4"
                    textAnchor="middle"
                    fill="var(--ion)"
                    style={{ font: "500 2.3px var(--font-mono)", letterSpacing: "0.5px" }}
                  >
                    NIMBLE
                  </text>

                  {/* lobe labels */}
                  {fields.map((f) => {
                    const out =
                      f.id === "ad" ? { x: 50, y: 93 } : { x: f.cx < 50 ? 11 : 89, y: 18 };
                    const anchor = f.id === "ad" ? "middle" : f.cx < 50 ? "start" : "end";
                    const dim = active !== null && active !== f.id;
                    return (
                      <text
                        key={f.id}
                        x={out.x}
                        y={out.y}
                        textAnchor={anchor}
                        fill={f.hue}
                        style={{
                          font: "500 3px var(--font-mono)",
                          letterSpacing: "0.4px",
                          transition: "opacity 500ms ease",
                          opacity: dim ? 0.35 : 1,
                        }}
                      >
                        {f.label.toUpperCase()}
                      </text>
                    );
                  })}
                </svg>
              </div>
              <figcaption className="mt-2 text-center text-[0.78rem] text-ash">
                Each field is strong on its own axis. The centre is what none of them cover.
              </figcaption>
            </figure>
          </Reveal>

          {/* ---------------- the gaps ---------------- */}
          <Reveal delay={120}>
            <ul className="min-w-0">
              {fields.map((f) => (
                <li
                  key={f.id}
                  onMouseEnter={() => setActive(f.id)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(f.id)}
                  onBlur={() => setActive(null)}
                  tabIndex={0}
                  className="group border-b border-foreground/10 py-5 outline-none transition-colors first:border-t first:border-foreground/10 focus-visible:bg-foreground/[0.03]"
                >
                  <div className="flex items-baseline gap-3">
                    <span
                      className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                      style={{ background: f.hue }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-[1.02rem] font-medium text-foreground">{f.label}</p>
                        <span className="t-num text-[0.72rem] text-ash">{f.examples}</span>
                      </div>
                      <p className="mt-1.5 text-[0.84rem] text-ash">
                        <span className="text-foreground/70">Strength — </span>
                        {f.strength}
                      </p>
                      <p className="mt-1 text-[0.84rem] text-ash">
                        <span style={{ color: f.hue }}>Gap — </span>
                        {f.gap}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        {/* ---------------- the four pillars ---------------- */}
        <Reveal delay={160}>
          <div className="mt-[clamp(2.5rem,5vw,4.5rem)]">
            <p className="t-marker text-ash">What has to hold, all four at once</p>
            <div className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-foreground/12 bg-foreground/10 sm:grid-cols-2 lg:grid-cols-4">
              {pillars.map((p) => (
                <div
                  key={p.n}
                  className="group relative bg-paper px-6 py-7 transition-colors duration-500 hover:bg-foreground/[0.03]"
                >
                  <span
                    className="absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                    style={{
                      background: "linear-gradient(90deg,transparent,var(--ion),transparent)",
                    }}
                    aria-hidden="true"
                  />
                  <p className="t-marker text-ash">{p.n}</p>
                  <h3 className="mt-3.5 text-[1.05rem] font-semibold tracking-[-0.02em] text-foreground">
                    {p.title}
                  </h3>
                  <p className="mt-2.5 text-[0.85rem] leading-relaxed text-ash">{p.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 max-w-[68ch] text-[0.88rem] leading-relaxed text-ash">
              Drop any one of the four and the platform converges on tools that already exist.
              Holding all four together is the entire claim — and each one is gated on a published
              number.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
