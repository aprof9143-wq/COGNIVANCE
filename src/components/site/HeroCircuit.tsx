import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SimScene } from "@/components/sim/scene";
import { DEFAULT_ARRAY } from "@/lib/sim/acoustics";
import { loadAnatomy, placeArray, targetPoint, type Anatomy } from "@/lib/sim/anatomy";
import { autoConnect, FULL_TOPOLOGY } from "@/lib/sim/autoconnect";
import { autoDesign } from "@/lib/sim/design";
import { diseaseByKey } from "@/lib/sim/diseases";
import { CircuitSim, computeBeams, type LoopEvent, type Stage } from "@/lib/sim/loop";
import { plasticityIndex, REGION_INDEX, REGIONS } from "@/lib/sim/neural";
import { STAGE_SPANS, stageAt } from "@/lib/sim/stages";
import { FALLBACK, pathways, SCHEMATIC, sideOf, w } from "@/lib/vision/pathway";

/**
 * The landing page hero: the CIRCUIT simulator's own 3D scene, running.
 *
 * The MNI152 brain, the cortical visual implant and its closed loop (sense,
 * predict, verify, write, measure) are the same objects and the same network
 * model as /simulation, on the "vision loss" programme. The eyes and the
 * visual pathway are drawn into the same scene, faint because in this
 * programme the natural route to V1 is damaged and the implant writes to V1
 * directly. The panel reads its numbers from the running model.
 *
 * Nothing is pre-rendered. It pauses when scrolled off screen.
 */

const DISEASE = "vision" as const;
const SEVERITY = 0.8;
const SEED = 7;
const SPEED = 30 / 1600; // model time per real time: one 30 ms loop every 1.6 s
/** Loops run before the hero shows, so the endpoint has its 2 s window. */
const WARMUP = 120;

const RESUME_MS = 12000; // after the visitor stops dragging

const STAGE_NAME: Record<Stage, string> = {
  SENSE: "Sense",
  PREDICT: "Predict",
  VERIFY: "Verify",
  WRITE: "Write",
  MEASURE: "Measure",
};

type Hud = {
  stage: Stage | null;
  index: number;
  phase: number;
  endpoint: number | null;
  history: number[];
  latencyMs: number | null;
  loops: number;
  verified: number;
  halted: boolean;
  /** Array frequency chosen by the auto-design, MHz. */
  mhz: number | null;
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const EMPTY: Hud = {
  stage: null,
  index: -1,
  phase: 0,
  endpoint: null,
  history: [],
  latencyMs: null,
  loops: 0,
  verified: 0,
  halted: false,
  mhz: null,
};

export function HeroCircuit({ className = "" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hud, setHud] = useState<Hud>(EMPTY);

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
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;
    let sim: CircuitSim | null = null;
    let overlay: Overlay | null = null;
    let raf = 0;

    // A view to look at, not a tool to drive: no zoom or pan, and on touch
    // screens the page keeps its vertical scroll.
    const c = scene.controls;
    c.enableZoom = false;
    c.enablePan = false;
    c.autoRotateSpeed = 0.6;
    if (!window.matchMedia("(pointer: fine)").matches) c.enabled = false;
    scene.renderer.domElement.style.touchAction = "pan-y";
    scene.renderer.toneMappingExposure = 1.15;
    scene.setLabelsVisible(false);
    // Pull back from the simulator's framing so the whole head fits a hero.
    scene.camera.fov = 46;
    scene.camera.updateProjectionMatrix();

    // The brain turns slowly; a drag takes over, and it turns again after a pause.
    let heldUntil = 0;
    scene.renderer.domElement.addEventListener("pointerdown", () => {
      heldUntil = performance.now() + RESUME_MS;
      c.autoRotate = false;
    });
    let mhz: number | null = null;

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
        // 15 MHz array cannot focus on V1 within the safety rules.
        const best = await autoDesign(placements);
        if (disposed) return;
        const design = best?.design ?? DEFAULT_ARRAY;
        mhz = design.frequencyHz / 1e6;
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
        scene.setShowcase(true);
        overlay = addPathway(scene.scene, an);
        c.autoRotate = !still;
        sim = new CircuitSim({
          disease,
          severity: SEVERITY,
          design,
          beams,
          seed: SEED,
          dutyLimit: circuit.power.dutyLimit,
          gated: true,
        });
        for (let i = 0; i < WARMUP; i++) record(sim.iterate());
        setReady(true);
      })
      .catch(() => !disposed && setFailed(true));

    // Drive the loop: the same stepping as the simulator, without its panels.
    let last = performance.now();
    let t = 0;
    let ev: LoopEvent | null = null;
    let prev: LoopEvent | null = null;
    let lastHud = 0;
    let loops = 0;
    let verified = 0;
    const history: number[] = [];
    const record = (e: LoopEvent) => {
      loops++;
      if (!e.halted && e.delivered.length) verified++;
      // The endpoint needs its measurement window (see the simulator).
      if (e.tS >= 2) {
        history.push(e.endpoint);
        if (history.length > 90) history.shift();
      }
      return e;
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - last);
      last = now;
      if (!sim) return;
      if (!still && !c.autoRotate && now > heldUntil) c.autoRotate = true;
      t += dt * SPEED;
      let guard = 0;
      while ((ev === null || t >= sim.period) && guard++ < 8) {
        if (ev) t -= sim.period;
        prev = ev;
        ev = record(sim.iterate());
      }
      if (t >= sim.period) t = 0;
      if (!ev) return;
      const { stage, phase, index } = stageAt(t / sim.period);
      const shown = index >= 2 ? ev : prev;
      const activity: Record<string, number> = {};
      const plasticity: Record<string, number> = {};
      for (const r of REGIONS) {
        const i = REGION_INDEX[r.key];
        activity[r.key] = Math.max(0, Math.min(1, Math.sqrt(sim.rec.power(i, 200)) / 0.5));
        plasticity[r.key] = plasticityIndex(sim.net, i);
      }
      const writing = stage === "WRITE" && ev.delivered.length > 0;
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
      overlay?.update(now / 1000, writing ? Math.sin(Math.PI * phase) : 0);
      if (now - lastHud > 90) {
        lastHud = now;
        setHud({
          stage,
          index,
          phase,
          endpoint: history.length ? mean(history.slice(-20)) : null,
          history: history.slice(),
          latencyMs: shown?.latencyMs ?? null,
          loops,
          verified,
          halted: Boolean(shown?.halted) && index >= 2,
          mhz,
        });
      }
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
      overlay?.dispose();
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
      {ready && <LoopPanel hud={hud} />}
      {failed && (
        <div className="absolute inset-0 bg-[radial-gradient(45%_45%_at_55%_50%,rgba(61,139,245,0.2),transparent_70%)]" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

/** The live readout: what the loop is doing and what the model measures. */
function LoopPanel({ hud }: { hud: Hud }) {
  const pct = hud.endpoint === null ? null : Math.round(hud.endpoint);
  return (
    <aside
      aria-label="Live simulation readout"
      className="rise pointer-events-none absolute inset-x-4 top-[calc(100%-12px)] z-10 rounded-2xl sm:bottom-3 sm:top-auto border border-white/10 bg-[linear-gradient(180deg,rgba(10,18,44,0.78),rgba(4,8,22,0.82))] p-3.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:w-[336px] lg:bottom-auto lg:right-10 lg:top-28 lg:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[12.5px] font-medium text-white">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#41e0a2] opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#41e0a2]" />
          </span>
          Live simulation
        </p>
        <p className="text-[11.5px] text-white/45">Vision loss, cortical implant</p>
      </div>

      <ol className="mt-4 grid grid-cols-5 gap-1.5" aria-label="Loop stage">
        {STAGE_SPANS.map(([s], i) => {
          const fill = i < hud.index ? 1 : i === hud.index ? hud.phase : 0;
          const active = i === hud.index;
          const red = hud.halted && i >= 2;
          return (
            <li key={s}>
              <span className="block h-[3px] overflow-hidden rounded-full bg-white/10">
                <span
                  className={`block h-full rounded-full ${red ? "bg-[#ff5a6e]" : s === "WRITE" ? "bg-[#a58bff]" : "bg-[#7fd8ff]"}`}
                  style={{ width: `${fill * 100}%` }}
                />
              </span>
              <span
                className={`mt-1.5 block text-[10.5px] ${active ? "text-white" : "text-white/40"}`}
              >
                {STAGE_NAME[s]}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex items-end justify-between gap-4 border-t border-white/10 pt-3 sm:mt-4 sm:pt-4">
        <div>
          <p className="font-[family-name:var(--font-head)] text-[2rem] font-semibold leading-none tracking-[-0.04em] text-white tabular-nums">
            {pct === null ? "…" : `${pct}%`}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-white/50">
            V1 activity recovered toward healthy
            <br />
            <span className="hidden text-white/35 sm:inline">Model endpoint, last 20 loops</span>
          </p>
        </div>
        <span className="hidden sm:block">
          <Spark values={hud.history} />
        </span>
      </div>

      <dl className="mt-4 hidden grid-cols-3 gap-2 border-t border-white/10 pt-3 text-[11px] sm:grid">
        <div>
          <dt className="text-white/40">Loop latency</dt>
          <dd className="mt-0.5 font-[family-name:var(--font-code)] text-white/85 tabular-nums">
            {hud.latencyMs === null ? "…" : `${hud.latencyMs.toFixed(1)} ms`}
          </dd>
        </div>
        <div>
          <dt className="text-white/40">Verified writes</dt>
          <dd className="mt-0.5 font-[family-name:var(--font-code)] text-white/85 tabular-nums">
            {hud.verified}/{hud.loops}
          </dd>
        </div>
        <div>
          <dt className="text-white/40">Array</dt>
          <dd className="mt-0.5 font-[family-name:var(--font-code)] text-white/85 tabular-nums">
            {hud.mhz === null ? "…" : `${hud.mhz} MHz`}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

function Spark({ values }: { values: number[] }) {
  const W = 128;
  const H = 40;
  if (values.length < 2) return <svg width={W} height={H} aria-hidden />;
  const lo = Math.min(0, ...values);
  const hi = Math.max(100, ...values);
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    H - 2 - ((v - lo) / (hi - lo)) * (H - 4),
  ]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x!.toFixed(1)},${y!.toFixed(1)}`).join("");
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#a58bff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#a58bff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d}L${W},${H}L0,${H}Z`} fill="url(#spark-fill)" />
      <path d={d} fill="none" stroke="#b9a6ff" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.5" fill="#fff" />
    </svg>
  );
}

/* ------------------------------------------------------------------ pathway */

type Overlay = { update(t: number, write: number): void; dispose(): void };

/**
 * The eyes and the visual pathway, added to the simulator's scene. Faint and
 * sparse, because in the vision-loss programme the natural route is damaged;
 * the optic radiation brightens while the implant writes to V1.
 */
function addPathway(scene: THREE.Scene, an: Anatomy): Overlay {
  const group = new THREE.Group();
  const trash: { dispose(): void }[] = [];
  const lgn = an.meshes.get("lgn");
  const v1 = an.meshes.get("v1");
  const paths = pathways(
    sideOf(lgn, "left", FALLBACK.lgnL),
    sideOf(lgn, "right", FALLBACK.lgnR),
    sideOf(v1, "left", FALLBACK.v1L),
    sideOf(v1, "right", FALLBACK.v1R),
  );

  const tubeMats: { mat: THREE.MeshBasicMaterial; cortex: boolean }[] = [];
  for (const p of paths) {
    const cortex = p.stage === "cortex";
    const g = new THREE.TubeGeometry(p.curve, 100, cortex ? 0.7 : 0.5, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: cortex ? 0xa58bff : 0x7fd8ff,
      transparent: true,
      opacity: cortex ? 0.16 : 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    trash.push(g, mat);
    group.add(new THREE.Mesh(g, mat));
    tubeMats.push({ mat, cortex });
  }

  // Signal particles along the tracts.
  const per = 46;
  const n = paths.length * per;
  const P = new Float32Array(n * 3);
  const C = new Float32Array(n * 3);
  const off = Float32Array.from({ length: n }, () => Math.random());
  const pg = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(P, 3);
  const colAttr = new THREE.BufferAttribute(C, 3);
  pg.setAttribute("position", posAttr);
  pg.setAttribute("color", colAttr);
  const dot = dotTexture();
  const pm = new THREE.PointsMaterial({
    size: 2.2,
    map: dot,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  trash.push(pg, pm, dot);
  group.add(new THREE.Points(pg, pm));

  // Schematic eyes: glass globes with an iris.
  for (const e of [SCHEMATIC.eyeL, SCHEMATIC.eyeR]) {
    const globe = new THREE.SphereGeometry(12, 48, 32);
    const glass = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { tint: { value: new THREE.Color(0x9fc3ff) } },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 tint; varying vec3 vN; varying vec3 vV;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
          gl_FragColor = vec4(tint * (0.02 + 0.55 * rim), 1.0);
        }`,
    });
    const eye = new THREE.Mesh(globe, glass);
    eye.position.copy(w(e));
    const iris = new THREE.RingGeometry(2.4, 5.2, 48);
    const im = new THREE.MeshBasicMaterial({
      color: 0x3d8bf5,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ir = new THREE.Mesh(iris, im);
    ir.position.set(0, 0, -11.6);
    eye.add(ir);
    trash.push(globe, glass, iris, im);
    group.add(eye);
  }
  scene.add(group);

  const v = new THREE.Vector3();
  const warm = new THREE.Color(0xffb45c);
  const violet = new THREE.Color(0xb9a6ff);
  return {
    update(t, write) {
      for (const tm of tubeMats)
        tm.mat.opacity = tm.cortex ? 0.14 + 0.3 * write : 0.08 + 0.02 * Math.sin(t * 2);
      for (let k = 0; k < paths.length; k++) {
        const p = paths[k]!;
        const cortex = p.stage === "cortex";
        for (let i = 0; i < per; i++) {
          const idx = k * per + i;
          const u = (off[idx]! + t * (cortex ? 0.06 : 0.035)) % 1;
          p.curve.getPointAt(u, v);
          P[idx * 3] = v.x;
          P[idx * 3 + 1] = v.y;
          P[idx * 3 + 2] = v.z;
          // Damaged route: only a fifth of the retinal signal gets through.
          const on = cortex ? 0.25 + 0.9 * write : off[idx]! < 0.2 ? 0.55 : 0.04;
          const col = cortex ? violet : warm;
          C[idx * 3] = col.r * on;
          C[idx * 3 + 1] = col.g * on;
          C[idx * 3 + 2] = col.b * on;
        }
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    },
    dispose() {
      scene.remove(group);
      for (const x of trash) x.dispose();
    },
  };
}

function dotTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const x = cv.getContext("2d")!;
  const r = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.3, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = r;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
