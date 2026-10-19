import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  Image as ImageIcon,
  Info,
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
import { EMMETROPIC_LENGTH, LE_GRAND_RELAXED, power, simulateEye } from "@/lib/vision/optics";
import { EyeModel3D } from "./EyeModel3D";
import { RetinalImage } from "./RetinalImage";
import { VisualCycle } from "./VisualCycle";
import { Card, EvidenceTag, VisionPages } from "./ui";

const DISTANCES = [Infinity, 6000, 2000, 1000, 500, 330, 250, 200, 150, 120, 100];
const RELAXED_POWER = power(LE_GRAND_RELAXED);

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

  const distance = DISTANCES[distIdx]!;
  const result = useMemo(
    () =>
      simulateEye({
        distance,
        pupilDiameter: pupil,
        axialLength: length,
        accommodation: auto ? "auto" : manual,
      }),
    [distance, pupil, length, auto, manual],
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
      <div className="mx-auto max-w-[1440px] rounded-[36px] bg-[var(--v-frame)] p-2.5 ring-1 ring-white/80 backdrop-blur sm:p-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[250px_minmax(0,1fr)_330px]">
          {/* ------------------------------------------------ left */}
          <div className="order-2 flex flex-col gap-3 lg:order-none">
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[15px] font-semibold tracking-[0.18em]">COGNIVANCE</p>
                  <p className="text-xs text-[var(--v-ink-3)]">Vision · eye simulation</p>
                </div>
                <Link
                  to="/"
                  aria-label="Back to Cognivance"
                  className="grid h-10 w-10 place-items-center rounded-full bg-[var(--v-ink)] text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </div>
              <VisionPages active="eye" />
              <nav className="mt-4 flex flex-col gap-1 text-sm" aria-label="Sections">
                {[
                  { href: "#eye", label: "The living eye", icon: Eye, active: true },
                  { href: "#retina", label: "Image on the retina", icon: ImageIcon },
                  { href: "#cycle", label: "Where RPE65 works", icon: RefreshCcw },
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
                            ? "bg-white text-[var(--v-accent-ink)]"
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
            className="relative order-1 flex min-h-[620px] flex-col overflow-hidden !p-0 lg:order-none"
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
                        className="inline-flex items-center gap-2 rounded-full bg-white/85 px-2.5 py-1"
                      >
                        <span className="h-0.5 w-5 rounded" style={{ background: c }} aria-hidden />
                        {t}
                      </span>
                    ))}
                    <span className="rounded-full bg-white/85 px-2.5 py-1 text-[var(--v-ink-2)]">
                      Object: {fmtDistance(distance)} (rays shortened to fit)
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 sm:pointer-events-none sm:absolute sm:inset-x-0 sm:bottom-0">
                {current ? (
                  <div className="max-w-[340px] rounded-3xl bg-white/90 p-4 shadow-[0_8px_30px_rgba(22,21,29,0.08)] backdrop-blur sm:pointer-events-auto">
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
                        className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--v-ink)] px-3 text-[12px] text-white"
                      >
                        {current.n < STEPS.length ? "Next" : "Explore freely"}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setStep(1)}
                    className="rounded-full bg-white/90 px-4 py-2 text-[12px] shadow-[0_8px_30px_rgba(22,21,29,0.08)] sm:pointer-events-auto"
                  >
                    Start the guided tour
                  </button>
                )}
                <p className="ml-auto max-w-[260px] rounded-2xl bg-white/85 px-3 py-2 text-[11px] text-[var(--v-ink-2)] sm:pointer-events-auto">
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
                        ? "bg-[var(--v-ink)] text-white"
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
                  onChange={(e) => setDistIdx(+e.target.value)}
                  className="w-full accent-[var(--v-accent)]"
                  aria-label="Object distance"
                />
              </Control>

              <Control
                label="Focusing"
                value={auto ? "automatic" : `${Math.round(manual * 100)}% effort`}
                hint={auto ? "The eye focuses itself, as yours does." : "You control the lens."}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (auto) setManual(result.accommodation);
                      setAuto(!auto);
                    }}
                    aria-pressed={auto}
                    className={`shrink-0 rounded-full px-3 py-1 text-[12px] ${auto ? "bg-[var(--v-ink)] text-white" : "bg-[var(--v-soft)]"}`}
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
                value={`${pupil.toFixed(1)} mm`}
                hint="Small in bright light, large in the dark."
              >
                <input
                  type="range"
                  min={2}
                  max={8}
                  step={0.5}
                  value={pupil}
                  onChange={(e) => setPupil(+e.target.value)}
                  className="w-full accent-[var(--v-accent)]"
                  aria-label="Pupil diameter"
                />
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
                      className={`rounded-full px-2 py-0.5 ${Math.abs(length - v) < 0.05 ? "bg-[var(--v-ink)] text-white" : "bg-[var(--v-soft)]"}`}
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
                className={`mt-2 rounded-2xl p-3 text-[13px] ${sharp ? "bg-[#e3f4f1]" : "bg-[#fbf0dc]"}`}
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
                  label="Sharp range"
                  value={`${fmtDistance(result.nearPointMm)} – ${fmtDistance(result.farPointMm)}`}
                />
              </dl>
            </Card>
          </div>
        </div>

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
            <p className="mt-3 rounded-2xl bg-[#fbf0dc] p-3 text-[11px] text-[var(--v-ink)]">
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
