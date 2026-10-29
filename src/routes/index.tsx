import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { ProgramStrip } from "@/components/site/ProgramStrip";
import { HeroCircuit } from "@/components/site/HeroCircuit";
import { Trace } from "@/components/site/Trace";
import { COMPANY, MODULES, TEAM, type ModuleKey } from "@/lib/company";

const title = "Cognivance — the simulation layer for brain and eye medicine";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: COMPANY.pitch },
      { property: "og:title", content: title },
      { property: "og:description", content: COMPANY.pitch },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

/* ------------------------------------------------------------------ parts */

function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[1240px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

const head = "font-[family-name:var(--font-head)]";

function H2({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`${head} max-w-[20ch] text-[clamp(2.1rem,4.4vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-foreground ${className}`}
    >
      {children}
    </h2>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="mt-5 max-w-[58ch] text-[clamp(1rem,1.3vw,1.125rem)] leading-relaxed text-ash">
      {children}
    </p>
  );
}

const section = "scroll-mt-16 border-t border-border py-[clamp(4.5rem,9vw,8rem)]";

/* ------------------------------------------------------------------ content */

const AUDIENCE = [
  {
    t: "Gene and cell therapy developers",
    d: "Run a construct against a genotype and follow its modelled effect from the vector to the visual cortex before committing to a study.",
  },
  {
    t: "Neurology and ophthalmology researchers",
    d: "Join a cohort's genome, imaging and EEG in one coordinate frame, with every value traced to its source and release.",
  },
  {
    t: "Trial designers and CROs",
    d: "Pressure-test inclusion criteria and endpoints in silico, with an audit trail a reviewer can follow line by line.",
  },
];

const STEPS = [
  {
    t: "Ingest",
    d: "Genome, imaging and EEG enter through one acquisition contract. Public references are captured with a SHA-256 manifest per gene, and a source policy decides what may be stored, shown or shared.",
  },
  {
    t: "Model",
    d: "Simulate from the gene to the protein, the cell, the retina and the visual cortex, and run neural circuits for six conditions in a 3D brain.",
  },
  {
    t: "Benchmark",
    d: "Every result is labelled measured, reference, computed or hypothetical, and no figure is published until it clears its benchmark gate on a locked hold-out set.",
  },
];

/** The three facts a reader should leave the hero with. All are checkable. */
const PROOF = [
  {
    v: "2.2 billion",
    d: "people live with a near or distance vision impairment (WHO, World report on vision, 2019).",
  },
  {
    v: "RPE65",
    d: "our first gene: the target of Luxturna, the first FDA-approved gene therapy for an inherited disease (2017).",
  },
  {
    v: "9 tools",
    d: "working today behind one sign-in, from genome evidence to a 3D brain simulation.",
  },
];

const WHY_NOW = [
  {
    t: "Foundation models are going vertical",
    d: "General models are giving way to lean domain models for biology. The eye and the brain need one trained on joined genome, imaging and signal data, and nobody owns that model yet.",
  },
  {
    t: "An ageing population is losing sight and memory",
    d: "Retinal and neurodegenerative disease grows with age. Every new gene therapy, cell therapy and implant needs evidence long before its first trial.",
  },
  {
    t: "Every AI output in medicine will need an audit trail",
    d: "Regulators will not accept a number nobody can trace. Provenance has to be built in from the first record, not bolted on, and ours is.",
  },
  {
    t: "The reference data finally connects",
    d: "Open gene, protein, structure and variant databases now cover the genome. Joining them per patient, with provenance, is an engineering problem, and engineering problems get solved.",
  },
];

const EVIDENCE = [
  { k: "Measured", d: "Recorded from an instrument" },
  { k: "Reference", d: "Taken from a public database, with its release" },
  { k: "Computed", d: "Derived by a model from the above" },
  { k: "Hypothetical", d: "A labelled assumption, never a result" },
];

/** The screenshot tiles: which module, which capture, and how to frame it. */
const TILES: {
  key: ModuleKey;
  img: string;
  pos: string;
  span: string;
  h: string;
  /** "contain" for a capture drawn on the card's own colour: shown whole, no crop. */
  fit?: "contain";
}[] = [
  {
    key: "therapy",
    img: "therapy",
    pos: "object-left-top",
    span: "lg:col-span-4",
    h: "h-[clamp(240px,30vw,400px)]",
  },
  {
    key: "eye",
    img: "eye",
    pos: "object-center",
    fit: "contain",
    span: "lg:col-span-2",
    h: "h-[clamp(240px,30vw,400px)]",
  },
  { key: "vision", img: "vision", pos: "object-left-top", span: "lg:col-span-2", h: "h-[230px]" },
  {
    key: "simulation",
    img: "simulation",
    pos: "object-[42%_45%]",
    span: "lg:col-span-2",
    h: "h-[230px]",
  },
  { key: "viewer", img: "viewer", pos: "object-top", span: "lg:col-span-2", h: "h-[230px]" },
];

const initials = (n: string) =>
  n
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

/* ------------------------------------------------------------------ page */

function Landing() {
  const tiled = new Set(TILES.map((t) => t.key));
  const rest = MODULES.filter((m) => !tiled.has(m.key));
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />

      {/* ---------------------------------------------------------- hero */}
      <section
        id="stage"
        className="relative overflow-hidden pb-[clamp(3.5rem,7vw,6rem)] pt-[clamp(6.5rem,10vw,8.5rem)]"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_40%_at_10%_6%,color-mix(in_oklab,var(--electric)_16%,transparent),transparent_70%)]"
        />
        <Container className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14">
          <div>
            <Link
              to="/auth"
              className="rise inline-flex items-center gap-2 rounded-full border border-border bg-card/70 py-1 pl-1 pr-3 text-[12.5px] text-foreground/80 backdrop-blur transition-colors hover:border-foreground/25"
            >
              <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
                Live
              </span>
              Genome v1: RPE65 from the gene to the visual cortex
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <h1
              className={`${head} rise mt-7 text-[clamp(2.8rem,5.6vw,5.2rem)] font-semibold leading-[0.95] tracking-[-0.055em] text-foreground`}
              style={{ animationDelay: "80ms" }}
            >
              In-silico trials for the eye and the brain.
            </h1>
            <p
              className="rise mt-6 max-w-[50ch] text-[clamp(1rem,1.35vw,1.15rem)] leading-relaxed text-foreground/70"
              style={{ animationDelay: "160ms" }}
            >
              We are building the vertical foundation model for the eye and the brain. Cognivance
              joins a patient's genome, imaging and EEG into one simulation, so a gene therapy or an
              implant can be tested from the gene to the visual cortex before it reaches a person.
            </p>
            <div
              className="rise mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "240ms" }}
            >
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-[14px] font-medium text-background transition-opacity hover:opacity-90"
              >
                Open the platform <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                to="/"
                hash="platform"
                className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-[14px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
              >
                See what's inside
              </Link>
            </div>
          </div>

          {/* No entrance animation here: its filter would isolate the canvas, and
              the light theme's multiply blend needs to reach the page. The
              canvas fades in on its own once the anatomy has loaded. */}
          <div className="relative h-[clamp(400px,48vw,640px)]">
            <HeroCircuit className="absolute inset-0" />
          </div>
        </Container>

        <Container className="relative">
          <dl className="mt-[clamp(3rem,6vw,4.5rem)] grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
            {PROOF.map((p) => (
              <div key={p.v} className="bg-card p-5 sm:p-6">
                <dt
                  className={`${head} text-[1.9rem] font-semibold tracking-[-0.04em] text-foreground`}
                >
                  {p.v}
                </dt>
                <dd className="mt-1 max-w-[34ch] text-[13.5px] leading-snug text-foreground/65">
                  {p.d}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 border-t border-border pt-7">
            <ProgramStrip />
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------- problem */}
      <section id="problem" className="scroll-mt-16 py-[clamp(5rem,10vw,9rem)]">
        <Container>
          <div>
            <p
              className={`${head} max-w-[36ch] text-[clamp(1.6rem,3.3vw,2.75rem)] font-medium leading-[1.14] tracking-[-0.035em] text-ash`}
            >
              Therapies for the eye and the brain are still tested on people first. The genome sits
              in one system, the scan in another, the EEG in a third, and the models that could join
              them cannot say where their numbers came from.
            </p>
            <p
              className={`${head} mt-8 max-w-[36ch] text-[clamp(1.6rem,3.3vw,2.75rem)] font-medium leading-[1.14] tracking-[-0.035em] text-foreground`}
            >
              Cognivance joins them into one model of one nervous system, and every value in it
              carries its source.
            </p>
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------- platform */}
      <section id="platform" className={section}>
        <Container>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <H2>One workspace, from the gene to the cortex.</H2>
              <Lead>
                Nine tools behind one sign-in, in light and dark. Each is working software you can
                open today, labelled honestly as live data, model or demo.
              </Lead>
            </div>
            <Link
              to="/auth"
              className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-foreground px-5 py-2.5 text-[13.5px] font-medium text-background transition-opacity hover:opacity-85 lg:self-end"
            >
              Open the workspace <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <div className="mt-14 grid gap-4 lg:grid-cols-6">
            {TILES.map((t, i) => {
              const m = MODULES.find((x) => x.key === t.key)!;
              const img = `w-full ${t.h} ${t.fit === "contain" ? "object-contain" : "object-cover"} ${t.pos}`;
              return (
                <Link
                  key={t.key}
                  to={m.to}
                  className={`group flex flex-col overflow-hidden rounded-[20px] border border-border bg-card transition-colors hover:border-foreground/25 ${t.span}`}
                >
                  <div
                    className={`relative overflow-hidden border-b border-border ${t.fit === "contain" ? "bg-card" : "bg-secondary"}`}
                  >
                    <img
                      src={`/landing/tile-${t.img}-light.jpg`}
                      alt=""
                      loading={i < 2 ? "eager" : "lazy"}
                      className={`${img} dark:hidden`}
                    />
                    <img
                      src={`/landing/tile-${t.img}-dark.jpg`}
                      alt=""
                      loading={i < 2 ? "eager" : "lazy"}
                      className={`${img} hidden dark:block`}
                    />
                  </div>
                  <div className="flex flex-1 items-start justify-between gap-4 p-5 sm:p-6">
                    <div>
                      <h3 className="text-[16px] font-semibold tracking-[-0.015em]">{m.name}</h3>
                      <p className="mt-1.5 max-w-[52ch] text-[14px] leading-relaxed text-ash">
                        {m.blurb}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-ash">
                      {m.status}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>

          <ul className="mt-4 grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {rest.map((m) => (
              <li key={m.key} className="bg-card">
                <Link
                  to={m.to}
                  className="group flex h-full flex-col p-5 transition-colors hover:bg-secondary/60"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-semibold tracking-[-0.015em]">{m.name}</span>
                    <span className="text-[11.5px] text-ash">{m.status}</span>
                  </span>
                  <span className="mt-1.5 text-[13.5px] leading-relaxed text-ash">{m.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ---------------------------------------------------------- who */}
      <section id="who" className={section}>
        <Container>
          <H2>Built for the teams that decide what reaches a patient.</H2>
          <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
            {AUDIENCE.map((a) => (
              <div key={a.t} className="border-t border-foreground/80 pt-5">
                <h3 className="text-[1.1rem] font-semibold tracking-[-0.02em]">{a.t}</h3>
                <p className="mt-3 max-w-[40ch] text-[15.5px] leading-relaxed text-ash">{a.d}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------- how */}
      <section id="how" className={section}>
        <Container>
          <H2>Ingest, model, benchmark.</H2>
          <Lead>
            One signal, followed through the platform: the RPE65 coding sequence as Ensembl
            publishes it, translated codon by codon, then the model's retina and visual cortex.
          </Lead>
          {/* Another instrument window: the trace draws light on dark in both themes. */}
          <div className="dark relative mt-12 overflow-hidden rounded-[28px] bg-[#02040c] px-5 py-7 ring-1 ring-foreground/10 sm:px-9 sm:py-10 dark:ring-white/10">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_70%_at_75%_40%,rgba(255,180,92,0.08),transparent_70%),radial-gradient(45%_60%_at_15%_30%,rgba(61,139,245,0.14),transparent_70%)]"
            />
            <Trace className="relative" />
          </div>
          <ol className="relative mt-16 grid gap-10 md:grid-cols-3 md:gap-8">
            <span
              aria-hidden
              className="absolute left-0 right-0 top-[15px] hidden h-px bg-border md:block"
            />
            {STEPS.map((s, i) => (
              <li key={s.t} className="relative">
                <span
                  className={`${head} relative grid h-[31px] w-[31px] place-items-center rounded-full border border-border bg-background text-[13px] font-semibold`}
                >
                  {i + 1}
                </span>
                <h3 className={`${head} mt-6 text-[1.5rem] font-semibold tracking-[-0.03em]`}>
                  {s.t}
                </h3>
                <p className="mt-3 max-w-[38ch] text-[15.5px] leading-relaxed text-ash">{s.d}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* ---------------------------------------------------------- why now */}
      <section id="why-now" className={section}>
        <Container>
          <H2>Why this is buildable now.</H2>
          <dl className="mt-14 border-b border-border">
            {WHY_NOW.map((w) => (
              <div
                key={w.t}
                className="grid gap-3 border-t border-border py-7 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-10"
              >
                <dt className={`${head} text-[1.3rem] font-semibold tracking-[-0.025em]`}>{w.t}</dt>
                <dd className="max-w-[60ch] text-[16px] leading-relaxed text-ash">{w.d}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {/* ---------------------------------------------------------- trust */}
      <section id="trust" className={section}>
        <Container className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <H2>Every number knows where it came from.</H2>
            <Lead>
              Each value in the platform carries its source, release, retrieval time and checksum,
              and says what kind of evidence it is. The software never calls itself clinically
              validated.
            </Lead>
          </div>
          <ul className="divide-y divide-border self-start rounded-[20px] border border-border bg-card">
            {EVIDENCE.map((e) => (
              <li key={e.k} className="flex items-baseline justify-between gap-6 px-6 py-5">
                <span className="text-[15px] font-semibold tracking-[-0.015em]">{e.k}</span>
                <span className="text-right text-[13.5px] text-ash">{e.d}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-6 px-6 py-5">
              <span className="text-[15px] font-semibold tracking-[-0.015em] text-foreground/45">
                Validated
              </span>
              <span className="text-right text-[13.5px] text-ash">
                Reserved until an independent validation exists
              </span>
            </li>
          </ul>
        </Container>
      </section>

      {/* ---------------------------------------------------------- team */}
      <section id="team" className={section}>
        <Container>
          <H2>The team.</H2>
          <ul className="mt-14 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
            {TEAM.map((m) => (
              <li key={m.name}>
                <div className="h-full overflow-hidden rounded-[20px] border border-border bg-card">
                  {m.img ? (
                    <img
                      src={m.img}
                      alt={`${m.name}, ${m.role}`}
                      loading="lazy"
                      className="aspect-[4/5] w-full object-cover object-top grayscale"
                    />
                  ) : (
                    <div className="grid aspect-[4/5] w-full place-items-center bg-[linear-gradient(150deg,color-mix(in_oklab,var(--electric)_24%,var(--card)),var(--secondary)_70%)]">
                      <span
                        className={`${head} text-[clamp(2.5rem,5vw,3.5rem)] font-semibold tracking-[-0.04em] text-foreground/55`}
                      >
                        {initials(m.name)}
                      </span>
                    </div>
                  )}
                  <div className="p-4 sm:p-5">
                    <p className="text-[15px] font-semibold tracking-[-0.015em]">{m.name}</p>
                    <p className="mt-0.5 text-[13px] text-ash">{m.role}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ---------------------------------------------------------- CTA: always dark */}
      <section className="border-t border-border py-[clamp(4.5rem,9vw,8rem)]">
        <Container>
          <div className="dark relative overflow-hidden rounded-[28px] bg-[#02040c] px-7 py-14 text-white ring-1 ring-white/10 sm:px-14 sm:py-20">
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(50%_80%_at_85%_0%,rgba(61,139,245,0.32),transparent_70%),radial-gradient(40%_60%_at_0%_100%,rgba(255,180,92,0.12),transparent_70%)]"
            />
            <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <h2
                  className={`${head} max-w-[16ch] text-[clamp(2.2rem,5vw,4rem)] font-semibold leading-[1] tracking-[-0.05em]`}
                >
                  See it working, not in a deck.
                </h2>
                <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-white/65">
                  One sign-in opens every tool: genome evidence, the therapy simulator, the eye, the
                  brain simulation and the imaging workstation.
                </p>
              </div>
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 self-start rounded-full bg-white px-6 py-3 text-[14px] font-medium text-[#02040c] transition-opacity hover:opacity-90 lg:self-end"
              >
                Open the platform <ArrowUpRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <Footer />
    </div>
  );
}
