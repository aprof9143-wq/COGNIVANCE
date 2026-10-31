import { Link } from "@tanstack/react-router";
import libraryCfg from "../../../config/genome/library.json";
import { useId, useMemo, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import {
  cell,
  curationsFor,
  facets,
  hasConflict,
  searchGenes,
  type GeneFilter,
} from "@/lib/genomics/library";
import type { Library, LibraryGene } from "@/lib/genomics/schema";
import {
  ClassChip,
  fmtDate,
  GenomicsFrame,
  ModeNotice,
  PageState,
  Panel,
  SourceList,
  Term,
  useLibrary,
} from "./shared";

/** A condition's evidence status, from the library's configuration rather than a capture. */
const STATUS_NOTE: Record<string, string> = Object.fromEntries(
  libraryCfg.conditions.flatMap((c) =>
    "statusNote" in c && typeof c.statusNote === "string" ? [[c.key, c.statusNote]] : [],
  ),
);

const LEAD =
  "Research evidence, not clinical interpretation. Genes that ClinGen's gene–disease validity curations associate with autism spectrum disorder, with their identifiers, orthologues and annotated phenotypes; Alzheimer disease awaits an approved source. A curation describes published evidence about a gene. It is not a diagnosis, a risk estimate or proof of cause for any person.";

export function LibraryPage() {
  const loaded = useLibrary();
  const lib = loaded && loaded.kind !== "error" ? loaded.lib : undefined;
  return (
    <GenomicsFrame active="/genomics" title="Gene library" lead={LEAD} lib={lib}>
      <PageState loaded={loaded} />
      {loaded && loaded.kind !== "error" && (
        <>
          <ModeNotice loaded={loaded} />
          <LibraryView lib={loaded.lib} />
        </>
      )}
    </GenomicsFrame>
  );
}

export function LibraryView({ lib }: { lib: Library }) {
  const [f, setF] = useState<GeneFilter>({});
  const genes = useMemo(() => searchGenes(lib, f), [lib, f]);
  const fs = useMemo(() => facets(lib), [lib]);
  const comparison = lib.species.filter((s) => s.role === "comparison");
  const active = Object.values(f).some(Boolean);
  const set = (k: keyof GeneFilter) => (v: string) => setF((p) => ({ ...p, [k]: v || undefined }));

  return (
    <>
      <div className="grid gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,1.1fr)]">
        {lib.conditions.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={f.condition === c.key}
            onClick={() => set("condition")(f.condition === c.key ? "" : c.key)}
            className={`group rounded-[28px] p-5 text-left transition-colors ${
              f.condition === c.key
                ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]"
                : "bg-[var(--v-card)] hover:bg-[var(--v-soft)]"
            }`}
          >
            <span className="text-[12px] font-medium opacity-70">Condition</span>
            <span className="mt-1 block text-[17px] font-medium">{c.label}</span>
            <span className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-[34px] leading-none tracking-tight">
                {c.geneCount}
              </span>
              <span className="text-[13px] opacity-70">genes with a curation</span>
            </span>
            {STATUS_NOTE[c.key] && (
              <span className="mt-3 block rounded-xl border border-current/20 px-2.5 py-1.5 text-[12px] font-medium leading-snug">
                {STATUS_NOTE[c.key]}
              </span>
            )}
            <span className="mt-3 block text-[12px] leading-snug opacity-70">
              {c.geneCount === 0 && lib.mode === "snapshot"
                ? `ClinGen's download of ${fmtDate(lib.capturedAt)} has no curation whose disease label names this condition, so no gene is listed. None is added by hand. `
                : ""}
              {c.note}
            </span>
          </button>
        ))}
        <Panel title="Sources">
          <SourceList lib={lib} />
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[240px] flex-[1_1_320px]">
            <span className="sr-only">Search genes</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--v-ink-3)]"
              aria-hidden
            />
            <input
              type="search"
              value={f.q ?? ""}
              onChange={(e) => set("q")(e.target.value)}
              placeholder="Search symbol, name, identifier or disease"
              className="h-10 w-full rounded-full border border-[var(--v-line)] bg-[var(--v-card)] pl-9 pr-3 text-[14px] outline-none placeholder:text-[var(--v-ink-3)] focus-visible:border-[var(--v-accent)]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Select
              label="Condition"
              value={f.condition}
              onChange={set("condition")}
              options={lib.conditions.map((c) => [c.key, c.label])}
            />
            <Select
              label="Classification"
              value={f.classification}
              onChange={set("classification")}
              options={fs.classifications.map((c) => [c, c])}
            />
            <Select
              label="Inheritance"
              value={f.moi}
              onChange={set("moi")}
              options={fs.mois.map((m) => [m, m])}
            />
            <Select
              label="Orthologue in"
              value={f.orthologueIn}
              onChange={set("orthologueIn")}
              options={comparison.map((s) => [s.ensembl, s.commonName])}
            />
            {active && (
              <button
                type="button"
                onClick={() => setF({})}
                className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-[13px] text-[var(--v-ink-2)] hover:text-[var(--v-ink)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden /> Clear
              </button>
            )}
          </div>
        </div>
        <p aria-live="polite" className="mt-3 text-[12px] text-[var(--v-ink-3)]">
          {genes.length} of {lib.genes.length} genes
        </p>

        {genes.length === 0 ? (
          <div className="mt-3 rounded-2xl bg-[var(--v-soft)] px-4 py-8 text-center text-[14px]">
            <p className="font-medium">No gene matches these filters.</p>
            <p className="mt-1 text-[13px] text-[var(--v-ink-2)]">
              The library holds only genes with a ClinGen curation for its conditions.
            </p>
            {active && (
              <button
                type="button"
                onClick={() => setF({})}
                className="mt-3 rounded-full bg-[var(--v-ink)] px-4 py-1.5 text-[13px] font-medium text-[var(--v-on-ink)]"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <GeneTable lib={lib} genes={genes} condition={f.condition} />
        )}
      </Panel>
    </>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  const id = useId();
  return (
    <span className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[var(--v-line)] bg-[var(--v-card)] pl-3 pr-1.5 text-[13px]">
      <label htmlFor={id} className="text-[var(--v-ink-3)]">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[160px] bg-transparent pr-1 font-medium outline-none"
      >
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </span>
  );
}

function GeneTable({
  lib,
  genes,
  condition,
}: {
  lib: Library;
  genes: LibraryGene[];
  condition: string | undefined;
}) {
  const comparison = lib.species.filter((s) => s.role === "comparison");
  const label = (k: string) => lib.conditions.find((c) => c.key === k)?.label ?? k;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-[13px]">
        <thead>
          <tr className="text-[12px] text-[var(--v-ink-3)]">
            <th scope="col" className="border-b border-[var(--v-line)] py-2 pr-3 font-medium">
              Gene
            </th>
            <th scope="col" className="border-b border-[var(--v-line)] py-2 pr-3 font-medium">
              <Term k="curation">Curations</Term> and <Term k="classification">classification</Term>
            </th>
            <th scope="col" className="border-b border-[var(--v-line)] py-2 pr-3 font-medium">
              <Term k="moi">Inheritance</Term>
            </th>
            <th scope="col" className="border-b border-[var(--v-line)] py-2 pr-3 font-medium">
              <Term k="orthologue">Orthologues</Term>
            </th>
            <th scope="col" className="border-b border-[var(--v-line)] py-2 font-medium">
              Latest curation
            </th>
          </tr>
        </thead>
        <tbody>
          {genes.map((g) => {
            const cs = curationsFor(g, condition);
            const latest = cs
              .map((c) => c.date)
              .filter(Boolean)
              .sort()
              .at(-1);
            return (
              <tr key={g.symbol} className="group align-top">
                <td className="border-b border-[var(--v-line)] py-3 pr-3">
                  <Link
                    to="/genomics/$symbol"
                    params={{ symbol: g.symbol }}
                    className="inline-flex items-center gap-1 font-mono text-[14px] font-semibold text-[var(--v-accent-ink)] hover:underline"
                  >
                    {g.symbol}
                    <ArrowRight
                      className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </Link>
                  <span className="mt-0.5 block max-w-[24ch] text-[12px] text-[var(--v-ink-2)]">
                    {g.hgnc?.name ?? "Name not retrieved"}
                  </span>
                </td>
                <td className="border-b border-[var(--v-line)] py-3 pr-3">
                  <ul className="flex flex-col gap-1.5">
                    {cs.map((c, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <ClassChip c={c.classification} />
                        <span className="text-[var(--v-ink)]">{c.diseaseLabel}</span>
                        {!condition && (
                          <span className="text-[11px] text-[var(--v-ink-3)]">
                            {label(c.condition)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {hasConflict(g, condition) && (
                    <p className="mt-1.5 text-[12px] text-[var(--v-ink-2)]">
                      Curations disagree; each is shown as ClinGen states it.
                    </p>
                  )}
                </td>
                <td className="border-b border-[var(--v-line)] py-3 pr-3 font-mono text-[12px]">
                  {[...new Set(cs.map((c) => c.moi ?? "—"))].join(", ")}
                </td>
                <td className="border-b border-[var(--v-line)] py-3 pr-3">
                  <OrthoDots g={g} species={comparison.map((s) => [s.ensembl, s.commonName])} />
                </td>
                <td className="border-b border-[var(--v-line)] py-3 text-[12px] text-[var(--v-ink-2)]">
                  {fmtDate(latest)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One dot per comparison species: filled with an orthologue, hollow with none reported, dashed when not read. */
function OrthoDots({ g, species }: { g: LibraryGene; species: [string, string][] }) {
  const cells = species.map(([k, name]) => [name, cell(g, k)] as const);
  const n = cells.filter(([, c]) => c.kind === "orthologue").length;
  if (g.orthologues === null)
    return <span className="text-[12px] text-[var(--v-ink-3)]">Not retrieved</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex gap-1" aria-hidden>
        {cells.map(([name, c]) => (
          <span
            key={name}
            title={`${name}: ${c.kind === "orthologue" ? "orthologue reported" : "none reported"}`}
            className={`h-2.5 w-2.5 rounded-full ${
              c.kind === "orthologue"
                ? "bg-[var(--v-accent)]"
                : "border border-[var(--v-ink-3)] bg-transparent"
            }`}
          />
        ))}
      </span>
      <span className="text-[12px] text-[var(--v-ink-2)]">
        {n} of {species.length} species
      </span>
    </span>
  );
}
