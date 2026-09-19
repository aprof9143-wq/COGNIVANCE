import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SiteNav } from "@/components/SiteNav";

/**
 * NIMBLE Benchmark Console.
 *
 * Every target on this page is carried from the platform benchmarking
 * specification. None of them are measured results — the pipelines that would
 * produce them are gated behind their build phases, and a figure only appears
 * here once its gate passes. "AWAITING" is the truthful state, not a
 * placeholder, and the page is built to keep it that way.
 */

const title = "Benchmark Console — Cognivance Labs";
const description =
  "Diagnostic, quantification and system-uniqueness targets for the NIMBLE platform, with the phase gate each one is held behind.";

export const Route = createFileRoute("/benchmarks")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: Benchmarks,
});

/* ------------------------------------------------------------------ data */

type Gate = "awaiting" | "running" | "passed";

type Task = {
  id: string;
  task: string;
  metric: string;
  lo: number;
  hi: number;
  floor: number;
  unit: "%" | "auc" | "dice" | "err";
  phase: string;
  gate: Gate;
  note: string;
};

const tasks: Task[] = [
  {
    id: "BM-01",
    task: "AD vs Cognitively Normal",
    metric: "Accuracy",
    lo: 88,
    hi: 93,
    floor: 88,
    unit: "%",
    phase: "05",
    gate: "awaiting",
    note: "Multi-modal fusion; AUC must clear 0.90 on the locked hold-out.",
  },
  {
    id: "BM-02",
    task: "MCI vs Normal",
    metric: "Accuracy",
    lo: 75,
    hi: 85,
    floor: 75,
    unit: "%",
    phase: "05",
    gate: "awaiting",
    note: "Harder boundary; AUC > 0.80. Expect the widest confidence interval.",
  },
  {
    id: "BM-03",
    task: "Progression — converter vs stable",
    metric: "Accuracy",
    lo: 70,
    hi: 78,
    floor: 70,
    unit: "%",
    phase: "05",
    gate: "awaiting",
    note: "The most challenging task. AUC > 0.75. Requires longitudinal follow-up.",
  },
  {
    id: "BM-04",
    task: "EEG-based AD detection",
    metric: "Accuracy",
    lo: 80,
    hi: 90,
    floor: 80,
    unit: "%",
    phase: "04",
    gate: "awaiting",
    note: "Strongly dependent on recording quality and validation method.",
  },
  {
    id: "BM-05",
    task: "Hippocampal volume",
    metric: "Volume error",
    lo: 0,
    hi: 4,
    floor: 4,
    unit: "err",
    phase: "03",
    gate: "awaiting",
    note: "Versus FreeSurfer on the fixed cohort. Lower is better; < 4%.",
  },
  {
    id: "BM-06",
    task: "Segmentation quality",
    metric: "Dice coefficient",
    lo: 0.85,
    hi: 1,
    floor: 0.85,
    unit: "dice",
    phase: "03",
    gate: "awaiting",
    note: "Hippocampus and ventricles, normalised to intracranial volume.",
  },
];

const systemMetrics = [
  {
    id: "SYS-01",
    label: "Source-switch cost",
    target: "0 code / 1 config line",
    proves: "Architecture quality",
    phase: "01 · 07",
  },
  {
    id: "SYS-02",
    label: "Multi-modal fusion count",
    target: "5 modalities",
    proves: "Core uniqueness",
    phase: "05",
  },
  {
    id: "SYS-03",
    label: "End-to-end latency",
    target: "p50 / p95 published",
    proves: "Real-time readiness",
    phase: "07 · 08",
  },
  {
    id: "SYS-04",
    label: "Reproducibility",
    target: "Byte-identical re-run",
    proves: "Scientific credibility",
    phase: "01 · 09",
  },
  {
    id: "SYS-05",
    label: "Full-subject processing",
    target: "Wall-clock, stated hardware",
    proves: "Practical usability",
    phase: "03 · 09",
  },
];

/** Planned evaluation cohort — a design target, not an enrolled population. */
const cohort = [
  { label: "Cognitively normal", key: "CN", n: 180, of: 520 },
  { label: "Mild cognitive impairment", key: "MCI", n: 200, of: 520 },
  { label: "Alzheimer's disease", key: "AD", n: 140, of: 520 },
];

const modalities = [
  { label: "T1 MRI", pct: 100, gate: "03" },
  { label: "fMRI", pct: 62, gate: "03" },
  { label: "PET", pct: 71, gate: "03" },
  { label: "EEG", pct: 44, gate: "04" },
  { label: "Clinical", pct: 100, gate: "05" },
];

const phases = [
  { n: "00", label: "Repo remediation", a: 1, b: 2 },
  { n: "01", label: "Core contracts", a: 1, b: 4 },
  { n: "02", label: "Benchmark harness", a: 3, b: 6 },
  { n: "03", label: "Imaging pipeline", a: 5, b: 12 },
  { n: "04", label: "EEG pipeline", a: 9, b: 14 },
  { n: "05", label: "Fusion + models", a: 13, b: 20 },
  { n: "06", label: "Simulation", a: 17, b: 22 },
  { n: "07", label: "Hardware / live", a: 19, b: 24 },
  { n: "08", label: "Console", a: 21, b: 27 },
  { n: "09", label: "v1.0 release", a: 27, b: 28 },
];

/**
 * Regions carried on a coronal slice through the medial temporal lobe — the
 * standard volumetric ROI set for Alzheimer's. `dx` is the distance from the
 * midline, so the pair is placed anatomically rather than derived from radius.
 */
const regions = [
  { label: "Lateral ventricles", dx: 7, cy: 41, rx: 2.6, ry: 4.6, lead: false },
  { label: "Amygdala", dx: 13, cy: 52, rx: 3.4, ry: 3.0, lead: false },
  { label: "Hippocampus", dx: 12.5, cy: 61, rx: 4.4, ry: 3.2, lead: true },
  { label: "Entorhinal cortex", dx: 9.5, cy: 69, rx: 3.4, ry: 2.4, lead: true },
];

/* ------------------------------------------------------- small utilities */

const GATE_COPY: Record<Gate, { text: string; color: string }> = {
  awaiting: { text: "AWAITING", color: "var(--ash)" },
  running: { text: "RUNNING", color: "var(--warn)" },
  passed: { text: "PASSED", color: "var(--ok)" },
};

function Panel({
  title: t,
  meta,
  children,
  className = "",
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-lg border border-foreground/12 bg-card/60 ${className}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-foreground/10 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-3 w-[2px] shrink-0 rounded-full bg-[var(--ion)]" aria-hidden="true" />
          <h2 className="truncate text-[0.82rem] font-semibold tracking-[-0.01em] text-foreground">
            {t}
          </h2>
        </div>
        {meta ? (
          <span className="t-num shrink-0 text-[0.62rem] uppercase tracking-[0.12em] text-ash">
            {meta}
          </span>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 p-3.5">{children}</div>
    </section>
  );
}

function GateChip({ gate }: { gate: Gate }) {
  const g = GATE_COPY[gate];
  return (
    <span
      className="t-num inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-[2px] text-[0.58rem] tracking-[0.1em]"
      style={{ color: g.color, borderColor: `color-mix(in oklab, ${g.color} 40%, transparent)` }}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: g.color }} aria-hidden="true" />
      {g.text}
    </span>
  );
}

/**
 * Acceptance zone, deliberately not a progress bar.
 *
 * A solid filled bar on a dashboard reads as a measured value, which is exactly
 * the wrong message here. The zone is drawn as a hatched, dashed-outline region
 * over an empty track, with the floor as a solid rule — it reads as "the range a
 * result must land in", and the absence of any value mark is the point.
 */
function TargetBand({ t }: { t: Task }) {
  const max = t.unit === "dice" ? 1 : t.unit === "err" ? 8 : 100;
  const min = t.unit === "dice" ? 0.6 : 0;
  const pos = (v: number) => ((v - min) / (max - min)) * 100;
  const left = pos(t.lo);
  const width = pos(t.hi) - left;

  const axisLo = t.unit === "dice" ? "0.60" : "0";
  const axisHi = t.unit === "dice" ? "1.00" : t.unit === "err" ? "8%" : "100%";
  const targetLabel =
    t.unit === "dice"
      ? `target ≥ ${t.floor}`
      : t.unit === "err"
        ? `target < ${t.hi}%`
        : `target ${t.lo}–${t.hi}%`;

  return (
    <div className="min-w-0">
      <div className="relative h-[20px] w-full overflow-hidden rounded-sm border border-foreground/10 bg-foreground/[0.03]">
        {/* acceptance zone — hatched, never solid */}
        <div
          className="absolute inset-y-[2px] rounded-[2px] border border-dashed"
          style={{
            left: `${left}%`,
            width: `${width}%`,
            borderColor: "color-mix(in oklab, var(--beam) 65%, transparent)",
            background:
              "repeating-linear-gradient(135deg, color-mix(in oklab, var(--electric) 38%, transparent) 0 3px, transparent 3px 7px)",
          }}
        />
        {/* the floor a release must clear */}
        <div
          className="absolute inset-y-0 w-[2px] bg-[var(--ion)]"
          style={{ left: `calc(${pos(t.floor)}% - 1px)` }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="t-num shrink-0 text-[0.58rem] text-ash">{axisLo}</span>
        <span className="t-num min-w-0 truncate text-[0.62rem] text-[var(--lift)]">
          {targetLabel}
        </span>
        <span className="t-num shrink-0 text-[0.58rem] text-ash">{axisHi}</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- page */

function Benchmarks() {
  const [clock, setClock] = useState("");
  const [selected, setSelected] = useState<Task>(tasks[0]!);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      setClock(
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
          d.getMinutes(),
        )}:${p(d.getSeconds())}`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.task.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.metric.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />

      <main className="scope px-[clamp(0.75rem,2vw,1.75rem)] pb-10 pt-24">
        <div className="mx-auto max-w-[1680px]">
          {/* ---------------- console header ---------------- */}
          <header className="relative overflow-hidden rounded-lg border border-foreground/12 bg-[linear-gradient(90deg,color-mix(in_oklab,var(--deep)_75%,transparent),transparent_60%)]">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <img src="/logo-mark.png" alt="" width={64} height={64} className="h-7 w-auto" />
                <h1 className="truncate text-[1.05rem] font-semibold tracking-[-0.02em] text-foreground">
                  NIMBLE Benchmark Console
                </h1>
                <span className="t-num hidden rounded-sm border border-[var(--ion)]/35 px-1.5 py-[2px] text-[0.58rem] tracking-[0.12em] text-[var(--ion)] sm:inline">
                  SPEC v1
                </span>
              </div>
              <span className="t-num text-[0.72rem] tracking-[0.08em] text-ash">
                {clock || "—"}
              </span>
            </div>
          </header>

          {/* ---------------- honesty banner ---------------- */}
          <div
            className="mt-2.5 flex items-start gap-2.5 rounded-lg border px-4 py-2.5"
            style={{
              borderColor: "color-mix(in oklab, var(--warn) 32%, transparent)",
              background: "color-mix(in oklab, var(--warn) 7%, transparent)",
            }}
          >
            <span
              className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: "var(--warn)" }}
              aria-hidden="true"
            />
            <p className="text-[0.82rem] leading-relaxed text-foreground/85">
              <span className="font-semibold">These are targets and gates, not results.</span>{" "}
              <span className="text-ash">
                No figure is published here until its phase gate passes on a locked hold-out set,
                reported with a 95% confidence interval. Everything currently reads{" "}
                <span className="t-num text-[0.78rem]">AWAITING</span> because the pipelines that
                would produce it are still in build.
              </span>
            </p>
          </div>

          {/* ---------------- three-column console ---------------- */}
          <div className="mt-2.5 grid gap-2.5 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.05fr)_minmax(0,1.35fr)]">
            {/* ======================= LEFT ======================= */}
            <div className="flex min-w-0 flex-col gap-2.5">
              <Panel title="Evaluation scope" meta="fixed cohort">
                <dl className="grid grid-cols-2 gap-2">
                  {[
                    { k: "Subjects", v: "520", s: "planned" },
                    { k: "Timepoints", v: "3", s: "per subject" },
                    { k: "Split", v: "subject", s: "grouped, enforced" },
                    { k: "Hold-out", v: "locked", s: "1 open / release" },
                  ].map((m) => (
                    <div
                      key={m.k}
                      className="rounded-sm border border-foreground/10 bg-foreground/[0.03] px-2.5 py-2"
                    >
                      <dt className="t-num text-[0.58rem] uppercase tracking-[0.12em] text-ash">
                        {m.k}
                      </dt>
                      <dd className="t-num mt-1 text-[1.05rem] font-semibold text-foreground">
                        {m.v}
                      </dd>
                      <dd className="mt-0.5 text-[0.62rem] text-ash">{m.s}</dd>
                    </div>
                  ))}
                </dl>

                <p className="t-num mt-3.5 text-[0.58rem] uppercase tracking-[0.12em] text-ash">
                  Planned class balance
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {cohort.map((c, i) => {
                    const pct = (c.n / c.of) * 100;
                    // single-hue ramp: magnitude by lightness, never by hue rotation
                    const fill = ["#1b5cbc", "#3d8bf5", "#7fc0ff"][i];
                    return (
                      <li key={c.key}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[0.74rem] text-foreground/85">
                            {c.label}
                          </span>
                          <span className="t-num shrink-0 text-[0.72rem] text-foreground">
                            {c.n}
                          </span>
                        </div>
                        <div className="mt-1 h-[6px] w-full overflow-hidden rounded-full bg-foreground/[0.06]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: fill }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>

              <Panel title="Modality coverage" meta="planned">
                <ul className="flex flex-col gap-2.5">
                  {modalities.map((m) => (
                    <li key={m.label} className="flex items-center gap-2.5">
                      <span className="w-[4.4rem] shrink-0 truncate text-[0.74rem] text-foreground/85">
                        {m.label}
                      </span>
                      <span className="relative h-[18px] min-w-0 flex-1 overflow-hidden rounded-sm bg-foreground/[0.05]">
                        <span
                          className="absolute inset-y-0 left-0 rounded-sm"
                          style={{
                            width: `${m.pct}%`,
                            background:
                              "linear-gradient(90deg,color-mix(in oklab,var(--electric) 70%,transparent),var(--beam))",
                          }}
                        />
                      </span>
                      <span className="t-num w-9 shrink-0 text-right text-[0.7rem] text-foreground">
                        {m.pct}%
                      </span>
                      <span className="t-num w-5 shrink-0 text-right text-[0.58rem] text-ash">
                        {m.gate}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[0.68rem] leading-relaxed text-ash">
                  Share of the planned cohort expected to carry each modality. Fusion must handle
                  the missing remainder explicitly.
                </p>
              </Panel>

              <Panel title="Build schedule" meta="28 weeks">
                <ul className="flex flex-col gap-[3px]">
                  {phases.map((p) => (
                    <li key={p.n} className="flex items-center gap-2">
                      <span className="t-num w-4 shrink-0 text-[0.6rem] text-ash">{p.n}</span>
                      <span className="w-[5.6rem] shrink-0 truncate text-[0.68rem] text-foreground/80">
                        {p.label}
                      </span>
                      <span className="relative h-[9px] min-w-0 flex-1 overflow-hidden rounded-sm bg-foreground/[0.05]">
                        <span
                          className="absolute inset-y-0 rounded-sm bg-[var(--electric)]"
                          style={{
                            left: `${((p.a - 1) / 28) * 100}%`,
                            width: `${((p.b - p.a + 1) / 28) * 100}%`,
                          }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="t-num mt-2 flex justify-between text-[0.56rem] tracking-[0.1em] text-ash">
                  <span>WK 1</span>
                  <span>WK 14</span>
                  <span>WK 28</span>
                </div>
              </Panel>
            </div>

            {/* ======================= MIDDLE ======================= */}
            <div className="flex min-w-0 flex-col gap-2.5">
              <Panel title="Benchmark register" meta={`${filtered.length} / ${tasks.length}`}>
                <label className="sr-only" htmlFor="bm-search">
                  Filter benchmarks
                </label>
                <input
                  id="bm-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by task, metric or ID…"
                  className="w-full rounded-sm border border-foreground/12 bg-foreground/[0.04] px-2.5 py-2 text-[0.76rem] text-foreground outline-none transition-colors placeholder:text-ash focus:border-[var(--ion)]/50"
                />

                <div className="mt-2.5 overflow-x-auto">
                  <table className="w-full min-w-[26rem] border-collapse">
                    <thead>
                      <tr>
                        {["ID", "Task", "Target", "Phase", "Gate"].map((h) => (
                          <th
                            key={h}
                            className="t-num border-b border-foreground/12 px-1.5 py-1.5 text-left text-[0.56rem] uppercase tracking-[0.12em] text-ash"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t) => {
                        const on = t.id === selected.id;
                        return (
                          <tr
                            key={t.id}
                            onClick={() => setSelected(t)}
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelected(t);
                              }
                            }}
                            aria-selected={on}
                            className={`cursor-pointer border-b border-foreground/8 outline-none transition-colors ${
                              on ? "bg-[var(--ion)]/10" : "hover:bg-foreground/[0.04]"
                            } focus-visible:bg-foreground/[0.06]`}
                          >
                            <td className="t-num px-1.5 py-2 text-[0.66rem] text-[var(--lift)]">
                              {t.id}
                            </td>
                            <td className="px-1.5 py-2 text-[0.74rem] text-foreground">
                              <span className="block max-w-[14rem] truncate">{t.task}</span>
                              <span className="text-[0.62rem] text-ash">{t.metric}</span>
                            </td>
                            <td className="t-num px-1.5 py-2 text-[0.68rem] text-foreground/85">
                              {t.unit === "dice"
                                ? `≥ ${t.floor}`
                                : t.unit === "err"
                                  ? `< ${t.hi}%`
                                  : `${t.lo}–${t.hi}%`}
                            </td>
                            <td className="t-num px-1.5 py-2 text-[0.66rem] text-ash">{t.phase}</td>
                            <td className="px-1.5 py-2">
                              <GateChip gate={t.gate} />
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-1.5 py-6 text-center text-[0.75rem] text-ash"
                          >
                            No benchmark matches “{query}”.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="All acceptance bands" meta="targets only">
                <ul className="flex flex-col gap-3">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-[0.74rem] text-foreground/85">
                          <span className="t-num text-[0.64rem] text-[var(--lift)]">{t.id}</span>{" "}
                          {t.task}
                        </span>
                        <GateChip gate={t.gate} />
                      </div>
                      <div className="mt-1.5">
                        <TargetBand t={t} />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3.5 border-t border-foreground/10 pt-3 text-[0.68rem] leading-relaxed text-ash">
                  The cyan rule on each band is the floor a release must clear. A measured value
                  appears only once its phase gate passes; until then the band stays empty rather
                  than showing a provisional number.
                </p>
              </Panel>
            </div>

            {/* ======================= RIGHT ======================= */}
            <div className="flex min-w-0 flex-col gap-2.5">
              <Panel title="Task analysis" meta={selected.id}>
                {/* selected-task header strip */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { k: "Metric", v: selected.metric },
                    {
                      k: "Target",
                      v:
                        selected.unit === "dice"
                          ? `≥ ${selected.floor}`
                          : selected.unit === "err"
                            ? `< ${selected.hi}%`
                            : `${selected.lo}–${selected.hi}%`,
                    },
                    { k: "Gate phase", v: selected.phase },
                    { k: "Status", v: GATE_COPY[selected.gate].text },
                  ].map((f) => (
                    <div
                      key={f.k}
                      className="rounded-sm border border-foreground/10 bg-foreground/[0.03] px-2.5 py-2"
                    >
                      <p className="t-num text-[0.56rem] uppercase tracking-[0.12em] text-ash">
                        {f.k}
                      </p>
                      <p className="t-num mt-1 truncate text-[0.82rem] font-semibold text-foreground">
                        {f.v}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="mt-2.5 text-[0.76rem] leading-relaxed text-ash">{selected.note}</p>

                <div className="mt-3">
                  <p className="t-num text-[0.56rem] uppercase tracking-[0.12em] text-ash">
                    Acceptance band
                  </p>
                  <div className="mt-1.5">
                    <TargetBand t={selected} />
                  </div>
                </div>

                {/* region map */}
                <div className="mt-3.5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                  <div className="scope instrument relative min-w-0 overflow-hidden rounded-md border border-foreground/10">
                    <svg
                      viewBox="0 0 100 100"
                      className="block h-auto w-full"
                      role="img"
                      aria-label="Coronal schematic of the regions the volumetry gates cover: hippocampus, entorhinal cortex, lateral ventricles and precuneus."
                    >
                      <defs>
                        <radialGradient id="bm-core">
                          <stop offset="0%" stopColor="var(--ion)" stopOpacity="0.5" />
                          <stop offset="100%" stopColor="var(--ion)" stopOpacity="0" />
                        </radialGradient>
                      </defs>
                      <ellipse cx="50" cy="52" rx="33" ry="29" fill="url(#bm-core)" />
                      {/* cerebral outline — coronal */}
                      <path
                        d="M50 21 C 33 21, 19 32, 18 46 C 17 57, 21 66, 27 72 C 32 77, 40 80, 50 80 C 60 80, 68 77, 73 72 C 79 66, 83 57, 82 46 C 81 32, 67 21, 50 21 Z"
                        fill="none"
                        stroke="var(--beam)"
                        strokeOpacity="0.45"
                        strokeWidth="0.55"
                      />
                      {/* inner sulcal shells */}
                      <g fill="none" stroke="var(--beam)" strokeOpacity="0.16" strokeWidth="0.35">
                        {Array.from({ length: 4 }, (_, i) => (
                          <ellipse key={i} cx="50" cy="52" rx={26 - i * 4.4} ry={24 - i * 4.2} />
                        ))}
                      </g>
                      {/* midline */}
                      <line
                        x1="50"
                        y1="21"
                        x2="50"
                        y2="80"
                        stroke="var(--lift)"
                        strokeOpacity="0.3"
                        strokeWidth="0.4"
                        strokeDasharray="1.5 2"
                      />
                      {/* bilateral region markers */}
                      {regions.map((r) =>
                        [-1, 1].map((side) => (
                          <g key={`${r.label}-${side}`}>
                            <ellipse
                              cx={50 + side * r.dx}
                              cy={r.cy}
                              rx={r.rx}
                              ry={r.ry}
                              fill={r.lead ? "var(--ion)" : "var(--electric)"}
                              fillOpacity={r.lead ? 0.45 : 0.24}
                              stroke={r.lead ? "var(--ion)" : "var(--beam)"}
                              strokeWidth="0.4"
                              strokeOpacity="0.85"
                            />
                            {r.lead ? (
                              <ellipse
                                cx={50 + side * r.dx}
                                cy={r.cy}
                                rx={r.rx + 1.8}
                                ry={r.ry + 1.8}
                                fill="none"
                                stroke="var(--ion)"
                                strokeWidth="0.3"
                                strokeOpacity="0.35"
                                className="live-dot"
                              />
                            ) : null}
                          </g>
                        )),
                      )}
                      <text
                        x="50"
                        y="93"
                        textAnchor="middle"
                        fill="var(--ash)"
                        style={{ font: "500 3px var(--font-mono)", letterSpacing: "0.4px" }}
                      >
                        CORONAL · SCHEMATIC
                      </text>
                    </svg>
                  </div>

                  <ul className="flex min-w-0 flex-col gap-1.5">
                    <li className="t-num text-[0.56rem] uppercase tracking-[0.12em] text-ash">
                      Gated regions
                    </li>
                    {regions.map((r) => (
                      <li key={r.label} className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: r.lead ? "var(--ion)" : "var(--electric)" }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-[0.7rem] text-foreground/85">
                          {r.label}
                        </span>
                        {r.lead ? (
                          <span className="t-num shrink-0 text-[0.56rem] text-[var(--ion)]">
                            LEAD
                          </span>
                        ) : null}
                      </li>
                    ))}
                    <li className="mt-1 text-[0.64rem] leading-relaxed text-ash">
                      Lead regions carry the volumetry gate — hippocampal volume error under 4%
                      against FreeSurfer, Dice above 0.85.
                    </li>
                  </ul>
                </div>
              </Panel>

              <Panel title="System & uniqueness metrics" meta="measured, not asserted">
                <ul className="flex flex-col">
                  {systemMetrics.map((m) => (
                    <li
                      key={m.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 border-b border-foreground/8 py-2.5 last:border-0"
                    >
                      <span className="t-num text-[0.62rem] text-[var(--lift)]">{m.id}</span>
                      <div className="min-w-0">
                        <p className="text-[0.78rem] font-medium text-foreground">{m.label}</p>
                        <p className="t-num mt-0.5 text-[0.66rem] text-ash">{m.target}</p>
                        <p className="mt-0.5 text-[0.66rem] text-ash">{m.proves}</p>
                      </div>
                      <span className="t-num text-[0.6rem] text-ash">{m.phase}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
