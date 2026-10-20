import { useState } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import {
  BANDS,
  BAND_CODES,
  REGION_NOTES,
  type Region,
  type SpectrumMode,
} from "@/lib/vision/spectrum";
import { ConceptScene3D, PAINTS } from "./ConceptScene3D";

const MODES: { key: SpectrumMode; label: string }[] = [
  { key: "human", label: "Human eye" },
  { key: "uv", label: "+ Ultraviolet" },
  { key: "nir", label: "+ Near-infrared" },
  { key: "both", label: "Both" },
];

/** 300–1000 nm, with the bands this mode adds picked out. */
function SpectrumBar({ mode }: { mode: SpectrumMode }) {
  const x = (nm: number) => ((nm - 300) / 700) * 100;
  const on = (k: string) =>
    k === "visible" ||
    (k === "uv" && (mode === "uv" || mode === "both")) ||
    (k === "nir" && (mode === "nir" || mode === "both"));
  return (
    <div>
      <div className="relative h-8 overflow-hidden rounded-full ring-1 ring-[var(--v-line)]">
        <div
          className="absolute inset-y-0"
          style={{
            left: `${x(380)}%`,
            width: `${x(750) - x(380)}%`,
            background:
              "linear-gradient(90deg,#7b2cbf,#3a0ca3,#4361ee,#4cc9f0,#52b788,#f9c74f,#f8961e,#d00000)",
          }}
        />
        {BANDS.filter((b) => b.key !== "visible").map((b) => (
          <div
            key={b.key}
            className="absolute inset-y-0"
            style={{
              left: `${x(b.nm[0])}%`,
              width: `${x(b.nm[1]) - x(b.nm[0])}%`,
              background: on(b.key)
                ? b.key === "uv"
                  ? "repeating-linear-gradient(45deg,#c13cff 0 6px,#e9b8ff 6px 12px)"
                  : "repeating-linear-gradient(45deg,#ff4d2e 0 6px,#ffc2b5 6px 12px)"
                : "repeating-linear-gradient(45deg,#e4e2ec 0 6px,#f4f3f8 6px 12px)",
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-[1.1fr_5.3fr_3.6fr]">
        {BANDS.map((b) => (
          <div key={b.key} className={on(b.key) ? "" : "opacity-50"}>
            <p className="font-medium">
              {b.name}{" "}
              <span className="font-normal text-[var(--v-ink-3)]">
                {b.nm[0]}–{b.nm[1]} nm
              </span>
            </p>
            <p className="text-[var(--v-ink-2)]">{b.plain}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The enhanced-vision concept: a separate, clearly labelled presentation
 * piece. Nothing here feeds or comes from the benchmark.
 */
export function ConceptVision() {
  const [mode, setMode] = useState<SpectrumMode>("both");
  const [at, setAt] = useState<Region | null>(null);

  return (
    <div>
      <div className="flex gap-2 rounded-2xl bg-[#fbe6ee] p-3 text-[12px] text-[var(--v-ink)]">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#b0306a]" aria-hidden />
        <p>
          <span className="font-medium">A concept for presentation.</span> It shows what extra bands
          of light would reveal, translated into colours a screen can show. It is not a therapy, not
          something any treatment does, not what such senses would feel like, and not part of any
          benchmark result.
        </p>
      </div>

      <div className="mt-4">
        <SpectrumBar mode={mode} />
      </div>

      <div
        role="tablist"
        aria-label="Concept view"
        className="mt-4 grid grid-cols-2 gap-1 rounded-3xl bg-[var(--v-soft)] p-1 text-[12px] sm:flex sm:rounded-full"
      >
        {MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => setMode(m.key)}
            className={`flex-1 rounded-full px-3 py-1.5 ${mode === m.key ? "bg-[#b0306a] text-white" : ""}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <ConceptScene3D mode={mode} onInspect={setAt} />
        <p className="mt-1.5 text-[11px] text-[var(--v-ink-3)]">
          Drag the handle to move the split; drag the scene to look around. Left: visible light, as
          a human eye sees it. Right: the concept view, in false colour.
        </p>
      </div>

      <div className="mt-3 rounded-2xl bg-[var(--v-soft)] p-3 text-[12px]" aria-live="polite">
        {at ? (
          <>
            <p className="font-medium first-letter:uppercase">{at}</p>
            <p className="mt-0.5 text-[var(--v-ink-2)]">
              Ultraviolet {Math.round(PAINTS[at].uv * 100)}%
              {at === "petal" ? " at the tips, about 4% near the centre" : ""} · near-infrared{" "}
              {Math.round(PAINTS[at].nir * 100)}%{" "}
              <span className="text-[var(--v-ink-3)]">(illustrative values)</span>
            </p>
            {REGION_NOTES[at] && <p className="mt-1">{REGION_NOTES[at]}</p>}
          </>
        ) : (
          <p className="text-[var(--v-ink-2)]">
            Point at the flowers, the tree or the pond to see what changes and why.
          </p>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--v-line)] p-3 text-[12px]">
          <p className="flex items-center gap-1.5 font-medium">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> How the colours are coded
          </p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[var(--v-ink-2)]">
            <li>{BAND_CODES.uv.text}</li>
            <li>{BAND_CODES.nir.text}</li>
            <li>
              A screen can only show visible light, so this is a translation, not a window onto new
              colours.
            </li>
          </ul>
        </div>
        <div className="rounded-2xl border border-[var(--v-line)] p-3 text-[12px]">
          <p className="font-medium">What is real here, and what is not</p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[var(--v-ink-2)]">
            <li>
              Real, well documented: flowers with ultraviolet patterns, leaves bright in
              near-infrared, water dark in it.
            </li>
            <li>
              Built by this app: the 3D scene and its values, chosen to illustrate those effects;
              not measurements.
            </li>
            <li>
              Not covered: radiation exposure (X-rays, gamma). That is a separate use case and needs
              its own scope and validated models.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
