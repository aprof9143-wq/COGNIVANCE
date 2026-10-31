import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Gated } from "@/components/app/Gated";
import { MODULE_ICON } from "@/components/app/AppShell";
import {
  StatusKey,
  StatusPill,
  WorkflowStrip,
  fmtDay,
  useDataAsOf,
} from "@/components/site/Workflow";
import { COMPANY, MODULES, type Module } from "@/lib/company";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Workspace — Cognivance" },
      { name: "description", content: "Every Cognivance tool, behind one sign-in." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Gated path="/app">
      <Workspace />
    </Gated>
  );
}

const GROUPS = [
  {
    key: "Genome & Vision",
    lead: "From the gene to the visual cortex, and a gene library compared across species.",
  },
  { key: "Brain", lead: "Neural circuits, imaging and EEG in one coordinate frame." },
  { key: "Platform", lead: "The acquisition core and the benchmark protocol behind every result." },
] as const;

function Workspace() {
  const featured = MODULES.find((m) => m.key === "therapy")!;
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 lg:py-14">
      <header className="flex flex-col gap-6 border-b border-border pb-10 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="t-marker text-ash">Workspace</p>
          <h1 className="mt-4 text-[clamp(2rem,4vw,2.8rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
            Everything in one place.
          </h1>
          <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-ash">
            {MODULES.length} tools on one theme and one session, joined in one workflow from the
            data to the evidence behind it. Each says how far it is real.
          </p>
        </div>
        <Link
          to={featured.to}
          className="group inline-flex items-center gap-2 self-start rounded-full bg-foreground px-5 py-2.5 text-[13.5px] font-medium text-background transition-opacity hover:opacity-85 md:self-end"
        >
          Start with {featured.name.toLowerCase()}
          <ArrowRight
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </header>

      <section aria-labelledby="flow" className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="flow" className="text-[1.15rem] font-semibold tracking-[-0.02em]">
            From data to evidence
          </h2>
          <p className="text-[13px] text-ash">What exists at each step, and how far it is real.</p>
        </div>
        <div className="mt-5">
          <WorkflowStrip />
        </div>
        <div className="mt-4">
          <StatusKey />
        </div>
      </section>

      <div className="mt-14 space-y-12">
        {GROUPS.map((g) => (
          <section key={g.key} aria-labelledby={`g-${g.key}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`g-${g.key}`} className="text-[1.15rem] font-semibold tracking-[-0.02em]">
                {g.key}
              </h2>
              <p className="text-[13px] text-ash">{g.lead}</p>
            </div>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MODULES.filter((m) => m.group === g.key).map((m) => (
                <li key={m.key}>
                  <ModuleCard m={m} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-14 border-t border-border pt-6 text-[12px] text-ash">{COMPANY.disclaimer}</p>
    </div>
  );
}

function ModuleCard({ m }: { m: Module }) {
  const Icon = MODULE_ICON[m.key];
  const asOf = useDataAsOf(m.manifest);
  return (
    <Link
      to={m.to}
      className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-foreground/[0.05] text-foreground">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
        </span>
        <StatusPill status={m.status} />
      </div>
      <h3 className="mt-5 text-[15.5px] font-semibold tracking-[-0.015em]">{m.name}</h3>
      <p className="mt-1.5 flex-1 text-[13.5px] leading-relaxed text-ash">{m.blurb}</p>
      <dl className="mt-4 space-y-1 border-t border-border pt-3 text-[12px] text-ash">
        <div>
          <dt className="sr-only">Runs on</dt>
          <dd>{m.data}</dd>
        </div>
        {m.refresh && (
          <div>
            <dt className="sr-only">Updates</dt>
            <dd>
              {asOf ? `Data as of ${fmtDay(asOf)}. ` : ""}
              {m.refresh}
            </dd>
          </div>
        )}
      </dl>
      <span className="mt-4 inline-flex items-center gap-1 text-[12.5px] font-medium text-foreground/70 group-hover:text-foreground">
        Open <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </span>
    </Link>
  );
}
