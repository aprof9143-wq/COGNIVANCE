import { useState } from "react";
import { Reveal } from "@/components/Reveal";

/**
 * Two divisions, one instrument.
 *
 * The claim of this section is that the two halves are not separate teams — they
 * share a bench, a dataset and a research plan. Two cards sitting side by side
 * says the opposite, so the layout converges instead: both panels lean on a lit
 * seam that carries what they hold in common, and hovering either one pulls the
 * seam toward it while the other recedes.
 */

type Division = {
  id: "nano" | "comp";
  n: string;
  kicker: string;
  title: string;
  img: string;
  alt: string;
  claim: string;
  body: string;
  specs: { k: string; v: string }[];
};

const divisions: Division[] = [
  {
    id: "nano",
    n: "01",
    kicker: "Instrument",
    title: "Nanorobotic Systems",
    img: "/nanorobotics.jpeg",
    alt: "A nanorobotic agent at the centre of a dense filament network",
    claim: "Instruments that live inside the tissue they study.",
    body: "Autonomous agents navigating neural tissue at sub-cellular resolution. These are not probes lowered in from outside — they operate within the circuit, and they keep working while it does.",
    specs: [
      { k: "Power", v: "The body's own biochemistry" },
      { k: "Guidance", v: "Acoustic gradients" },
      { k: "Control", v: "Reprogrammable in real time" },
    ],
  },
  {
    id: "comp",
    n: "02",
    kicker: "Interpretation",
    title: "Computational Neuroscience",
    img: "/comp-neuroscience.jpeg",
    alt: "Two instrument readouts of a brain with structural and signal overlays",
    claim: "Frameworks for what those instruments find.",
    body: "Mathematical models that turn traversal data into circuit-level structure — and that represent forms of degeneration and emergent cognition existing tools cannot express at all.",
    specs: [
      { k: "Models", v: "Synaptic dynamics" },
      { k: "Simulation", v: "Degeneration, pre-symptomatic" },
      { k: "Frameworks", v: "Emergent cognition" },
    ],
  },
];

const shared = ["One bench", "One dataset", "One research plan"];

export function TechnologySection() {
  const [active, setActive] = useState<Division["id"] | null>(null);

  return (
    <section
      id="divisions"
      className="relative overflow-hidden border-t border-foreground/10 px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(4.5rem,10vw,9rem)]"
    >
      <div className="mx-auto max-w-[1500px]">
        <Reveal>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <p className="t-marker text-ash">Technology</p>
              <h2 className="t-section mt-4 max-w-[24ch] text-foreground">
                Two divisions, one instrument.
              </h2>
            </div>
            <p className="max-w-[38ch] text-[0.95rem] leading-relaxed text-ash">
              One half reaches places no imaging modality can. The other turns what it finds into
              structure. Neither is useful alone.
            </p>
          </div>
        </Reveal>

        {/* ---------------- the two halves, joined ---------------- */}
        <Reveal delay={100}>
          <div className="relative mt-[clamp(2.5rem,5vw,4rem)] grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-0">
            {/* --- division 01 --- */}
            <DivisionPanel
              d={divisions[0]!}
              side="left"
              active={active}
              onEnter={() => setActive("nano")}
              onLeave={() => setActive(null)}
            />

            {/* --- the seam --- */}
            <div
              className="relative flex shrink-0 items-center justify-center lg:w-[clamp(4rem,7vw,7rem)]"
              aria-hidden="true"
            >
              {/* rule: vertical on desktop, horizontal when stacked */}
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-foreground/20 to-transparent lg:inset-x-auto lg:inset-y-0 lg:left-1/2 lg:top-auto lg:h-auto lg:w-px lg:-translate-x-1/2 lg:translate-y-0 lg:bg-gradient-to-b" />
              {/* node — leans toward whichever half is hovered */}
              <span
                className="relative flex h-[clamp(2.6rem,4vw,3.4rem)] w-[clamp(2.6rem,4vw,3.4rem)] items-center justify-center rounded-full border border-[var(--ion)]/40 bg-paper transition-transform duration-700 ease-out"
                style={{
                  transform:
                    active === "nano"
                      ? "translateX(-14%) scale(1.06)"
                      : active === "comp"
                        ? "translateX(14%) scale(1.06)"
                        : "none",
                }}
              >
                <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--ion)_45%,transparent),transparent_70%)] blur-[6px]" />
                <span className="live-dot absolute inset-[-7px] rounded-full border border-[var(--ion)]/25" />
                <svg viewBox="0 0 24 24" className="relative h-1/2 w-1/2" fill="none">
                  <path
                    d="M12 3v18M3 12h18"
                    stroke="var(--ion)"
                    strokeWidth="1.1"
                    strokeLinecap="round"
                    opacity="0.85"
                  />
                  <circle cx="12" cy="12" r="3.4" stroke="var(--ion)" strokeWidth="1.1" />
                </svg>
              </span>
            </div>

            {/* --- division 02 --- */}
            <DivisionPanel
              d={divisions[1]!}
              side="right"
              active={active}
              onEnter={() => setActive("comp")}
              onLeave={() => setActive(null)}
            />
          </div>
        </Reveal>

        {/* ---------------- what they share ---------------- */}
        <Reveal delay={180}>
          <div className="mt-[clamp(2rem,4vw,3rem)] flex flex-wrap items-center justify-center gap-x-3 gap-y-3 border-t border-foreground/10 pt-[clamp(1.5rem,3vw,2.25rem)]">
            <span className="t-marker text-ash">Not two teams —</span>
            {shared.map((s, i) => (
              <span key={s} className="flex items-center gap-3">
                {i > 0 ? (
                  <span className="h-1 w-1 rounded-full bg-[var(--ion)]/50" aria-hidden="true" />
                ) : null}
                <span className="text-[0.92rem] font-medium text-foreground/85">{s}</span>
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function DivisionPanel({
  d,
  side,
  active,
  onEnter,
  onLeave,
}: {
  d: Division;
  side: "left" | "right";
  active: Division["id"] | null;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const dim = active !== null && active !== d.id;
  const on = active === d.id;

  return (
    <article
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      tabIndex={0}
      className={`scope group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-paper outline-none transition-all duration-700 ease-out focus-visible:border-[var(--ion)]/50 ${
        on ? "border-[var(--ion)]/35" : "border-foreground/12"
      } ${dim ? "opacity-55" : "opacity-100"} ${side === "left" ? "lg:rounded-r-none" : "lg:rounded-l-none"}`}
    >
      {/* corner ticks — instrument framing, kept light so the artwork leads */}
      <span
        className={`pointer-events-none absolute left-0 top-0 h-3.5 w-3.5 border-l border-t transition-colors duration-700 ${
          on ? "border-[var(--ion)]/70" : "border-[var(--ion)]/25"
        }`}
        aria-hidden="true"
      />
      <span
        className={`pointer-events-none absolute bottom-0 right-0 h-3.5 w-3.5 border-b border-r transition-colors duration-700 ${
          on ? "border-[var(--ion)]/70" : "border-[var(--ion)]/25"
        }`}
        aria-hidden="true"
      />

      {/* artwork */}
      <div className="relative overflow-hidden">
        <img
          src={d.img}
          alt={d.alt}
          width={1280}
          height={720}
          loading="lazy"
          className="aspect-[16/10] w-full object-cover transition-transform duration-[1600ms] ease-out group-hover:scale-[1.05] group-focus-visible:scale-[1.05]"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-paper via-paper/25 to-transparent" />
        {/* scan sweep on the active half */}
        <span
          className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[var(--ion)]/16 to-transparent transition-opacity duration-500 ${
            on ? "scan-sweep opacity-100" : "opacity-0"
          }`}
          aria-hidden="true"
        />
      </div>

      {/* text */}
      <div className="flex flex-1 flex-col p-[clamp(1.25rem,2.4vw,2rem)]">
        {/* index and role — kept off the artwork, which carries its own labels */}
        <div className="flex items-center gap-3">
          <span className="t-num text-[clamp(1.3rem,2.2vw,1.75rem)] font-semibold leading-none text-foreground/45">
            {d.n}
          </span>
          <span
            className={`h-px flex-1 transition-colors duration-700 ${
              on ? "bg-[var(--ion)]/45" : "bg-foreground/12"
            }`}
            aria-hidden="true"
          />
          <span className="t-marker text-[var(--ion)]">{d.kicker}</span>
        </div>

        <h3 className="mt-4 font-semibold tracking-[-0.03em] text-foreground [font-size:clamp(1.4rem,2.4vw,2rem)]">
          {d.title}
        </h3>
        <p className="mt-3 max-w-[44ch] text-[0.98rem] font-medium leading-relaxed text-foreground/80">
          {d.claim}
        </p>
        <p className="mt-3.5 max-w-[48ch] text-[0.9rem] leading-relaxed text-ash">{d.body}</p>

        {/* spec rows — reads as an instrument sheet, not marketing bullets */}
        <dl className="mt-auto grid gap-px overflow-hidden rounded-lg border border-foreground/10 bg-foreground/10 pt-0 [margin-top:clamp(1.5rem,3vw,2.25rem)]">
          {d.specs.map((s) => (
            <div
              key={s.k}
              className="flex items-baseline justify-between gap-4 bg-paper px-3.5 py-2.5"
            >
              <dt className="t-num shrink-0 text-[0.6rem] uppercase tracking-[0.14em] text-ash">
                {s.k}
              </dt>
              <dd className="min-w-0 truncate text-right text-[0.82rem] text-foreground/85">
                {s.v}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}
