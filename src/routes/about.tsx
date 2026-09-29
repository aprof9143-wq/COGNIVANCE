import { createFileRoute } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { AboutSection } from "@/components/AboutSection";
import { Reveal } from "@/components/Reveal";

const title = "About Us — Cognivance Labs";
const description =
  "The people and principles behind Cognivance Labs: engineers, neurobiologists and computational scientists building instruments neuroscience never had.";

export const Route = createFileRoute("/about")({
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
  component: About,
});

const principles = [
  {
    n: "01",
    t: "Measurement before theory",
    d: "We do not model what we cannot measure. Every framework in the lab is anchored to instrument data taken from living tissue.",
  },
  {
    n: "02",
    t: "One engine, not two teams",
    d: "Instrumentation and computation share a bench. The people building the nanorobotic stack sit with the people modelling its output.",
  },
  {
    n: "03",
    t: "Resolution is the strategy",
    d: "Every advantage we hold comes from resolving structure the field can only approximate. We optimise for resolution first.",
  },
];

function About() {
  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />

      <section className="haze px-[clamp(1.25rem,4vw,3.5rem)] pt-[clamp(8rem,16vw,12rem)] pb-[clamp(3rem,7vw,5rem)]">
        <div className="mx-auto max-w-[1500px]">
          <p className="t-marker rise text-ash">About us</p>
          <h1
            className="t-hero rise mt-7 max-w-[20ch] text-foreground"
            style={{ animationDelay: "100ms" }}
          >
            We build the instruments, then we build the science.
          </h1>
          <p
            className="t-lead rise mt-8 max-w-[54ch] text-foreground/80"
            style={{ animationDelay: "200ms" }}
          >
            Cognivance Labs is an institute of neuronanotechnology. We are a small group with a
            deliberately narrow thesis: the brain has been studied with instruments that cannot
            reach it, and that is the problem worth solving.
          </p>
        </div>
      </section>

      <section className="border-t border-foreground/10 px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(3.5rem,8vw,7rem)]">
        <div className="mx-auto grid max-w-[1500px] gap-6 md:grid-cols-3">
          {principles.map((p, i) => (
            <Reveal key={p.n} delay={i * 100}>
              <div className="h-full rounded-2xl border border-foreground/12 bg-veil p-7">
                <p className="t-marker text-ash">{p.n}</p>
                <h2 className="mt-4 font-semibold tracking-[-0.03em] text-foreground [font-size:clamp(1.2rem,2vw,1.55rem)]">
                  {p.t}
                </h2>
                <p className="mt-3.5 text-[0.92rem] leading-relaxed text-ash">{p.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <div className="border-t border-foreground/10">
        <AboutSection heading="The team" />
      </div>

      <SiteFooter />
    </div>
  );
}
