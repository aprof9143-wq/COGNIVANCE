import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { ProgramStrip } from "@/components/site/ProgramStrip";
import { ProductShot } from "@/components/site/ProductShot";
import { COMPANY, MODULES, TEAM } from "@/lib/company";

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
  return <div className={`mx-auto max-w-[1180px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

function SectionHead({
  n,
  label,
  title,
  lead,
}: {
  n: string;
  label: string;
  title: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <Reveal>
      <p className="t-marker text-ash">
        <span className="text-foreground/40">{n}</span>
        <span className="mx-2 text-foreground/25">/</span>
        {label}
      </p>
      <h2 className="mt-5 max-w-[22ch] text-[clamp(2rem,4.2vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-foreground">
        {title}
      </h2>
      {lead && (
        <p className="mt-5 max-w-[60ch] text-[clamp(1rem,1.3vw,1.125rem)] leading-relaxed text-ash">
          {lead}
        </p>
      )}
    </Reveal>
  );
}

const Serif = ({ children }: { children: ReactNode }) => (
  <span className="font-[family-name:var(--font-display)] font-normal italic tracking-[-0.01em]">
    {children}
  </span>
);

/* ------------------------------------------------------------------ content */

const PROBLEMS = [
  {
    t: "Therapies are tested on people first",
    d: "Neurology and ophthalmology still learn whether a therapy works in the clinic, one cohort at a time, years after the decision to build it.",
  },
  {
    t: "Patient data lives in silos",
    d: "The genome sits in one system, the MRI in another, the EEG in a third. Nothing joins them into a single picture of one nervous system.",
  },
  {
    t: "Models nobody can audit",
    d: "When a number cannot be traced to its source, release and method, a regulator cannot accept it and a clinician should not trust it.",
  },
];

const STEPS = [
  {
    n: "01",
    t: "Ingest",
    d: "Genome, imaging and EEG enter through one acquisition contract. Public references (Ensembl, UniProt, AlphaFold DB, ClinVar) are captured with a SHA-256 manifest per gene.",
  },
  {
    n: "02",
    t: "Model",
    d: "Simulate from the gene to the protein, the cell, the retina and the visual cortex, and run neural circuits for six conditions in a 3D brain.",
  },
  {
    n: "03",
    t: "Benchmark",
    d: "Every result is labelled measured, reference, computed or hypothetical, and no figure is published until it clears its benchmark gate on a locked hold-out set.",
  },
];

// Who the platform is built for: the users the founders are designing around, not customers.
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

const WHY_NOW = [
  {
    t: "Foundation models are going vertical",
    d: "General models are giving way to lean, domain models for biology. Neurology and vision need one trained on joined genome, imaging and signal data.",
  },
  {
    t: "Every AI output will need an audit trail",
    d: "Regulated medicine will not adopt a model whose numbers cannot be traced. Provenance has to be built in from the first record, not bolted on.",
  },
  {
    t: "An ageing population is losing sight and memory",
    d: "Retinal and neurodegenerative disease grows with age, and every new gene or cell therapy needs evidence long before its first trial.",
  },
  {
    t: "The reference data finally connects",
    d: "Open gene, protein, structure and variant databases now cover the genome. Joining them per patient, with provenance, is an engineering problem.",
  },
];

const EVIDENCE = [
  { k: "Measured", d: "Recorded from an instrument" },
  { k: "Reference", d: "Taken from a public database, with its release" },
  { k: "Computed", d: "Derived by a model from the above" },
  { k: "Hypothetical", d: "A labelled assumption, never a result" },
];

const GROUP_SHOTS: Record<string, { light: string; dark: string; path: string; alt: string }> = {
  "Genome & Vision": {
    light: "/landing/vision-light.jpg",
    dark: "/landing/vision-dark.jpg",
    path: "/vision",
    alt: "Gene and protein evidence for RPE65: ClinVar variants on the gene and protein, and the AlphaFold structure",
  },
  Brain: {
    light: "/landing/simulation-light.jpg",
    dark: "/landing/simulation-dark.jpg",
    path: "/simulation",
    alt: "The CIRCUIT simulation window: a closed-loop neural circuit assembled in a 3D brain",
  },
  Platform: {
    light: "/landing/nimble-light.jpg",
    dark: "/landing/nimble-dark.jpg",
    path: "/nimble",
    alt: "The NIMBLE acquisition core streaming a simulated 19-channel EEG with link health",
  },
};

const initials = (n: string) =>
  n
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

/* ------------------------------------------------------------------ page */

function Landing() {
  const groups = ["Genome & Vision", "Brain", "Platform"] as const;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />

      {/* ---------------------------------------------------------- hero */}
      <section className="relative overflow-hidden pt-[clamp(7.5rem,15vw,10.5rem)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--beam)_14%,transparent),transparent_70%)] dark:bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--deep)_80%,transparent),transparent_70%)]"
        />
        <Container className="relative">
          <Link
            to="/auth"
            className="rise inline-flex items-center gap-2 rounded-full border border-border bg-card/70 py-1 pl-1 pr-3 text-[12.5px] text-foreground/80 backdrop-blur transition-colors hover:border-foreground/25"
          >
            <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
              New
            </span>
            Genome v1: gene to visual cortex, every value traced
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <h1
            className="rise mt-7 max-w-[17ch] text-[clamp(2.75rem,7vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.045em]"
            style={{ animationDelay: "80ms" }}
          >
            The simulation layer for <Serif>brain and eye</Serif> medicine.
          </h1>
          <p
            className="rise mt-7 max-w-[58ch] text-[clamp(1.05rem,1.5vw,1.25rem)] leading-relaxed text-ash"
            style={{ animationDelay: "160ms" }}
          >
            {COMPANY.pitch}
          </p>
          <div
            className="rise mt-9 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-[14px] font-medium text-background transition-opacity hover:opacity-85"
            >
              Open the platform <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              to="/"
              hash="platform"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-[14px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              See what's inside
            </Link>
          </div>

          <div className="rise mt-[clamp(3.5rem,8vw,5.5rem)]" style={{ animationDelay: "320ms" }}>
            <ProductShot
              light="/landing/therapy-light.jpg"
              dark="/landing/therapy-dark.jpg"
              path="/vision/therapy"
              alt="The gene therapy simulator: RPE65 genotype, vector, enzyme, photoreceptors, optic nerve and visual cortex over time"
              priority
            />
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------- programs */}
      <section className="py-14">
        <Container>
          <ProgramStrip />
        </Container>
      </section>

      {/* ---------------------------------------------------------- problem */}
      <section
        id="problem"
        className="scroll-mt-20 border-t border-border py-[clamp(4.5rem,10vw,8rem)]"
      >
        <Container>
          <SectionHead
            n="01"
            label="Problem"
            title={
              <>
                Medicine for the nervous system is still <Serif>discovered in the clinic.</Serif>
              </>
            }
          />
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
            {PROBLEMS.map((p, i) => (
              <Reveal key={p.t} delay={i * 80} className="bg-background p-7 sm:p-8">
                <p className="t-num text-[12px] text-ash">0{i + 1}</p>
                <h3 className="mt-8 text-[1.15rem] font-semibold tracking-[-0.02em]">{p.t}</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ash">{p.d}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------- platform */}
      <section
        id="platform"
        className="scroll-mt-20 border-t border-border py-[clamp(4.5rem,10vw,8rem)]"
      >
        <Container>
          <SectionHead
            n="02"
            label="Platform"
            title={
              <>
                One workspace, <Serif>from the gene to the cortex.</Serif>
              </>
            }
            lead="Nine tools, one login, one theme. Each is working software you can open today, labelled honestly as live data, model or demo."
          />
          <div className="mt-14 space-y-6">
            {groups.map((g, gi) => {
              const shot = GROUP_SHOTS[g]!;
              const mods = MODULES.filter((m) => m.group === g);
              return (
                <Reveal key={g} delay={gi * 60}>
                  <div
                    className={`grid items-center gap-8 rounded-2xl border border-border bg-card p-6 sm:p-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12 ${
                      gi % 2 ? "lg:[&>*:first-child]:order-2" : ""
                    }`}
                  >
                    <div>
                      <p className="t-marker text-ash">{g}</p>
                      <ul className="mt-6 divide-y divide-border border-y border-border">
                        {mods.map((m) => (
                          <li key={m.key} className="py-4">
                            <div className="flex items-baseline justify-between gap-3">
                              <h3 className="text-[15.5px] font-semibold tracking-[-0.015em]">
                                {m.name}
                              </h3>
                              <span className="t-num shrink-0 text-[11px] text-ash">
                                {m.status}
                              </span>
                            </div>
                            <p className="mt-1.5 text-[14px] leading-relaxed text-ash">{m.blurb}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <ProductShot {...shot} />
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------- who */}
      <section
        id="who"
        className="scroll-mt-20 border-t border-border py-[clamp(4.5rem,10vw,8rem)]"
      >
        <Container>
          <SectionHead
            n="03"
            label="Who it's for"
            title={
              <>
                Built for the teams that <Serif>decide what reaches a patient.</Serif>
              </>
            }
          />
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
            {AUDIENCE.map((a, i) => (
              <Reveal key={a.t} delay={i * 80} className="bg-card p-7 sm:p-8">
                <h3 className="text-[1.15rem] font-semibold tracking-[-0.02em]">{a.t}</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ash">{a.d}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------- how */}
      <section
        id="how"
        className="scroll-mt-20 border-t border-border py-[clamp(4.5rem,10vw,8rem)]"
      >
        <Container>
          <SectionHead
            n="04"
            label="How it works"
            title={
              <>
                Ingest. Model. <Serif>Benchmark.</Serif>
              </>
            }
          />
          <ol className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
            <span
              aria-hidden
              className="absolute left-0 right-0 top-[7px] hidden h-px bg-border md:block"
            />
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.n} delay={i * 90} className="relative">
                <span className="relative block h-[15px] w-[15px] rounded-full border border-foreground/30 bg-background">
                  <span className="absolute inset-[4px] rounded-full bg-primary" />
                </span>
                <p className="t-num mt-6 text-[12px] text-ash">{s.n}</p>
                <h3 className="mt-2 text-[1.4rem] font-semibold tracking-[-0.025em]">{s.t}</h3>
                <p className="mt-3 max-w-[38ch] text-[14.5px] leading-relaxed text-ash">{s.d}</p>
              </Reveal>
            ))}
          </ol>
        </Container>
      </section>

      {/* ---------------------------------------------------------- why now */}
      <section
        id="why-now"
        className="scroll-mt-20 border-t border-border py-[clamp(4.5rem,10vw,8rem)]"
      >
        <Container>
          <SectionHead
            n="05"
            label="Why now"
            title={
              <>
                Four shifts make this <Serif>buildable this year.</Serif>
              </>
            }
          />
          <div className="mt-14 grid gap-4 sm:grid-cols-2">
            {WHY_NOW.map((w, i) => (
              <Reveal
                key={w.t}
                delay={i * 70}
                className="group rounded-2xl border border-border bg-card p-7 transition-colors hover:border-foreground/25"
              >
                <p className="t-num text-[12px] text-ash">0{i + 1}</p>
                <h3 className="mt-6 text-[1.15rem] font-semibold tracking-[-0.02em]">{w.t}</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-ash">{w.d}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------- trust */}
      <section
        id="trust"
        className="scroll-mt-20 border-t border-border py-[clamp(4.5rem,10vw,8rem)]"
      >
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <SectionHead
            n="06"
            label="Built to be audited"
            title={
              <>
                Every number <Serif>knows where it came from.</Serif>
              </>
            }
            lead="Each value in the platform carries its source, release, retrieval time and checksum, and says what kind of evidence it is. The software never calls itself clinically validated."
          />
          <Reveal delay={100}>
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
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
          </Reveal>
        </Container>
      </section>

      {/* ---------------------------------------------------------- team */}
      <section
        id="team"
        className="scroll-mt-20 border-t border-border py-[clamp(4.5rem,10vw,8rem)]"
      >
        <Container>
          <SectionHead
            n="07"
            label="Team"
            title={
              <>
                A small team, <Serif>one bench.</Serif>
              </>
            }
          />
          <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {TEAM.map((m, i) => (
              <Reveal as="li" key={m.name} delay={i * 60}>
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  {m.img ? (
                    <img
                      src={m.img}
                      alt={`${m.name}, ${m.role}`}
                      loading="lazy"
                      className="aspect-[4/5] w-full object-cover object-top grayscale transition duration-500 hover:grayscale-0"
                    />
                  ) : (
                    <div className="grid aspect-[4/5] w-full place-items-center bg-secondary">
                      <span className="font-[family-name:var(--font-display)] text-5xl italic text-foreground/50">
                        {initials(m.name)}
                      </span>
                    </div>
                  )}
                  <div className="p-4">
                    <p className="text-[14.5px] font-semibold tracking-[-0.015em]">{m.name}</p>
                    <p className="mt-0.5 text-[12.5px] text-ash">{m.role}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ul>
        </Container>
      </section>

      {/* ---------------------------------------------------------- CTA */}
      <section className="border-t border-border py-[clamp(4.5rem,10vw,8rem)]">
        <Container>
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-[#00030b] px-7 py-14 text-white ring-1 ring-white/10 sm:px-14 sm:py-20">
              <div
                aria-hidden
                className="absolute inset-0 bg-[radial-gradient(50%_80%_at_85%_0%,rgba(61,139,245,0.35),transparent_70%),radial-gradient(40%_60%_at_0%_100%,rgba(138,107,255,0.22),transparent_70%)]"
              />
              <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div>
                  <h2 className="max-w-[18ch] text-[clamp(2rem,4.6vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
                    See it working, <Serif>not in a deck.</Serif>
                  </h2>
                  <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-white/65">
                    One sign-in opens every tool: genome evidence, the therapy simulator, the eye,
                    the brain simulation and the imaging workstation.
                  </p>
                </div>
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-2 self-start rounded-full bg-white px-6 py-3 text-[14px] font-medium text-[#00030b] transition-opacity hover:opacity-90 lg:self-end"
                >
                  Open the platform <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      <Footer />
    </div>
  );
}
