import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Atom,
  Box,
  Check,
  ChevronRight,
  CircleDashed,
  Dna,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Layers,
  ListChecks,
  Lock,
  Microscope,
  Minus,
  Palette,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Scale,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import {
  EVIDENCE,
  valueOf,
  type EvidenceKind,
  type Provenance,
  type Sourced,
} from "@/lib/vision/evidence";
import {
  CHAIN_COLOURS,
  PLDDT_BANDS,
  parsePdbBackbone,
  plddtBand,
  summarisePlddt,
  type Backbone,
} from "@/lib/vision/pdb";
import {
  crossCheck,
  fetchStructureText,
  rcsbPdbUrl,
  type Check as CheckResult,
} from "@/lib/vision/sources";
import { useEvidence, useStructure } from "./useEvidence";
import { GenomeTrack, GroupFilter, ProteinTrack, VariantCard, countGroups } from "./genome";
import { buildEvidenceExport } from "@/lib/vision/export";
import { compareToReference, REFERENCE } from "@/lib/vision/reference";
import { simulateTherapy } from "@/lib/vision/therapy";
import type { Variant, VariantGroup } from "@/lib/vision/snapshot";
import {
  DECISIONS,
  sourceTerms,
  PIPELINE,
  TARGETS,
  type DecisionStatus,
  type Target,
} from "@/lib/vision/targets";
import { MolViewer, type HoverInfo, type MolColour, type MolStyle } from "./MolViewer";
import { Card, EvidenceTag, Gap, Spinner, VerdictChip, Withheld } from "./ui";
import { StatusLine, StatusPanel } from "./StatusPanel";
import { PlddtChart } from "./PlddtChart";

type Ready = Extract<Target, { status: "ready" }>;

const fetcher = (u: string, i?: RequestInit) => fetch(u, i);

type StructureSource = {
  key: string;
  load: (() => Promise<string>) | null;
  kind: "computed" | "measured";
  label: string;
  recordId: string;
};

// ---------------------------------------------------------------- small parts

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function ProvLine({ p }: { p: Provenance }) {
  return (
    <span className="text-[11px] leading-snug text-[var(--v-ink-3)]">
      <a
        href={p.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 underline decoration-[var(--v-line)] underline-offset-2 hover:text-[var(--v-ink)]"
      >
        {p.source}
        <ExternalLink className="h-2.5 w-2.5" aria-hidden />
      </a>
      {p.recordId && <> · {p.recordId}</>}
      {p.release && <> · {p.release}</>} · retrieved {when(p.retrievedAt)}
      {p.note && <> · {p.note}</>}
    </span>
  );
}

const sourcedReason = (s: Sourced<unknown>) =>
  s.state === "missing" ? s.reason : s.state === "conflict" ? s.reason : "";

// ---------------------------------------------------------------- the module

export function VisionModule() {
  const target = TARGETS.find((t): t is Ready => t.status === "ready")!;
  const { ev, setMode: setDataMode, reload } = useEvidence(target.geneSymbol, target.taxonId);
  const state = { status: ev.status };
  const record = ev.status === "done" ? ev.record : null;
  const gene = record ? valueOf(record.gene) : undefined;
  const protein = record ? valueOf(record.protein) : undefined;
  const model = record ? valueOf(record.model) : undefined;

  const [mode, setMode] = useState<"predicted" | "experimental">("predicted");
  const [pdbId, setPdbId] = useState<string | null>(null);
  const [colourBy, setColourBy] = useState<MolColour>("plddt");
  const [molStyle, setMolStyle] = useState<MolStyle>("cartoon");
  const [autoRotate, setAutoRotate] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [groups, setGroups] = useState<Set<VariantGroup>>(new Set(["pathogenic", "conflicting"]));
  const [picked, setPicked] = useState<Variant | null>(null);
  const variantSet = ev.variants ? valueOf(ev.variants) : undefined;
  const allVariants = useMemo(() => variantSet?.variants ?? [], [variantSet]);
  const shownVariants = useMemo(
    () => allVariants.filter((v) => groups.has(v.group)),
    [allVariants, groups],
  );
  const selectedVariant =
    picked ??
    allVariants.find((v) => v.protein?.short === "R91W" && v.group === "pathogenic") ??
    null;
  const cds = ev.sequences ? valueOf(ev.sequences)?.cds : undefined;
  const comparison = useMemo(
    () =>
      compareToReference(
        simulateTherapy({ dose: 1, treatedArea: 0.3, viableAtStart: 0.7, days: 365 }),
      ),
    [],
  );

  const experimental = protein?.pdb ?? [];
  useEffect(() => {
    setPdbId(experimental[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protein?.accession]);

  const source: StructureSource | null =
    mode === "predicted"
      ? model
        ? {
            key: `${ev.mode}:${model.entryId}`,
            load: ev.loadModelText,
            kind: "computed",
            label: "Predicted model",
            recordId: model.entryId,
          }
        : null
      : pdbId
        ? {
            key: `pdb:${pdbId}`,
            load: async () => {
              const r = await fetchStructureText(rcsbPdbUrl(pdbId), fetcher);
              if (!r.ok) throw new Error(r.reason);
              return r.data;
            },
            kind: "measured",
            label: "Experimental structure",
            recordId: pdbId,
          }
        : null;
  const structure = useStructure(source?.key ?? null, source?.load ?? null);
  const backbone = structure.status === "ready" ? structure.backbone : null;
  const plddt = useMemo(
    () => (mode === "predicted" && backbone ? summarisePlddt(backbone.residues) : null),
    [mode, backbone],
  );
  const effectiveColour: MolColour = mode === "experimental" ? "chain" : colourBy;

  const checks = useMemo(
    () => (record ? crossCheck(target.geneSymbol, target.taxonId, gene, protein, model) : []),
    [record, target, gene, protein, model],
  );

  const exportRecord = () => {
    const out = buildEvidenceExport({
      exportedAt: new Date().toISOString(),
      target: { gene: target.geneSymbol, taxonId: target.taxonId, condition: target.condition },
      record,
      structure: source && {
        ...source,
        retrievedAt: structure.status === "ready" ? structure.retrievedAt : null,
        residues: backbone?.residues.length ?? null,
        plddtComputed: plddt,
      },
      crossChecks: checks,
      decisions: DECISIONS,
    });
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vision-evidence-${target.geneSymbol}-${out.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openCount = DECISIONS.filter((d) => d.status === "open").length;

  return (
    <div className="vision-light min-h-screen px-3 py-3 font-sans sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1440px]">
        <StatusLine />
      </div>
      <div className="mx-auto max-w-[1440px] rounded-[36px] bg-[var(--v-frame)] p-2.5 ring-1 ring-white/80 dark:ring-white/10 backdrop-blur sm:p-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[250px_minmax(0,1fr)_330px]">
          {/* ------------------------------------------------ left */}
          {/* On phones the structure comes first, then its summary, then this index. */}
          <div className="order-3 flex flex-col gap-3 lg:order-none">
            <Card>
              <p className="text-[13px] font-semibold tracking-[-0.01em]">Vision evidence</p>
              <p className="text-xs text-[var(--v-ink-3)]">On this page</p>
              <nav className="mt-4 flex flex-col gap-1 text-sm" aria-label="Sections">
                {[
                  { href: "#structure", label: "Structure", icon: Box, active: true },
                  { href: "#evidence", label: "Evidence record", icon: FileText },
                  { href: "#checks", label: "Cross-checks", icon: ListChecks },
                  {
                    href: "#benchmark",
                    label: "Benchmark definition",
                    icon: Scale,
                    badge: openCount,
                  },
                  { href: "#scope", label: "Scope & licences", icon: ShieldAlert },
                ].map(({ href, label, icon: Icon, active, badge }) => (
                  <a
                    key={href}
                    href={href}
                    className={`flex items-center gap-3 rounded-full px-3 py-2 ${
                      active
                        ? "bg-[var(--v-accent)] text-white"
                        : "text-[var(--v-ink)] hover:bg-[var(--v-soft)]"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {active && <ChevronRight className="h-4 w-4" aria-hidden />}
                    {badge ? (
                      <span
                        className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--v-accent-soft)] px-1.5 text-[11px] font-medium text-[var(--v-accent-ink)]"
                        title={`${badge} open decisions`}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </a>
                ))}
              </nav>
              <p className="mt-6 text-xs font-medium text-[var(--v-ink-2)]">Targets</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TARGETS.map((t) =>
                  t.status === "ready" ? (
                    <span
                      key={t.key}
                      className="rounded-full bg-[var(--v-ink)] px-3 py-1.5 text-xs font-medium text-[var(--v-on-ink)]"
                      aria-current="true"
                    >
                      {t.label}
                    </span>
                  ) : (
                    <span
                      key={t.key}
                      title={t.note}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--v-line)] px-3 py-1.5 text-xs text-[var(--v-ink-3)]"
                    >
                      <Lock className="h-3 w-3" aria-hidden />
                      {t.label} · undefined
                    </span>
                  ),
                )}
              </div>

              <p className="mt-5 text-xs font-medium text-[var(--v-ink-2)]">Data</p>
              <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-[var(--v-soft)] p-1 text-[12px]">
                {(
                  [
                    ["snapshot", "Snapshot"],
                    ["live", "Live check"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    aria-pressed={ev.mode === k}
                    onClick={() => setDataMode(k)}
                    className={`rounded-full px-2 py-1 ${ev.mode === k ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--v-ink-3)]">
                {ev.mode === "snapshot" && ev.manifest
                  ? `Captured ${new Date(ev.manifest.capturedAt).toLocaleDateString(undefined, { dateStyle: "medium" })} from Ensembl, UniProt and AlphaFold DB; shown from a display copy that keeps each value's source. Works offline. Variant records are withheld.`
                  : "Requested now from Ensembl, UniProt and AlphaFold DB. Variant records are withheld."}
              </p>
              {ev.fallback && (
                <p className="mt-1 text-[11px] text-[color:var(--kv-b57d12)]">{ev.fallback}</p>
              )}
            </Card>

            <Card className="flex-1">
              <p className="text-xs text-[var(--v-ink-3)]">Workflow</p>
              <h2 className="text-[19px] font-medium">Evidence pipeline</h2>
              <ul className="mt-4 flex flex-col gap-2">
                {PIPELINE.map((s) => {
                  const src: Sourced<unknown> | null | undefined =
                    s.key === "gene"
                      ? record?.gene
                      : s.key === "protein" || s.key === "cell"
                        ? record?.protein
                        : s.key === "structure"
                          ? record?.model
                          : s.key === "variant"
                            ? ev.variants
                            : undefined;
                  const status =
                    ev.status === "loading"
                      ? "Loading"
                      : s.key === "hypothesis" || s.key === "reference"
                        ? "Ready"
                        : src?.state === "value"
                          ? "Loaded"
                          : src?.state === "conflict"
                            ? "Conflict"
                            : src?.state === "withheld"
                              ? "Withheld"
                              : "Gap";
                  const Icon =
                    s.key === "gene"
                      ? Dna
                      : s.key === "variant"
                        ? ListChecks
                        : s.key === "protein"
                          ? Atom
                          : s.key === "structure"
                            ? Box
                            : s.key === "cell"
                              ? Eye
                              : s.key === "hypothesis"
                                ? Microscope
                                : Scale;
                  const ok = status === "Loaded" || status === "Ready";
                  return (
                    <li key={s.key}>
                      <a
                        href={`#stage-${s.key}`}
                        className={`flex items-center gap-3 rounded-2xl px-2.5 py-2 ${
                          ok
                            ? "bg-[var(--v-soft)] hover:bg-[var(--v-accent-soft)]"
                            : "border border-dashed border-[var(--v-line)]"
                        }`}
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--v-card)]">
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{s.label}</span>
                          <span className="block truncate text-[11px] text-[var(--v-ink-3)]">
                            {s.source} | {status}
                          </span>
                        </span>
                        {ok ? (
                          <Check
                            className="h-3.5 w-3.5 shrink-0 text-[color:var(--kv-0f8f7e)]"
                            aria-label="working"
                          />
                        ) : (
                          <CircleDashed
                            className="h-3.5 w-3.5 shrink-0 text-[var(--v-ink-3)]"
                            aria-hidden
                          />
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          {/* ------------------------------------------------ centre */}
          <Card
            id="structure"
            className="relative order-1 flex min-h-[560px] flex-col overflow-hidden !p-0 lg:order-none"
          >
            <div className="z-10 flex flex-wrap items-center justify-between gap-3 p-5 pb-0">
              <div>
                <h1 className="text-[19px] font-medium">Protein structure</h1>
                <p className="text-xs text-[var(--v-ink-3)]">
                  {target.geneSymbol}
                  {protein && <> · UniProt {protein.accession}</>}
                  {protein?.name && <> · {protein.name}</>}
                </p>
              </div>
              <div
                role="tablist"
                aria-label="Structure source"
                className="flex rounded-full bg-[var(--v-soft)] p-1 text-[13px]"
              >
                {(
                  [
                    ["predicted", "Predicted"],
                    ["experimental", `Experimental${protein ? ` (${experimental.length})` : ""}`],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={mode === k}
                    onClick={() => setMode(k)}
                    className={`rounded-full px-4 py-1.5 ${
                      mode === k ? "bg-[var(--v-accent)] text-white" : "text-[var(--v-ink)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {mode === "experimental" && experimental.length > 0 && (
              <div className="z-10 px-5 pt-3">
                <label className="text-xs text-[var(--v-ink-2)]">
                  Entry{" "}
                  <select
                    value={pdbId ?? ""}
                    onChange={(e) => setPdbId(e.target.value)}
                    className="ml-1 rounded-full border border-[var(--v-line)] bg-[var(--v-card)] px-2 py-1 text-xs"
                  >
                    {experimental.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.id} · {x.method ?? "method not stated"}
                        {x.resolution ? ` · ${x.resolution}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="z-10 flex flex-wrap items-center gap-2 px-5 pt-3 text-[12px]">
              <span className="text-[var(--v-ink-3)]">Show as</span>
              <div
                className="flex rounded-full bg-[var(--v-soft)] p-1"
                role="group"
                aria-label="Drawing style"
              >
                {(
                  [
                    ["cartoon", "Ribbon"],
                    ["surface", "Surface"],
                    ["atoms", "Atoms"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    aria-pressed={molStyle === k}
                    onClick={() => setMolStyle(k)}
                    className={`rounded-full px-3 py-1 ${molStyle === k ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-full bg-[var(--v-soft)] px-3 py-1.5">
                  What am I looking at?
                </summary>
                <div className="absolute left-0 top-9 z-20 w-[300px] rounded-2xl bg-[var(--v-card)] p-3 text-[12px] text-[var(--v-ink-2)] shadow-[0_8px_30px_rgba(22,21,29,0.12)]">
                  <p>
                    <span className="font-medium text-[var(--v-ink)]">A protein</span> is a chain of
                    building blocks (amino acids) that folds into a shape. Its shape decides its
                    job.
                  </p>
                  <p className="mt-1.5">
                    <span className="font-medium text-[var(--v-ink)]">Ribbon</span> follows the
                    chain: spirals are helices, flat arrows are sheets.{" "}
                    <span className="font-medium text-[var(--v-ink)]">Surface</span> shows its
                    outside shape. <span className="font-medium text-[var(--v-ink)]">Atoms</span>{" "}
                    shows every atom and bond.
                  </p>
                  <p className="mt-1.5">
                    Colour shows how sure the prediction is about each part, not whether that part
                    works. Point at the model to read any building block.
                  </p>
                </div>
              </details>
            </div>

            <div className="relative flex flex-1 flex-col">
              <div className="relative min-h-[360px] flex-1 sm:min-h-[420px]">
                {structure.status === "ready" && source && (
                  <MolViewer
                    pdbText={structure.text}
                    label={source.recordId}
                    style={molStyle}
                    colourBy={effectiveColour}
                    spin={autoRotate}
                    resetKey={resetKey}
                    onHover={setHover}
                    focusResidues={
                      mode === "predicted" && selectedVariant?.protein
                        ? [selectedVariant.protein.pos]
                        : []
                    }
                  />
                )}
                <div className="pointer-events-none absolute inset-0 grid place-items-center p-8">
                  {state.status === "loading" ? (
                    <Spinner label="Querying Ensembl and UniProt…" />
                  ) : structure.status === "loading" ? (
                    <Spinner label="Loading coordinates…" />
                  ) : structure.status === "gap" ? (
                    <div className="pointer-events-auto max-w-sm">
                      <Gap>{structure.reason}</Gap>
                    </div>
                  ) : !source ? (
                    <div className="pointer-events-auto max-w-sm">
                      <Gap>
                        {mode === "predicted"
                          ? record
                            ? `No predicted model to show. ${sourcedReason(record.model)}`
                            : ""
                          : protein
                            ? `UniProt lists no experimentally determined structure for ${protein.accession} (${protein.organism ?? `taxon ${protein.taxonId}`}). Structures of other species' versions of this protein are not substituted: matching them would be an inference, not a record.`
                            : `No protein record. ${record ? sourcedReason(record.protein) : ""}`}
                      </Gap>
                    </div>
                  ) : null}
                </div>

                {hover && (
                  <div className="pointer-events-none absolute left-5 top-3 rounded-full bg-[var(--v-ink)] px-3 py-1 text-xs text-[var(--v-on-ink)]">
                    {hover.name} {hover.seq} · chain {hover.chain}
                    {mode === "predicted" && Number.isFinite(hover.b) && (
                      <>
                        {" "}
                        · pLDDT {hover.b.toFixed(1)} ·{" "}
                        {PLDDT_BANDS.find((b) => b.band === plddtBand(hover.b))!.label}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Below the model on phones; over its lower edge from sm up. */}
              <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 sm:pointer-events-none sm:absolute sm:inset-x-0 sm:bottom-0">
                {backbone && source && (
                  <div className="max-w-[290px] rounded-3xl sm:pointer-events-auto bg-[color-mix(in_oklab,var(--v-card)_90%,transparent)] p-4 shadow-[0_8px_30px_rgba(22,21,29,0.08)] backdrop-blur">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[17px] font-medium leading-tight">{source.label}</p>
                      <EvidenceTag kind={source.kind} />
                    </div>
                    <p className="mt-1 text-xs text-[var(--v-ink-2)]">
                      {source.kind === "computed"
                        ? "Predicted by AlphaFold. A model of the structure, not a measurement of it."
                        : "Experimentally determined. Colour shows chain, not confidence."}
                    </p>
                    <p className="mt-2 text-[11px] text-[var(--v-ink-3)]">
                      {source.recordId} · {backbone.residues.length} residues ·{" "}
                      {backbone.chains.length} chain
                      {backbone.chains.length === 1 ? "" : "s"}
                    </p>
                    <ul className="mt-2 space-y-0.5">
                      {effectiveColour === "plddt"
                        ? PLDDT_BANDS.map((b) => (
                            <li
                              key={b.band}
                              className="flex items-center gap-2 text-[11px] text-[var(--v-ink-2)]"
                            >
                              <span
                                className="h-2.5 w-2.5 rounded-sm"
                                style={{ background: b.colour }}
                                aria-hidden
                              />
                              <span className="font-medium text-[var(--v-ink)]">{b.label}</span>{" "}
                              {b.range}
                            </li>
                          ))
                        : backbone.chains.map((c, i) => (
                            <li
                              key={c}
                              className="flex items-center gap-2 text-[11px] text-[var(--v-ink-2)]"
                            >
                              <span
                                className="h-2.5 w-2.5 rounded-sm"
                                style={{ background: CHAIN_COLOURS[i % CHAIN_COLOURS.length] }}
                                aria-hidden
                              />
                              Chain {c}
                            </li>
                          ))}
                    </ul>
                    {effectiveColour === "plddt" && (
                      <p className="mt-2 text-[11px] text-[var(--v-ink-2)]">
                        In plain words: blue parts the model is sure about; orange parts it is
                        unsure about, often loose, flexible stretches.
                      </p>
                    )}
                  </div>
                )}

                <div className="ml-auto grid grid-cols-2 gap-2 rounded-3xl bg-[color-mix(in_oklab,var(--v-card)_90%,transparent)] p-2 shadow-[0_8px_30px_rgba(22,21,29,0.08)] sm:pointer-events-auto">
                  {[
                    {
                      label: "Reset view",
                      icon: RotateCcw,
                      on: () => setResetKey((k) => k + 1),
                      disabled: !backbone,
                    },
                    {
                      label: autoRotate ? "Stop rotation" : "Rotate",
                      icon: autoRotate ? Pause : Play,
                      on: () => setAutoRotate((r) => !r),
                      pressed: autoRotate,
                      disabled: !backbone,
                    },
                    {
                      label: colourBy === "plddt" ? "Colour by chain" : "Colour by confidence",
                      icon: Palette,
                      on: () => setColourBy((c) => (c === "plddt" ? "chain" : "plddt")),
                      disabled: !backbone || mode === "experimental",
                    },
                    { label: "Reload sources", icon: RefreshCw, on: reload },
                  ].map(({ label, icon: Icon, on, pressed, disabled }) => (
                    <button
                      key={label}
                      onClick={on}
                      disabled={disabled}
                      aria-label={label}
                      title={label}
                      aria-pressed={pressed}
                      className="grid h-10 w-10 place-items-center rounded-full border border-[var(--v-line)] bg-[var(--v-card)] disabled:opacity-40"
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* ------------------------------------------------ right */}
          <div className="order-2 flex flex-col gap-3 lg:order-none">
            <Card>
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--v-accent-soft)] text-[var(--v-accent-ink)]">
                  <Eye className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-medium leading-tight">{target.condition}</p>
                  <p className="text-[11px] text-[var(--v-ink-3)]">{target.note}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Stat
                  icon={Atom}
                  value={protein ? `${protein.length}` : "—"}
                  unit="aa"
                  label="Protein length · UniProt"
                  kind={protein ? "reference" : undefined}
                />
                <Stat
                  icon={Dna}
                  value={gene?.canonical ? `${gene.canonical.exonCount}` : "—"}
                  label="Exons · Ensembl canonical"
                  kind={gene?.canonical ? "reference" : undefined}
                />
              </div>
            </Card>

            <Card>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-[var(--v-ink-3)]">Model confidence</p>
                  <h2 className="text-[19px] font-medium">Mean pLDDT</h2>
                </div>
                {plddt && <EvidenceTag kind="computed" />}
              </div>
              <p className="mt-1 text-xs text-[var(--v-ink-2)]">
                AlphaFold's own per-residue confidence, read from the model file. It describes the
                model, not any patient.
              </p>
              {plddt && backbone ? (
                <>
                  <div className="mt-3 flex items-end gap-2">
                    <span className="text-[56px] font-light leading-none tracking-tight">
                      {plddt.mean.toFixed(1)}
                    </span>
                    <span className="mb-1.5 text-sm text-[var(--v-ink-2)]">/ 100</span>
                  </div>
                  {model?.globalPlddt !== undefined && (
                    <p className="mt-1 text-[11px] text-[var(--v-ink-3)]">
                      AlphaFold DB reports {model.globalPlddt.toFixed(1)} for this entry.
                    </p>
                  )}
                  <div className="mt-3">
                    <PlddtChart residues={backbone.residues} />
                  </div>
                  <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    {PLDDT_BANDS.map((b) => (
                      <li
                        key={b.band}
                        className="flex items-center gap-1.5 text-[11px] text-[var(--v-ink-2)]"
                      >
                        <span
                          className="h-2 w-2 rounded-sm"
                          style={{ background: b.colour }}
                          aria-hidden
                        />
                        {b.label}
                        <span className="ml-auto tabular-nums text-[var(--v-ink)]">
                          {(plddt.fractions[b.band] * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="mt-3">
                  <Gap>
                    {mode === "experimental"
                      ? "Shown for predicted models only. B-factors in experimental files are not confidence scores."
                      : "Appears once a predicted model has loaded."}
                  </Gap>
                </div>
              )}
            </Card>

            <Card className="flex-1">
              <div className="flex items-center justify-between">
                <h2 className="text-[19px] font-medium">Benchmark definition</h2>
                <a
                  href="#benchmark"
                  className="text-xs text-[var(--v-accent-ink)] underline underline-offset-2"
                >
                  All 14
                </a>
              </div>
              <DecisionMeter />
              <ul className="mt-3 flex flex-col gap-1.5">
                {DECISIONS.filter((d) => d.status !== "decided")
                  .slice(0, 5)
                  .map((d) => (
                    <li
                      key={d.n}
                      className="flex items-center gap-2 rounded-2xl bg-[var(--v-soft)] px-3 py-2 text-[13px]"
                    >
                      <span className="w-5 font-mono text-[11px] text-[var(--v-ink-3)]">{d.n}</span>
                      <span className="flex-1 truncate">{d.question}</span>
                      <StatusChip status={d.status} />
                    </li>
                  ))}
              </ul>
            </Card>
          </div>
        </div>

        {/* ------------------------------------------------ evidence + checks */}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card id="evidence">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[19px] font-medium">Evidence record</h2>
                <p className="text-xs text-[var(--v-ink-3)]">
                  Each value as its source states it, with where and when it was retrieved.
                </p>
              </div>
              <button
                onClick={exportRecord}
                disabled={!record}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--v-ink)] px-4 py-2 text-xs font-medium text-[var(--v-on-ink)] disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export record (JSON)
              </button>
            </div>
            {!record ? (
              <div className="mt-4">
                <Spinner label="Querying sources…" />
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-5">
                <EvidenceGroup title="Gene & transcript" icon={Dna} s={record.gene}>
                  {gene && [
                    ["Symbol", gene.symbol],
                    [
                      "Ensembl gene",
                      gene.version ? `${gene.ensemblId}.${gene.version}` : gene.ensemblId,
                    ],
                    [
                      "Location",
                      `chr${gene.chromosome}:${gene.start.toLocaleString()}–${gene.end.toLocaleString()} (${gene.strand > 0 ? "+" : "−"} strand) · ${gene.assembly}`,
                    ],
                    ["Biotype", gene.biotype ?? "not stated"],
                    ["Description", gene.description ?? "not stated"],
                    [
                      "Canonical transcript",
                      gene.canonical
                        ? `${gene.canonical.id}${gene.canonical.version ? `.${gene.canonical.version}` : ""} · ${gene.canonical.exonCount} exons`
                        : "not identified",
                    ],
                    [
                      "Canonical translation",
                      gene.canonical?.translation
                        ? `${gene.canonical.translation.id} · ${gene.canonical.translation.length} aa`
                        : "not identified",
                    ],
                    ["Transcripts in Ensembl", String(gene.transcriptCount)],
                  ]}
                </EvidenceGroup>
                <EvidenceGroup title="Protein" icon={Atom} s={record.protein}>
                  {protein && [
                    [
                      "Accession",
                      `${protein.accession}${protein.entryName ? ` (${protein.entryName})` : ""} · ${protein.reviewed ? "reviewed" : "unreviewed"}`,
                    ],
                    ["Name", protein.name ?? "not stated"],
                    ["Organism", `${protein.organism ?? "not stated"} · taxon ${protein.taxonId}`],
                    ["Length", `${protein.length} aa`],
                    ["Function", protein.functionText ?? "not stated"],
                    ["Subcellular location", protein.locations.join(", ") || "not stated"],
                    [
                      "Disease associations",
                      protein.diseases.length
                        ? protein.diseases
                            .map(
                              (d) =>
                                `${d.id}${d.acronym ? ` (${d.acronym})` : ""}${d.mim ? ` · MIM ${d.mim}` : ""}`,
                            )
                            .join("; ")
                        : "none listed",
                    ],
                    [
                      "Experimental structures",
                      protein.pdb.length
                        ? protein.pdb.map((p) => p.id).join(", ")
                        : "none cross-referenced",
                    ],
                  ]}
                </EvidenceGroup>
                <EvidenceGroup title="Predicted structure" icon={Microscope} s={record.model}>
                  {model && [
                    [
                      "Entry",
                      `${model.entryId}${model.version ? ` · version ${model.version}` : ""}`,
                    ],
                    ["Created", model.created ?? "not stated"],
                    [
                      "Residues modelled",
                      model.start !== undefined && model.end !== undefined
                        ? `${model.start}–${model.end}`
                        : "not stated",
                    ],
                    [
                      "Mean pLDDT (reported)",
                      model.globalPlddt !== undefined
                        ? model.globalPlddt.toFixed(1)
                        : "not reported",
                    ],
                    ["Other entries for this accession", model.others.join(", ") || "none"],
                  ]}
                </EvidenceGroup>
              </div>
            )}
          </Card>

          <Card id="checks">
            <h2 className="text-[19px] font-medium">Cross-checks</h2>
            <p className="text-xs text-[var(--v-ink-3)]">
              Computed here. A difference is shown, never resolved by picking a side.
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {!record ? (
                <Spinner label="Waiting for sources…" />
              ) : (
                checks.map((c) => <CheckRow key={c.key} c={c} />)
              )}
            </ul>
          </Card>
        </div>

        {/* ------------------------------------------------ pipeline stages */}
        <Card id="stage-variant" className="mt-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[19px] font-medium">Genomic variants</h2>
                {ev.variants?.state === "value" && <EvidenceTag kind="reference" label="ClinVar" />}
              </div>
              {ev.variants?.state === "withheld" ? (
                <p className="text-xs text-[var(--v-ink-3)]">
                  Variant records come from ClinVar, which this app may not show yet.
                </p>
              ) : variantSet ? (
                <p className="text-xs text-[var(--v-ink-3)]">
                  {variantSet.variants.length.toLocaleString()} variants recorded for RPE65 alone ·{" "}
                  {countGroups(variantSet.variants).pathogenic} pathogenic or likely pathogenic ·{" "}
                  {variantSet.multiGene} larger events spanning other genes too are counted, not
                  mapped.
                </p>
              ) : ev.variants?.state === "missing" ? null : (
                <p className="text-xs text-[var(--v-ink-3)]">Loading…</p>
              )}
              {ev.variants?.state === "value" && (
                <div className="mt-0.5">
                  <ProvLine p={ev.variants.provenance} />
                </div>
              )}
            </div>
            <Link
              to="/vision/therapy"
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--v-ink)] px-4 py-2 text-xs font-medium text-[var(--v-on-ink)]"
            >
              Open the gene therapy simulator <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {ev.variants?.state === "missing" && (
            <div className="mt-3">
              <Gap>{ev.variants.reason}</Gap>
            </div>
          )}
          {ev.variants?.state === "withheld" && (
            <div className="mt-3">
              <Withheld what="Variant records" reason={ev.variants.reason} />
            </div>
          )}
          {variantSet && gene && protein && (
            <>
              <div className="mt-3">
                <GroupFilter
                  value={groups}
                  onChange={setGroups}
                  counts={countGroups(allVariants)}
                />
              </div>
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-4">
                  <GenomeTrack
                    gene={gene}
                    variants={shownVariants}
                    selected={selectedVariant}
                    onSelect={setPicked}
                  />
                  <ProteinTrack
                    length={protein.length}
                    variants={shownVariants}
                    selected={selectedVariant}
                    onSelect={setPicked}
                    plddt={
                      mode === "predicted" && backbone
                        ? backbone.residues.map((r) => r.b)
                        : undefined
                    }
                  />
                </div>
                <div>
                  {selectedVariant ? (
                    <>
                      <VariantCard v={selectedVariant} cds={cds} />
                      {selectedVariant.protein && mode === "predicted" && (
                        <a
                          href="#structure"
                          className="mt-2 inline-flex text-[12px] text-[var(--v-accent-ink)] underline underline-offset-2"
                        >
                          Amino acid {selectedVariant.protein.pos} is selected in the 3D structure
                          above
                        </a>
                      )}
                    </>
                  ) : (
                    <Gap>Choose a variant on either track.</Gap>
                  )}
                </div>
              </div>
            </>
          )}
        </Card>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card id="stage-cell">
            <div className="flex items-center gap-2">
              <h2 className="text-[19px] font-medium">Retinal cell & pathway</h2>
              <EvidenceTag kind="reference" label="UniProt · Reactome" />
            </div>
            {protein ? (
              <dl className="mt-3 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
                <dt className="text-[var(--v-ink-3)]">Made in</dt>
                <dd>{protein.tissue ?? "not stated"}</dd>
                <dt className="text-[var(--v-ink-3)]">Inside the cell</dt>
                <dd>{protein.locations.join(", ") || "not stated"}</dd>
                <dt className="text-[var(--v-ink-3)]">Reaction</dt>
                <dd>
                  {protein.reactions.length
                    ? protein.reactions.slice(0, 2).map((r) => (
                        <span key={r.name} className="block">
                          {r.name}
                          {r.ec && <span className="text-[var(--v-ink-3)]"> · EC {r.ec}</span>}
                        </span>
                      ))
                    : "not stated"}
                </dd>
                <dt className="text-[var(--v-ink-3)]">Pathway</dt>
                <dd>
                  {protein.pathways.length
                    ? protein.pathways.map((pw) => (
                        <a
                          key={pw.id}
                          href={`https://reactome.org/content/detail/${pw.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block underline decoration-[var(--v-line)] underline-offset-2"
                        >
                          {pw.name} <span className="text-[var(--v-ink-3)]">· {pw.id}</span>
                        </a>
                      ))
                    : "not stated"}
                </dd>
              </dl>
            ) : (
              <div className="mt-3">
                <Gap>Needs the protein record.</Gap>
              </div>
            )}
            <p className="mt-3 text-[12px] text-[var(--v-ink-2)]">
              In plain words: RPE65 is made only in the RPE, the layer of cells behind the retina,
              where it resets the molecule rods and cones use to catch light.{" "}
              <Link
                to="/vision/eye"
                hash="cycle"
                className="text-[var(--v-accent-ink)] underline underline-offset-2"
              >
                See it in the eye simulation
              </Link>
            </p>
          </Card>

          <Card id="stage-hypothesis">
            <div className="flex items-center gap-2">
              <h2 className="text-[19px] font-medium">Intervention hypothesis</h2>
              <EvidenceTag kind="hypothetical" />
            </div>
            <p className="mt-2 text-[15px] font-medium">
              Gene augmentation: add a working copy of RPE65 to RPE cells.
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-[13px] text-[var(--v-ink-2)]">
              <li>
                <span className="font-medium text-[var(--v-ink)]">Why it could work: </span>
                the hypothesis assumes the condition is recessive, so disease needs both copies
                faulty and one working copy could restore the reset step. That is an assumption of
                this hypothesis, not a finding of this software.
              </li>
              <li>
                <span className="font-medium text-[var(--v-ink)]">What limits it: </span>
                only cells reached by the injection are treated, and photoreceptors already lost
                cannot respond.
              </li>
              <li>
                <span className="font-medium text-[var(--v-ink)]">Precedent: </span>
                an approved therapy works this way (voretigene neparvovec, US FDA, 2017).
              </li>
            </ul>
            <Link
              to="/vision/therapy"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--v-accent)] px-4 py-2 text-xs font-medium text-[var(--v-on-ink)]"
            >
              Simulate it <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </Card>
        </div>

        <Card id="stage-reference" className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[19px] font-medium">Reference comparison</h2>
            <EvidenceTag kind="reference" label="Phase 3 trial" />
            <EvidenceTag kind="computed" label="Model, default inputs" />
          </div>
          <p className="mt-1 text-xs text-[var(--v-ink-3)]">
            {REFERENCE.design} Endpoint: {REFERENCE.endpoint}. The model is compared only where both
            can speak.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="text-[11px] text-[var(--v-ink-3)]">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Aspect</th>
                  <th className="py-1.5 pr-3 font-medium">Trial (reference)</th>
                  <th className="py-1.5 pr-3 font-medium">Model (hypothetical)</th>
                  <th className="py-1.5 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--v-line)]">
                {comparison.map((c) => (
                  <tr key={c.key}>
                    <td className="py-2 pr-3 font-medium">{c.aspect}</td>
                    <td className="py-2 pr-3 text-[var(--v-ink-2)]">{c.reference}</td>
                    <td className="py-2 pr-3 text-[var(--v-ink-2)]">{c.model}</td>
                    <td className="py-2">
                      <VerdictChip v={c.verdict} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[var(--v-ink-3)]">
            {REFERENCE.citation} Citation entered from the developers' knowledge; check it against
            the publication.
          </p>
        </Card>

        {/* ------------------------------------------------ benchmark + scope */}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card id="benchmark">
            <h2 className="text-[19px] font-medium">Benchmark definition</h2>
            <p className="text-xs text-[var(--v-ink-3)]">
              No clinical predictor is built until these are decided. Open items carry no answer.
            </p>
            <DecisionMeter />
            <ol className="mt-4 flex flex-col divide-y divide-[var(--v-line)]">
              {DECISIONS.map((d) => (
                <li key={d.n} className="flex gap-3 py-2.5">
                  <span className="w-5 shrink-0 pt-0.5 font-mono text-[11px] text-[var(--v-ink-3)]">
                    {d.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{d.question}</p>
                    {d.answer && (
                      <p className="mt-0.5 text-[13px] text-[var(--v-ink-2)]">{d.answer}</p>
                    )}
                    {d.decidedOn && (
                      <p className="text-[11px] text-[var(--v-ink-3)]">Decided {d.decidedOn}</p>
                    )}
                  </div>
                  <StatusChip status={d.status} />
                </li>
              ))}
            </ol>
          </Card>

          <Card id="scope">
            <h2 className="text-[19px] font-medium">Scope & licences</h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-4 text-[13px] text-[var(--v-ink-2)]">
              <li>
                Research software. Not a medical device, not cleared or approved by the FDA, and not
                clinically validated. Do not use it for diagnosis or treatment decisions.
              </li>
              <li>
                Public reference data, from a captured snapshot by default or, with Live check,
                requested from your browser. Databases change between releases; each value shows its
                release and retrieval time. Export the record to keep what you saw.
              </li>
              <li>
                Predicted structures are models. pLDDT is the model's confidence in itself, not a
                measured accuracy.
              </li>
              <li>No patient data is loaded, entered or stored.</li>
              <li>
                Modelled, not measured: the gene-therapy time course is a hypothetical model with
                illustrative parameters, not fitted to any trial.
              </li>
            </ul>
            <p className="mt-4 text-xs font-medium text-[var(--v-ink-2)]">
              Sources and their terms
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {sourceTerms().map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0">
                    {l.source}
                    <span className="text-[var(--v-ink-3)]">
                      {" "}
                      ({l.shown ? "shown" : "withheld"}; {l.review})
                    </span>
                  </span>
                  {l.url && (
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[var(--v-ink-2)] underline decoration-[var(--v-line)] underline-offset-2"
                    >
                      Terms
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-[var(--v-ink-3)]">
              From the licence inventory. No source's terms have been approved for commercial use,
              and none may be redistributed until a reviewer confirms its terms allow it.
            </p>
          </Card>
        </div>

        <Card className="mt-3">
          <StatusPanel />
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Stat({
  icon: Icon,
  value,
  unit,
  label,
  kind,
}: {
  icon: typeof Atom;
  value: string;
  unit?: string | undefined;
  label: string;
  kind?: EvidenceKind | undefined;
}) {
  return (
    <div className="rounded-2xl bg-[var(--v-soft)] p-3">
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 text-[var(--v-ink-2)]" aria-hidden />
        {kind && <EvidenceTag kind={kind} />}
      </div>
      <p className="mt-2 text-[26px] font-medium leading-none">
        {value}
        {unit && value !== "—" && (
          <span className="ml-1 text-xs font-normal text-[var(--v-ink-2)]">{unit}</span>
        )}
      </p>
      <p className="mt-1 text-[11px] text-[var(--v-ink-3)]">{label}</p>
    </div>
  );
}

const STATUS_LABEL: Record<DecisionStatus, string> = {
  decided: "Decided",
  partial: "Partial",
  open: "Open",
};

function StatusChip({ status }: { status: DecisionStatus }) {
  const cls =
    status === "decided"
      ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]"
      : status === "partial"
        ? "bg-[var(--v-accent-soft)] text-[var(--v-accent-ink)]"
        : "border border-dashed border-[var(--v-line)] text-[var(--v-ink-2)]";
  return (
    <span className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function DecisionMeter() {
  const n = (s: DecisionStatus) => DECISIONS.filter((d) => d.status === s).length;
  const parts: [DecisionStatus, string][] = [
    ["decided", "bg-[var(--v-ink)]"],
    ["partial", "bg-[var(--v-accent)]"],
    ["open", "bg-[var(--v-line)]"],
  ];
  return (
    <div className="mt-3">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map(([s, cls]) => (
          <div key={s} className={cls} style={{ flex: n(s) }} />
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--v-ink-2)]">
        {n("decided")} decided · {n("partial")} partial · {n("open")} open
      </p>
    </div>
  );
}

function EvidenceGroup<T>({
  title,
  icon: Icon,
  s,
  children,
}: {
  title: string;
  icon: typeof Atom;
  s: Sourced<T>;
  children: (string | undefined)[][] | false | undefined;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4 text-[var(--v-ink-2)]" aria-hidden />
        <h3 className="text-sm font-medium">{title}</h3>
        {s.state === "value" && <EvidenceTag kind={s.kind} />}
      </div>
      {s.state === "value" ? (
        <>
          <div className="mt-1">
            <ProvLine p={s.provenance} />
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-2xl bg-[var(--v-soft)] p-3 text-[13px] sm:grid-cols-[170px_minmax(0,1fr)]">
            {(children || []).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[var(--v-ink-3)]">{k}</dt>
                <dd
                  className={`break-words ${v?.startsWith("not ") || v === "none listed" ? "italic text-[var(--v-ink-3)]" : ""}`}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : s.state === "conflict" ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-2 rounded-2xl bg-[color:var(--kv-fbf0dc)] px-3 py-2.5 text-[13px]">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {s.reason}
          </div>
          {s.values.map((v, i) => (
            <ProvLine key={i} p={v.provenance} />
          ))}
        </div>
      ) : (
        <div className="mt-2">
          <Gap>{s.reason}</Gap>
        </div>
      )}
    </div>
  );
}

function CheckRow({ c }: { c: CheckResult }) {
  const [Icon, label, cls] =
    c.status === "agree"
      ? [Check, "Agree", "bg-[color:var(--kv-e3f4f1)]"]
      : c.status === "differ"
        ? [TriangleAlert, "Differ", "bg-[color:var(--kv-fbf0dc)]"]
        : [Minus, "Not checked", "bg-[var(--v-soft)]"];
  return (
    <li className="rounded-2xl bg-[var(--v-soft)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${cls}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="flex-1 text-[13px] font-medium">{c.label}</span>
        <span className="text-[11px] font-medium text-[var(--v-ink-2)]">{label}</span>
      </div>
      <p className="mt-1 pl-8 text-xs text-[var(--v-ink-2)]">{c.detail}</p>
    </li>
  );
}
