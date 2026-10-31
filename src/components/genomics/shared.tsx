import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Database, FlaskConical, Info } from "lucide-react";
import { StatusLine } from "@/components/vision/StatusPanel";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ageDays, classificationTone, isStale, STALE_AFTER_DAYS } from "@/lib/genomics/library";
import { loadLibrary, type Loaded } from "@/lib/genomics/load";
import type { Library, LibrarySource } from "@/lib/genomics/schema";

/** Loads the library once per page; never mixes the snapshot with the sample. */
export function useLibrary(): Loaded | null {
  const [state, setState] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    void loadLibrary().then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "date not given";

/** Scientific terms, explained once, used by <Term>. */
export const GLOSSARY = {
  curation:
    "A ClinGen expert panel's review of the published evidence that variation in a gene causes a disease. It describes the literature, not any person.",
  classification:
    "ClinGen's verdict on the strength of that evidence, shown exactly as ClinGen states it. Several curations of one gene are shown side by side, never merged.",
  moi: "Mode of inheritance recorded on the curation, as ClinGen states it (for example AD: autosomal dominant, AR: autosomal recessive, XL: X-linked).",
  orthologue:
    "A gene in another species descended from the same ancestral gene as the human one, separated by speciation. Related by descent; not shown to have the same function.",
  identity:
    "Percent identity: the share of aligned amino acids that are identical between the two proteins, as Ensembl Compara reports it. Higher means more similar sequence, not more similar function.",
  baseline:
    "The spread of percent identity across the one-to-one orthologues of all genes in this library, in the same species. It describes this gene set, not the whole genome.",
  deviation:
    "A gene is marked outside the baseline only when its identity falls beyond the Tukey fences (1.5 × the interquartile range from the middle half). That is a measurable difference from this gene set, not a biological finding.",
  hpo: "Human Phenotype Ontology terms annotated to diseases linked to this gene. They are not specific to autism or Alzheimer disease and predict nothing for any person.",
  taxonomyLevel:
    "The taxon at which Ensembl places the speciation that separates the two genes, as Ensembl reports it.",
} as const;

export function Term({ k, children }: { k: keyof typeof GLOSSARY; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 underline decoration-dotted decoration-[var(--v-ink-3)] underline-offset-[3px]"
          >
            {children}
            <Info className="h-3 w-3 text-[var(--v-ink-3)]" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px] text-[12px] leading-snug">
          {GLOSSARY[k]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const TONE: Record<ReturnType<typeof classificationTone>, string> = {
  supportive: "bg-[color:var(--kv-e3f4f1)] text-[var(--v-ink)]",
  limited: "bg-[color:var(--kv-fbf0dc)] text-[var(--v-ink)]",
  contested: "bg-[color:var(--kv-fbe6ee)] text-[var(--v-ink)]",
  none: "bg-[var(--v-soft)] text-[var(--v-ink-2)]",
  other: "bg-[var(--v-soft)] text-[var(--v-ink-2)]",
};

/** A ClinGen classification, in ClinGen's words; colour always comes with the text. */
export function ClassChip({ c }: { c: string }) {
  const tone = classificationTone(c);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[tone]}`}
    >
      {tone === "contested" && <AlertTriangle className="h-3 w-3" aria-hidden />}
      {c}
    </span>
  );
}

/** Where the data on screen came from: captured snapshot, or synthetic sample. */
export function DataBadge({ lib }: { lib: Library }) {
  if (lib.mode === "sample")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--kv-fbf0dc)] px-2.5 py-1 text-[12px] font-medium text-[var(--v-ink)]">
        <FlaskConical className="h-3.5 w-3.5" aria-hidden />
        Sample data · synthetic
      </span>
    );
  const stale = isStale(lib);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium text-[var(--v-ink)] ${
        stale ? "bg-[color:var(--kv-fbf0dc)]" : "bg-[color:var(--kv-e6eefc)]"
      }`}
    >
      <Database className="h-3.5 w-3.5" aria-hidden />
      Snapshot · {fmtDate(lib.capturedAt)}
      {stale && " · out of date"}
    </span>
  );
}

/** One-line banners for the sample, an out-of-date or incomplete snapshot. */
export function ModeNotice({ loaded }: { loaded: Exclude<Loaded, { kind: "error" }> }) {
  const lib = loaded.lib;
  if (loaded.kind === "sample")
    return (
      <Banner tone="warn" icon={<FlaskConical className="h-4 w-4" aria-hidden />}>
        <strong>Sample data.</strong> {loaded.reason} {lib.sampleNote}
      </Banner>
    );
  const notes: ReactNode[] = [];
  if (isStale(lib))
    notes.push(
      <span key="stale">
        Captured {ageDays(lib.capturedAt)} days ago, more than the {STALE_AFTER_DAYS}-day limit for
        this library; the sources may have changed since.
      </span>,
    );
  if (!lib.complete)
    notes.push(
      <span key="partial">
        This capture is incomplete: some sources could not be read (see Sources). Missing data is
        marked where it would appear, never filled in.
      </span>,
    );
  if (!notes.length) return null;
  return (
    <Banner tone="warn" icon={<AlertTriangle className="h-4 w-4" aria-hidden />}>
      {notes}
    </Banner>
  );
}

export function Banner({
  tone,
  icon,
  children,
}: {
  tone: "warn" | "info";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="note"
      className={`flex gap-2.5 rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug text-[var(--v-ink)] ${
        tone === "warn" ? "bg-[color:var(--kv-fbf0dc)]" : "bg-[var(--v-soft)]"
      }`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

const SOURCE_WORDS: Record<LibrarySource["status"], string> = {
  ok: "read",
  partial: "partly read",
  failed: "could not be read",
  withheld: "withheld by the source policy",
  "not-run": "not read",
};

/** Every source behind the library, with its state and retrieval time. */
export function SourceList({ lib }: { lib: Library }) {
  if (lib.mode === "sample")
    return (
      <p className="text-[13px] text-[var(--v-ink-2)]">
        No source: the sample is made up for this app ({lib.tool}).
      </p>
    );
  return (
    <ul className="flex flex-col divide-y divide-[var(--v-line)]">
      {lib.sources.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2"
        >
          <span className="text-[13px] font-medium">{s.name}</span>
          <span className="text-[12px] text-[var(--v-ink-2)]">
            {SOURCE_WORDS[s.status]}
            {s.retrievedAt && ` · ${fmtDate(s.retrievedAt)}`}
            {s.id === "ensembl-compara" &&
              lib.releases.ensembl &&
              ` · Ensembl ${lib.releases.ensembl}`}
            {s.id === "hpo-annotations" && lib.releases.hpo && ` · ${lib.releases.hpo}`}
          </span>
          {s.reason && <span className="w-full text-[12px] text-[var(--v-ink-3)]">{s.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Panel({
  title,
  children,
  aside,
  className = "",
  id,
}: {
  title?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={typeof title === "string" ? title : undefined}
      className={`scroll-mt-4 rounded-[28px] bg-[var(--v-card)] p-5 shadow-[0_1px_2px_rgba(22,21,29,0.04)] ${className}`}
    >
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

const TABS = [
  { to: "/genomics", label: "Gene library" },
  { to: "/genomics/compare", label: "Cross-species" },
] as const;

/** The frame of every genomics page: status line, title, data badge and the two views. */
export function GenomicsFrame({
  active,
  title,
  lead,
  lib,
  children,
}: {
  active: "/genomics" | "/genomics/compare" | null;
  title: ReactNode;
  lead?: ReactNode;
  lib?: Library | undefined;
  children: ReactNode;
}) {
  return (
    <div className="vision-light min-h-screen px-3 py-3 font-sans sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1280px]">
        <StatusLine />
        <header className="mt-2 flex flex-col gap-4 px-2 pb-5 pt-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--v-ink-3)]">
              Genomics · research library
            </p>
            <h1 className="mt-2 text-[clamp(1.6rem,3vw,2.2rem)] font-semibold leading-tight tracking-[-0.03em]">
              {title}
            </h1>
            {lead && (
              <p className="mt-2 max-w-[72ch] text-[14px] leading-relaxed text-[var(--v-ink-2)]">
                {lead}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
            {lib && <DataBadge lib={lib} />}
            <nav aria-label="Genomics views" className="flex rounded-full bg-[var(--v-soft)] p-1">
              {TABS.map((t) => (
                <Link
                  key={t.to}
                  to={t.to}
                  aria-current={active === t.to ? "page" : undefined}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                    active === t.to
                      ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]"
                      : "text-[var(--v-ink-2)] hover:text-[var(--v-ink)]"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}

/** Loading and error states for a whole page. */
export function PageState({ loaded }: { loaded: Loaded | null }) {
  if (!loaded)
    return (
      <Panel>
        <div role="status" className="flex flex-col gap-3">
          <span className="text-[13px] text-[var(--v-ink-2)]">Reading the gene library…</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-[var(--v-soft)]" aria-hidden />
          ))}
        </div>
      </Panel>
    );
  if (loaded.kind === "error")
    return (
      <Panel>
        <div role="alert" className="flex gap-2.5 text-[14px]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">The gene library could not be shown.</p>
            <p className="mt-1 text-[13px] text-[var(--v-ink-2)]">{loaded.message}</p>
            <p className="mt-1 text-[13px] text-[var(--v-ink-2)]">
              Nothing has been substituted. Reload the page, or rebuild the library
              (docs/genome/LIBRARY.md).
            </p>
          </div>
        </div>
      </Panel>
    );
  return null;
}
