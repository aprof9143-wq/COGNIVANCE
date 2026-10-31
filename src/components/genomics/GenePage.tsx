import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Lock, RefreshCw } from "lucide-react";
import {
  cell,
  curationsFor,
  deviation,
  deviationWords,
  hasConflict,
  modelCheck,
  orthologyWords,
  type Deviation,
} from "@/lib/genomics/library";
import { geneExport } from "@/lib/genomics/export";
import { requestLiveCheck, type LiveCheck } from "@/lib/genomics/live";
import type { Library, LibraryGene, Orthologue, Species } from "@/lib/genomics/schema";
import {
  Banner,
  ClassChip,
  fmtDate,
  GenomicsFrame,
  ModeNotice,
  PageState,
  Panel,
  Term,
  useLibrary,
} from "./shared";

export function GenePage({ symbol }: { symbol: string }) {
  const loaded = useLibrary();
  const lib = loaded && loaded.kind !== "error" ? loaded.lib : undefined;
  const gene = lib?.genes.find((g) => g.symbol === symbol);
  return (
    <GenomicsFrame
      active={null}
      title={
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono">{symbol}</span>
          {gene?.hgnc?.name && (
            <span className="text-[0.55em] font-normal tracking-normal text-[var(--v-ink-2)]">
              {gene.hgnc.name}
            </span>
          )}
        </span>
      }
      lib={lib}
    >
      <Link
        to="/genomics"
        className="inline-flex w-fit items-center gap-1 px-2 text-[13px] text-[var(--v-ink-2)] hover:text-[var(--v-ink)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All genes
      </Link>
      <PageState loaded={loaded} />
      {loaded && loaded.kind !== "error" && <ModeNotice loaded={loaded} />}
      {lib && !gene && (
        <Panel>
          <p className="font-medium">{symbol} is not in this library.</p>
          <p className="mt-1 text-[13px] text-[var(--v-ink-2)]">
            The library holds only genes with a ClinGen curation for its conditions
            {lib.mode === "sample" ? ", and the sample holds only made-up genes" : ""}.
          </p>
        </Panel>
      )}
      {lib && gene && <Gene lib={lib} g={gene} />}
    </GenomicsFrame>
  );
}

const links = {
  hgnc: (id: string) => `https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/${id}`,
  ncbi: (id: string) => `https://www.ncbi.nlm.nih.gov/gene/${id}`,
  ensembl: (id: string) => `https://www.ensembl.org/id/${id}`,
  uniprot: (id: string) => `https://www.uniprot.org/uniprotkb/${id}`,
  hpo: (id: string) => `https://hpo.jax.org/browse/term/${id}`,
  clinvar: (s: string) =>
    `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(`${s}[gene]`)}`,
};

function Ext({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return <span className="font-mono">{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[var(--v-accent-ink)] hover:underline"
    >
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden />
      <span className="sr-only">(opens the source's page)</span>
    </a>
  );
}

function Gene({ lib, g }: { lib: Library; g: LibraryGene }) {
  const sample = lib.mode === "sample";
  const h = g.hgnc;
  const ids: [string, string | null | undefined, ((id: string) => string) | null][] = [
    ["HGNC", h?.hgncId, links.hgnc],
    ["NCBI Gene", h?.ncbiGeneId, links.ncbi],
    ["Ensembl", h?.ensemblGeneId, links.ensembl],
    ...(h?.uniprotIds ?? []).map(
      (u) => ["UniProt", u, links.uniprot] as [string, string, (id: string) => string],
    ),
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-3">
        <Panel
          title="Curations"
          aside={
            <span className="text-[12px] text-[var(--v-ink-3)]">ClinGen gene–disease validity</span>
          }
        >
          {g.curations.length === 0 ? (
            <p className="text-[13px] text-[var(--v-ink-2)]">
              No curation is shown: ClinGen is withheld or was not read.
            </p>
          ) : (
            <>
              {hasConflict(g) && (
                <div className="mb-3">
                  <Banner tone="info" icon={<span aria-hidden>≠</span>}>
                    These curations reach different classifications. Each is shown as ClinGen states
                    it; none is picked over another here.
                  </Banner>
                </div>
              )}
              <ul className="flex flex-col divide-y divide-[var(--v-line)]">
                {curationsFor(g).map((c, i) => (
                  <li key={i} className="grid gap-2 py-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                    <div className="flex flex-col items-start gap-1">
                      <ClassChip c={c.classification} />
                      <span className="text-[11px] text-[var(--v-ink-3)]">{fmtDate(c.date)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium">{c.diseaseLabel}</p>
                      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--v-ink-2)]">
                        <div>
                          <dt className="inline">Disease ID </dt>
                          <dd className="inline font-mono">{c.mondoId ?? "not given"}</dd>
                        </div>
                        <div>
                          <dt className="inline">
                            <Term k="moi">Inheritance</Term>{" "}
                          </dt>
                          <dd className="inline font-mono">{c.moi ?? "not given"}</dd>
                        </div>
                        <div>
                          <dt className="inline">Expert panel </dt>
                          <dd className="inline">{c.gcep ?? "not given"}</dd>
                        </div>
                        {c.sop && (
                          <div>
                            <dt className="inline">Procedure </dt>
                            <dd className="inline">{c.sop}</dd>
                          </div>
                        )}
                      </dl>
                      {c.reportUrl && (
                        <a
                          href={c.reportUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-[var(--v-accent-ink)] hover:underline"
                        >
                          ClinGen report <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Orthologues lib={lib} g={g} />
        <Phenotypes g={g} lib={lib} />
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <Panel title="Identifiers">
          <dl className="flex flex-col gap-2 text-[13px]">
            {ids.map(([k, v, f], i) => (
              <div key={i} className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--v-ink-2)]">{k}</dt>
                <dd className="min-w-0 truncate text-right">
                  {v ? (
                    <Ext href={sample || !f ? null : f(v)}>{v}</Ext>
                  ) : (
                    <span className="text-[var(--v-ink-3)]">not reported</span>
                  )}
                </dd>
              </div>
            ))}
            {h?.location && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--v-ink-2)]">Location</dt>
                <dd className="font-mono">{h.location}</dd>
              </div>
            )}
          </dl>
          {g.hgncIdCheck === "differ" && (
            <p className="mt-2 text-[12px] text-[var(--v-ink-2)]">
              HGNC's ID differs from the one on the ClinGen curation; both are kept as reported.
            </p>
          )}
          <p className="mt-3 text-[12px] text-[var(--v-ink-3)]">
            Identifiers from HGNC. The NCBI Gene ID is HGNC's cross-reference; NCBI itself is not
            read.
          </p>
        </Panel>

        {!sample && (
          <Panel title="Variant records">
            <div className="flex gap-2 text-[13px] text-[var(--v-ink-2)]">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--v-ink)]" aria-hidden />
              <p>
                ClinVar records are not shown in this app: they are withheld by the source policy
                until NCBI's required notice is in place and legal review is complete.{" "}
                <a
                  href={links.clinvar(g.symbol)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--v-accent-ink)] underline underline-offset-2"
                >
                  Open {g.symbol} in ClinVar
                </a>{" "}
                on NCBI's own site.
              </p>
            </div>
          </Panel>
        )}

        <LivePanel lib={lib} g={g} />
        <EvidencePanel lib={lib} g={g} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ orthologues

function Orthologues({ lib, g }: { lib: Library; g: LibraryGene }) {
  const species = lib.species.filter((s) => s.role === "comparison");
  return (
    <Panel
      title={<Term k="orthologue">Orthologues</Term>}
      aside={
        <span className="text-[12px] text-[var(--v-ink-3)]">
          Ensembl Compara{lib.releases.ensembl ? ` ${lib.releases.ensembl}` : ""}
        </span>
      }
    >
      {g.orthologues === null ? (
        <p className="text-[13px] text-[var(--v-ink-2)]">
          Not retrieved for this gene ({g.orthologueStatus ?? "not read"}). This says nothing about
          whether orthologues exist.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="text-[12px] text-[var(--v-ink-3)]">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Species
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Type
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    <Term k="identity">Identity</Term>
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Against the <Term k="baseline">baseline</Term>
                  </th>
                </tr>
              </thead>
              <tbody>
                {species.map((s) => (
                  <OrthoRow key={s.ensembl} lib={lib} g={g} s={s} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] leading-snug text-[var(--v-ink-3)]">
            An orthologue is related by descent; it is not shown to do the same job. "None reported"
            means Ensembl reported no orthologue in that species, which is not proof the gene is
            absent.
          </p>
        </>
      )}
    </Panel>
  );
}

function OrthoRow({ lib, g, s }: { lib: Library; g: LibraryGene; s: Species }) {
  const c = cell(g, s.ensembl);
  const d = deviation(lib, g, s.ensembl);
  return (
    <tr className="border-t border-[var(--v-line)] align-middle">
      <td className="py-2.5 pr-3">
        <span className="font-medium">{s.commonName}</span>
        <span className="block text-[11px] italic text-[var(--v-ink-3)]">{s.scientificName}</span>
      </td>
      <td className="py-2.5 pr-3">
        {c.kind === "orthologue" ? (
          <>
            {orthologyWords(c.best.type)}
            {c.all.length > 1 && (
              <span className="text-[11px] text-[var(--v-ink-3)]"> · {c.all.length} genes</span>
            )}
            {c.best.geneId && (
              <span className="block font-mono text-[11px] text-[var(--v-ink-3)]">
                {c.best.geneId}
              </span>
            )}
          </>
        ) : (
          <span className="text-[var(--v-ink-3)]">None reported</span>
        )}
      </td>
      <td className="py-2.5 pr-3">
        <span className="font-mono">
          {c.kind === "orthologue" && c.best.percId !== null ? `${c.best.percId.toFixed(1)}%` : "—"}
        </span>
        {c.kind === "orthologue" && <Lengths o={c.best} />}
      </td>
      <td className="py-2.5">
        <BaselineBar d={d} />
      </td>
    </tr>
  );
}

/** Both aligned proteins' lengths; a large difference points at the gene model, not biology. */
function Lengths({ o }: { o: Orthologue }) {
  const m = modelCheck(o);
  if (m.kind === "not-recorded") return null;
  return (
    <span
      className={`block text-[11px] ${m.kind === "length-differs" ? "font-medium text-[#b5650d]" : "text-[var(--v-ink-3)]"}`}
      title="Lengths of the two proteins Ensembl Compara aligned. A difference of more than a fifth often means an incomplete or different gene model."
    >
      {m.human} vs {m.other} aa{m.kind === "length-differs" && " · check gene model"}
    </span>
  );
}

/** The species baseline as a band (middle half), fences and median, with this gene's value. */
export function BaselineBar({ d }: { d: Deviation }) {
  if (d.kind === "no-baseline" || d.kind === "not-comparable")
    return (
      <span className="text-[12px] text-[var(--v-ink-3)]" title={d.reason}>
        {d.kind === "no-baseline" ? "Too few genes" : "Not compared"}
      </span>
    );
  const b = d.baseline;
  const lo = Math.min(b.low, d.value, b.q1) - 2;
  const hi = Math.max(Math.min(b.high, 100), d.value, b.q3) + 2;
  const x = (v: number) => `${((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 100}%`;
  const words = { within: "Within", below: "Candidate for review", above: "Candidate for review" }[
    d.kind
  ];
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="relative block h-3 w-32 shrink-0"
        role="img"
        aria-label={`${deviationWords(d)}: ${d.value.toFixed(1)}% against a median of ${b.median.toFixed(1)}% (middle half ${b.q1.toFixed(1)} to ${b.q3.toFixed(1)}%, ${b.n} genes)`}
      >
        <span
          className="absolute inset-y-[5px] rounded-full bg-[var(--v-line)]"
          style={{ left: x(b.low), right: `calc(100% - ${x(Math.min(b.high, 100))})` }}
        />
        <span
          className="absolute inset-y-[3px] rounded-sm bg-[var(--v-accent-soft)]"
          style={{ left: x(b.q1), right: `calc(100% - ${x(b.q3)})` }}
        />
        <span
          className="absolute inset-y-[2px] w-px bg-[var(--v-ink-2)]"
          style={{ left: x(b.median) }}
        />
        <span
          className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--v-card)] ${
            d.kind === "within" ? "bg-[var(--v-accent)]" : "bg-[#c4741a]"
          }`}
          style={{ left: x(d.value) }}
        />
      </span>
      <span
        className={`text-[12px] ${d.kind === "within" ? "text-[var(--v-ink-2)]" : "font-medium text-[var(--v-ink)]"}`}
      >
        {words}
        <span className="text-[var(--v-ink-3)]"> · n={b.n}</span>
      </span>
    </span>
  );
}

// ------------------------------------------------------------ phenotypes

function Phenotypes({ g, lib }: { g: LibraryGene; lib: Library }) {
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const terms = useMemo(
    () =>
      (g.phenotypes ?? []).filter(
        (t) => !q || `${t.name} ${t.hpoId}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [g.phenotypes, q],
  );
  const shown = all ? terms : terms.slice(0, 12);
  return (
    <Panel
      title={<Term k="hpo">Annotated phenotypes</Term>}
      aside={
        <span className="text-[12px] text-[var(--v-ink-3)]">
          Human Phenotype Ontology{lib.releases.hpo ? ` ${lib.releases.hpo}` : ""}
        </span>
      }
    >
      {g.phenotypes === null ? (
        <p className="text-[13px] text-[var(--v-ink-2)]">
          Not retrieved: HPO is withheld or was not read.
        </p>
      ) : g.phenotypes.length === 0 ? (
        <p className="text-[13px] text-[var(--v-ink-2)]">
          HPO annotates no phenotype to this gene{lib.mode === "sample" ? " in the sample" : ""}.
        </p>
      ) : (
        <>
          <label className="mb-3 block">
            <span className="sr-only">Filter phenotypes</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Filter ${g.phenotypes.length} terms`}
              className="h-9 w-full max-w-[280px] rounded-full border border-[var(--v-line)] bg-[var(--v-card)] px-3 text-[13px] outline-none focus-visible:border-[var(--v-accent)]"
            />
          </label>
          <ul className="flex flex-wrap gap-1.5">
            {shown.map((t) => (
              <li key={t.hpoId}>
                <a
                  href={links.hpo(t.hpoId)}
                  target="_blank"
                  rel="noreferrer"
                  title={`${t.hpoId} · from ${t.diseaseIds.join(", ") || "no disease ID"}${t.frequencies.length ? ` · frequency ${t.frequencies.join(", ")}` : ""}`}
                  className="inline-flex items-center rounded-full bg-[var(--v-soft)] px-2.5 py-1 text-[12px] hover:bg-[var(--v-accent-soft)]"
                >
                  {t.name}
                </a>
              </li>
            ))}
          </ul>
          {terms.length > 12 && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="mt-3 text-[12px] font-medium text-[var(--v-accent-ink)]"
            >
              {all ? "Show fewer" : `Show all ${terms.length}`}
            </button>
          )}
          <p className="mt-3 text-[12px] leading-snug text-[var(--v-ink-3)]">
            Terms HPO annotates to diseases linked with this gene. They are not specific to autism
            or Alzheimer disease and describe no particular person.
          </p>
        </>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ live check

function LivePanel({ lib, g }: { lib: Library; g: LibraryGene }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "done"; r: LiveCheck }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  if (lib.mode === "sample")
    return (
      <Panel title="Live check">
        <p className="text-[13px] text-[var(--v-ink-2)]">
          Not available for sample genes: they exist in no source.
        </p>
      </Panel>
    );
  const run = async () => {
    setState({ kind: "busy" });
    try {
      setState({ kind: "done", r: await requestLiveCheck(g.symbol) });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  };
  const words = {
    ok: "read",
    failed: "could not be read",
    withheld: "withheld by the source policy",
    skipped: "not read",
  };
  return (
    <Panel title="Live check">
      <p className="text-[13px] text-[var(--v-ink-2)]">
        Asks HGNC and Ensembl now, from the server, and compares their answer with the snapshot of{" "}
        {fmtDate(lib.capturedAt)}. The snapshot is not changed.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={state.kind === "busy"}
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--v-ink)] px-4 py-2 text-[13px] font-medium text-[var(--v-on-ink)] disabled:opacity-60"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${state.kind === "busy" ? "animate-spin" : ""}`}
          aria-hidden
        />
        {state.kind === "busy" ? "Checking…" : "Check now"}
      </button>
      <div aria-live="polite">
        {state.kind === "error" && (
          <p role="alert" className="mt-3 text-[13px]">
            The check could not run: {state.message}
          </p>
        )}
        {state.kind === "done" && (
          <div className="mt-3 rounded-2xl bg-[var(--v-soft)] p-3 text-[13px]">
            <p className="font-medium">
              Live · {new Date(state.r.checkedAt).toLocaleString("en-GB")}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1 text-[12px] text-[var(--v-ink-2)]">
              {state.r.sources.map((s) => (
                <li key={s.id}>
                  {s.id === "hgnc-rest" ? "HGNC" : "Ensembl Compara"}: {words[s.status]}
                  {s.detail && ` (${s.detail})`}
                </li>
              ))}
            </ul>
            <LiveDiff g={g} r={state.r} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function LiveDiff({ g, r }: { g: LibraryGene; r: LiveCheck }) {
  const rows: [string, string, string][] = [];
  if (r.hgnc && g.hgnc) {
    for (const [k, label] of [
      ["hgncId", "HGNC ID"],
      ["ensemblGeneId", "Ensembl gene"],
      ["ncbiGeneId", "NCBI Gene ID"],
    ] as const)
      rows.push([label, g.hgnc[k] ?? "—", r.hgnc[k] ?? "—"]);
  }
  if (r.orthologues && g.orthologues) {
    const n = (os: typeof r.orthologues) => String(new Set(os!.map((o) => o.species)).size);
    rows.push(["Species with an orthologue", n(g.orthologues), n(r.orthologues)]);
  }
  if (!rows.length) return null;
  return (
    <table className="mt-2 w-full text-[12px]">
      <thead className="text-[var(--v-ink-3)]">
        <tr>
          <th scope="col" className="py-1 text-left font-medium" />
          <th scope="col" className="py-1 text-left font-medium">
            Snapshot
          </th>
          <th scope="col" className="py-1 text-left font-medium">
            Live
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, a, b]) => (
          <tr key={k} className={a !== b ? "font-medium" : ""}>
            <td className="py-0.5 pr-2 text-[var(--v-ink-2)]">{k}</td>
            <td className="py-0.5 pr-2 font-mono">{a}</td>
            <td className="py-0.5 font-mono">
              {b}
              {a !== b && <span className="ml-1 text-[11px] text-[#b5650d]">changed</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------ evidence

function EvidencePanel({ lib, g }: { lib: Library; g: LibraryGene }) {
  const download = () => {
    const blob = new Blob([JSON.stringify(geneExport(lib, g, new Date().toISOString()), null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${g.symbol}-${lib.mode}-evidence.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const clingen = lib.sources.find((s) => s.id === "clingen-gene-validity")?.file;
  const files = [...(clingen ? [clingen] : []), ...g.files];
  return (
    <Panel title="Evidence">
      {files.length === 0 ? (
        <p className="text-[13px] text-[var(--v-ink-2)]">
          {lib.mode === "sample"
            ? "Sample data has no source files."
            : "No source file is recorded for this gene."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.file} className="rounded-xl bg-[var(--v-soft)] px-3 py-2 text-[12px]">
              <p className="font-mono">{f.file}</p>
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                title={f.url}
                className="mt-0.5 block truncate text-[var(--v-ink-3)] hover:text-[var(--v-accent-ink)]"
              >
                {f.url.replace(/^https:\/\//, "")}
              </a>
              <p className="mt-0.5 text-[var(--v-ink-2)]">
                Retrieved {fmtDate(f.retrievedAt)} · SHA-256 {f.sha256.slice(0, 12)}…
              </p>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={download}
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--v-line)] px-4 py-2 text-[13px] font-medium hover:bg-[var(--v-soft)]"
      >
        <Download className="h-3.5 w-3.5" aria-hidden /> Export record (JSON)
      </button>
    </Panel>
  );
}
