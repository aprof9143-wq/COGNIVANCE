import { useEffect, useRef, useState } from "react";
import { SimScene, type View } from "@/components/sim/scene";
import { DEFAULT_ARRAY } from "@/lib/sim/acoustics";
import { loadAnatomy, placeArray, targetPoint } from "@/lib/sim/anatomy";
import { autoConnect, FULL_TOPOLOGY } from "@/lib/sim/autoconnect";
import { autoDesign } from "@/lib/sim/design";
import { diseaseByKey } from "@/lib/sim/diseases";
import { CircuitSim, computeBeams, type LoopEvent } from "@/lib/sim/loop";
import { plasticityIndex, REGION_INDEX, REGIONS } from "@/lib/sim/neural";
import { stageAt } from "@/lib/sim/stages";

/**
 * The landing page hero: the CIRCUIT simulator's own 3D scene, running.
 *
 * The MNI152 brain, the cortical visual implant and its closed loop (sense,
 * predict, verify, write, measure) are the same objects and the same network
 * model as /simulation, on the "vision loss" programme. Nothing here is a
 * pre-rendered animation. It pauses when scrolled off screen.
 */

const DISEASE = "vision" as const;
const SEVERITY = 0.8;
const SEED = 7;
const SPEED = 0.25; // model time per real time: slow enough to read

/** The camera tour: the simulator's own views, in turn. */
// Field of view per stop, for the hero's near-square window: tight on the whole
// brain so it fills the frame, wider on the close-ups so they keep context.
const TOUR: { view: View; s: number; caption: string; fov: number }[] = [
  { view: "cinematic", s: 10, caption: "Whole brain, MNI152", fov: 38 },
  { view: "beam", s: 8, caption: "Ultrasound beam to V1", fov: 56 },
  { view: "section", s: 8, caption: "Cross-section through the focus", fov: 50 },
  { view: "implant", s: 7, caption: "The cortical implant", fov: 52 },
];
const RESUME_MS = 12000; // after the visitor stops dragging

const STAGE_WORDS: Record<string, string> = {
  SENSE: "Sensing",
  PREDICT: "Predicting",
  VERIFY: "Verifying",
  WRITE: "Writing back",
  MEASURE: "Measuring",
};

export function HeroCircuit({ className = "" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const stageOut = useRef<HTMLSpanElement>(null);
  const [stop, setStop] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    const lab = labels.current;
    if (!el || !lab) return;
    let scene: SimScene;
    try {
      scene = new SimScene(el, lab);
    } catch {
      setFailed(true);
      return;
    }
    let disposed = false;
    let sim: CircuitSim | null = null;
    let raf = 0;

    // A view to look at, not a tool to drive: no zoom or pan, and on touch
    // screens the page keeps its vertical scroll.
    const c = scene.controls;
    c.enableZoom = false;
    c.enablePan = false;
    c.autoRotateSpeed = 0.45;
    if (!window.matchMedia("(pointer: fine)").matches) c.enabled = false;
    scene.renderer.domElement.style.touchAction = "pan-y";
    scene.setLabelsVisible(false);
    // Framed for the hero's instrument window; each tour stop sets its own.
    scene.camera.fov = TOUR[0]!.fov;
    let fovTo = TOUR[0]!.fov;
    scene.camera.updateProjectionMatrix();

    loadAnatomy()
      .then(async (an) => {
        if (disposed) return;
        scene.setAnatomy(an);
        const disease = diseaseByKey(DISEASE);
        const outer = an.meshes.get("outer");
        if (!outer) throw new Error("no outer surface");
        const placements = disease.targets.map((t) => {
          const mesh = an.meshes.get(t);
          return {
            region: t,
            placement: placeArray(outer, mesh ? targetPoint(mesh, "left") : [0, 0, 0]),
          };
        });
        // The simulator's own array search, as a user would run it: the default
        // 15 MHz array cannot focus on V1 within the safety rules, so its writes
        // would all be refused.
        const best = await autoDesign(placements);
        if (disposed) return;
        const design = best?.design ?? DEFAULT_ARRAY;
        const beams = computeBeams(design, placements, { keepPlane: true });
        const circuit = autoConnect(FULL_TOPOLOGY);
        scene.setTargets(disease.targets);
        scene.buildImplant(placements[0]!.placement, circuit.assemblyOrder, design);
        for (const comp of circuit.components) scene.setPartLabel(comp.id, comp.part);
        scene.placeAll(circuit.nets);
        scene.setBeams(
          beams.map((b) => ({
            region: b.region,
            placement: b.placement,
            plane: b.plane ?? null,
            lateralFwhmMm: b.metrics.lateralFwhmMm,
            apertureMm: b.metrics.apertureMm,
            reachable: true,
            design,
          })),
        );
        scene.setView("cinematic");
        c.autoRotate = !still;
        stopUntil = performance.now() + TOUR[0]!.s * 1000;
        sim = new CircuitSim({
          disease,
          severity: SEVERITY,
          design,
          beams,
          seed: SEED,
          dutyLimit: circuit.power.dutyLimit,
          gated: true,
        });
        setReady(true);
      })
      .catch(() => !disposed && setFailed(true));

    // Drive the loop: the same stepping as the simulator, without its panels.
    let last = performance.now();
    let t = 0;
    let ev: LoopEvent | null = null;
    let prev: LoopEvent | null = null;
    let lastStage = "";
    // Tour: advance through TOUR; a drag pauses it for a while.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stopIdx = 0;
    let stopUntil = 0;
    let heldUntil = 0;
    const goTo = (i: number, now: number) => {
      stopIdx = i % TOUR.length;
      const st = TOUR[stopIdx]!;
      scene.setView(st.view);
      c.autoRotate = st.view === "cinematic" && !still;
      stopUntil = now + st.s * 1000;
      fovTo = st.fov;
      setStop(stopIdx);
    };
    scene.renderer.domElement.addEventListener("pointerdown", () => {
      heldUntil = performance.now() + RESUME_MS;
      c.autoRotate = false;
    });
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - last);
      last = now;
      if (!sim) return;
      // Close-ups need room: narrow screens keep the whole-brain view.
      if (!still && el.clientWidth >= 480 && now > heldUntil && now > stopUntil)
        goTo(stopIdx + 1, now);
      // Ease the field of view with the camera move instead of jumping. In a
      // window taller than it is wide (phones), widen it so the framing holds
      // horizontally rather than cropping the sides of the brain.
      const cam = scene.camera;
      const want =
        cam.aspect >= 1
          ? fovTo
          : (2 * Math.atan(Math.tan((fovTo * Math.PI) / 360) / cam.aspect) * 180) / Math.PI;
      if (Math.abs(cam.fov - want) > 0.05) {
        cam.fov += (want - cam.fov) * Math.min(1, dt / 600);
        cam.updateProjectionMatrix();
      }
      t += dt * SPEED;
      let guard = 0;
      while ((ev === null || t >= sim.period) && guard++ < 8) {
        if (ev) t -= sim.period;
        prev = ev;
        ev = sim.iterate();
      }
      if (t >= sim.period) t = 0;
      if (!ev) return;
      const { stage, phase, index } = stageAt(t / sim.period);
      const shown = index >= 2 ? ev : prev;
      if (stage !== lastStage && stageOut.current) {
        lastStage = stage;
        stageOut.current.textContent = STAGE_WORDS[stage] ?? "";
      }
      const activity: Record<string, number> = {};
      const plasticity: Record<string, number> = {};
      for (const r of REGIONS) {
        const i = REGION_INDEX[r.key];
        activity[r.key] = Math.max(0, Math.min(1, Math.sqrt(sim.rec.power(i, 200)) / 0.5));
        plasticity[r.key] = plasticityIndex(sim.net, i);
      }
      scene.setLoop({
        stage,
        phase,
        verified: index === 2 && phase < 0.5 ? null : shown ? !shown.halted : null,
        halted: Boolean(shown?.halted) && index >= 2,
        delivered: stage === "WRITE" ? ev.delivered.map((d) => d.region) : [],
        activity,
        plasticity,
        payload: false,
      });
    };

    let visible = true;
    const play = () => {
      scene.setPaused(false);
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const pause = () => {
      scene.setPaused(true);
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible && !document.hidden) play();
      else pause();
    });
    io.observe(el);
    const onVis = () => (document.hidden || !visible ? pause() : play());
    document.addEventListener("visibilitychange", onVis);
    play();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      scene.dispose();
    };
  }, []);

  return (
    <div className={className}>
      <div
        ref={host}
        className={`absolute inset-0 transition-opacity duration-[1600ms] ${ready ? "opacity-100" : "opacity-0"}`}
        role="img"
        aria-label="The CIRCUIT simulator running live: a 3D brain with a cortical visual implant, its ultrasound beam reaching the visual cortex in a closed loop"
      />
      <div ref={labels} className="pointer-events-none absolute inset-0" aria-hidden />
      {ready && (
        <p className="pointer-events-none absolute bottom-4 left-4 z-10 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-full border border-white/10 bg-[#02040c]/70 py-1.5 pl-3 pr-4 text-[12px] text-white/70 backdrop-blur">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#41e0a2] opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#41e0a2]" />
          </span>
          <span className="truncate">
            Running live in your browser. {TOUR[stop]!.caption}.{" "}
            <span ref={stageOut} className="text-white" />
          </span>
        </p>
      )}
      {failed && (
        <div className="absolute inset-0 bg-[radial-gradient(45%_45%_at_55%_50%,rgba(61,139,245,0.2),transparent_70%)]" />
      )}
    </div>
  );
}
