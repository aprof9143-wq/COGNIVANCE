"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Bounds,
  ContactShadows,
  Environment,
  Grid,
  OrbitControls,
  PerspectiveCamera,
  useGLTF,
} from "@react-three/drei";
import * as THREE from "three";

type ResearchMode = "STRUCTURE" | "RECONSTRUCTION" | "SIGNAL" | "NAVIGATION";
interface Mode {
  id: ResearchMode;
  label: string;
  shortLabel: string;
  description: string;
}
const MODES: Mode[] = [
  {
    id: "STRUCTURE",
    label: "STRUCTURAL MAP",
    shortLabel: "STRUCTURE",
    description: "Volumetric visualization of the uploaded anatomical model.",
  },
  {
    id: "RECONSTRUCTION",
    label: "CIRCUIT RECONSTRUCTION",
    shortLabel: "RECONSTRUCTION",
    description: "Visualization layer for reconstructing candidate neural pathways.",
  },
  {
    id: "SIGNAL",
    label: "SIGNAL FLOW",
    shortLabel: "SIGNAL",
    description:
      "Simulated visualization of signal propagation through the reconstructed topology.",
  },
  {
    id: "NAVIGATION",
    label: "NANOROBOT NAVIGATION",
    shortLabel: "NAVIGATION",
    description: "Simulated spatial trajectories for future nanorobotic navigation research.",
  },
];
const TELEMETRY = [
  { label: "RECONSTRUCTION", value: "94.7", unit: "%" },
  { label: "RESOLUTION", value: "4.2", unit: "µm" },
  { label: "PATHWAYS", value: "1,824", unit: "" },
  { label: "LATENCY", value: "3.41", unit: "ms" },
];
function enhanceMaterial(material: THREE.Material) {
  const m = material as THREE.MeshStandardMaterial;
  if ("roughness" in m) m.roughness = 0.58;
  if ("metalness" in m) m.metalness = 0.18;
  if ("emissive" in m) {
    m.emissive = new THREE.Color("#061218");
    m.emissiveIntensity = 0.28;
  }
}
function BrainModel({ mode, scanProgress }: { mode: ResearchMode; scanProgress: number }) {
  const { scene } = useGLTF("/BrainStem.glb");
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (Array.isArray(mesh.material)) mesh.material.forEach(enhanceMaterial);
      else if (mesh.material) enhanceMaterial(mesh.material);
    });
    return clone;
  }, [scene]);
  return (
    <group>
      <primitive object={model} />
      {mode === "RECONSTRUCTION" && (
        <ReconstructionOverlay object={model} scanProgress={scanProgress} />
      )}
      {mode === "SIGNAL" && <SignalNetwork />}
      {mode === "NAVIGATION" && <NanorobotNetwork />}
      <ScanPlane
        visible={mode === "STRUCTURE" || mode === "RECONSTRUCTION"}
        progress={scanProgress}
      />
    </group>
  );
}
function ReconstructionOverlay({
  object,
  scanProgress,
}: {
  object: THREE.Object3D;
  scanProgress: number;
}) {
  const geometries = useMemo(() => {
    const result: {
      geometry: THREE.BufferGeometry;
      position: THREE.Vector3;
      rotation: THREE.Euler;
      scale: THREE.Vector3;
    }[] = [];
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      result.push({
        geometry: new THREE.EdgesGeometry(mesh.geometry, 18),
        position: mesh.position.clone(),
        rotation: mesh.rotation.clone(),
        scale: mesh.scale.clone(),
      });
    });
    return result;
  }, [object]);
  return (
    <group>
      {geometries.map((item, index) => (
        <lineSegments
          key={index}
          geometry={item.geometry}
          position={item.position}
          rotation={item.rotation}
          scale={item.scale}
        >
          <lineBasicMaterial
            color={scanProgress > 0.5 ? "#50ddff" : "#7164ff"}
            transparent
            opacity={0.28}
          />
        </lineSegments>
      ))}
      <CircuitParticles />
    </group>
  );
}
function CircuitParticles() {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const count = 700;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const index = i * 3;
      positions[index] = (Math.random() - 0.5) * 2.6;
      positions[index + 1] = (Math.random() - 0.5) * 2.2;
      positions[index + 2] = (Math.random() - 0.5) * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.035;
    ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.2) * 0.025;
  });
  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial color="#53dfff" size={0.011} transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}
function SignalNetwork() {
  const nodes = useMemo(
    () =>
      Array.from({ length: 45 }, (_, index) => ({
        id: index,
        position: new THREE.Vector3(
          (Math.random() - 0.5) * 2.4,
          (Math.random() - 0.5) * 1.9,
          (Math.random() - 0.5) * 1.8,
        ),
      })),
    [],
  );
  return (
    <group>
      {nodes.map((node) => (
        <SignalNode key={node.id} position={node.position} index={node.id} />
      ))}
      {nodes.slice(0, -1).map((node, index) => (
        <SignalLine
          key={`${node.id}-${index}`}
          start={node.position}
          end={nodes[index + 1]!.position}
          delay={index * 0.08}
        />
      ))}
    </group>
  );
}
function SignalNode({ position, index }: { position: THREE.Vector3; index: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 3 + index * 0.35) * 0.25);
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.018, 8, 8]} />
      <meshBasicMaterial color="#8a7bff" />
    </mesh>
  );
}
function SignalLine({
  start,
  end,
  delay,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  delay: number;
}) {
  const line = useMemo(
    () =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(new THREE.LineCurve3(start, end).getPoints(24)),
        new THREE.LineBasicMaterial({ color: "#786aff", transparent: true, opacity: 0.18 }),
      ),
    [start, end],
  );
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  useFrame((state) => {
    const material = line.material as THREE.LineBasicMaterial;
    material.opacity = 0.12 + (Math.sin(state.clock.elapsedTime * 2.5 + delay) + 1) * 0.12;
  });
  return <primitive object={line} />;
}
function NanorobotNetwork() {
  return (
    <group>
      {Array.from({ length: 22 }, (_, index) => (
        <NanoBot key={index} index={index} />
      ))}
    </group>
  );
}
function NanoBot({ index }: { index: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const initial = useMemo(
    () =>
      new THREE.Vector3(
        -1.15 + Math.random() * 2.3,
        -0.85 + Math.random() * 1.7,
        -0.85 + Math.random() * 1.7,
      ),
    [],
  );
  useFrame((state) => {
    if (!ref.current) return;
    const time = state.clock.elapsedTime * 0.25 + index * 0.45;
    ref.current.position.x = initial.x + Math.sin(time) * 0.22;
    ref.current.position.y = initial.y + Math.cos(time * 0.8) * 0.18;
    ref.current.position.z = initial.z + Math.sin(time * 0.65) * 0.18;
  });
  return (
    <mesh ref={ref} position={initial}>
      <sphereGeometry args={[0.024, 10, 10]} />
      <meshBasicMaterial color="#51e8ff" />
    </mesh>
  );
}
function ScanPlane({ progress, visible }: { progress: number; visible: boolean }) {
  if (!visible) return null;
  return (
    <mesh position={[0, -1.15 + progress * 2.3, 0]}>
      <planeGeometry args={[3.3, 2.7]} />
      <meshBasicMaterial color="#51e4ff" transparent opacity={0.045} side={THREE.DoubleSide} />
    </mesh>
  );
}
function ResearchScene({ mode, scanProgress }: { mode: ResearchMode; scanProgress: number }) {
  return (
    <>
      <color attach="background" args={["#020506"]} />
      <fog attach="fog" args={["#020506", 4.5, 9]} />
      <PerspectiveCamera makeDefault position={[0, 0.25, 4.6]} fov={34} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 4, 4]} intensity={2} color="#d9f7ff" />
      <pointLight position={[-3, 1, 2]} intensity={12} distance={7} color="#1487ff" />
      <pointLight position={[2, -2, -1]} intensity={8} distance={6} color="#704cff" />
      <Environment preset="night" />
      <Bounds fit clip observe margin={1.35}>
        <BrainModel mode={mode} scanProgress={scanProgress} />
      </Bounds>
      <Grid
        position={[0, -1.25, 0]}
        args={[8, 8]}
        cellSize={0.15}
        cellThickness={0.3}
        cellColor="#123039"
        sectionSize={1}
        sectionThickness={0.7}
        sectionColor="#1a505d"
        fadeDistance={7}
        fadeStrength={1}
        infiniteGrid
      />
      <ContactShadows position={[0, -1.2, 0]} opacity={0.3} scale={5} blur={2} />
      <OrbitControls
        enablePan={false}
        enableZoom
        minDistance={2.8}
        maxDistance={6}
        autoRotate
        autoRotateSpeed={0.3}
        enableDamping
        dampingFactor={0.05}
      />
    </>
  );
}
export default function NeuralResearchLab() {
  const [mode, setMode] = useState<ResearchMode>("RECONSTRUCTION");
  const [scanProgress, setScanProgress] = useState(0.48);
  const [isScanning, setIsScanning] = useState(false);
  const currentMode = MODES.find((item) => item.id === mode)!;
  useEffect(() => {
    if (!isScanning) return;
    let animationFrame: number;
    const animate = () => {
      setScanProgress((previous) => {
        const next = previous + 0.0028;
        if (next >= 1) {
          setIsScanning(false);
          return 0;
        }
        return next;
      });
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [isScanning]);
  return (
    <section id="research-lab" className="relative overflow-hidden bg-[#020404] text-white">
      <div className="relative mx-auto max-w-[1600px] px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
        <header className="max-w-5xl">
          <div className="flex items-center gap-4">
            <span className="font-mono text-[8px] uppercase tracking-[0.35em] text-cyan-300/55">
              COGNIVANCE LABS
            </span>
            <span className="h-px w-12 bg-cyan-300/20" />
            <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-white/25">
              Research Instrumentation
            </span>
          </div>
          <h1 className="mt-7 text-[clamp(3.3rem,7vw,7.5rem)] font-medium leading-[0.84] tracking-[-0.065em]">
            Reconstructing
            <br />
            <span className="bg-gradient-to-r from-white via-white to-white/25 bg-clip-text text-transparent">
              the living circuit.
            </span>
          </h1>
          <p className="mt-8 max-w-2xl text-sm leading-7 text-white/35">
            An interactive research environment for visualizing neural structure, inferred pathways,
            signal propagation and future nanorobotic navigation.
          </p>
        </header>
        <div className="mt-12 flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-2 backdrop-blur-xl lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                className={`whitespace-nowrap rounded-xl px-4 py-3 font-mono text-[8px] uppercase tracking-[0.16em] transition-all ${item.id === mode ? "bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/20" : "text-white/25 hover:bg-white/[0.04] hover:text-white/60"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIsScanning(true)}
            className="flex items-center justify-center gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] px-5 py-3 font-mono text-[8px] uppercase tracking-[0.18em] text-cyan-200 transition hover:bg-cyan-300/10"
          >
            {isScanning ? "Scanning" : "Run reconstruction"}
          </button>
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative min-h-[620px] overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#030708] lg:min-h-[720px]">
            <Canvas dpr={[1, 1.75]} gl={{ antialias: true, alpha: false }}>
              <Suspense fallback={null}>
                <ResearchScene mode={mode} scanProgress={scanProgress} />
              </Suspense>
            </Canvas>
          </div>
          <aside className="flex flex-col gap-5">
            <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.025] p-5">
              <span className="font-mono text-[8px] uppercase tracking-[0.25em] text-white/25">
                Analysis mode
              </span>
              <h2 className="mt-5 text-xl font-medium">{currentMode.label}</h2>
              <p className="mt-2 text-[10px] leading-5 text-white/30">{currentMode.description}</p>
            </div>
            <div className="overflow-hidden rounded-[20px] border border-white/[0.08] bg-white/[0.025]">
              <div className="border-b border-white/[0.07] px-5 py-4">
                <span className="font-mono text-[8px] uppercase tracking-[0.25em] text-white/25">
                  System telemetry
                </span>
              </div>
              <div className="grid grid-cols-2">
                {TELEMETRY.map((item) => (
                  <div key={item.label} className="border-b border-r border-white/[0.07] p-5">
                    <p className="font-mono text-[7px] uppercase tracking-[0.18em] text-white/20">
                      {item.label}
                    </p>
                    <p className="mt-3 text-xl font-medium">
                      {item.value}
                      <span className="ml-1 text-[9px] text-cyan-300/50">{item.unit}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

export function LiveBadge({ label = "Live stream" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-foreground/15 bg-foreground/5 px-3 py-1">
      <span className="live-dot h-1.5 w-1.5 rounded-full bg-foreground" />
      <span className="t-marker text-foreground/75">{label}</span>
    </span>
  );
}
export function EEGTrace({
  channels = 6,
  height = 180,
  speed = 1,
}: {
  channels?: number;
  height?: number;
  speed?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let phase = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      phase += 0.02 * speed;
      ctx.clearRect(0, 0, w, h);
      const band = h / channels;
      for (let c = 0; c < channels; c++) {
        const mid = band * c + band / 2;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const t = x / 40 + phase * (1 + c * 0.05);
          const v =
            Math.sin(t * (0.7 + c * 0.37)) * 0.5 +
            Math.sin(t * (1.9 + c * 0.2)) * 0.25 +
            (Math.random() - 0.5) * 0.08;
          const y = mid + v * band * 0.36;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(255,255,255,${0.85 - c * 0.09})`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [channels, speed]);
  return (
    <canvas
      ref={ref}
      aria-label="Live multi-channel EEG trace"
      role="img"
      className="w-full"
      style={{ height }}
    />
  );
}
export function Metric({
  label,
  value,
  unit,
  jitter = 0,
}: {
  label: string;
  value: number | string;
  unit?: string;
  jitter?: number;
}) {
  const numeric = typeof value === "number" ? value : Number(value);
  const shown =
    jitter && Number.isFinite(numeric)
      ? (numeric + Math.sin(Date.now() / 1500) * jitter).toFixed(1)
      : String(value);
  return (
    <div>
      <p className="t-marker text-ash">{label}</p>
      <p className="mt-2 text-2xl font-medium text-foreground">
        {shown}
        <span className="ml-1 text-sm text-ash">{unit}</span>
      </p>
    </div>
  );
}
useGLTF.preload("/BrainStem.glb");
