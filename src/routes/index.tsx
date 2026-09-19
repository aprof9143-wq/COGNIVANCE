import { createFileRoute, Link } from "@tanstack/react-router";
import { Reveal } from "@/components/Reveal";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { AboutSection } from "@/components/AboutSection";
import { Waitlist } from "@/components/Waitlist";
import { NimbleSection } from "@/components/NimbleSection";
import { NoveltySection } from "@/components/NoveltySection";
import { EEGTrace, LiveBadge, Metric } from "@/components/research-viz";
import divisionNano from "@/assets/division-nano.jpg";
import divisionComp from "@/assets/division-comp.jpg";
import f1 from "@/assets/f1.jpg";
import f2 from "@/assets/f2.jpg";
import f3 from "@/assets/f3.jpg";
import f4 from "@/assets/f4.jpg";
import f5 from "@/assets/f5.jpg";

const title = "Cognivance Labs — Institute of Neuronanotechnology";
const description =
  "Nanorobotic systems and computational neuroscience in one engine: mapping synapses in living tissue and modelling neurodegeneration before the first symptom.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const frontiers = [
  {
    n: "01",
    img: f1,
    alt: "Points of contact between translucent organic filaments",
    title: "Real-Time Synaptic Mapping",
    claim:
      "Individual synaptic junctions mapped in living tissue — not inferred from imaging averages.",
    body: "Every existing method for studying synaptic activity is a translation. fMRI translates blood flow into signal. EEG translates surface voltage into guesswork. We map the synapse itself, in living tissue, in real time.",
  },
  {
    n: "02",
    img: f2,
    alt: "An intact pale membrane with the first faint traces of erosion",
    title: "Pre-Symptomatic Neurodegeneration",
    claim: "Models detect disease signatures years before clinical symptoms appear.",
    body: "By the time a neurodegenerative disease is diagnosed, damage has been accumulating for years. Our models identify the earliest computational signatures of degeneration — the disease, before it becomes a disease.",
  },
  {
    n: "03",
    img: f3,
    alt: "A single droplet held inside a dense field of pale fibers",
    title: "Sub-Cellular Intervention",
    claim: "Molecular instructions delivered to specific circuits — not broadcast drugs.",
    body: "Drugs are broadcast signals. We deliver instructions: molecular payloads carried by nanorobotic systems to specific circuits, specific synapses, specific cells.",
  },
  {
    n: "04",
    img: f4,
    alt: "Fragments of a pale organic structure reassembling",
    title: "Circuit Reconstruction",
    claim: "Neural circuits rebuilt from nanorobotic traversal data, not MRI approximations.",
    body: "Every existing map of neural circuitry is a statistical guess from low-resolution imaging. We reconstruct circuits from within, using physical traversal data.",
  },
  {
    n: "05",
    img: f5,
    alt: "A single coherent thread of light running through dense texture",
    title: "Intent-Reading BCI",
    claim: "An interface that reads cognitive intent, not voltage spikes.",
    body: "Current BCIs read electrical noise and translate it into commands. We read the computational structure of intent itself — the pattern that precedes the signal.",
  },
];

const analytics = [
  { k: "18.4 nm", v: "Median traversal resolution", d: "Sub-cellular, in living tissue" },
  { k: "1.2 M", v: "Synaptic events / session", d: "Captured without inference layers" },
  { k: "6.4 yrs", v: "Mean pre-symptomatic lead", d: "Across retrospective cohorts" },
  { k: "94.1 %", v: "Circuit reconstruction fidelity", d: "Versus ground-truth histology" },
];

const studies = [
  {
    id: "CGN-01",
    title: "Acoustic-gradient navigation in cortical tissue",
    status: "In review",
    n: "n = 42",
  },
  {
    id: "CGN-04",
    title: "Synaptic-junction event coding at 18 nm resolution",
    status: "Preprint",
    n: "n = 118",
  },
  {
    id: "CGN-07",
    title: "Pre-symptomatic degeneration signatures in longitudinal cohorts",
    status: "Active",
    n: "n = 1,306",
  },
  {
    id: "CGN-11",
    title: "First-principles reconstruction versus diffusion tractography",
    status: "Active",
    n: "n = 76",
  },
];

function Index() {
  return (
    <div id="top" className="min-h-screen bg-paper">
      <SiteNav />

      {/* ---------- Hero ---------- */}
      <section className="relative flex min-h-svh items-end overflow-hidden">
        <img
          src="/main-hero.png"
          alt="A human head dissolving into a spiral of luminous neural filaments against deep space"
          width={1664}
          height={936}
          className="drift-slow absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-paper/70 via-paper/25 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-paper via-paper/25 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(75%_65%_at_50%_38%,transparent,color-mix(in_oklab,var(--paper)_35%,transparent))]" />

        <div className="relative w-full px-[clamp(1.25rem,4vw,3.5rem)] pt-36 pb-[clamp(2.5rem,6vw,5rem)]">
          <div className="mx-auto max-w-[1500px]">
            <p
              className="t-marker rise text-[var(--ion)]"
              style={{ animationDelay: "80ms", textShadow: "0 1px 12px rgba(0,4,20,0.9)" }}
            >
              Institute of Neuronanotechnology
            </p>
            <h1 className="t-hero rise mt-7 max-w-[19ch] text-foreground">
              The last frontier of science is between your ears.
            </h1>
            <div className="mt-9 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-end">
              <p
                className="t-lead rise max-w-[48ch] text-foreground/80"
                style={{ animationDelay: "160ms" }}
              >
                We engineer the instruments neuroscience never had — nanorobotic systems that move
                through living neural tissue, and computational models that turn what they find into
                structure.
              </p>
              <div
                className="rise flex flex-wrap items-center gap-4 lg:justify-end"
                style={{ animationDelay: "300ms" }}
              >
                <Link
                  to="/research"
                  className="rounded-full bg-foreground px-7 py-3.5 text-[0.9rem] font-semibold text-primary-foreground transition-opacity hover:opacity-85"
                >
                  See the live research demo
                </Link>
                <Link
                  to="/"
                  hash="frontiers"
                  className="rule-link text-[0.9rem] font-medium text-foreground"
                >
                  Read the science
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Novelty (directly under hero) ---------- */}
      <NoveltySection />

      {/* ---------- Problem ---------- */}
      <section
        id="problem"
        className="haze px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(4.5rem,10vw,9rem)]"
      >
        <div className="mx-auto max-w-[1500px] grid gap-[clamp(2rem,5vw,5rem)] lg:grid-cols-[minmax(0,0.55fr)_minmax(0,1fr)]">
          <Reveal>
            <p className="t-marker text-ash">The problem, stated without flattery</p>
          </Reveal>
          <div className="space-y-8">
            <Reveal delay={80}>
              <p className="t-lead text-foreground">
                Neuroscience has been working with instruments designed for a different era. MRI
                shows you averages. EEG shows you surface noise. Patch clamps show you one cell at a
                time. The hardest problems in the field were never unsolvable — they were
                under-tooled.
              </p>
            </Reveal>
            <Reveal delay={160}>
              <p className="t-body text-ash">
                We build the tools that were missing. Nanorobotic systems that navigate neural
                tissue at sub-cellular resolution. Computational frameworks that make sense of what
                those instruments find. Not two teams working in parallel — one engine, designed
                from the first principle that you cannot understand what you cannot measure, and you
                cannot measure what you cannot reach.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------- Divisions ---------- */}
      <section
        id="divisions"
        className="border-t border-foreground/10 px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(4.5rem,10vw,9rem)]"
      >
        <div className="mx-auto max-w-[1500px]">
          <Reveal>
            <p className="t-marker text-ash">Technology</p>
            <h2 className="t-section mt-4 max-w-[24ch] text-foreground">
              Two divisions, one instrument.
            </h2>
          </Reveal>
          <div className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-[clamp(2rem,4vw,3.5rem)] md:grid-cols-2">
            <Division
              n="01"
              img={divisionNano}
              alt="A translucent filament threading through pale tissue"
              title="Nanorobotic Systems"
              body="Autonomous agents navigating neural tissue at sub-cellular resolution. Powered by the body's own biochemistry. Guided by acoustic gradients. Reprogrammable in real time. These are not probes — they are instruments that live inside the tissue they study."
            />
            <Division
              n="02"
              delay={120}
              img={divisionComp}
              alt="A crystalline lattice emerging out of soft organic tissue"
              title="Computational Neuroscience"
              body="Mathematical frameworks that make sense of what those instruments find. Novel models of synaptic dynamics. Simulations of neurodegeneration before the first clinical symptom. Frameworks for emergent cognition that existing tools cannot represent."
            />
          </div>
        </div>
      </section>

      {/* ---------- Frontiers ---------- */}
      <section
        id="frontiers"
        className="grain border-t border-foreground/10 bg-veil px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(4.5rem,10vw,9rem)]"
      >
        <div className="mx-auto max-w-[1500px]">
          <Reveal>
            <p className="t-marker text-ash">Frontiers</p>
            <h2 className="t-section mt-4 max-w-[26ch] text-foreground">
              Five problems the field declared unsolvable.
            </h2>
          </Reveal>

          <div className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-4 md:grid-cols-3">
            <BentoCard f={frontiers[0]!} variant="wide" className="md:col-span-3" />
            <BentoCard f={frontiers[1]!} delay={80} />
            <BentoCard f={frontiers[2]!} delay={140} variant="halo" />
            <BentoCard f={frontiers[3]!} delay={200} />
            <BentoCard f={frontiers[4]!} delay={260} variant="feature" className="md:col-span-3" />
          </div>
        </div>
      </section>

      {/* ---------- Research & analytics ---------- */}
      <section
        id="analytics"
        className="border-t border-foreground/10 px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(4.5rem,10vw,9rem)]"
      >
        <div className="mx-auto max-w-[1500px]">
          <Reveal>
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="min-w-0">
                <p className="t-marker text-ash">Research & analytics</p>
                <h2 className="t-section mt-4 max-w-[24ch] text-foreground">
                  Measured, not asserted.
                </h2>
              </div>
              <LiveBadge label="Instrument telemetry" />
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="mt-[clamp(2rem,4vw,3.5rem)] grid gap-px overflow-hidden rounded-2xl border border-foreground/12 bg-foreground/10 sm:grid-cols-2 lg:grid-cols-4">
              {analytics.map((a) => (
                <div key={a.v} className="bg-paper px-6 py-7">
                  <p className="t-num text-[clamp(1.6rem,3vw,2.3rem)] font-semibold text-foreground">
                    {a.k}
                  </p>
                  <p className="mt-3 text-[0.92rem] font-medium text-foreground/85">{a.v}</p>
                  <p className="mt-1.5 text-[0.8rem] text-ash">{a.d}</p>
                </div>
              ))}
            </div>
          </Reveal>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Reveal delay={140}>
              <div className="h-full rounded-2xl border border-foreground/12 bg-veil p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="t-marker text-ash">Cortical channel array — live</p>
                  <span className="t-num text-[0.75rem] text-ash">1.2 kHz</span>
                </div>
                <div className="scope instrument mt-5 overflow-hidden rounded-xl border border-foreground/10">
                  <EEGTrace channels={6} height={200} />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <Metric label="SNR" value={38.6} unit="dB" jitter={1.4} />
                  <Metric label="Drift" value={0.42} unit="µm/h" jitter={0.4} />
                  <Metric label="Yield" value={97.3} unit="%" jitter={1} />
                </div>
              </div>
            </Reveal>

            <Reveal delay={200}>
              <div className="h-full rounded-2xl border border-foreground/12 bg-veil p-6">
                <p className="t-marker text-ash">Active studies</p>
                <ul className="mt-5">
                  {studies.map((s) => (
                    <li
                      key={s.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-1 border-b border-foreground/10 py-4 last:border-0"
                    >
                      <span className="t-num text-[0.75rem] text-ash">{s.id}</span>
                      <span className="min-w-0 text-[0.95rem] font-medium text-foreground">
                        {s.title}
                      </span>
                      <span />
                      <span className="flex flex-wrap items-center gap-3 text-[0.78rem] text-ash">
                        <span className="rounded-full border border-foreground/15 px-2.5 py-0.5">
                          {s.status}
                        </span>
                        <span className="t-num">{s.n}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/research"
                  className="rule-link mt-6 inline-block text-[0.9rem] font-medium text-foreground"
                >
                  Open the real-time research console →
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------- About us ---------- */}
      <div className="border-t border-foreground/10">
        <NimbleSection />

        <AboutSection />
      </div>

      {/* ---------- Waitlist ---------- */}
      <Waitlist />

      <SiteFooter />
    </div>
  );
}

function Division({
  n,
  img,
  alt,
  title: t,
  body,
  delay = 0,
}: {
  n: string;
  img: string;
  alt: string;
  title: string;
  body: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay}>
      <div className="group overflow-hidden rounded-2xl border border-foreground/12">
        <img
          src={img}
          alt={alt}
          width={1280}
          height={960}
          loading="lazy"
          className="aspect-[4/3] w-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-[1.05]"
        />
      </div>
      <p className="t-marker mt-7 text-ash">{n}</p>
      <h3 className="mt-3.5 font-semibold tracking-[-0.03em] text-foreground [font-size:clamp(1.5rem,2.5vw,2.1rem)]">
        {t}
      </h3>
      <p className="mt-4 max-w-[48ch] text-[1rem] leading-relaxed text-ash">{body}</p>
    </Reveal>
  );
}

type Frontier = (typeof frontiers)[number];

function BentoCard({
  f,
  variant = "small",
  className = "",
  delay = 0,
}: {
  f: Frontier;
  variant?: "small" | "wide" | "halo" | "feature";
  className?: string;
  delay?: number;
}) {
  const big = variant === "wide" || variant === "feature";

  return (
    <Reveal delay={delay} className={className}>
      <article className="scope group relative h-full overflow-hidden rounded-2xl border border-foreground/12 bg-paper">
        <img
          src={f.img}
          alt={f.alt}
          width={1280}
          height={960}
          loading="lazy"
          className={`absolute inset-0 h-full w-full object-cover transition-all duration-[1400ms] ease-out group-hover:scale-[1.06] ${
            big ? "opacity-40" : "opacity-30"
          }`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/35" />
        {variant === "halo" ? (
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,oklch(1_0_0/0.22),transparent_65%)]" />
        ) : null}

        <div
          className={`relative flex h-full flex-col ${
            big
              ? "gap-6 p-[clamp(1.5rem,3vw,2.75rem)] md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-end"
              : "justify-end gap-4 p-[clamp(1.25rem,2.5vw,2rem)] min-h-[19rem]"
          }`}
        >
          <div className="min-w-0">
            <p className="t-marker text-foreground/50">{f.n}</p>
            <h3
              className={`mt-3 font-semibold tracking-[-0.03em] text-foreground ${
                big
                  ? "[font-size:clamp(1.6rem,3vw,2.4rem)]"
                  : "[font-size:clamp(1.2rem,2vw,1.55rem)]"
              }`}
            >
              {f.title}
            </h3>
            <p className="mt-3 max-w-[40ch] text-[0.92rem] font-medium leading-relaxed text-foreground/75">
              {f.claim}
            </p>
          </div>
          <p
            className={`min-w-0 text-[0.88rem] leading-relaxed text-ash ${
              big
                ? ""
                : "max-h-0 overflow-hidden opacity-0 transition-all duration-700 group-hover:max-h-40 group-hover:opacity-100"
            }`}
          >
            {f.body}
          </p>
        </div>
      </article>
    </Reveal>
  );
}
