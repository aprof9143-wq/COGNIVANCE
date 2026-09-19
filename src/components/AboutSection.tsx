import { Reveal } from "@/components/Reveal";

const team = [
  {
    name: "Ansab Butt",
    role: "Chief Executive Officer",
    img: "/Ansab-founder.jpeg",
    bio: "Sets the institute's research agenda and holds the line on first-principles engineering.",
  },
  {
    name: "Maheen",
    role: "Chief Technology Officer",
    img: "/Maheen.jpeg",
    bio: "Owns the platform architecture end to end — the hardware abstraction layer, the unified data model and the pipelines that run on both.",
  },
  {
    name: "Ruhma Naveed",
    role: "Founding Research Engineer",
    img: "/Ruhma.jpg",
    bio: "Designs the nanorobotic instrument stack, from actuation to acoustic guidance.",
  },
];

export function AboutSection({ heading = "About Us" }: { heading?: string }) {
  return (
    <section
      id="about"
      className="grain px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(4.5rem,10vw,9rem)]"
    >
      <div className="mx-auto max-w-[1500px]">
        <Reveal>
          <div className="grid gap-[clamp(1.75rem,4vw,4rem)] border-b border-foreground/12 pb-[clamp(2.5rem,5vw,4rem)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="min-w-0">
              <p className="t-marker text-ash">{heading}</p>
              <h2 className="t-section mt-5 text-foreground">
                A small institute, built to out-resolve the field.
              </h2>
            </div>
            <div className="min-w-0 space-y-6">
              <p className="t-lead text-foreground/85">
                Cognivance Labs was founded on a single observation: the hardest problems in
                neuroscience were never unsolvable — they were under-tooled.
              </p>
              <p className="t-body text-ash">
                We are engineers, neurobiologists and computational scientists working as one group
                across one engine. Nanorobotic systems generate measurement no imaging modality can
                reach; computational neuroscience turns that measurement into structure. The two
                halves are not separate teams — they share a bench, a dataset and a research plan.
              </p>
              <div className="grid grid-cols-3 gap-4 pt-2">
                {[
                  { k: "3", v: "Founding members" },
                  { k: "2", v: "Integrated divisions" },
                  { k: "5", v: "European partners" },
                ].map((s) => (
                  <div key={s.v}>
                    <p className="t-num text-[clamp(1.6rem,3vw,2.4rem)] font-semibold text-foreground">
                      {s.k}
                    </p>
                    <p className="mt-1 text-[0.8rem] text-ash">{s.v}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <div className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {team.map((m, i) => (
            <Reveal key={m.name} delay={i * 90}>
              <figure className="scope group relative h-full overflow-hidden rounded-2xl border border-foreground/12 bg-paper">
                <img
                  src={m.img}
                  alt={`${m.name}, ${m.role}`}
                  width={1200}
                  height={1500}
                  loading="lazy"
                  className="aspect-[4/5] w-full object-cover object-top transition-all duration-[1200ms] ease-out group-hover:scale-[1.04]"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
                <figcaption className="absolute inset-x-0 bottom-0 p-[clamp(1rem,2vw,1.75rem)]">
                  <p className="t-marker text-foreground/55">{String(i + 1).padStart(2, "0")}</p>
                  <h3 className="mt-2.5 font-semibold tracking-[-0.03em] text-foreground [font-size:clamp(1.25rem,2vw,1.6rem)]">
                    {m.name}
                  </h3>
                  <p className="mt-1 text-[0.9rem] font-medium text-foreground/70">{m.role}</p>
                  <p className="mt-3 max-w-[42ch] text-[0.85rem] leading-relaxed text-ash opacity-0 transition-opacity duration-700 group-hover:opacity-100">
                    {m.bio}
                  </p>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
