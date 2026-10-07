import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Box,
  Brain,
  Cpu,
  Eye,
  EyeOff,
  Gauge,
  Layers,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Waves,
} from "lucide-react";
import { DEFAULT_ARRAY, type ArrayDesign } from "@/lib/sim/acoustics";
import {
  loadAnatomy,
  placeArray,
  targetPoint,
  type Anatomy,
  type Placement,
} from "@/lib/sim/anatomy";
import { autoConnect, FULL_TOPOLOGY, type Circuit } from "@/lib/sim/autoconnect";
import type { CohortResult } from "@/lib/sim/benchmark";
import type { BenchRequest } from "@/lib/sim/bench.worker";
import { autoDesign } from "@/lib/sim/design";
import { DISEASES, diseaseByKey, type DiseaseKey } from "@/lib/sim/diseases";
import { CircuitSim, computeBeams, deliverable, type LoopEvent, type Stage } from "@/lib/sim/loop";
import { plasticityIndex, REGION_INDEX, REGIONS, type RegionKey } from "@/lib/sim/neural";
import { GATED_REGIONS, regionDepth, type RegionDepth } from "@/lib/sim/regions";
import { COMPONENTS } from "@/lib/sim/specs";
import {
  BeamPanel,
  BenchmarkPanel,
  DepthPanel,
  DesignPanel,
  LatencyPanel,
  LibraryPanel,
  NetlistPanel,
  PipelineStrip,
  PrismPanel,
  ScopePanel,
} from "./panels";
import { SimScene, type View } from "./scene";

type Mode = "assemble" | "loop" | "benchmark";
type Phase = "loading" | "assembling" | "ready" | "error";

/** Visual share of one loop period given to each stage. */
const STAGE_SPANS: [Stage, number][] = [
  ["SENSE", 0.25],
  ["PREDICT", 0.17],
  ["VERIFY", 0.16],
  ["WRITE", 0.3],
  ["MEASURE", 0.12],
];

function stageAt(f: number): { stage: Stage; phase: number; index: number } {
  let acc = 0;
  for (let i = 0; i < STAGE_SPANS.length; i++) {
    const [s, w] = STAGE_SPANS[i]!;
    if (f < acc + w) return { stage: s, phase: (f - acc) / w, index: i };
    acc += w;
  }
  return { stage: "MEASURE", phase: 1, index: STAGE_SPANS.length - 1 };
}

const SPEEDS = [
  { id: "slow", label: "Slow-mo", sub: "1 loop / 2.4 s", factor: 30 / 2400 },
  { id: "medium", label: "×1/10", sub: "3 loops / s", factor: 0.1 },
  { id: "real", label: "Real time", sub: "33 loops / s", factor: 1 },
] as const;
type SpeedId = (typeof SPEEDS)[number]["id"];

const VIEWS: { id: View; label: string; icon: typeof Eye }[] = [
  { id: "cinematic", label: "Cinematic", icon: Brain },
  { id: "implant", label: "Implant", icon: Cpu },
  { id: "explode", label: "Explode", icon: Layers },
  { id: "section", label: "Section", icon: ScanLine },
  { id: "beam", label: "Beam", icon: Waves },
];

const SEVERITY = 0.8;
const SEED = 7;

type Hud = {
  ev: LoopEvent | null;
  stage: Stage | null;
  endpoints: number[];
  loops: number;
  verified: number;
  halts: number;
  modelS: number;
};

const EMPTY_HUD: Hud = {
  ev: null,
  stage: null,
  endpoints: [],
  loops: 0,
  verified: 0,
  halts: 0,
  modelS: 0,
};

export function SimulationWindow() {
  const navigate = useNavigate();
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SimScene | null>(null);
  const simRef = useRef<CircuitSim | null>(null);
  /** The circuit and array design the 3D implant currently shows. */
  const built = useRef<{ circuit: Circuit; design: ArrayDesign } | null>(null);

  const [anatomy, setAnatomy] = useState<Anatomy | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("assemble");
  const [view, setView] = useState<View>("cinematic");
  const [labels, setLabels] = useState(true);
  const [diseaseKey, setDiseaseKey] = useState<DiseaseKey>("autism");
  const [designs, setDesigns] = useState<Partial<Record<DiseaseKey, ArrayDesign>>>({});
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(FULL_TOPOLOGY.components));
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState<SpeedId>("slow");
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [autoProgress, setAutoProgress] = useState<number | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [assemblyKey, setAssemblyKey] = useState(0);

  const [benchResults, setBenchResults] = useState<Partial<Record<string, CohortResult>>>({});
  const [benchProgress, setBenchProgress] = useState<{
    disease: string;
    done: number;
    total: number;
  } | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [patients, setPatients] = useState(10);
  const [benchAuto, setBenchAuto] = useState(true);

  const disease = diseaseByKey(diseaseKey);
  const design = designs[diseaseKey] ?? DEFAULT_ARRAY;

  const signOut = () => {
    localStorage.removeItem("cognivance_session");
    navigate({ to: "/auth" });
  };

  /* --------------------------------------------------------- derived */

  const placementsFor = useCallback(
    (targets: RegionKey[]): { region: RegionKey; placement: Placement }[] => {
      if (!anatomy) return [];
      const outer = anatomy.meshes.get("outer");
      if (!outer) return [];
      return targets.map((t) => {
        const mesh = anatomy.meshes.get(t);
        return {
          region: t,
          placement: placeArray(outer, mesh ? targetPoint(mesh, "left") : [0, 0, 0]),
        };
      });
    },
    [anatomy],
  );

  const placements = useMemo(() => placementsFor(disease.targets), [placementsFor, disease]);
  const beams = useMemo(
    () => (placements.length ? computeBeams(design, placements, { keepPlane: true }) : []),
    [design, placements],
  );
  const circuit = useMemo(() => autoConnect({ components: [...enabled] }), [enabled]);
  const fullCircuit = useMemo(() => autoConnect(FULL_TOPOLOGY), []);
  const blocked = circuit.drc.filter((d) => d.severity === "error");
  const unreachable = beams.filter((b) => !deliverable(b));
  const regionName = (k: string) => anatomy?.meshes.get(k)?.name ?? k;
  const gatedDepths = useMemo(
    () =>
      anatomy
        ? GATED_REGIONS.map((k) => regionDepth(anatomy, k)).filter(
            (d): d is RegionDepth => d !== null,
          )
        : [],
    [anatomy],
  );

  /* ------------------------------------------------------- lifecycle */

  useEffect(() => {
    const host = hostRef.current;
    const lab = labelsRef.current;
    if (!host || !lab) return;
    let scene: SimScene;
    try {
      scene = new SimScene(host, lab);
    } catch (e) {
      setError(e instanceof Error ? e.message : "WebGL is unavailable in this browser.");
      setPhase("error");
      return;
    }
    sceneRef.current = scene;
    let cancelled = false;
    loadAnatomy()
      .then((an) => {
        if (cancelled) return;
        scene.setAnatomy(an);
        setAnatomy(an);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
    return () => {
      cancelled = true;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Build and assemble the implant whenever the programme changes (or on request).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !anatomy || !placements.length) return;
    let cancelled = false;
    simRef.current = null;
    setHud(EMPTY_HUD);
    setPhase("assembling");
    setRevealed(new Set());
    scene.setBeams([]);
    scene.setTargets(disease.targets);
    const c = circuit;
    built.current = { circuit, design };
    scene.buildImplant(placements[0]!.placement, c.assemblyOrder, design);
    for (const comp of c.components) scene.setPartLabel(comp.id, comp.part);
    scene.setView("implant");
    setView("implant");
    void scene
      .assemble(c.assemblyOrder, c.nets, (_id, done) => {
        if (cancelled) return;
        setRevealed((prev) => {
          const next = new Set(prev);
          for (const n of done) next.add(n.id);
          return next;
        });
      })
      .then(() => {
        if (cancelled) return;
        setPhase("ready");
        setMode((m) => (m === "assemble" ? "loop" : m));
      });
    return () => {
      cancelled = true;
    };
    // Re-assemble only on programme change or an explicit request; design and
    // topology edits are applied in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anatomy, diseaseKey, assemblyKey]);

  // Topology or design edits after assembly: rebuild in place, no animation.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || phase !== "ready" || !placements.length) return;
    if (built.current?.circuit === circuit && built.current.design === design) return;
    built.current = { circuit, design };
    scene.buildImplant(placements[0]!.placement, circuit.assemblyOrder, design);
    for (const comp of circuit.components) scene.setPartLabel(comp.id, comp.part);
    scene.placeAll(circuit.nets);
    setRevealed(new Set(circuit.nets.map((n) => n.id)));
  }, [circuit, design, phase, placements]);

  // Beams and the closed-loop simulator follow the design and the circuit.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || phase !== "ready") return;
    scene.setBeams(
      beams.map((b) => ({
        region: b.region,
        placement: b.placement,
        plane: b.plane ?? null,
        lateralFwhmMm: b.metrics.lateralFwhmMm,
        apertureMm: b.metrics.apertureMm,
        reachable: deliverable(b),
        design,
      })),
    );
    if (!circuit.ok) {
      simRef.current = null;
      setHud(EMPTY_HUD);
      return;
    }
    simRef.current = new CircuitSim({
      disease,
      severity: SEVERITY,
      design,
      beams,
      seed: SEED,
      dutyLimit: circuit.power.dutyLimit,
      gated: true,
    });
    setHud(EMPTY_HUD);
  }, [beams, circuit, design, disease, phase]);

  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view]);
  useEffect(() => {
    sceneRef.current?.setLabelsVisible(labels);
  }, [labels]);

  /* ---------------------------------------------------- loop driver */

  const runningRef = useRef(running);
  runningRef.current = running && mode !== "assemble";
  const speedRef = useRef<number>(SPEEDS[0].factor);
  speedRef.current = SPEEDS.find((s) => s.id === speed)!.factor;
  const nanobotsOn = enabled.has("nanobots") && Boolean(disease.payload);
  const nanobotsRef = useRef(nanobotsOn);
  nanobotsRef.current = nanobotsOn;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let t = 0; // model ms into the current period
    let ev: LoopEvent | null = null;
    let prev: LoopEvent | null = null;
    let lastHud = 0;
    const endpoints: number[] = [];
    let loops = 0;
    let verified = 0;
    let halts = 0;
    let owner: CircuitSim | null = null;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - last);
      last = now;
      const sim = simRef.current;
      const scene = sceneRef.current;
      if (!scene) return;
      if (sim !== owner) {
        owner = sim;
        ev = prev = null;
        t = 0;
        endpoints.length = 0;
        loops = verified = halts = 0;
      }
      if (!sim) {
        scene.setLoop({
          stage: null,
          phase: 0,
          verified: null,
          halted: false,
          delivered: [],
          activity: {},
          plasticity: {},
          payload: false,
        });
        return;
      }
      const period = sim.period;
      if (runningRef.current) {
        t += dt * speedRef.current;
        let guard = 0;
        while ((ev === null || t >= period) && guard++ < 8) {
          if (ev) t -= period;
          prev = ev;
          ev = sim.iterate();
          loops++;
          if (ev.halted) halts++;
          else if (ev.delivered.length) verified++;
          // The endpoint needs a full 1.5 s measurement window after the 0.5 s settle.
          if (ev.tS >= 2) {
            endpoints.push(ev.endpoint);
            if (endpoints.length > 400) endpoints.shift();
          }
        }
        if (t >= period) t = 0; // fell behind: drop frames rather than spiral
      }
      if (!ev) return;
      const { stage, phase: p, index } = stageAt(t / period);
      const pastGate = index >= 3;
      const atGate = index === 2;
      const shown = pastGate || atGate ? ev : prev;
      const activity: Record<string, number> = {};
      const plasticity: Record<string, number> = {};
      for (const r of REGIONS) {
        const i = REGION_INDEX[r.key];
        activity[r.key] = Math.max(0, Math.min(1, Math.sqrt(sim.rec.power(i, 200)) / 0.5));
        plasticity[r.key] = plasticityIndex(sim.net, i);
      }
      scene.setLoop({
        stage,
        phase: p,
        verified: atGate && p < 0.5 ? null : shown ? !shown.halted : null,
        halted: Boolean(shown?.halted) && (pastGate || (atGate && p >= 0.5)),
        delivered: stage === "WRITE" ? ev.delivered.map((d) => d.region) : [],
        activity,
        plasticity,
        payload: stage === "WRITE" && ev.delivered.length > 0 && nanobotsRef.current,
      });
      if (now - lastHud > 120) {
        lastHud = now;
        setHud({
          ev: shown,
          stage,
          endpoints: endpoints.slice(),
          loops,
          verified,
          halts,
          modelS: ev.tS,
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ------------------------------------------------------- actions */

  const runAutoDesign = async () => {
    setAutoProgress(0);
    setAutoNote(null);
    const best = await autoDesign(placements, (p) => setAutoProgress(p));
    setAutoProgress(null);
    if (!best) {
      setAutoNote(
        "No design in the search space reaches every target of this programme within PRISM's off-target rule. The doc spec stays selected; PRISM will halt write-back to the unreachable targets.",
      );
      return;
    }
    setDesigns((d) => ({ ...d, [diseaseKey]: best.design }));
    const f = best.design.frequencyHz / 1e6;
    setAutoNote(
      f === 15
        ? "The doc spec (15 MHz) already reaches every target — kept."
        : `Auto-design moved the array to ${f} MHz (pitch ${(best.design.pitchM * 1000).toFixed(2)} mm): at 15 MHz the brain absorbs ≈ 9 dB/cm and the focus at this depth falls below the near-field pressure. Every other spec is unchanged.`,
    );
  };

  const toggle = (id: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBench = async (keys: string[]) => {
    setBenchRunning(true);
    try {
      for (const key of keys) {
        const d = diseaseByKey(key as DiseaseKey);
        const pl = placementsFor(d.targets);
        let des = designs[d.key] ?? DEFAULT_ARRAY;
        if (benchAuto && !designs[d.key]) {
          setBenchProgress({ disease: `${d.name} · auto-design`, done: 0, total: 1 });
          const best = await autoDesign(pl);
          if (best) des = best.design;
        }
        const result = await new Promise<CohortResult>((resolve, reject) => {
          const w = new Worker(new URL("../../lib/sim/bench.worker.ts", import.meta.url), {
            type: "module",
          });
          w.onmessage = (e: MessageEvent) => {
            const m = e.data as
              | { type: "progress"; done: number; total: number }
              | { type: "result"; result: CohortResult }
              | { type: "error"; message: string };
            if (m.type === "progress")
              setBenchProgress({ disease: d.name, done: m.done, total: m.total });
            else if (m.type === "result") {
              w.terminate();
              resolve(m.result);
            } else {
              w.terminate();
              reject(new Error(m.message));
            }
          };
          w.onerror = (e) => {
            w.terminate();
            reject(new Error(e.message));
          };
          const req: BenchRequest = {
            disease: d.key,
            design: des,
            placements: pl,
            dutyLimit: fullCircuit.power.dutyLimit,
            patients,
            loops: 120,
          };
          w.postMessage(req);
        });
        setBenchResults((r) => ({ ...r, [key]: result }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBenchRunning(false);
      setBenchProgress(null);
    }
  };

  const recorder = useCallback(() => simRef.current?.rec ?? null, []);

  const ev = hud.ev;
  const isSpec =
    design.frequencyHz === DEFAULT_ARRAY.frequencyHz && design.pitchM === DEFAULT_ARRAY.pitchM;

  /* --------------------------------------------------------- render */

  return (
    <div className="sim-window relative min-h-screen bg-[#01040d] text-[#e6efff]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(48,94,190,0.16),transparent_60%)]" />

      {/* Header */}
      <header className="relative z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#16305e] bg-[#020818]/90 px-4 py-2.5 backdrop-blur">
        <Link
          to="/research"
          className="flex items-center gap-1.5 text-[0.72rem] text-[#8095bf] hover:text-[#e6efff]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Research OS
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-[#7fd8ff]/40 bg-[#0b2a5c] shadow-[0_0_16px_rgba(127,216,255,0.35)]">
            <Box className="h-4 w-4 text-[#7fd8ff]" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[0.95rem] font-semibold tracking-[-0.01em]">
              CIRCUIT Simulation Window
            </h1>
            <p className="truncate font-mono text-[0.56rem] uppercase tracking-[0.16em] text-[#8095bf]">
              NIMBLE · Synapse Atlas · PRISM · ECHO — closed-loop implant, in silico
            </p>
          </div>
        </div>
        <nav
          className="flex rounded-lg border border-[#16305e] bg-[#030b20] p-0.5"
          aria-label="Mode"
        >
          {(
            [
              ["assemble", "A · Assemble"],
              ["loop", "B · Closed loop"],
              ["benchmark", "C · Benchmark"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                if (m === "assemble") setView("explode");
                else if (m === "loop") setView("beam");
              }}
              className={`rounded-md px-2.5 py-1 text-[0.7rem] transition ${
                mode === m
                  ? "bg-[#0b2a5c] text-[#e6f7ff] shadow-[inset_0_0_0_1px_rgba(127,216,255,0.45)]"
                  : "text-[#8095bf] hover:text-[#e6efff]"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-md border border-[#16305e] px-2.5 py-1.5 text-[0.72rem] text-[#8095bf] transition hover:border-[#3d8bf5] hover:text-[#e6efff]"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      {/* Programme picker */}
      <div className="relative z-10 flex gap-1.5 overflow-x-auto border-b border-[#0e2247] bg-[#020818]/70 px-4 py-2">
        {DISEASES.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => {
              setDiseaseKey(d.key);
              setAutoNote(null);
            }}
            className={`shrink-0 rounded-full border px-3 py-1 text-[0.7rem] transition ${
              d.key === diseaseKey
                ? "border-[#7fd8ff]/70 bg-[#0b2a5c] text-[#e6f7ff]"
                : "border-[#16305e] text-[#8095bf] hover:border-[#3d8bf5] hover:text-[#e6efff]"
            }`}
          >
            {d.name}
            <span className="ml-1.5 font-mono text-[0.56rem] text-[#5e719a]">
              {d.targets.join("+")}
            </span>
          </button>
        ))}
      </div>

      <div className="relative z-10 grid gap-3 p-3 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        {/* Left column */}
        <div className="order-2 flex min-w-0 flex-col gap-3 xl:order-1">
          <LibraryPanel enabled={enabled} onToggle={toggle} locked={phase === "assembling"} />
          <NetlistPanel circuit={circuit} revealed={revealed} />
        </div>

        {/* Viewport */}
        <div className="order-1 flex min-w-0 flex-col gap-3 xl:order-2">
          <div className="relative h-[62vh] min-h-[22rem] overflow-hidden rounded-xl border border-[#16305e] bg-[#01040d] xl:h-[calc(100vh-11.5rem)]">
            <div ref={hostRef} className="absolute inset-0" />
            <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />

            {/* top overlay */}
            <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2 p-3">
              {phase === "ready" && mode !== "assemble" && circuit.ok ? (
                <div className="origin-top scale-[0.66] sm:scale-90 lg:scale-100">
                  <PipelineStrip stage={hud.stage} ev={ev} />
                </div>
              ) : null}
              {phase === "assembling" ? (
                <div className="rounded-full border border-[#7fd8ff]/40 bg-[#01071a]/80 px-3 py-1 font-mono text-[0.62rem] tracking-[0.12em] text-[#7fd8ff] backdrop-blur">
                  AUTO-ASSEMBLY · placing {revealed.size ? "and wiring" : ""}{" "}
                  {circuit.components.length} parts · {revealed.size}/{circuit.nets.length} nets
                </div>
              ) : null}
            </div>

            {/* left overlay: programme + status */}
            <div className="pointer-events-none absolute left-3 top-3 hidden max-w-[15rem] flex-col gap-1 md:flex">
              {mode === "loop" || mode === "benchmark" ? null : (
                <p className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-[#5e719a]">
                  {disease.implant}
                </p>
              )}
            </div>

            {/* blocking states */}
            {phase === "loading" ? (
              <div className="absolute inset-0 grid place-items-center">
                <p className="font-mono text-[0.7rem] tracking-[0.14em] text-[#8095bf]">
                  LOADING MNI152 ANATOMY…
                </p>
              </div>
            ) : null}
            {phase === "error" ? (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <p className="max-w-md text-[0.8rem] text-[#ffb3bc]">{error}</p>
              </div>
            ) : null}
            {phase === "ready" && blocked.length ? (
              <div className="absolute inset-x-3 bottom-16 mx-auto max-w-lg rounded-lg border border-[#ff4b5c]/50 bg-[#2a0710]/85 p-3 backdrop-blur">
                <p className="flex items-center gap-2 text-[0.8rem] font-semibold text-[#ffb3bc]">
                  <ShieldAlert className="h-4 w-4" /> Simulation refused — design-rule errors
                </p>
                <ul className="mt-1 list-disc pl-5 text-[0.7rem] text-[#ffd0d6]">
                  {blocked.map((d) => (
                    <li key={d.message}>
                      <b>{d.rule}</b> {d.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {phase === "ready" && circuit.ok && unreachable.length && mode !== "benchmark" ? (
              <div className="absolute inset-x-3 bottom-16 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-lg border border-[#d9a441]/50 bg-[#1f1505]/85 p-2.5 backdrop-blur">
                <p className="min-w-0 flex-1 text-[0.7rem] text-[#f0d08a]">
                  {isSpec ? "At the spec's 15 MHz, " : "With this design, "}
                  {unreachable.map((b) => regionName(b.region)).join(" and ")}{" "}
                  {unreachable.length > 1 ? "are" : "is"} out of reach: off-target pressure exceeds
                  half the focus. PRISM halts write-back there.
                </p>
                <button
                  type="button"
                  onClick={() => void runAutoDesign()}
                  disabled={autoProgress !== null}
                  className="flex items-center gap-1.5 rounded-md border border-[#7fd8ff]/50 bg-[#0b2a5c] px-2.5 py-1.5 text-[0.7rem] text-[#e6f7ff] disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {autoProgress !== null ? `${Math.round(autoProgress * 100)} %` : "Auto-design"}
                </button>
              </div>
            ) : null}

            {/* bottom toolbar */}
            <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-[#16305e]/70 bg-[#01071a]/80 px-2 py-1.5 backdrop-blur">
              <div className="flex flex-wrap items-center gap-1">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setView(v.id)}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[0.66rem] transition ${
                      view === v.id
                        ? "bg-[#0b2a5c] text-[#e6f7ff]"
                        : "text-[#8095bf] hover:text-[#e6efff]"
                    }`}
                  >
                    <v.icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{v.label}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setLabels((l) => !l)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.66rem] text-[#8095bf] hover:text-[#e6efff]"
                  aria-label={labels ? "Hide labels" : "Show labels"}
                >
                  {labels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setAssemblyKey((k) => k + 1)}
                  disabled={phase !== "ready"}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.66rem] text-[#8095bf] hover:text-[#e6efff] disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Re-assemble</span>
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setRunning((r) => !r);
                    if (mode === "assemble") setMode("loop");
                  }}
                  disabled={phase !== "ready" || !circuit.ok}
                  className="flex items-center gap-1 rounded-md border border-[#16305e] px-2 py-1 text-[0.66rem] text-[#e6efff] disabled:opacity-40"
                >
                  {running && mode !== "assemble" ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {running && mode !== "assemble" ? "Pause" : "Run loop"}
                </button>
                <Gauge className="ml-1 h-3.5 w-3.5 text-[#5e719a]" />
                {SPEEDS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.sub}
                    onClick={() => setSpeed(s.id)}
                    className={`rounded-md px-1.5 py-1 font-mono text-[0.6rem] ${
                      speed === s.id
                        ? "bg-[#0b2a5c] text-[#e6f7ff]"
                        : "text-[#8095bf] hover:text-[#e6efff]"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* loop counters */}
            {phase === "ready" && circuit.ok && mode !== "assemble" ? (
              <div className="pointer-events-none absolute right-3 top-3 hidden flex-col items-end gap-0.5 font-mono text-[0.6rem] text-[#a9bbdc] md:flex">
                <span>t = {hud.modelS.toFixed(2)} s model</span>
                <span>loop #{hud.loops}</span>
                <span className="text-[#9ff0cc]">{hud.verified} verified write-backs</span>
                <span className="text-[#ffb3bc]">{hud.halts} halts</span>
                <span className="text-[#5e719a]">0 unverified · by construction</span>
              </div>
            ) : null}
          </div>

          {mode === "benchmark" ? (
            <BenchmarkPanel
              diseases={DISEASES}
              results={benchResults}
              progress={benchProgress}
              onRun={(k) => void runBench(k)}
              running={benchRunning}
              patients={patients}
              setPatients={setPatients}
              autoDesign={benchAuto}
              setAutoDesign={setBenchAuto}
            />
          ) : (
            <ScopePanel
              recorder={recorder}
              regions={disease.targets.concat(disease.targets.includes("vmpfc") ? [] : ["vmpfc"])}
              endpointHistory={hud.endpoints}
              unit={disease.endpoint.unit}
              label={disease.endpoint.label}
              windowS={hud.modelS ? Math.max(0, Math.min(1.5, hud.modelS - 0.5)) : 0}
            />
          )}
        </div>

        {/* Right column */}
        <div className="order-3 flex min-w-0 flex-col gap-3">
          <PrismPanel ev={ev} />
          <LatencyPanel ev={ev} />
          <DesignPanel
            design={design}
            beams={beams}
            onDesign={(d) => setDesigns((all) => ({ ...all, [diseaseKey]: d }))}
            onAuto={() => void runAutoDesign()}
            autoProgress={autoProgress}
            autoNote={autoNote}
          />
          <BeamPanel beams={beams} ev={ev} />
          <DepthPanel depths={gatedDepths} name={regionName} targets={disease.targets} />
        </div>
      </div>

      {/* Honesty strip */}
      <footer className="relative z-10 border-t border-[#0e2247] bg-[#020818]/80 px-4 py-3 text-[0.64rem] leading-relaxed text-[#8095bf]">
        <p>
          <b className="text-[#c4d2ee]">What this is:</b> a physics- and model-based simulation of
          the CIRCUIT closed loop on MNI152 anatomy. Part values tagged SPEC are design targets from
          the Simulation Window design document, not measurements of built hardware; ASSUMED values
          are literature-typical and say where they come from. Acoustics are a Rayleigh sum over the
          16 × 16 array with tissue attenuation; the brain is a 10-region Stuart–Landau network
          (Deco et al. 2017) with Hebbian plasticity. PRISM is a deterministic rule gate — any
          failing rule halts write-back. The simulation does not predict clinical outcomes.
        </p>
      </footer>
    </div>
  );
}
