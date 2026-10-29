import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  Image as ImageIcon,
  Info,
  Pause,
  Play,
  Sun,
  RefreshCcw,
  Sparkles,
  Tag,
  Waves,
} from "lucide-react";
import {
  CITATIONS,
  CITATION_NOTE,
  PARTS,
  RAY_COLOURS,
  STEPS,
  partByKey,
  type PartKey,
} from "@/lib/vision/eyeContent";
import {
  EMMETROPIC_LENGTH,
  LE_GRAND_RELAXED,
  power,
  simulateEye,
  vergenceOf,
} from "@/lib/vision/optics";
import {
  DYNAMICS,
  LIGHT_LEVELS,
  SCENARIOS,
  frameAt,
  pupilForLuminance,
  scenarioLength,
  trolands,
  type Scenario,
} from "@/lib/vision/dynamics";
import { EyeModel3D } from "./EyeModel3D";
import { LiveTrace } from "./LiveTrace";
import { useAdaptingEye } from "./useAdaptingEye";
import { RetinalImage } from "./RetinalImage";
import { VisualCycle } from "./VisualCycle";
import { ConceptVision } from "./ConceptVision";
import { Card, EvidenceTag } from "./ui";
import { StatusLine } from "./StatusPanel";

const DISTANCES = [Infinity, 6000, 2000, 1000, 500, 330, 250, 200, 150, 120, 100];
const RELAXED_POWER = power(LE_GRAND_RELAXED);

const fmtLight = (cdm2: number) => {
  const near = LIGHT_LEVELS.reduce((a, b) =>
    Math.abs(Math.log10(b.cdm2) - Math.log10(cdm2)) <
    Math.abs(Math.log10(a.cdm2) - Math.log10(cdm2))
      ? b
      : a,
  );
  const v = cdm2 >= 10 ? Math.round(cdm2).toLocaleString() : +cdm2.toPrecision(2);
  return `${near.label} · ${v} cd/m²`;
};

const nearestDistance = (mm: number) =>
  DISTANCES.reduce(
    (best, d, i) =>
      Math.abs(vergenceOf(d) - vergenceOf(mm)) <
      Math.abs(vergenceOf(DISTANCES[best]!) - vergenceOf(mm))
        ? i
        : best,
    0,
  );

const fmtDistance = (mm: number) =>
  !Number.isFinite(mm)
    ? "far away"
    : mm >= 1000
      ? `${+(mm / 1000).toFixed(1)} m`
      : `${Math.round(mm / 10)} cm`;

export function EyeSimulation() {
  const [distIdx, setDistIdx] = useState(0);
  const [auto, setAuto] = useState(true);
  const [manual, setManual] = useState(0);
  const [pupil, setPupil] = useState(3);
  const [length, setLength] = useState(EMMETROPIC_LENGTH);
  const [showLabels, setShowLabels] = useState(true);
  const [showRays, setShowRays] = useState(true);
  const [selected, setSelected] = useState<PartKey | null>(null);
  const [step, setStep] = useState<number | null>(1);

  const [lightLog, setLightLog] = useState(2);
  const [autoPupil, setAutoPupil] = useState(true);

  // A scripted scenario drives distance and light while it plays.
  const [play, setPlay] = useState<{ s: Scenario; t0: number } | null>(null);
  const [playT, setPlayT] = useState(0);
  useEffect(() => {
    if (!play) return;
    const id = window.setInterval(() => {
      const t = (performance.now() - play.t0) / 1000;
      if (t < scenarioLength(play.s)) return setPlayT(t);
      const end = play.s.frames[play.s.frames.length - 1]!;
      setDistIdx(nearestDistance(end.distance));
      setLightLog(Math.log10(end.cdm2));
      setPlay(null);
    }, 50);
    return () => window.clearInterval(id);
  }, [play]);
  const frame = play ? frameAt(play.s, playT) : null;

  const distance = frame ? frame.distance : DISTANCES[distIdx]!;
  const cdm2 = frame ? frame.cdm2 : 10 ** lightLog;
  const pupilTarget = autoPupil ? Math.min(8, Math.max(2, pupilForLuminance(cdm2))) : pupil;
  // Where the lens is heading: the focus the model would settle on.
  const accTarget = useMemo(
    () =>
      simulateEye({
        distance,
        pupilDiameter: pupilTarget,
        axialLength: length,
        accommodation: auto ? "auto" : manual,
      }).accommodation,
    [distance, pupilTarget, length, auto, manual],
  );
  const { live, trace, adapting } = useAdaptingEye(accTarget, pupilTarget, {
    acc: !auto,
    pupil: !autoPupil,
  });
  const result = useMemo(
    () =>
      simulateEye({
        distance,
        pupilDiameter: live.pupil,
        axialLength: length,
        accommodation: live.acc,
      }),
    [distance, live.pupil, length, live.acc],
  );

  const current = step ? STEPS[step - 1]! : null;
  const highlight: PartKey[] = current ? current.parts : selected ? [selected] : [];
  const part = selected ? partByKey(selected) : current ? partByKey(current.parts[0]!) : null;

  const offset = result.imageZ - length;
  const sharp = Math.abs(result.focusErrorD) < 0.25;
  const lengthDiff = length - EMMETROPIC_LENGTH;

  const select = (k: PartKey) => {
    setSelected(k);
    setStep(null);
  };

  return (
    <div className="vision-light min-h-screen px-3 py-3 font-sans sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1440px]">
        <StatusLine />
      </div>
      <div className="mx-auto max-w-[1440px] rounded-[36px] bg-[var(--v-frame)] p-2.5 ring-1 ring-white/80 dark:ring-white/10 backdrop-blur sm:p-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[250px_minmax(0,1fr)_330px]">
          {/* ------------------------------------------------ left */}
          <div className="order-2 flex flex-col gap-3 lg:order-none">
            <Card>
              <p className="text-[13px] font-semibold tracking-[-0.01em]">
                Vision · eye simulation
              </p>
              <p className="text-xs text-[var(--v-ink-3)]">On this page</p>
              <nav className="mt-4 flex flex-col gap-1 text-sm" aria-label="Sections">
                {[
                  { href: "#eye", label: "The living eye", icon: Eye, active: true },
                  { href: "#motion", label: "The eye in motion", icon: Play },
                  { href: "#retina", label: "Image on the retina", icon: ImageIcon },
                  { href: "#cycle", label: "Where RPE65 works", icon: RefreshCcw },
                  { href: "#concept", label: "Concept: beyond visible light", icon: Sparkles },
                  { href: "#about", label: "About this model", icon: BookOpen },
                ].map(({ href, label, icon: Icon, active }) => (
                  <a
                    key={href}
                    href={href}
                    className={`flex items-center gap-3 rounded-full px-3 py-2 ${
                      active ? "bg-[var(--v-accent)] text-white" : "hover:bg-[var(--v-soft)]"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {active && <ChevronRight className="h-4 w-4" aria-hidden />}
                  </a>
                ))}
              </nav>
            </Card>

            <Card className="flex-1">
              <p className="text-xs text-[var(--v-ink-3)]">How seeing works</p>
              <h2 className="text-[19px] font-medium">Step by step</h2>
              <ol className="mt-3 flex flex-col gap-1.5">
                {STEPS.map((s) => (
                  <li key={s.n}>
                    <button
                      onClick={() => {
                        setStep(s.n);
                        setSelected(null);
                      }}
                      className={`flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left ${
                        step === s.n ? "bg-[var(--v-accent)] text-white" : "bg-[var(--v-soft)]"
                      }`}
                    >
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-medium ${
                          step === s.n
                            ? "bg-[var(--v-card)] text-[var(--v-accent-ink)]"
                            : "bg-[var(--v-card)]"
                        }`}
                      >
                        {s.n}
                      </span>
                      <span className="text-[13px] leading-snug">{s.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          {/* ------------------------------------------------ centre */}
          <Card
            id="eye"
            className="relative order-1 flex min-h-[620px] flex-col overflow-hidden !p-0 lg:sticky lg:top-6 lg:order-none lg:h-[calc(100vh-3rem)] lg:self-start"
          >
            <div className="z-10 flex flex-wrap items-center justify-between gap-3 p-5 pb-0">
              <div>
                <h1 className="text-[19px] font-medium">The human eye, live</h1>
                <p className="text-xs text-[var(--v-ink-3)]">
                  Cut in half so you can see inside. Drag to turn it; click any part to learn what
                  it does.
                </p>
              </div>
              <div className="flex gap-1 rounded-full bg-[var(--v-soft)] p-1 text-[12px]">
                {(
                  [
                    ["Labels", showLabels, setShowLabels, Tag],
                    ["Light rays", showRays, setShowRays, Waves],
                  ] as const
                ).map(([label, on, set, Icon]) => (
                  <button
                    key={label}
                    aria-pressed={on}
                    onClick={() => set(!on)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
                      on ? "bg-[var(--v-accent)] text-white" : ""
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative flex flex-1 flex-col">
              <div className="relative min-h-[440px] flex-1">
                <EyeModel3D
                  result={result}
                  distance={distance}
                  showLabels={showLabels}
                  showRays={showRays}
                  highlight={highlight}
                  onSelect={select}
                />
                <div className="pointer-events-none absolute right-4 top-3 flex flex-col items-end gap-1 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--v-ink)] px-2.5 py-1 text-[var(--v-on-ink)]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${adapting ? "animate-pulse bg-[color:var(--kv-f5b544)]" : "bg-[color:var(--kv-46c08f)]"}`}
                      aria-hidden
                    />
                    {adapting ? "Adapting" : "Settled"} · pupil {live.pupil.toFixed(1)} mm · lens{" "}
                    {Math.round(live.acc * 100)}%
                  </span>
                  {frame?.note && (
                    <span className="rounded-full bg-[color-mix(in_oklab,var(--v-card)_90%,transparent)] px-2.5 py-1 font-medium">
                      {frame.note}
                    </span>
                  )}
                </div>
                {showRays && (
                  <div className="pointer-events-none absolute left-5 top-3 flex flex-col gap-1 text-[11px]">
                    {(
                      [
                        [RAY_COLOURS.top, "Light from the top of the object"],
                        [RAY_COLOURS.bottom, "Light from the bottom of the object"],
                      ] as const
                    ).map(([c, t]) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_oklab,var(--v-card)_85%,transparent)] px-2.5 py-1"
                      >
                        <span className="h-0.5 w-5 rounded" style={{ background: c }} aria-hidden />
                        {t}
                      </span>
                    ))}
                    <span className="rounded-full bg-[color-mix(in_oklab,var(--v-card)_85%,transparent)] px-2.5 py-1 text-[var(--v-ink-2)]">
                      Object: {fmtDistance(distance)} (rays shortened to fit)
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 sm:pointer-events-none sm:absolute sm:inset-x-0 sm:bottom-0">
                {current ? (
                  <div className="max-w-[340px] rounded-3xl bg-[color-mix(in_oklab,var(--v-card)_90%,transparent)] p-4 shadow-[0_8px_30px_rgba(22,21,29,0.08)] backdrop-blur sm:pointer-events-auto">
                    <p className="text-[11px] text-[var(--v-ink-3)]">
                      Step {current.n} of {STEPS.length}
                    </p>
                    <p className="text-[17px] font-medium leading-tight">{current.title}</p>
                    <p className="mt-1 text-[13px] text-[var(--v-ink-2)]">{current.text}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => setStep(Math.max(1, current.n - 1))}
                        disabled={current.n === 1}
                        aria-label="Previous step"
                        className="grid h-8 w-8 place-items-center rounded-full border border-[var(--v-line)] disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setStep(current.n < STEPS.length ? current.n + 1 : null)}
                        className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--v-ink)] px-3 text-[12px] text-[var(--v-on-ink)]"
                      >
                        {current.n < STEPS.length ? "Next" : "Explore freely"}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setStep(1)}
                    className="rounded-full bg-[color-mix(in_oklab,var(--v-card)_90%,transparent)] px-4 py-2 text-[12px] shadow-[0_8px_30px_rgba(22,21,29,0.08)] sm:pointer-events-auto"
                  >
                    Start the guided tour
                  </button>
                )}
                <p className="ml-auto max-w-[260px] rounded-2xl bg-[color-mix(in_oklab,var(--v-card)_85%,transparent)] px-3 py-2 text-[11px] text-[var(--v-ink-2)] sm:pointer-events-auto">
                  <Info className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />A model eye (Le
                  Grand schematic eye): a population average, not anyone's eye. Optics to scale;
                  other tissues drawn approximately.
                </p>
              </div>
            </div>
          </Card>

          {/* ------------------------------------------------ right */}
          <div className="order-3 flex flex-col gap-3 lg:order-none">
            <Card>
              {part ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-[var(--v-ink-3)]">
                        {selected ? "You selected" : "In this step"}
                      </p>
                      <h2 className="text-[19px] font-medium leading-tight">{part.name}</h2>
                    </div>
                    <EvidenceTag kind="reference" label="Textbook anatomy" />
                  </div>
                  <p className="mt-2 text-[13px]">{part.what}</p>
                  {part.rpe65 && (
                    <p className="mt-2 rounded-2xl bg-[var(--v-accent-soft)] p-3 text-[13px] text-[var(--v-ink)]">
                      <span className="font-medium">RPE65: </span>
                      {part.rpe65}
                    </p>
                  )}
                  <details className="mt-2 text-[12px] text-[var(--v-ink-2)]">
                    <summary className="cursor-pointer text-[var(--v-ink)]">
                      Technical detail
                    </summary>
                    <p className="mt-1">{part.technical}</p>
                  </details>
                </>
              ) : (
                <p className="text-[13px] text-[var(--v-ink-2)]">
                  Click any part of the eye, or a label, to learn what it does.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-1">
                {PARTS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => select(p.key)}
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      highlight.includes(p.key)
                        ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]"
                        : "bg-[var(--v-soft)]"
                    }`}
                  >
                    {p.name.split(" (")[0]}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-[var(--v-ink-3)]">Try it</p>
                  <h2 className="text-[19px] font-medium">Change what the eye sees</h2>
                </div>
              </div>

              <Control
                label="How far away is the object?"
                value={fmtDistance(distance)}
                hint="Closer objects need the lens to work harder."
              >
                <input
                  type="range"
                  min={0}
                  max={DISTANCES.length - 1}
                  value={distIdx}
                  onChange={(e) => {
                    setPlay(null);
                    setDistIdx(+e.target.value);
                  }}
                  className="w-full accent-[var(--v-accent)]"
                  aria-label="Object distance"
                />
              </Control>

              <Control
                label="How bright is it?"
                value={fmtLight(cdm2)}
                hint="The pupil closes in bright light and opens in the dark, after a short delay."
              >
                <input
                  type="range"
                  min={-3}
                  max={4.5}
                  step={0.05}
                  value={frame ? Math.log10(frame.cdm2) : lightLog}
                  onChange={(e) => {
                    setPlay(null);
                    setLightLog(+e.target.value);
                  }}
                  className="w-full accent-[var(--v-accent)]"
                  aria-label="Scene luminance"
                />
              </Control>

              <Control
                label="Focusing"
                value={
                  auto
                    ? `automatic · ${Math.round(live.acc * 100)}% effort`
                    : `${Math.round(manual * 100)}% effort`
                }
                hint={
                  auto
                    ? "The eye refocuses itself, as yours does, a fraction of a second late."
                    : "You control the lens."
                }
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (auto) setManual(result.accommodation);
                      setAuto(!auto);
                    }}
                    aria-pressed={auto}
                    className={`shrink-0 rounded-full px-3 py-1 text-[12px] ${auto ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]" : "bg-[var(--v-soft)]"}`}
                  >
                    Auto
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={auto ? result.accommodation : manual}
                    disabled={auto}
                    onChange={(e) => setManual(+e.target.value)}
                    className="w-full accent-[var(--v-accent)] disabled:opacity-50"
                    aria-label="Focusing effort"
                  />
                </div>
              </Control>

              <Control
                label="Pupil size"
                value={`${(autoPupil ? live.pupil : pupil).toFixed(1)} mm${autoPupil ? " · automatic" : ""}`}
                hint={
                  autoPupil
                    ? "Set by the light, as yours is (the pupil light reflex)."
                    : "Small in bright light, large in the dark."
                }
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (autoPupil) setPupil(Math.round(live.pupil * 2) / 2);
                      setAutoPupil(!autoPupil);
                    }}
                    aria-pressed={autoPupil}
                    className={`shrink-0 rounded-full px-3 py-1 text-[12px] ${autoPupil ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]" : "bg-[var(--v-soft)]"}`}
                  >
                    Auto
                  </button>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    step={0.5}
                    value={autoPupil ? live.pupil : pupil}
                    disabled={autoPupil}
                    onChange={(e) => setPupil(+e.target.value)}
                    className="w-full accent-[var(--v-accent)] disabled:opacity-50"
                    aria-label="Pupil diameter"
                  />
                </div>
              </Control>

              <Control
                label="Eye length"
                value={`${length.toFixed(1)} mm`}
                hint={
                  Math.abs(lengthDiff) < 0.05
                    ? "The model's typical length: distant things focus on the retina."
                    : lengthDiff > 0
                      ? "Longer than typical: distant things focus in front of the retina, as in short sight."
                      : "Shorter than typical: the lens must work even for distant things, as in long sight."
                }
              >
                <input
                  type="range"
                  min={22.2}
                  max={26.2}
                  step={0.1}
                  value={length}
                  onChange={(e) => setLength(+e.target.value)}
                  className="w-full accent-[var(--v-accent)]"
                  aria-label="Axial length"
                />
                <div className="mt-1 flex gap-1 text-[11px]">
                  {(
                    [
                      ["Long sight", EMMETROPIC_LENGTH - 1],
                      ["Typical", EMMETROPIC_LENGTH],
                      ["Short sight", EMMETROPIC_LENGTH + 1],
                    ] as const
                  ).map(([t, v]) => (
                    <button
                      key={t}
                      onClick={() => setLength(v)}
                      className={`rounded-full px-2 py-0.5 ${Math.abs(length - v) < 0.05 ? "bg-[var(--v-ink)] text-[var(--v-on-ink)]" : "bg-[var(--v-soft)]"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Control>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--v-ink-2)]">What happens</p>
                <EvidenceTag kind="computed" label="Calculated live" />
              </div>
              <div
                className={`mt-2 rounded-2xl p-3 text-[13px] ${sharp ? "bg-[color:var(--kv-e3f4f1)]" : "bg-[color:var(--kv-fbf0dc)]"}`}
                aria-live="polite"
              >
                <p className="font-medium">
                  {sharp
                    ? "Sharp: the image lands on the retina."
                    : offset < 0
                      ? `Blurry: the image forms ${Math.abs(offset).toFixed(2)} mm in front of the retina.`
                      : `Blurry: the image would form ${offset.toFixed(2)} mm behind the retina.`}
                </p>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <Readout
                  label="Blur spot on retina"
                  value={result.rmsBlurUm !== null ? `${result.rmsBlurUm.toFixed(1)} µm` : "—"}
                />
                <Readout
                  label="Out of focus by"
                  value={`${Math.abs(result.focusErrorD).toFixed(2)} D`}
                />
                <Readout
                  label="Lens effort used"
                  value={`${(result.powerD - RELAXED_POWER).toFixed(1)} D (${Math.round(result.accommodation * 100)}%)`}
                />
                <Readout
                  label="Light reaching the retina"
                  value={`${Math.round(trolands(cdm2, live.pupil)).toLocaleString()} td`}
                />
                <Readout label="Eye state" value={adapting ? "Adapting…" : "Settled"} />
                <Readout
                  label="Sharp range"
                  value={`${fmtDistance(result.nearPointMm)} – ${fmtDistance(result.farPointMm)}`}
                />
              </dl>
            </Card>
          </div>
        </div>

        {/* ------------------------------------------------ motion */}
        <Card id="motion" className="mt-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[19px] font-medium">The eye in motion</h2>
                <EvidenceTag kind="computed" label="Calculated live" />
                <EvidenceTag kind="hypothetical" label="Timing illustrative" />
              </div>
              <p className="max-w-3xl text-xs text-[var(--v-ink-3)]">
                Play a moment from daily life. The pupil reacts to light and the lens to distance,
                each after a short delay, and the 3D eye, the light paths and the picture on the
                retina follow. Pupil size for each light level: Moon &amp; Spencer (1944).
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="flex flex-col gap-2">
              {SCENARIOS.map((sc) => {
                const on = play?.s.key === sc.key;
                return (
                  <button
                    key={sc.key}
                    onClick={() => {
                      if (on) return setPlay(null);
                      setPlayT(0);
                      setPlay({ s: sc, t0: performance.now() });
                      setAuto(true);
                      setAutoPupil(true);
                      document.getElementById("eye")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${
                      on
                        ? "bg-[var(--v-accent)] text-white"
                        : "bg-[var(--v-soft)] hover:bg-[var(--v-card)]"
                    }`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${on ? "bg-[var(--v-card)] text-[var(--v-accent-ink)]" : "bg-[var(--v-card)]"}`}
                    >
                      {on ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium">{sc.title}</span>
                      <span
                        className={`block text-[11px] ${on ? "text-white/80" : "text-[var(--v-ink-3)]"}`}
                      >
                        {on
                          ? `${playT.toFixed(1)} s of ${scenarioLength(sc)} s · ${frame?.note ?? ""}`
                          : sc.what}
                      </span>
                    </span>
                  </button>
                );
              })}
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--v-ink-3)]">
                <Sun className="h-3 w-3" aria-hidden />
                Or move the brightness and distance sliders and watch the trace.
              </p>
            </div>
            <div>
              <LiveTrace trace={trace} />
              <details className="mt-2 text-[12px] text-[var(--v-ink-2)]">
                <summary className="cursor-pointer text-[var(--v-ink)]">Timing assumptions</summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {Object.entries(DYNAMICS).map(([k, d]) => (
                    <li key={k}>
                      <span className="font-mono">
                        {d.value} {d.unit}
                      </span>{" "}
                      · {d.what}
                    </li>
                  ))}
                  <li>
                    Typical magnitudes chosen for a plausible shape, not fitted to data; real eyes
                    vary with age and person.
                  </li>
                </ul>
              </details>
            </div>
          </div>
        </Card>

        {/* ------------------------------------------------ retina + cycle */}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card id="retina">
            <h2 className="text-[19px] font-medium">What lands on the retina</h2>
            <p className="mb-3 text-xs text-[var(--v-ink-3)]">
              The picture the eye's optics project onto the retina, using the settings above. Change
              the eye length or pupil and watch it blur.
            </p>
            <RetinalImage result={result} />
          </Card>
          <Card id="cycle">
            <h2 className="text-[19px] font-medium">Where RPE65 works</h2>
            <p className="mb-3 text-xs text-[var(--v-ink-3)]">
              Rods and cones use a light-catching molecule once, then the RPE layer resets it. This
              loop is the visual cycle.
            </p>
            <VisualCycle />
          </Card>
        </div>

        {/* ------------------------------------------------ concept */}
        <section
          id="concept"
          className="mt-3 scroll-mt-4 rounded-[28px] border-2 border-dashed border-[color:var(--kv-e7a3c2)] bg-[color:var(--kv-fff8fb)] p-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[color:var(--kv-b0306a)] px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-white">
              CONCEPT
            </span>
            <h2 className="text-[19px] font-medium">
              Enhanced vision: seeing beyond visible light
            </h2>
          </div>
          <p className="mb-3 mt-1 text-xs text-[var(--v-ink-3)]">
            The MetaHuman-style concept, rendered in the browser. Kept apart from the science above
            on purpose.
          </p>
          <ConceptVision />
        </section>

        {/* ------------------------------------------------ about */}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card id="about">
            <h2 className="text-[19px] font-medium">About this model</h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-4 text-[13px] text-[var(--v-ink-2)]">
              <li>
                The optics are the Le Grand schematic eye: four spherical surfaces with fixed
                refractive indices, reproducing its published power (59.94 D) and focus. Light paths
                are traced exactly with Snell's law.
              </li>
              <li>
                Assumptions added here: focusing is a straight blend between the model's relaxed and
                focused lens; the retina is a 12 mm sphere; eye length changes move only the retina.
              </li>
              <li>
                Real eyes have aspheric surfaces, a lens with varying refractive index, colour
                fringing, scatter and tilt. This model has none of those, so it overstates blur from
                a large pupil.
              </li>
              <li>
                Pupil size for a light level follows Moon &amp; Spencer's formula (via Watson &amp;
                Yellott 2012); it ignores age and field size. The delays and speeds of the pupil and
                lens are illustrative.
              </li>
              <li>
                The retinal picture is an optical image. It is not what a person sees, and not a
                measurement of anyone's vision.
              </li>
              <li>
                The RPE65 loop illustrates a published mechanism. It does not simulate disease
                progression or how much treatment helps.
              </li>
              <li>
                Research software. Not a medical device, not FDA-cleared or approved, not clinically
                validated.
              </li>
            </ul>
          </Card>
          <Card>
            <div className="flex items-center gap-2">
              <h2 className="text-[19px] font-medium">References</h2>
              <Sparkles className="h-4 w-4 text-[var(--v-ink-3)]" aria-hidden />
            </div>
            <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-4 text-[12px] text-[var(--v-ink-2)]">
              {CITATIONS.map((c) => (
                <li key={c.id}>{c.text}</li>
              ))}
            </ol>
            <p className="mt-3 rounded-2xl bg-[color:var(--kv-fbf0dc)] p-3 text-[11px] text-[var(--v-ink)]">
              {CITATION_NOTE}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Control({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-[12px] tabular-nums text-[var(--v-accent-ink)]">{value}</p>
      </div>
      <div className="mt-1.5">{children}</div>
      <p className="mt-1 text-[11px] text-[var(--v-ink-3)]">{hint}</p>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--v-soft)] p-2.5">
      <dt className="text-[11px] text-[var(--v-ink-3)]">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  );
}
