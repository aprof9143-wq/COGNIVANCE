import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, ShieldAlert, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import { wavelengthM, type ArrayDesign } from "@/lib/sim/acoustics";
import type { Circuit, Net } from "@/lib/sim/autoconnect";
import type { CohortResult } from "@/lib/sim/benchmark";
import type { Disease } from "@/lib/sim/diseases";
import { FREQUENCIES_MHZ, PITCH_WAVELENGTHS } from "@/lib/sim/design";
import { deliverable, type LoopEvent, type TargetBeam } from "@/lib/sim/loop";
import { REGION_INDEX, type Recorder, type RegionKey } from "@/lib/sim/neural";
import { NOT_MODELLED, type TargetPlan } from "@/lib/sim/plan";
import {
  AMYGDALA_SCALP_RANGE_MM,
  DEEP_SOURCE_ERROR,
  REFS,
  type Reference,
  type RegionDepth,
} from "@/lib/sim/regions";
import { COMPONENTS, LAYER_LABEL, LAYER_ORDER, SAFETY_LIMITS } from "@/lib/sim/specs";

/* ------------------------------------------------------------------ shell */

export function SimPanel({
  title,
  meta,
  children,
  action,
  flush,
}: {
  title: string;
  meta?: string | undefined;
  children: React.ReactNode;
  action?: React.ReactNode;
  flush?: boolean | undefined;
}) {
  return (
    <section className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#16305e] bg-gradient-to-b from-[#071a3d]/85 to-[#030b20]/90 shadow-[0_22px_48px_-30px_rgba(30,99,196,0.75)]">
      <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#7fd8ff]/45 to-transparent" />
      <header className="flex items-center justify-between gap-2 border-b border-[#16305e] bg-gradient-to-r from-[#0b2150]/70 via-[#061733]/50 to-transparent px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-3 w-[2px] shrink-0 rounded-full bg-[#7fd8ff] shadow-[0_0_6px_#7fd8ff]" />
          <h2 className="truncate text-[0.74rem] font-semibold tracking-[-0.005em]">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meta ? (
            <span className="font-mono text-[0.56rem] uppercase tracking-[0.12em] text-[#8095bf]">
              {meta}
            </span>
          ) : null}
          {action}
        </div>
      </header>
      <div className={flush ? "" : "p-3"}>{children}</div>
    </section>
  );
}

export const Tag = ({
  kind,
}: {
  kind: "spec" | "assumption" | "measured" | "physics" | "model";
}) => {
  const style = {
    spec: "border-[#3d8bf5]/60 text-[#9cc7ff]",
    assumption: "border-[#d9a441]/60 text-[#f0d08a]",
    measured: "border-[#41e0a2]/60 text-[#9ff0cc]",
    physics: "border-[#c58cff]/60 text-[#dcc2ff]",
    model: "border-[#8095bf]/60 text-[#c4d2ee]",
  }[kind];
  const text = {
    spec: "SPEC",
    assumption: "ASSUMED",
    measured: "MEASURED",
    physics: "PHYSICS",
    model: "MODEL",
  }[kind];
  return (
    <span className={`rounded border px-1 py-px font-mono text-[0.5rem] tracking-[0.1em] ${style}`}>
      {text}
    </span>
  );
};

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");

/* ------------------------------------------------------------- library */

export function LibraryPanel({
  enabled,
  onToggle,
  locked,
}: {
  enabled: Set<string>;
  onToggle: (id: string) => void;
  locked: boolean;
}) {
  return (
    <SimPanel title="Component library" meta="real CIRCUIT parts">
      <div className="flex flex-col gap-2">
        {LAYER_ORDER.map((layer) => {
          const parts = COMPONENTS.filter((c) => c.layer === layer);
          if (!parts.length) return null;
          return (
            <div key={layer}>
              <p className="mb-1 font-mono text-[0.54rem] uppercase tracking-[0.16em] text-[#5e719a]">
                {LAYER_LABEL[layer]}
              </p>
              {parts.map((c) => (
                <details
                  key={c.id}
                  className="group mb-1 rounded-md border border-[#0e2247] bg-[#030b20]/80 open:border-[#1f4a8a]"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={enabled.has(c.id)}
                      disabled={locked}
                      onChange={() => onToggle(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-[#7fd8ff]"
                      aria-label={`Include ${c.name}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.74rem] text-[#e6efff]">{c.name}</span>
                      <span className="block font-mono text-[0.56rem] text-[#8095bf]">
                        {c.part} · {c.program}
                      </span>
                    </span>
                  </summary>
                  <div className="border-t border-[#0e2247] px-2 py-1.5">
                    <p className="mb-1 text-[0.66rem] leading-snug text-[#a9bbdc]">{c.summary}</p>
                    <dl className="flex flex-col gap-1">
                      {c.values.map((v) => (
                        <div
                          key={v.key}
                          className="flex items-start justify-between gap-2 text-[0.66rem]"
                          title={v.source}
                        >
                          <dt className="text-[#8095bf]">{v.key}</dt>
                          <dd className="flex items-center gap-1 text-right text-[#e6efff]">
                            {v.value} <Tag kind={v.kind} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </details>
              ))}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[0.6rem] leading-relaxed text-[#5e719a]">
        SPEC = design target from the Simulation Window design document. ASSUMED = a value the
        document does not give, needed to run the physics. Untick a part to see the
        auto-connector&apos;s design-rule check react.
      </p>
    </SimPanel>
  );
}

/* ------------------------------------------------------------- netlist */

const NET_CSS: Record<string, string> = {
  electrode: "#6fd3ff",
  "neural-data": "#3fa9ff",
  prediction: "#b58cff",
  intent: "#41e0a2",
  gate: "#41e0a2",
  drive: "#ffc04d",
  power: "#ff6b5b",
};

export function NetlistPanel({ circuit, revealed }: { circuit: Circuit; revealed: Set<string> }) {
  const name = (id: string) => COMPONENTS.find((c) => c.id === id)?.part ?? id;
  const errors = circuit.drc.filter((d) => d.severity === "error");
  const warnings = circuit.drc.filter((d) => d.severity === "warning");
  const pct = circuit.power.harvestMw
    ? Math.min(100, (circuit.power.drawMw / circuit.power.harvestMw) * 100)
    : 100;
  return (
    <SimPanel title="Auto-connector" meta={`${revealed.size}/${circuit.nets.length} nets`}>
      <div className="max-h-[13rem] overflow-y-auto pr-1">
        <table className="w-full border-collapse font-mono text-[0.6rem]">
          <tbody>
            {circuit.nets.map((n: Net) => (
              <tr
                key={n.id}
                className={`border-t border-[#0e2247] transition-opacity ${revealed.has(n.id) ? "opacity-100" : "opacity-20"}`}
              >
                <td className="py-1 pr-1 text-[#5e719a]">{n.id}</td>
                <td className="py-1 text-[#e6efff]">
                  {name(n.from.component)}.{n.from.port}
                </td>
                <td className="px-1 py-1 text-[#5e719a]">→</td>
                <td className="py-1 text-[#e6efff]">
                  {name(n.to.component)}.{n.to.port}
                </td>
                <td
                  className="py-1 pl-1 text-right"
                  style={{ color: NET_CSS[n.type] ?? "#c4d2ee" }}
                >
                  {n.type}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {errors.map((d) => (
          <p
            key={d.message}
            className="flex items-start gap-1.5 rounded border border-[#ff4b5c]/40 bg-[#ff4b5c]/[0.07] px-2 py-1 text-[0.64rem] text-[#ffb3bc]"
          >
            <X className="mt-0.5 h-3 w-3 shrink-0" />{" "}
            <span>
              <b>{d.rule}</b> {d.message}
            </span>
          </p>
        ))}
        {warnings.map((d) => (
          <p
            key={d.message}
            className="flex items-start gap-1.5 rounded border border-[#d9a441]/40 bg-[#d9a441]/[0.06] px-2 py-1 text-[0.64rem] text-[#f0d08a]"
          >
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />{" "}
            <span>
              <b>{d.rule}</b> {d.message}
            </span>
          </p>
        ))}
        {!errors.length ? (
          <p className="flex items-center gap-1.5 text-[0.64rem] text-[#9ff0cc]">
            <Check className="h-3 w-3" /> ERC passed · write path gated by PRISM
          </p>
        ) : null}
      </div>
      <div className="mt-2">
        <div className="mb-1 flex justify-between font-mono text-[0.56rem] uppercase tracking-[0.12em] text-[#8095bf]">
          <span>Power draw / harvest</span>
          <span className="text-[#e6efff]">
            {fmt(circuit.power.drawMw, 1)} / {fmt(circuit.power.harvestMw, 1)} mW
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#0e2247]">
          <div
            className={`h-full rounded-full ${pct >= 100 ? "bg-[#d9a441]" : "bg-[#41e0a2]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-[0.6rem] text-[#5e719a]">
          Write-back duty cycle limited to {fmt(circuit.power.dutyLimit * 100, 0)} % by the assumed
          harvest budget.
        </p>
      </div>
    </SimPanel>
  );
}

/* -------------------------------------------------------------- design */

export function DesignPanel({
  design,
  beams,
  onDesign,
  onAuto,
  autoProgress,
  autoNote,
}: {
  design: ArrayDesign;
  beams: TargetBeam[];
  onDesign: (d: ArrayDesign) => void;
  onAuto: () => void;
  autoProgress: number | null;
  autoNote: string | null;
}) {
  const fMhz = design.frequencyHz / 1e6;
  const lam = wavelengthM(design.frequencyHz);
  const pitchLam = design.pitchM / lam;
  const isSpec = fMhz === 15;
  return (
    <SimPanel title="ECHO array design" meta={isSpec ? "doc spec · 15 MHz" : "auto-designed"}>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[0.6rem] uppercase tracking-[0.12em] text-[#8095bf]">
          Frequency
          <select
            className="rounded border border-[#16305e] bg-[#01071a] px-2 py-1 text-[0.74rem] normal-case tracking-normal text-[#e6efff]"
            value={fMhz}
            onChange={(e) => {
              const f = Number(e.target.value) * 1e6;
              onDesign({ ...design, frequencyHz: f, pitchM: pitchLam * wavelengthM(f) });
            }}
          >
            {FREQUENCIES_MHZ.map((f) => (
              <option key={f} value={f}>
                {f} MHz{f === 15 ? " (spec)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.6rem] uppercase tracking-[0.12em] text-[#8095bf]">
          Pitch
          <select
            className="rounded border border-[#16305e] bg-[#01071a] px-2 py-1 text-[0.74rem] normal-case tracking-normal text-[#e6efff]"
            value={PITCH_WAVELENGTHS.reduce((a, b) =>
              Math.abs(b - pitchLam) < Math.abs(a - pitchLam) ? b : a,
            )}
            onChange={(e) => onDesign({ ...design, pitchM: Number(e.target.value) * lam })}
          >
            {PITCH_WAVELENGTHS.map((k) => (
              <option key={k} value={k}>
                {k} λ = {(k * lam * 1000).toFixed(2)} mm
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1 font-mono text-[0.58rem] text-[#8095bf]">
        λ {fmt(lam * 1000, 3)} mm · aperture {fmt(design.pitchM * design.elementsPerSide * 1000, 1)}{" "}
        mm · 16 × 16 elements
      </p>
      <table className="mt-2 w-full border-collapse text-[0.64rem]">
        <thead>
          <tr className="text-left font-mono text-[0.52rem] uppercase tracking-[0.1em] text-[#5e719a]">
            <th className="pb-1 font-medium">Target</th>
            <th className="pb-1 text-right font-medium">Depth</th>
            <th className="pb-1 text-right font-medium">Focus</th>
            <th className="pb-1 text-right font-medium">Off-tgt</th>
            <th className="pb-1 text-right font-medium" />
          </tr>
        </thead>
        <tbody>
          {beams.map((b) => {
            const ok = deliverable(b);
            return (
              <tr key={b.region} className="border-t border-[#0e2247]">
                <td className="py-1 capitalize text-[#e6efff]">{b.region}</td>
                <td className="py-1 text-right font-mono text-[#c4d2ee]">
                  {fmt(b.metrics.depthMm, 1)} mm
                </td>
                <td className="py-1 text-right font-mono text-[#c4d2ee]">
                  {fmt(b.metrics.focusMpa, 3)} MPa
                </td>
                <td
                  className={`py-1 text-right font-mono ${ok ? "text-[#9ff0cc]" : "text-[#ffb3bc]"}`}
                >
                  {fmt(b.metrics.offTargetFraction, 2)}×
                </td>
                <td className="py-1 text-right">
                  {ok ? (
                    <Check className="ml-auto h-3 w-3 text-[#41e0a2]" />
                  ) : (
                    <X className="ml-auto h-3 w-3 text-[#ff4b5c]" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        onClick={onAuto}
        disabled={autoProgress !== null}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-[#7fd8ff]/50 bg-[#0b2a5c] px-3 py-2 text-[0.74rem] font-medium text-[#e6f7ff] transition hover:bg-[#123a7a] disabled:opacity-60"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {autoProgress !== null
          ? `Searching ${Math.round(autoProgress * 100)} %…`
          : "Auto-design array for this programme"}
      </button>
      {autoNote ? (
        <p className="mt-1.5 text-[0.62rem] leading-relaxed text-[#a9bbdc]">{autoNote}</p>
      ) : null}
      <p className="mt-1.5 text-[0.6rem] leading-relaxed text-[#5e719a]">
        Brain attenuates ≈ 0.6 dB/cm/MHz: 9 dB/cm at the spec&apos;s 15 MHz. A target counts as
        reachable when no point outside its focus exceeds half the focal pressure (PRISM S4).
      </p>
    </SimPanel>
  );
}

/* ------------------------------------------------------- pipeline strip */

const STAGES = [
  { id: "SENSE", label: "NIMBLE", sub: "sense" },
  { id: "PREDICT", label: "Synapse Atlas", sub: "predict" },
  { id: "VERIFY", label: "PRISM", sub: "verify" },
  { id: "WRITE", label: "ECHO", sub: "write-back" },
  { id: "MEASURE", label: "NIMBLE", sub: "measure" },
] as const;

export function PipelineStrip({ stage, ev }: { stage: string | null; ev: LoopEvent | null }) {
  const halted = ev?.halted;
  return (
    <div className="pointer-events-none flex items-stretch gap-1">
      {STAGES.map((s, i) => {
        const on = stage === s.id;
        const gate = s.id === "VERIFY";
        const ms = ev?.stages.find((x) => x.stage === s.id)?.ms;
        const colour = gate && ev ? (halted ? "#ff4b5c" : "#41e0a2") : "#7fd8ff";
        return (
          <div key={s.id + i} className="flex items-center gap-1">
            <div
              className="rounded-md border px-2 py-1 backdrop-blur transition-all"
              style={{
                borderColor: on ? colour : "#16305e",
                background: on ? `${colour}22` : "rgba(1,7,26,0.72)",
                boxShadow: on ? `0 0 18px ${colour}66` : "none",
              }}
            >
              <p
                className="font-mono text-[0.52rem] uppercase tracking-[0.14em]"
                style={{ color: on ? colour : "#8095bf" }}
              >
                {s.sub}
              </p>
              <p className="flex items-center gap-1 whitespace-nowrap text-[0.68rem] font-semibold text-[#e6efff]">
                {gate && ev ? (
                  halted ? (
                    <ShieldAlert className="h-3 w-3 text-[#ff4b5c]" />
                  ) : (
                    <ShieldCheck className="h-3 w-3 text-[#41e0a2]" />
                  )
                ) : null}
                {s.label}
              </p>
              <p className="font-mono text-[0.54rem] text-[#a9bbdc]">
                {ms !== undefined ? `${ms.toFixed(ms < 1 ? 3 : 1)} ms` : " "}
              </p>
            </div>
            {i < STAGES.length - 1 ? <span className="text-[#3d5a8a]">›</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- instruments */

export function LatencyPanel({ ev }: { ev: LoopEvent | null }) {
  const target = 15;
  const total = ev?.latencyMs ?? 0;
  return (
    <SimPanel title="Loop latency" meta={`target < ${target} ms`}>
      {ev ? (
        <>
          <div className="flex flex-col gap-1.5">
            {ev.stages
              .filter((s) => s.stage !== "MEASURE")
              .map((s) => (
                <div key={s.stage} className="flex items-center gap-2 text-[0.66rem]">
                  <span className="w-16 font-mono text-[#8095bf]">{s.stage}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#0e2247]">
                    <div
                      className="h-full rounded-full bg-[#3fa9ff]"
                      style={{ width: `${Math.min(100, (s.ms / 18) * 100)}%` }}
                    />
                  </div>
                  <span className="w-14 text-right font-mono text-[#e6efff]">
                    {s.ms.toFixed(s.ms < 1 ? 3 : 2)}
                  </span>
                  <Tag
                    kind={
                      s.source === "spec" ? "spec" : s.source === "physics" ? "physics" : "measured"
                    }
                  />
                </div>
              ))}
          </div>
          <p
            className={`mt-2 font-mono text-[0.7rem] ${total <= target ? "text-[#9ff0cc]" : "text-[#f0d08a]"}`}
          >
            Sense → write-back: {total.toFixed(2)} ms{" "}
            {total <= target ? "· within target" : `· ${(total - target).toFixed(2)} ms over`}
          </p>
          <p className="mt-1 text-[0.6rem] leading-relaxed text-[#5e719a]">
            The spec budgets alone (ASIC &lt; 10 ms + PRISM &lt; 5 ms) already use the 15 ms target;
            prediction time is measured here, in this browser.
          </p>
        </>
      ) : (
        <p className="text-[0.66rem] text-[#8095bf]">Waiting for the first loop…</p>
      )}
    </SimPanel>
  );
}

export function PrismPanel({ ev }: { ev: LoopEvent | null }) {
  const v = ev?.verification;
  return (
    <SimPanel
      title="PRISM gate"
      meta={v ? (v.verified ? "verified" : "halted") : "—"}
      action={
        v ? (
          v.verified ? (
            <ShieldCheck className="h-4 w-4 text-[#41e0a2]" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-[#ff4b5c]" />
          )
        ) : null
      }
    >
      {v ? (
        <>
          {!v.verified ? (
            <p className="mb-2 rounded border border-[#ff4b5c]/40 bg-[#ff4b5c]/[0.08] px-2 py-1.5 text-[0.66rem] text-[#ffb3bc]">
              HALT — no write-back. {v.reason}
            </p>
          ) : null}
          <table className="w-full border-collapse text-[0.62rem]">
            <tbody>
              {v.rules.map((r) => (
                <tr key={r.id} className="border-t border-[#0e2247]" title={`limit ${r.limit}`}>
                  <td className="py-1 pr-1 font-mono text-[#5e719a]">{r.id}</td>
                  <td className="py-1 text-[#c4d2ee]">{r.label}</td>
                  <td className="py-1 pl-1 text-right font-mono text-[#e6efff]">{r.value}</td>
                  <td className="py-1 pl-1 text-right">
                    {r.pass ? (
                      <Check className="ml-auto h-3 w-3 text-[#41e0a2]" />
                    ) : (
                      <X className="ml-auto h-3 w-3 text-[#ff4b5c]" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="text-[0.66rem] text-[#8095bf]">Gate idle.</p>
      )}
    </SimPanel>
  );
}

export function BeamPanel({ beams, ev }: { beams: TargetBeam[]; ev: LoopEvent | null }) {
  return (
    <SimPanel title="Acoustic field" meta="Rayleigh sum · computed">
      <div className="flex flex-col gap-2">
        {beams.map((b) => {
          const m = b.metrics;
          const temp = ev?.delivered.find((d) => d.region === b.region)?.tempC;
          const rows: [string, string][] = [
            ["Depth", `${fmt(m.depthMm, 1)} mm`],
            ["Path loss", `${fmt(m.pathLossDb, 1)} dB`],
            ["Focal pressure", `${fmt(m.focusMpa, 3)} MPa`],
            ["I_SPPA", `${fmt(m.isppaWcm2, 2)} W/cm²`],
            ["Focal width (lat × ax)", `${fmt(m.lateralFwhmMm, 2)} × ${fmt(m.axialFwhmMm, 1)} mm`],
            [
              "Mechanical index",
              `${fmt(m.mechanicalIndex, 3)} (≤ ${SAFETY_LIMITS.mechanicalIndex})`,
            ],
            ["Off-target", `${fmt(m.offTargetFraction, 2)} × focus`],
            ["Focal ΔT now", temp !== undefined ? `${fmt(temp, 3)} °C` : "—"],
          ];
          return (
            <div key={b.region} className="rounded-md border border-[#0e2247] bg-[#030b20]/70 p-2">
              <p className="mb-1 flex items-center justify-between text-[0.7rem]">
                <span className="capitalize text-[#e6efff]">{b.region}</span>
                <span
                  className={`font-mono text-[0.56rem] ${deliverable(b) ? "text-[#9ff0cc]" : "text-[#ffb3bc]"}`}
                >
                  {deliverable(b) ? "IN REACH" : "OUT OF REACH"}
                </span>
              </p>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[0.6rem]">
                {rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-[#8095bf]">{k}</dt>
                    <dd className="text-right font-mono text-[#e6efff]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </SimPanel>
  );
}

const Cite = ({ refs }: { refs: Reference[] }) => (
  <span className="text-[#8095bf]">({refs.map((r) => r.cite).join("; ")})</span>
);

/** Why a deep target is gated, with this region's own measured depths. */
function GatedExplanation({ d, name }: { d: RegionDepth; name: string }) {
  const sources: Reference[] = [
    REFS.rushDriscoll1968,
    REFS.oostendorp2000,
    REFS.pascualMarqui2007,
    REFS.cuffin2001,
    REFS.akalinAcar2013,
    ...(d.region === "amygdala" ? [REFS.neurosity] : []),
  ];
  return (
    <div className="mt-2 border-t border-[#0e2247] pt-2 text-[0.6rem] leading-relaxed text-[#c4d2ee]">
      <p>
        {name} sits {fmt(d.belowScalpMm, 1)} mm below the scalp of this template and{" "}
        {fmt(d.belowBrainMm, 1)} mm below the brain surface, both measured here on MNI152. The skull
        conducts far less than brain — a brain-to-skull conductivity ratio of about 80 in early tank
        measurements and about 15 measured in vivo{" "}
        <Cite refs={[REFS.rushDriscoll1968, REFS.oostendorp2000]} /> — so it smears and attenuates
        what reaches scalp electrodes. Source imaging projects scalp potentials back into the brain
        through a head model; eLORETA&apos;s weighting localises a single test source without bias
        in principle, at low spatial resolution <Cite refs={[REFS.pascualMarqui2007]} />. In
        practice the error grows with depth: 12.8 ± 6.2 mm for inferior against 9.2 ± 4.4 mm for
        superior sources implanted in patients <Cite refs={[REFS.cuffin2001]} />, and about 20 mm at
        the most basal locations even with individual four-layer head models, where a wrong skull
        conductivity alone gave errors up to 31 mm <Cite refs={[REFS.akalinAcar2013]} />. A
        scalp-EEG estimate here needs cross-validation against fMRI or intracranial EEG before
        clinical use; this simulation senses with a cortical-surface mesh, not scalp EEG.
      </p>
      <ol className="mt-1.5 list-decimal pl-4 text-[0.56rem] text-[#8095bf]">
        {sources.map((r) => (
          <li key={r.cite}>
            {r.url ? (
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="text-[#9cc7ff] hover:text-[#e6efff]"
              >
                {r.cite}
              </a>
            ) : (
              <span className="text-[#c4d2ee]">{r.cite}</span>
            )}{" "}
            — {r.title}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DepthPanel({
  depths,
  name,
  targets,
}: {
  depths: RegionDepth[];
  name: (k: RegionKey) => string;
  targets: RegionKey[];
}) {
  const [open, setOpen] = useState<RegionKey | null>(null);
  const mni = (v: [number, number, number]) => v.map((x) => x.toFixed(0)).join(", ");
  return (
    <SimPanel title="Depth & localisation" meta="MNI152 · computed">
      {depths.length ? (
        <div className="flex flex-col gap-2">
          {depths.map((d) => {
            const rows: [string, string][] = [
              [`MNI (${d.side === "left" ? "L" : "R"} centroid)`, mni(d.mni)],
              ["Below scalp", `${fmt(d.belowScalpMm, 1)} mm`],
              ...(d.region === "amygdala"
                ? ([
                    [
                      "Published (scalp)",
                      `${AMYGDALA_SCALP_RANGE_MM[0]}–${AMYGDALA_SCALP_RANGE_MM[1]} mm`,
                    ],
                  ] as [string, string][])
                : []),
              ["Below brain surface", `${fmt(d.belowBrainMm, 1)} mm`],
              ["Scalp-EEG reach", "No · deep source"],
              ["Scalp-EEG error", "≈ 13–20 mm"],
            ];
            const isOpen = open === d.region;
            return (
              <div
                key={d.region}
                className="rounded-md border border-[#0e2247] bg-[#030b20]/70 p-2"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-[0.7rem]">
                  <span className="truncate text-[#e6efff]">{name(d.region)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {targets.includes(d.region) ? (
                      <span className="rounded border border-[#3d8bf5]/60 px-1 py-px font-mono text-[0.5rem] tracking-[0.1em] text-[#9cc7ff]">
                        TARGET
                      </span>
                    ) : null}
                    <span className="rounded border border-[#d9a441]/60 px-1 py-px font-mono text-[0.5rem] tracking-[0.1em] text-[#f0d08a]">
                      GATED
                    </span>
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[0.6rem]">
                  {rows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-[#8095bf]">{k}</dt>
                      <dd
                        className="text-right font-mono text-[#e6efff]"
                        title={
                          k === "Scalp-EEG error"
                            ? `${DEEP_SOURCE_ERROR.value} — ${DEEP_SOURCE_ERROR.refs.map((r) => r.cite).join("; ")}`
                            : k === "Published (scalp)"
                              ? REFS.neurosity.cite
                              : undefined
                        }
                      >
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : d.region)}
                  aria-expanded={isOpen}
                  className="mt-1.5 flex items-center gap-1 text-[0.6rem] text-[#7fd8ff] hover:text-[#e6efff]"
                >
                  Why gated
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen ? <GatedExplanation d={d} name={name(d.region)} /> : null}
              </div>
            );
          })}
          <p className="text-[0.6rem] leading-relaxed text-[#5e719a]">
            Gated: deep targets that scalp EEG cannot localise precisely. Depths are measured on the
            MNI152 template from each region&apos;s centroid; they describe the template, not a
            patient.
          </p>
        </div>
      ) : (
        <p className="text-[0.66rem] text-[#8095bf]">Waiting for the anatomy…</p>
      )}
    </SimPanel>
  );
}

/** Placement and safety margins of every target, at full drive, before the loop runs. */
export function PlanPanel({
  plans,
  name,
}: {
  plans: TargetPlan[];
  name: (k: RegionKey) => string;
}) {
  const failed = plans.filter((p) => !p.pass).length;
  const v3 = (v: [number, number, number], d: number) => v.map((x) => x.toFixed(d)).join(", ");
  return (
    <SimPanel
      title="Placement & plan"
      meta={
        plans.length ? (failed ? `${failed} target${failed > 1 ? "s" : ""} fail` : "all pass") : "—"
      }
      action={
        plans.length ? (
          failed ? (
            <ShieldAlert className="h-4 w-4 text-[#ff4b5c]" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-[#41e0a2]" />
          )
        ) : null
      }
    >
      {plans.length ? (
        <div className="flex flex-col gap-2">
          {plans.map((p) => (
            <div key={p.region} className="rounded-md border border-[#0e2247] bg-[#030b20]/70 p-2">
              <p className="mb-1 flex items-center justify-between text-[0.7rem]">
                <span className="text-[#e6efff]">{name(p.region)}</span>
                <span
                  className={`font-mono text-[0.56rem] ${p.pass ? "text-[#9ff0cc]" : "text-[#ffb3bc]"}`}
                >
                  {p.pass ? "PASS" : "FAIL"}
                </span>
              </p>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[0.6rem]">
                {(
                  [
                    ["Array centre (MNI)", v3(p.centre, 1)],
                    ["Normal", v3(p.normal, 2)],
                    ["Array → target", `${fmt(p.depthMm, 1)} mm`],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-[#8095bf]">{k}</dt>
                    <dd className="text-right font-mono text-[#e6efff]">{v}</dd>
                  </div>
                ))}
              </dl>
              <table className="mt-1.5 w-full border-collapse text-[0.6rem]">
                <tbody>
                  {p.margins.map((m) => (
                    <tr key={m.key} className="border-t border-[#0e2247]" title={m.basis}>
                      <td className="py-1 text-[#c4d2ee]">{m.label}</td>
                      <td className="whitespace-nowrap py-1 pl-1 text-right font-mono text-[#e6efff]">
                        {fmt(m.value, m.digits)} / {fmt(m.limit, m.digits)}
                        {m.unit ? ` ${m.unit}` : ""}
                      </td>
                      <td
                        className={`whitespace-nowrap py-1 pl-1 text-right font-mono ${m.pass ? "text-[#9ff0cc]" : "text-[#ffb3bc]"}`}
                      >
                        {m.pass ? `${Math.round(m.margin * 100)} %` : "over"}
                      </td>
                      <td className="py-1 pl-1 text-right">
                        {m.pass ? (
                          <Check className="ml-auto h-3 w-3 text-[#41e0a2]" />
                        ) : (
                          <X className="ml-auto h-3 w-3 text-[#ff4b5c]" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="rounded-md border border-dashed border-[#16305e] p-2 text-[0.6rem]">
            <p className="mb-1 font-mono text-[0.56rem] uppercase tracking-[0.12em] text-[#5e719a]">
              Not modelled
            </p>
            {NOT_MODELLED.map((n) => (
              <p key={n.label} className="text-[#8095bf]">
                <span className="text-[#c4d2ee]">{n.label}</span> — {n.reason}
              </p>
            ))}
          </div>
          <p className="text-[0.6rem] leading-relaxed text-[#5e719a]">
            Value / limit and headroom at full drive, from the same physics and limits PRISM
            enforces. The plan is the worst case before the loop runs; PRISM still checks every
            intent.
          </p>
        </div>
      ) : (
        <p className="text-[0.66rem] text-[#8095bf]">Waiting for the anatomy…</p>
      )}
    </SimPanel>
  );
}

const SCOPE_COLOURS = ["#3987e5", "#d95926", "#199e70", "#c58cff", "#e6c35c"];

export function ScopePanel({
  recorder,
  regions,
  endpointHistory,
  unit,
  label,
  windowS,
}: {
  recorder: () => Recorder | null;
  regions: string[];
  endpointHistory: number[];
  unit: string;
  label: string;
  windowS: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      const rec = recorder();
      if (!c || !rec) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "#0e2247";
      g.lineWidth = 1;
      for (let x = 0; x < w; x += w / 10) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      const rows = regions.length;
      regions.forEach((key, i) => {
        const idx = REGION_INDEX[key as keyof typeof REGION_INDEX];
        if (idx === undefined) return;
        const data = rec.last(idx, 1500);
        const y0 = ((i + 0.5) / rows) * h;
        g.strokeStyle = SCOPE_COLOURS[i % SCOPE_COLOURS.length]!;
        g.lineWidth = 1.2;
        g.beginPath();
        const off = 1500 - data.length; // newest sample at the right edge
        for (let k = 0; k < data.length; k++) {
          const x = ((off + k) / 1500) * w;
          const y = y0 - data[k]! * (h / rows) * 0.9;
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
        g.fillStyle = SCOPE_COLOURS[i % SCOPE_COLOURS.length]!;
        g.font = "10px ui-monospace, monospace";
        g.fillText(key, 4, y0 - (h / rows) * 0.32);
      });
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [recorder, regions]);

  const hist = endpointHistory.slice(-120);
  const lo = Math.min(0, ...hist);
  const hi = Math.max(1, ...hist);
  const pts = hist
    .map(
      (v, i) => `${(i / Math.max(1, hist.length - 1)) * 100},${30 - ((v - lo) / (hi - lo)) * 28}`,
    )
    .join(" ");
  return (
    <SimPanel title="Neural instruments" meta="1.5 s · model LFP">
      <canvas ref={ref} className="h-40 w-full rounded bg-[#01071a]" />
      <div className="mt-2">
        <p className="mb-1 flex items-center justify-between font-mono text-[0.56rem] uppercase tracking-[0.12em] text-[#8095bf]">
          <span className="truncate normal-case tracking-normal">Model endpoint · {label}</span>
          <span className="shrink-0 text-[#e6efff]">
            {hist.length
              ? `${hist[hist.length - 1]!.toFixed(1)} ${unit}`
              : `measuring · window ${windowS.toFixed(2)} / 1.50 s`}
          </span>
        </p>
        <svg
          viewBox="0 0 100 30"
          preserveAspectRatio="none"
          className="h-10 w-full rounded bg-[#01071a]"
        >
          <polyline
            points={pts}
            fill="none"
            stroke="#7fd8ff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </SimPanel>
  );
}

/* ----------------------------------------------------------- benchmark */

export function BenchmarkPanel({
  diseases,
  results,
  progress,
  onRun,
  running,
  patients,
  setPatients,
  autoDesign,
  setAutoDesign,
}: {
  diseases: Disease[];
  results: Partial<Record<string, CohortResult>>;
  progress: { disease: string; done: number; total: number } | null;
  onRun: (keys: string[]) => void;
  running: boolean;
  patients: number;
  setPatients: (n: number) => void;
  autoDesign: boolean;
  setAutoDesign: (on: boolean) => void;
}) {
  const statusPill = (d: Disease) => {
    const s = d.clinical.status;
    const style =
      s === "verified"
        ? "text-[#9ff0cc] border-[#41e0a2]/50"
        : s === "design-doc"
          ? "text-[#f0d08a] border-[#d9a441]/50"
          : "text-[#c4d2ee] border-[#8095bf]/50";
    const text = s === "verified" ? "cited" : s === "design-doc" ? "per design doc" : "no baseline";
    return (
      <span className={`rounded border px-1 font-mono text-[0.5rem] uppercase ${style}`}>
        {text}
      </span>
    );
  };
  return (
    <SimPanel
      title="Benchmark comparison · in-silico cohort"
      meta="closed loop vs open loop, same noise"
      action={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 font-mono text-[0.58rem] text-[#8095bf]">
            <input
              type="checkbox"
              checked={autoDesign}
              disabled={running}
              onChange={(e) => setAutoDesign(e.target.checked)}
              className="accent-[#7fd8ff]"
            />
            auto-design
          </label>
          <label className="flex items-center gap-1 font-mono text-[0.58rem] text-[#8095bf]">
            N
            <select
              value={patients}
              onChange={(e) => setPatients(Number(e.target.value))}
              className="rounded border border-[#16305e] bg-[#01071a] px-1 text-[0.66rem] text-[#e6efff]"
            >
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={running}
            onClick={() => onRun(diseases.map((d) => d.key))}
            className="flex items-center gap-1 rounded border border-[#7fd8ff]/50 bg-[#0b2a5c] px-2 py-1 font-mono text-[0.6rem] tracking-[0.1em] text-[#e6f7ff] disabled:opacity-60"
          >
            <Zap className="h-3 w-3" /> RUN ALL
          </button>
        </div>
      }
    >
      {progress ? (
        <div className="mb-2">
          <p className="mb-1 font-mono text-[0.6rem] text-[#a9bbdc]">
            {progress.disease}: patient {progress.done} / {progress.total}
          </p>
          <div className="h-1 overflow-hidden rounded-full bg-[#0e2247]">
            <div
              className="h-full bg-[#7fd8ff]"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse text-[0.66rem]">
          <thead>
            <tr className="text-left font-mono text-[0.52rem] uppercase tracking-[0.1em] text-[#5e719a]">
              <th className="pb-2 font-medium">Programme</th>
              <th className="pb-2 font-medium">Clinical reference</th>
              <th className="pb-2 font-medium">NIMBLE target</th>
              <th className="pb-2 font-medium">Model endpoint (in silico)</th>
              <th className="pb-2 text-right font-medium">Closed loop</th>
              <th className="pb-2 text-right font-medium">Open loop</th>
              <th className="pb-2 text-right font-medium">Verified write-backs</th>
              <th className="pb-2 text-right font-medium">Halts</th>
              <th className="pb-2 text-right font-medium">Open-loop breaches</th>
              <th className="pb-2 text-right font-medium">Latency p50/p95</th>
              <th className="pb-2 text-right font-medium">Result</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {diseases.map((d) => {
              const r = results[d.key];
              const verdict = r?.verdict;
              return (
                <tr key={d.key} className="border-t border-[#0e2247] align-top">
                  <td className="py-2 pr-2">
                    <p className="font-medium text-[#e6efff]">{d.name}</p>
                    <p className="text-[0.58rem] text-[#8095bf]">{d.targets.join(" + ")}</p>
                  </td>
                  <td className="py-2 pr-2 text-[#c4d2ee]" title={d.clinical.citation}>
                    {d.clinical.baseline} {statusPill(d)}
                  </td>
                  <td className="py-2 pr-2 text-[#c4d2ee]">{d.clinical.nimbleTarget}</td>
                  <td className="py-2 pr-2 text-[#c4d2ee]" title={d.endpoint.criterion}>
                    {d.endpoint.label}
                    <span className="block text-[0.56rem] text-[#5e719a]">
                      pass: {d.endpoint.criterion}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono text-[#e6efff]">
                    {r ? (
                      <span className="block text-[0.54rem] text-[#5e719a]">
                        {r.designMhz} MHz array
                      </span>
                    ) : null}
                    {r
                      ? r.foci !== null
                        ? `${r.foci} foci`
                        : `${r.closed.endpoint.mean.toFixed(1)} ± ${r.closed.endpoint.sd.toFixed(1)}`
                      : "—"}
                  </td>
                  <td className="py-2 text-right font-mono text-[#a9bbdc]">
                    {r && r.foci === null ? r.open.endpoint.mean.toFixed(1) : "—"}
                  </td>
                  <td className="py-2 text-right font-mono text-[#e6efff]">
                    {r ? `${r.closed.verifiedDeliveries}/${r.closed.deliveries}` : "—"}
                  </td>
                  <td
                    className="py-2 text-right font-mono text-[#a9bbdc]"
                    title={r ? JSON.stringify(r.closed.haltReasons) : ""}
                  >
                    {r ? r.closed.halts : "—"}
                  </td>
                  <td
                    className={`py-2 text-right font-mono ${r && r.open.safetyBreaches ? "text-[#ffb3bc]" : "text-[#a9bbdc]"}`}
                  >
                    {r ? r.open.safetyBreaches : "—"}
                  </td>
                  <td className="py-2 text-right font-mono text-[#a9bbdc]">
                    {r ? `${r.latencyP50Ms.toFixed(1)} / ${r.latencyP95Ms.toFixed(1)}` : "—"}
                  </td>
                  <td className="py-2 text-right" title={r?.why ?? ""}>
                    {verdict ? (
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[0.56rem] font-semibold ${
                          verdict === "pass"
                            ? "bg-[#41e0a2]/15 text-[#9ff0cc]"
                            : verdict === "fail"
                              ? "bg-[#ff4b5c]/15 text-[#ffb3bc]"
                              : "bg-[#8095bf]/15 text-[#c4d2ee]"
                        }`}
                      >
                        {verdict === "not-assessed" ? "NOT ASSESSED" : verdict.toUpperCase()}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => onRun([d.key])}
                      className="rounded border border-[#16305e] px-1.5 py-0.5 font-mono text-[0.56rem] text-[#7fd8ff] disabled:opacity-50"
                    >
                      RUN
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[0.62rem] leading-relaxed text-[#8095bf]">
        <Cpu className="mr-1 inline h-3 w-3" />
        Each virtual patient (seeded; severity, coupling and rhythm vary) runs both arms with the
        same noise. Closed loop enforces PRISM; open loop fires a fixed protocol and only logs the
        rules. Scored: the model&apos;s own biomarker endpoint, verification, halts, safety-limit
        breaches and latency.{" "}
        <b className="text-[#c4d2ee]">
          Clinical outcomes (CDR-SB, SRS-2, acuity, speech) are not predicted
        </b>{" "}
        — that needs a validated disease-progression model — so those columns show the cited
        reference and the NIMBLE target only. Each programme runs with its selected array design;
        with auto-design on, programmes still on the doc spec are first auto-designed. Untick it to
        benchmark the 15 MHz spec as written.
      </p>
    </SimPanel>
  );
}
