import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { ProgramStrip } from "@/components/site/ProgramStrip";
import { COMPANY, TEAM } from "@/lib/company";

const title = "About — Cognivance";
const description =
  "Cognivance Labs builds the simulation and evidence layer for brain and eye medicine.";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: About,
});

const PRINCIPLES = [
  {
    n: "01",
    t: "Provenance before polish",
    d: "A number without its source, release and method is not shown. Every value in the platform can be traced back to where it came from.",
  },
  {
    n: "02",
    t: "Say what kind of evidence it is",
    d: "Measured, reference, computed or hypothetical: each label is on the screen, next to the value. Nothing is called validated until it is.",
  },
  {
    n: "03",
    t: "Ship the working thing",
    d: "We would rather show a small model that runs than a large one that is described. Every tool on this site opens and works today.",
  },
];

const initials = (n: string) =>
  n
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

function About() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />

      <section className="pt-[clamp(7.5rem,15vw,10rem)] pb-[clamp(3.5rem,8vw,6rem)]">
        <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
          <p className="t-marker rise text-ash">About</p>
          <h1
            className="rise mt-6 max-w-[20ch] text-[clamp(2.5rem,6vw,4.6rem)] font-semibold leading-[1.0] tracking-[-0.045em]"
            style={{ animationDelay: "80ms" }}
          >
            We build the instruments,{" "}
            <span className="font-[family-name:var(--font-display)] font-normal italic">
              then the science.
            </span>
          </h1>
          <div
            className="rise mt-8 grid max-w-[64rem] gap-6 text-[clamp(1rem,1.4vw,1.15rem)] leading-relaxed text-ash md:grid-cols-2"
            style={{ animationDelay: "160ms" }}
          >
            <p>
              {COMPANY.legal} started from one observation: the hardest problems in neuroscience
              were never unsolvable, they were under-tooled. The brain and the eye are studied with
              data that never meets: a genome here, an MRI there, an EEG somewhere else.
            </p>
            <p>
              So we are building the layer that joins them: a model of one nervous system, from the
              gene to the cortex, that can be simulated and audited. Long term, the same model is
              how we want to guide intervention at the scale of circuits and cells. That part is
              research, not product.
            </p>
          </div>
          <div className="mt-12">
            <ProgramStrip />
          </div>
        </div>
      </section>

      <section className="border-t border-border py-[clamp(4rem,9vw,7rem)]">
        <div className="mx-auto grid max-w-[1180px] gap-4 px-5 sm:px-8 md:grid-cols-3">
          {PRINCIPLES.map((p, i) => (
            <Reveal
              key={p.n}
              delay={i * 80}
              className="rounded-2xl border border-border bg-card p-7"
            >
              <p className="t-num text-[12px] text-ash">{p.n}</p>
              <h2 className="mt-6 text-[1.2rem] font-semibold tracking-[-0.02em]">{p.t}</h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ash">{p.d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="team" className="border-t border-border py-[clamp(4rem,9vw,7rem)]">
        <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
          <p className="t-marker text-ash">Team</p>
          <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.035em]">
            The people building it.
          </h2>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM.map((m, i) => (
              <Reveal as="li" key={m.name} delay={i * 60}>
                <div className="flex h-full gap-4 rounded-2xl border border-border bg-card p-4">
                  {m.img ? (
                    <img
                      src={m.img}
                      alt={`${m.name}, ${m.role}`}
                      loading="lazy"
                      className="h-24 w-20 shrink-0 rounded-xl object-cover object-top"
                    />
                  ) : (
                    <div className="grid h-24 w-20 shrink-0 place-items-center rounded-xl bg-secondary">
                      <span className="font-[family-name:var(--font-display)] text-2xl italic text-foreground/50">
                        {initials(m.name)}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold tracking-[-0.015em]">{m.name}</p>
                    <p className="mt-0.5 text-[13px] text-ash">{m.role}</p>
                    {m.bio && (
                      <p className="mt-2.5 text-[13px] leading-relaxed text-ash">{m.bio}</p>
                    )}
                  </div>
                </div>
              </Reveal>
            ))}
          </ul>
          <Link
            to="/auth"
            className="mt-14 inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-[14px] font-medium text-background transition-opacity hover:opacity-85"
          >
            Open the platform <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
