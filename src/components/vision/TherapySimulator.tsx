import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Brain,
  ChevronRight,
  Dna,
  Eye,
  FlaskConical,
  Pause,
  Play,
  RotateCcw,
  Syringe,
} from "lucide-react";
import { valueOf } from "@/lib/vision/evidence";
import { cortexAt, cortexCurve } from "@/lib/vision/cortex";
import { compareToReference, REFERENCE } from "@/lib/vision/reference";
import type { Variant } from "@/lib/vision/snapshot";
import {
  PARAMS,
  simulateTherapy,
  transducedFraction,
  type TherapyInputs,
} from "@/lib/vision/therapy";
import { CortexPathway } from "./CortexPathway";
import { GenomeTrack, ProteinTrack, VariantCard } from "./genome";
import { MolViewer, type HoverInfo } from "./MolViewer";
import { TherapyChart, VectorMap } from "./TherapyChart";
import { useEvidence, useStructure } from "./useEvidence";
import { Card, EvidenceTag, Gap, Spinner, VerdictChip, VisionPages } from "./ui";

const HORIZONS = [
  { days: 365, label: "1 year" },
  { days: 365 * 5, label: "5 years" },
] as const;

/** Seconds the play button takes to run through the whole horizon. */
const PLAY_SECONDS = 14;

/** A single amino-acid substitution, e.g. R91W (not synonymous, not a stop). */
const isMissense = (v: Variant) => {
  const s = v.protein?.short ?? "";
  return /^[A-Z]\d+[A-Z]$/.test(s) && s[0] !== s[s.length - 1];
};

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

/** The two alleles shown by default: common, expert-reviewed pathogenic missense changes. */
const DEFAULT_ALLELES = ["R91W", "Y368H"] as const;

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-[12px] text-[var(--v-ink-2)]">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--v-accent)]"
      />
      <span className="block text-[11px] leading-snug text-[var(--v-ink-3)]">{hint}</span>
    </label>
  );
}

/** One step of the genome → cortex chain, with its value now. */
function Stage({
  icon,
  title,
  value,
  sub,
  level,
  last,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  sub: string;
  level: number | null;
  last?: boolean;
}) {
  return (
    <li className="relative flex min-w-0 flex-1 flex-col rounded-3xl bg-[var(--v-soft)] p-3">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--v-ink-2)]">
        {icon}
        {title}
      </span>
      <span className="mt-1 font-mono text-[22px] leading-none tracking-tight">{value}</span>
      <span className="mt-1 text-[11px] leading-snug text-[var(--v-ink-3)]">{sub}</span>
      {level !== null && (
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white" aria-hidden>
          <span
            className="block h-full rounded-full bg-[var(--v-accent)] transition-[width] duration-150"
            style={{ width: pct(Math.min(1, Math.max(0, level))) }}
          />
        </span>
      )}
      {!last && (
        <ChevronRight
          className="absolute -right-3 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white p-0.5 text-[var(--v-ink-3)] shadow lg:block"
          aria-hidden
        />
      )}
    </li>
  );
}

function AlleleSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Variant[];
  onChange: (uid: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[12px]">
      <span className="font-medium text-[var(--v-ink-2)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-full border border-[var(--v-line)] bg-white px-3 py-1.5 text-[13px]"
      >
        {options.map((v) => (
          <option key={v.uid} value={v.uid}>
            {v.protein?.short ?? v.accession} · {v.cdna ?? ""} · {v.classification}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TherapySimulator() {
  const { ev } = useEvidence("RPE65", 9606);
  const gene = ev.record ? valueOf(ev.record.gene) : undefined;
  const protein = ev.record ? valueOf(ev.record.protein) : undefined;
  const variantSet = ev.variants ? valueOf(ev.variants) : undefined;
  const sequences = ev.sequences ? valueOf(ev.sequences) : undefined;
  const model = ev.record ? valueOf(ev.record.model) : undefined;
  const structure = useStructure(model ? `${ev.mode}:${model.entryId}` : null, ev.loadModelText);

  // ---------------------------------------------------------- genotype
  // Patients carry two disease-causing copies. Offer the pathogenic missense
  // changes ClinVar records for RPE65; the model itself does not distinguish them.
  const missense = useMemo(
    () =>
      (variantSet?.variants ?? [])
        .filter((v) => v.group === "pathogenic" && isMissense(v))
        .sort((a, b) => a.protein!.pos - b.protein!.pos),
    [variantSet],
  );
  const [alleleIds, setAlleleIds] = useState<[string, string] | null>(null);
  useEffect(() => {
    if (alleleIds || !missense.length) return;
    const pick = (short: string) =>
      missense.find((v) => v.protein?.short === short && /expert/i.test(v.reviewStatus ?? "")) ??
      missense.find((v) => v.protein?.short === short) ??
      missense[0]!;
    setAlleleIds([pick(DEFAULT_ALLELES[0]).uid, pick(DEFAULT_ALLELES[1]).uid]);
  }, [missense, alleleIds]);
  const alleles = alleleIds
    ? alleleIds.map((id) => missense.find((v) => v.uid === id)).filter((v): v is Variant => !!v)
    : [];
  const [focusAllele, setFocusAllele] = useState(0);
  const shownAllele = alleles[focusAllele] ?? alleles[0] ?? null;
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // ---------------------------------------------------------- model
  const [inputs, setInputs] = useState<Omit<TherapyInputs, "days">>({
    dose: 1,
    treatedArea: 0.3,
    viableAtStart: 0.7,
  });
  const [horizon, setHorizon] = useState<number>(365);
  const series = useMemo(() => simulateTherapy({ ...inputs, days: horizon }), [inputs, horizon]);
  const firstYear = useMemo(
    () => (horizon === 365 ? series : simulateTherapy({ ...inputs, days: 365 })),
    [inputs, horizon, series],
  );
  const comparison = useMemo(() => compareToReference(firstYear), [firstYear]);

  // The network model is run once, off the first paint.
  const [curve, setCurve] = useState<{ input: number; v1: number }[] | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setCurve(cortexCurve()), 30);
    return () => window.clearTimeout(t);
  }, []);

  const [day, setDay] = useState(90);
  const [playing, setPlaying] = useState(false);
  const clampedDay = Math.min(day, horizon);
  const now = series[clampedDay]!;
  const v1 = curve ? cortexAt(curve, now.signalRetina) : null;
  const v1Untreated = curve ? cortexAt(curve, now.signalNoTreatment) : null;

  const dayRef = useRef(day);
  dayRef.current = clampedDay;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = dayRef.current >= horizon ? 0 : dayRef.current;
    const tick = (t: number) => {
      acc += ((t - last) / 1000) * (horizon / PLAY_SECONDS);
      last = t;
      if (acc >= horizon) {
        setDay(horizon);
        setPlaying(false);
        return;
      }
      setDay(Math.floor(acc));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, horizon]);

  const when = horizon > 400 ? `year ${(clampedDay / 365).toFixed(1)}` : `day ${clampedDay}`;
  const set = (k: keyof typeof inputs) => (v: number) => setInputs((s) => ({ ...s, [k]: v }));

  return (
    <div className="vision-light min-h-screen px-3 py-3 font-sans sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1440px] rounded-[36px] bg-[var(--v-frame)] p-2.5 ring-1 ring-white/80 backdrop-blur sm:p-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[250px_minmax(0,1fr)]">
          {/* ------------------------------------------------ left */}
          <div className="flex flex-col gap-3">
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[15px] font-semibold tracking-[0.18em]">COGNIVANCE</p>
                  <p className="text-xs text-[var(--v-ink-3)]">Gene therapy simulator</p>
                </div>
                <Link
                  to="/"
                  aria-label="Back to Cognivance"
                  className="grid h-10 w-10 place-items-center rounded-full bg-[var(--v-ink)] text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </div>
              <VisionPages active="therapy" />
              <nav className="mt-4 flex flex-col gap-1 text-sm" aria-label="Sections">
                {[
                  ["#journey", "Genome to cortex"],
                  ["#genotype", "Genotype & protein"],
                  ["#vector", "The vector"],
                  ["#reference", "Against the trial"],
                  ["#assumptions", "Assumptions"],
                ].map(([href, label]) => (
                  <a
                    key={href}
                    href={href}
                    className="rounded-full px-3 py-2 text-[var(--v-ink)] hover:bg-[var(--v-soft)]"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </Card>
            <Card>
              <div className="flex items-center gap-2">
                <EvidenceTag kind="hypothetical" />
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--v-ink-2)]">
                The time course is a mechanistic sketch with illustrative parameters. It is not
                fitted to trial data and is not a prediction for any patient. The gene, variants,
                protein and vector length come from the databases; the cortex response comes from
                Cognivance's network model.
              </p>
            </Card>
          </div>

          {/* ------------------------------------------------ main */}
          <div className="flex min-w-0 flex-col gap-3">
            <Card id="journey">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-[24px] font-medium tracking-tight">
                      RPE65 gene therapy, from genome to visual cortex
                    </h1>
                    <EvidenceTag kind="hypothetical" label="Hypothetical model" />
                  </div>
                  <p className="mt-1 max-w-3xl text-[13px] text-[var(--v-ink-2)]">
                    A working copy of RPE65 is delivered to the cells behind the retina. They make
                    the enzyme again, the light-catching molecule returns, photoreceptors respond to
                    light, and the signal travels along the optic nerve, through the thalamus, to
                    the visual cortex. Press play to watch it unfold.
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-[var(--v-soft)] p-1 text-[12px]">
                  {HORIZONS.map((h) => (
                    <button
                      key={h.days}
                      type="button"
                      onClick={() => {
                        setHorizon(h.days);
                        setDay((d) => Math.min(d, h.days));
                      }}
                      aria-pressed={horizon === h.days}
                      className={`rounded-full px-3 py-1.5 ${
                        horizon === h.days ? "bg-[var(--v-ink)] text-white" : "hover:bg-white"
                      }`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>

              <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:gap-4">
                <Stage
                  icon={<Dna className="h-3.5 w-3.5" aria-hidden />}
                  title="Genome"
                  value={
                    alleles.length === 2
                      ? `${alleles[0]!.protein!.short} / ${alleles[1]!.protein!.short}`
                      : "—"
                  }
                  sub="Two disease-causing copies of RPE65 (ClinVar)"
                  level={null}
                />
                <Stage
                  icon={<Syringe className="h-3.5 w-3.5" aria-hidden />}
                  title="Vector"
                  value={pct(now.expression)}
                  sub={`of treated RPE cells express it (max ${pct(transducedFraction(inputs.dose))})`}
                  level={now.expression}
                />
                <Stage
                  icon={<FlaskConical className="h-3.5 w-3.5" aria-hidden />}
                  title="RPE65 enzyme"
                  value={pct(now.rpe65)}
                  sub="activity of normal, treated area"
                  level={now.rpe65}
                />
                <Stage
                  icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
                  title="Photoreceptors"
                  value={pct(now.signalTreated)}
                  sub={`light response, treated area · ${pct(now.viable)} cells alive`}
                  level={now.signalTreated}
                />
                <Stage
                  icon={<Eye className="h-3.5 w-3.5" aria-hidden />}
                  title="Optic nerve"
                  value={pct(now.signalRetina)}
                  sub={`whole retina (untreated: ${pct(now.signalNoTreatment)})`}
                  level={now.signalRetina}
                />
                <Stage
                  icon={<Brain className="h-3.5 w-3.5" aria-hidden />}
                  title="Visual cortex"
                  value={v1 === null ? "…" : pct(v1)}
                  sub={
                    v1Untreated === null
                      ? "running the network model"
                      : `V1 response (untreated: ${pct(v1Untreated)})`
                  }
                  level={v1}
                  last
                />
              </ol>

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  aria-label={playing ? "Pause" : "Play"}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--v-ink)] text-white"
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setDay(0);
                  }}
                  aria-label="Back to the day of injection"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--v-soft)]"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={horizon}
                  value={clampedDay}
                  onChange={(e) => {
                    setPlaying(false);
                    setDay(Number(e.target.value));
                  }}
                  aria-label="Time since injection"
                  className="flex-1 accent-[var(--v-accent)]"
                />
                <span className="w-24 text-right font-mono text-[13px]">{when}</span>
              </div>
            </Card>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[19px] font-medium">Time course</h2>
                  <EvidenceTag kind="hypothetical" />
                </div>
                <p className="text-xs text-[var(--v-ink-3)]">
                  Fractions of a healthy eye. Drag on the chart to move through time.
                </p>
                <div className="mt-3">
                  <TherapyChart
                    series={series}
                    day={clampedDay}
                    onScrub={(d) => {
                      setPlaying(false);
                      setDay(d);
                    }}
                  />
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <Slider
                    label="Vector dose"
                    hint="Relative to the reference dose (1×)."
                    value={inputs.dose}
                    min={0}
                    max={2}
                    step={0.05}
                    format={(v) => `${v.toFixed(2)}×`}
                    onChange={set("dose")}
                  />
                  <Slider
                    label="Area treated"
                    hint="Share of the retina under the injection bleb."
                    value={inputs.treatedArea}
                    min={0.05}
                    max={1}
                    step={0.05}
                    format={(v) => pct(v)}
                    onChange={set("treatedArea")}
                  />
                  <Slider
                    label="Photoreceptors alive"
                    hint="At treatment. Lower means later-stage disease."
                    value={inputs.viableAtStart}
                    min={0.05}
                    max={1}
                    step={0.05}
                    format={(v) => pct(v)}
                    onChange={set("viableAtStart")}
                  />
                </div>
              </Card>

              <section
                className="relative flex min-h-[540px] flex-col overflow-hidden rounded-[28px] bg-[#050a1e] text-white"
                aria-label="Visual pathway from eye to cortex"
              >
                <div className="relative z-10 flex flex-wrap items-start justify-between gap-2 p-5 pb-0">
                  <div>
                    <h2 className="text-[19px] font-medium">From retina to visual cortex</h2>
                    <p className="text-xs text-white/60">
                      Brain anatomy: MNI152 template. Pathway drawn schematically. Brightness
                      follows the simulated signal at {when}.
                    </p>
                  </div>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">
                    Computed by a model
                  </span>
                </div>
                <div className="relative flex-1">
                  <CortexPathway retina={now.signalRetina} v1={v1 ?? 0} />
                </div>
                <dl className="relative z-10 grid grid-cols-3 gap-2 p-4 pt-0 text-center">
                  {[
                    ["Time", when],
                    ["Retina → nerve", pct(now.signalRetina)],
                    ["Visual cortex", v1 === null ? "…" : pct(v1)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-2xl bg-white/[0.06] px-2 py-2 backdrop-blur">
                      <dt className="text-[10px] uppercase tracking-wider text-white/50">{k}</dt>
                      <dd className="font-mono text-[15px]">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>

            {/* ------------------------------------------------ genotype */}
            <Card id="genotype">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[19px] font-medium">Genotype and the protein it breaks</h2>
                <EvidenceTag kind="reference" label="ClinVar · Ensembl" />
                <EvidenceTag kind="computed" label="AlphaFold model" />
              </div>
              <p className="text-xs text-[var(--v-ink-3)]">
                RPE65 disease is recessive: both copies carry a disease-causing change. Choose any
                two of the {missense.length.toLocaleString()} pathogenic single-letter changes
                ClinVar records. The model above treats every genotype the same, with the residual
                activity in the assumptions table.
              </p>
              {ev.status === "loading" && (
                <div className="mt-3">
                  <Spinner label="Reading the evidence snapshot…" />
                </div>
              )}
              {ev.variants?.state === "missing" && (
                <div className="mt-3">
                  <Gap>{ev.variants.reason}</Gap>
                </div>
              )}
              {alleleIds && missense.length > 0 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[0, 1].map((i) => (
                    <AlleleSelect
                      key={i}
                      label={i === 0 ? "First copy" : "Second copy"}
                      value={alleleIds[i as 0 | 1]}
                      options={missense}
                      onChange={(uid) => {
                        const next: [string, string] = [...alleleIds];
                        next[i as 0 | 1] = uid;
                        setAlleleIds(next);
                        setFocusAllele(i);
                      }}
                    />
                  ))}
                </div>
              )}
              {gene && protein && alleles.length > 0 && (
                <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <div className="flex flex-col gap-4">
                    <GenomeTrack
                      gene={gene}
                      variants={alleles}
                      selected={shownAllele}
                      onSelect={(v) => setFocusAllele(Math.max(0, alleles.indexOf(v)))}
                    />
                    <ProteinTrack
                      length={protein.length}
                      variants={alleles}
                      selected={shownAllele}
                      onSelect={(v) => setFocusAllele(Math.max(0, alleles.indexOf(v)))}
                      plddt={
                        structure.status === "ready"
                          ? structure.backbone.residues.map((r) => r.b)
                          : undefined
                      }
                    />
                    {shownAllele && <VariantCard v={shownAllele} cds={sequences?.cds} />}
                  </div>
                  <div className="relative min-h-[380px] overflow-hidden rounded-3xl bg-[var(--v-soft)]">
                    {structure.status === "ready" && model && (
                      <MolViewer
                        pdbText={structure.text}
                        label={model.entryId}
                        style="cartoon"
                        colourBy="plddt"
                        spin={false}
                        resetKey={0}
                        onHover={setHover}
                        focusResidues={alleles.map((a) => a.protein!.pos)}
                      />
                    )}
                    <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap gap-1.5">
                      {alleles.map((a) => (
                        <span
                          key={a.uid}
                          className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium shadow-sm"
                        >
                          {a.protein!.short} · amino acid {a.protein!.pos}
                        </span>
                      ))}
                    </div>
                    {structure.status !== "ready" && (
                      <div className="absolute inset-0 grid place-items-center p-6">
                        {structure.status === "gap" ? (
                          <Gap>{structure.reason}</Gap>
                        ) : (
                          <Spinner label="Loading the predicted structure…" />
                        )}
                      </div>
                    )}
                    <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-2xl bg-white/90 px-3 py-2 text-[11px] text-[var(--v-ink-2)]">
                      {hover
                        ? `${hover.name} ${hover.seq} · prediction confidence ${hover.b.toFixed(0)}`
                        : "Both changed amino acids are selected. Colour is prediction confidence (pLDDT), not function."}
                    </p>
                  </div>
                </div>
              )}
            </Card>

            {/* ------------------------------------------------ vector */}
            <Card id="vector">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[19px] font-medium">The vector</h2>
                <EvidenceTag kind="reference" label="Construct layout" />
                {sequences && <EvidenceTag kind="measured" label="cDNA length · Ensembl" />}
              </div>
              <p className="text-xs text-[var(--v-ink-3)]">
                Voretigene neparvovec (FDA-approved 2017) packs a normal human RPE65 copy into an
                AAV2 shell. It works only where it is injected: the area slider above.
              </p>
              <div className="mt-3">
                <VectorMap cdsLength={sequences?.cds.length ?? null} />
              </div>
            </Card>

            {/* ------------------------------------------------ reference */}
            <Card id="reference">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[19px] font-medium">Against the phase 3 trial</h2>
                <EvidenceTag kind="reference" label="Phase 3 trial" />
                <EvidenceTag kind="computed" label="Model, current inputs, first year" />
              </div>
              <p className="mt-1 text-xs text-[var(--v-ink-3)]">
                {REFERENCE.design} The model is compared only where both can speak.
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
                {REFERENCE.citation} Citation entered from the developers' knowledge; check it
                against the publication.
              </p>
            </Card>

            {/* ------------------------------------------------ assumptions */}
            <Card id="assumptions">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[19px] font-medium">Assumptions</h2>
                <EvidenceTag kind="hypothetical" label="Illustrative, not fitted" />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="text-[11px] text-[var(--v-ink-3)]">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Parameter</th>
                      <th className="py-1.5 pr-3 font-medium">Value</th>
                      <th className="py-1.5 font-medium">What it stands for</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--v-line)]">
                    {Object.entries(PARAMS).map(([k, p]) => (
                      <tr key={k}>
                        <td className="py-2 pr-3 font-mono text-[12px]">{k}</td>
                        <td className="whitespace-nowrap py-2 pr-3">
                          {p.value} {p.unit}
                        </td>
                        <td className="py-2 text-[var(--v-ink-2)]">{p.what}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 pr-3 font-mono text-[12px]">cortex</td>
                      <td className="py-2 pr-3">network model</td>
                      <td className="py-2 text-[var(--v-ink-2)]">
                        V1 response from the CIRCUIT network's vision-loss condition, with severity
                        = 1 − whole-retina signal; placed between full loss (0%) and healthy (100%).
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
