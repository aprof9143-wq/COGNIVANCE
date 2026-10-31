import { Link } from "@tanstack/react-router";
import { useId, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  baseline,
  cell,
  deviation,
  leafOrder,
  MIN_BASELINE_N,
  orthologyWords,
  speciesTree,
  type TreeNode,
} from "@/lib/genomics/library";
import type { Library, LibraryGene, Species } from "@/lib/genomics/schema";
import { BaselineBar } from "./GenePage";
import { fmtDate, GenomicsFrame, ModeNotice, PageState, Panel, Term, useLibrary } from "./shared";

const LEAD =
  "Which library genes have orthologues in other species, how similar their proteins are, and how each compares with the rest of the library. Every cell opens the record behind it. Species differing is expected; a difference is marked only when it is measurably outside this gene set's own spread.";

export function ComparePage() {
  const loaded = useLibrary();
  const lib = loaded && loaded.kind !== "error" ? loaded.lib : undefined;
  return (
    <GenomicsFrame
      active="/genomics/compare"
      title="Cross-species comparison"
      lead={LEAD}
      lib={lib}
    >
      <PageState loaded={loaded} />
      {loaded && loaded.kind !== "error" && (
        <>
          <ModeNotice loaded={loaded} />
          <Compare lib={loaded.lib} />
        </>
      )}
    </GenomicsFrame>
  );
}

type By = "gene" | "phenotype";

function Compare({ lib }: { lib: Library }) {
  const [by, setBy] = useState<By>("gene");
  const [condition, setCondition] = useState("");
  const [hpo, setHpo] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const all = lib.species;
  const [picked, setPicked] = useState<string[]>(all.map((s) => s.ensembl));
  const condId = useId();
  const hpoId = useId();

  const terms = useMemo(() => {
    const m = new Map<string, { name: string; genes: Set<string> }>();
    for (const g of lib.genes)
      for (const t of g.phenotypes ?? []) {
        const e = m.get(t.hpoId) ?? { name: t.name, genes: new Set<string>() };
        e.genes.add(g.symbol);
        m.set(t.hpoId, e);
      }
    return [...m.entries()]
      .map(([id, e]) => ({ id, name: e.name, genes: e.genes }))
      .filter((t) => t.genes.size > 1)
      .sort((a, b) => b.genes.size - a.genes.size || a.name.localeCompare(b.name));
  }, [lib]);

  const genes = useMemo(() => {
    if (by === "phenotype") {
      const t = terms.find((x) => x.id === hpo);
      return t ? lib.genes.filter((g) => t.genes.has(g.symbol)) : [];
    }
    return lib.genes.filter(
      (g) => !condition || g.curations.some((c) => c.condition === condition),
    );
  }, [by, condition, hpo, lib, terms]);

  const species = all.filter((s) => picked.includes(s.ensembl));
  const tree = useMemo(() => speciesTree(species), [species]);
  const order = tree ? leafOrder(tree) : species.map((s) => s.ensembl);
  const cols = order.map((k) => species.find((s) => s.ensembl === k)!);
  const focused = genes.find((g) => g.symbol === focus) ?? genes[0];

  const toggle = (k: string) =>
    setPicked((p) => (p.includes(k) ? (p.length > 2 ? p.filter((x) => x !== k) : p) : [...p, k]));

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
      <div className="flex min-w-0 flex-col gap-3">
        <Panel>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="radiogroup"
                aria-label="Compare by"
                className="flex rounded-full bg-[var(--v-soft)] p-1"
              >
                {(["gene", "phenotype"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="radio"
                    aria-checked={by === b}
                    onClick={() => setBy(b)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ${
                      by === b
                        ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]"
                        : "text-[var(--v-ink-2)]"
                    }`}
                  >
                    By {b}
                  </button>
                ))}
              </div>
              {by === "gene" ? (
                <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--v-line)] pl-3 pr-1.5 text-[13px]">
                  <label htmlFor={condId} className="text-[var(--v-ink-3)]">
                    Genes for
                  </label>
                  <select
                    id={condId}
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    className="bg-transparent font-medium outline-none"
                  >
                    <option value="">Every condition</option>
                    {lib.conditions.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </span>
              ) : (
                <span className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full border border-[var(--v-line)] pl-3 pr-1.5 text-[13px]">
                  <label htmlFor={hpoId} className="shrink-0 text-[var(--v-ink-3)]">
                    <Term k="hpo">Phenotype</Term>
                  </label>
                  <select
                    id={hpoId}
                    value={hpo}
                    onChange={(e) => setHpo(e.target.value)}
                    className="min-w-0 max-w-[280px] bg-transparent font-medium outline-none"
                  >
                    <option value="">Choose a term</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.genes.size} genes)
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </div>
            <fieldset>
              <legend className="mb-2 text-[12px] text-[var(--v-ink-3)]">
                Species (at least two)
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {all.map((s) => {
                  const on = picked.includes(s.ensembl);
                  return (
                    <button
                      key={s.ensembl}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(s.ensembl)}
                      className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                        on
                          ? "bg-[var(--v-accent-soft)] text-[var(--v-accent-ink)]"
                          : "bg-[var(--v-soft)] text-[var(--v-ink-3)]"
                      }`}
                    >
                      {s.commonName}
                      {s.role === "reference" && " (reference)"}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </Panel>

        <Panel
          title="Orthology matrix"
          aside={
            <span className="text-[12px] text-[var(--v-ink-3)]">
              {genes.length} genes × {cols.length} species
            </span>
          }
        >
          {by === "phenotype" && !hpo ? (
            <Empty>
              Choose a phenotype to see the library genes HPO annotates with it.
              {terms.length === 0 &&
                " No phenotype is shared by two or more genes in this library."}
            </Empty>
          ) : genes.length === 0 ? (
            <Empty>No library gene matches. Try another condition or phenotype.</Empty>
          ) : (
            <Matrix
              lib={lib}
              genes={genes}
              cols={cols}
              tree={tree}
              focus={focused?.symbol}
              onFocus={setFocus}
            />
          )}
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {focused && <FocusPanel lib={lib} g={focused} cols={cols} />}
        <Panel title="How to read this">
          <Legend />
          <div className="mt-4 flex flex-col gap-2 text-[12px] leading-snug text-[var(--v-ink-2)]">
            <p>
              <strong className="text-[var(--v-ink)]">Baseline.</strong> For each species, the
              spread of percent identity across the one-to-one orthologues of every gene in this
              library (at least {MIN_BASELINE_N}). It describes this gene set, not the genome.
            </p>
            <p>
              <strong className="text-[var(--v-ink)]">Outside the baseline.</strong> Identity beyond
              the Tukey fences: more than 1.5 times the interquartile range below the first quartile
              or above the third. That is a measurable difference, not a biological finding:
              alignment, gene models and annotation all add uncertainty, and the baseline itself
              moves as the library changes.
            </p>
            <p>
              <strong className="text-[var(--v-ink)]">Tree.</strong> Groups species by the ancestors
              they share in Ensembl's taxonomy; hover a node for the shared taxa. Where the
              ancestors Ensembl lists do not separate species, they branch from the same point.
              Branch lengths mean nothing here.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl bg-[var(--v-soft)] px-4 py-8 text-center text-[13px] text-[var(--v-ink-2)]">
      {children}
    </p>
  );
}

// ------------------------------------------------------------ matrix

const COL = 76;
const GENE_COL = 112;
/** Gap between cells; the tree's leaves sit over the cell centres. */
const SPACING = 3;

/** Cell fill from identity: 40% or less is palest, 100% is the full accent. */
export function identityFill(p: number): string {
  const t = Math.max(0, Math.min(1, (p - 40) / 60));
  return `color-mix(in oklab, var(--v-accent) ${Math.round(12 + t * 68)}%, var(--v-card))`;
}

function Matrix({
  lib,
  genes,
  cols,
  tree,
  focus,
  onFocus,
}: {
  lib: Library;
  genes: LibraryGene[];
  cols: Species[];
  tree: TreeNode | null;
  focus: string | undefined;
  onFocus: (s: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: GENE_COL + cols.length * COL }}>
        {tree ? (
          <Cladogram tree={tree} order={cols.map((c) => c.ensembl)} names={cols} />
        ) : (
          <p className="mb-2 text-[12px] text-[var(--v-ink-3)]" style={{ marginLeft: GENE_COL }}>
            No species tree:{" "}
            {lib.mode === "sample"
              ? "the sample makes up no taxonomy."
              : "Ensembl's taxonomy was not read for every species."}
          </p>
        )}
        <table
          className="table-fixed border-separate text-[12px]"
          style={{ borderSpacing: SPACING, width: GENE_COL + cols.length * COL + SPACING }}
        >
          <colgroup>
            <col style={{ width: GENE_COL - SPACING }} />
            {cols.map((s) => (
              <col key={s.ensembl} style={{ width: COL - SPACING }} />
            ))}
          </colgroup>
          <caption className="sr-only">
            Orthologues of each gene (rows) in each species (columns), with percent identity.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-[var(--v-card)] text-left font-medium text-[var(--v-ink-3)]"
              >
                Gene
              </th>
              {cols.map((s) => (
                <th
                  key={s.ensembl}
                  scope="col"
                  className="px-0.5 pb-1 text-center font-medium"
                  title={s.scientificName}
                >
                  <span className="block truncate">
                    {s.commonName.replace("Rhesus macaque", "Macaque")}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {genes.map((g) => (
              <tr key={g.symbol}>
                <th scope="row" className="sticky left-0 z-10 bg-[var(--v-card)] pr-2 text-left">
                  <button
                    type="button"
                    onClick={() => onFocus(g.symbol)}
                    aria-pressed={focus === g.symbol}
                    className={`rounded-md px-1.5 py-1 font-mono text-[12px] font-semibold ${
                      focus === g.symbol
                        ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]"
                        : "hover:bg-[var(--v-soft)]"
                    }`}
                  >
                    {g.symbol}
                  </button>
                </th>
                {cols.map((s) => (
                  <td key={s.ensembl} className="p-0">
                    <MatrixCell lib={lib} g={g} s={s} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatrixCell({ lib, g, s }: { lib: Library; g: LibraryGene; s: Species }) {
  const box = "flex h-9 w-full items-center justify-center rounded-lg text-[12px]";
  if (s.role === "reference")
    return (
      <span
        className={`${box} bg-[var(--v-soft)] text-[var(--v-ink-3)]`}
        title="The human gene: the reference"
      >
        ref
      </span>
    );
  const c = cell(g, s.ensembl);
  if (c.kind === "not-retrieved")
    return (
      <span
        className={`${box} text-[var(--v-ink-3)]`}
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--v-soft) 0 4px, transparent 4px 8px)",
        }}
        title="Not retrieved: Ensembl was not read for this gene"
      >
        n/a
      </span>
    );
  const d = deviation(lib, g, s.ensembl);
  const out = d.kind === "below" || d.kind === "above";
  const label =
    c.kind === "orthologue"
      ? `${g.symbol} in ${s.commonName}: ${orthologyWords(c.best.type)} orthologue, ${c.best.percId ?? "unknown"}% identity${out ? `, ${d.kind} the baseline` : ""}`
      : `${g.symbol} in ${s.commonName}: no orthologue reported`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={`${box} font-mono transition-transform hover:scale-[1.04] ${
            c.kind === "none-reported"
              ? "border border-dashed border-[var(--v-line)] text-[var(--v-ink-3)]"
              : "text-[var(--v-ink)]"
          } ${out ? "ring-2 ring-[#c4741a] ring-offset-1 ring-offset-[var(--v-card)]" : ""}`}
          style={
            c.kind === "orthologue" && c.best.percId !== null
              ? { background: identityFill(c.best.percId) }
              : undefined
          }
        >
          {c.kind === "orthologue" ? (
            <>
              {c.best.percId !== null ? Math.round(c.best.percId) : "?"}
              {c.best.type !== "ortholog_one2one" && (
                <sup className="ml-0.5 text-[9px]">
                  {c.best.type === "ortholog_one2many" ? "1:n" : "n:n"}
                </sup>
              )}
            </>
          ) : (
            "–"
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-[12px]">
        <Evidence lib={lib} g={g} s={s} />
      </PopoverContent>
    </Popover>
  );
}

/** The record behind one cell: what Ensembl reported, the baseline, and the file it came from. */
function Evidence({ lib, g, s }: { lib: Library; g: LibraryGene; s: Species }) {
  const c = cell(g, s.ensembl);
  const d = deviation(lib, g, s.ensembl);
  const file = g.files.find((f) => f.file.includes("homology"));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold">
        <span className="font-mono">{g.symbol}</span> · {s.commonName}{" "}
        <span className="font-normal italic text-muted-foreground">{s.scientificName}</span>
      </p>
      {c.kind === "orthologue" ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Orthology</dt>
          <dd>
            {orthologyWords(c.best.type)}
            {c.all.length > 1 && ` (${c.all.length} genes)`}
          </dd>
          <dt className="text-muted-foreground">Gene</dt>
          <dd className="font-mono">{c.best.geneId ?? "not given"}</dd>
          <dt className="text-muted-foreground">Identity</dt>
          <dd>
            {c.best.percId ?? "?"}% of the {s.commonName.toLowerCase()} protein
            {c.best.sourcePercId !== null && `; ${c.best.sourcePercId}% of the human one`}
          </dd>
          {c.best.taxonomyLevel && (
            <>
              <dt className="text-muted-foreground">Split at</dt>
              <dd>{c.best.taxonomyLevel}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Baseline</dt>
          <dd>
            {d.kind === "no-baseline" || d.kind === "not-comparable"
              ? d.reason
              : `${d.kind === "within" ? "Within" : d.kind === "below" ? "Below" : "Above"} this library's spread: median ${d.baseline.median.toFixed(1)}%, middle half ${d.baseline.q1.toFixed(1)}–${d.baseline.q3.toFixed(1)}%, n=${d.baseline.n}.`}
          </dd>
        </dl>
      ) : (
        <p>
          Ensembl reported no orthologue in this species. That is not proof the gene is absent from
          its genome.
        </p>
      )}
      <div className="border-t pt-2 text-[11px] text-muted-foreground">
        {lib.mode === "sample" ? (
          <p>Sample data: synthetic, from no source.</p>
        ) : file ? (
          <>
            <p>
              Ensembl Compara{lib.releases.ensembl ? ` release ${lib.releases.ensembl}` : ""},
              retrieved {fmtDate(file.retrievedAt)}.
            </p>
            <p className="mt-0.5 break-all font-mono">{file.url}</p>
            <p className="mt-0.5 font-mono">SHA-256 {file.sha256.slice(0, 16)}…</p>
          </>
        ) : (
          <p>No source file is recorded for this cell.</p>
        )}
        <Link
          to="/genomics/$symbol"
          params={{ symbol: g.symbol }}
          className="mt-1.5 inline-block font-medium text-foreground underline underline-offset-2"
        >
          Open {g.symbol}
        </Link>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ tree

function Cladogram({ tree, order, names }: { tree: TreeNode; order: string[]; names: Species[] }) {
  const height = (n: TreeNode): number =>
    n.children.length ? 1 + Math.max(...n.children.map(height)) : 0;
  const H = height(tree);
  const step = 16;
  const h = H * step + 8;
  const xOf = (k: string) => GENE_COL + SPACING + order.indexOf(k) * COL + (COL - SPACING) / 2;
  const lines: { d: string; key: string }[] = [];
  const nodes: { x: number; y: number; title: string; key: string }[] = [];
  const walk = (n: TreeNode): { x: number; y: number } => {
    if (!n.children.length) return { x: xOf(n.species[0]!), y: h };
    const kids = n.children.map(walk);
    const y = h - height(n) * step;
    const x = (Math.min(...kids.map((k) => k.x)) + Math.max(...kids.map((k) => k.x))) / 2;
    for (const k of kids)
      lines.push({ key: `${n.species.join()}-${k.x}`, d: `M${k.x},${k.y} V${y} H${x}` });
    const common = n.species.map((s) => names.find((x) => x.ensembl === s)?.commonName).join(", ");
    nodes.push({
      x,
      y,
      key: n.species.join(),
      title: `${common}: share ${n.sharedTaxa.join(", ") || "the root"}`,
    });
    return { x, y };
  };
  walk(tree);
  return (
    <svg
      width={GENE_COL + order.length * COL}
      height={h}
      role="img"
      aria-label="Species tree from Ensembl's taxonomy, grouping species by shared ancestors. Branch lengths are not meaningful."
      className="block"
    >
      {lines.map((l) => (
        <path key={l.key} d={l.d} fill="none" stroke="var(--v-ink-3)" strokeWidth={1.25} />
      ))}
      {nodes.map((n) => (
        <circle
          key={n.key}
          cx={n.x}
          cy={n.y}
          r={3.5}
          fill="var(--v-card)"
          stroke="var(--v-ink-2)"
          strokeWidth={1.25}
        >
          <title>{n.title}</title>
        </circle>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------ side panels

function FocusPanel({ lib, g, cols }: { lib: Library; g: LibraryGene; cols: Species[] }) {
  return (
    <Panel
      title={
        <span>
          <span className="font-mono">{g.symbol}</span>{" "}
          <span className="text-[13px] font-normal text-[var(--v-ink-2)]">
            against the baseline
          </span>
        </span>
      }
    >
      <ul className="flex flex-col gap-2.5">
        {cols
          .filter((s) => s.role === "comparison")
          .map((s) => {
            const b = baseline(lib, s.ensembl);
            return (
              <li key={s.ensembl} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{s.commonName}</span>
                <span title={b ? undefined : "No baseline for this species"}>
                  <BaselineBar d={deviation(lib, g, s.ensembl)} />
                </span>
              </li>
            );
          })}
      </ul>
      <Link
        to="/genomics/$symbol"
        params={{ symbol: g.symbol }}
        className="mt-4 inline-block text-[13px] font-medium text-[var(--v-accent-ink)] hover:underline"
      >
        Open the {g.symbol} record
      </Link>
    </Panel>
  );
}

function Legend() {
  return (
    <ul className="grid grid-cols-2 gap-2 text-[12px] text-[var(--v-ink-2)]">
      <li className="flex items-center gap-2">
        <span className="h-4 w-6 rounded" style={{ background: identityFill(95) }} aria-hidden />{" "}
        High identity
      </li>
      <li className="flex items-center gap-2">
        <span className="h-4 w-6 rounded" style={{ background: identityFill(55) }} aria-hidden />{" "}
        Lower identity
      </li>
      <li className="flex items-center gap-2">
        <span className="h-4 w-6 rounded border border-dashed border-[var(--v-line)]" aria-hidden />{" "}
        None reported
      </li>
      <li className="flex items-center gap-2">
        <span
          className="h-4 w-6 rounded"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, var(--v-soft) 0 4px, transparent 4px 8px)",
          }}
          aria-hidden
        />
        Not retrieved
      </li>
      <li className="flex items-center gap-2">
        <span className="h-4 w-6 rounded ring-2 ring-[#c4741a]" aria-hidden /> Outside baseline
      </li>
      <li className="flex items-center gap-2">
        <span className="font-mono">1:n</span> Not one-to-one
      </li>
    </ul>
  );
}
