import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { loadAnatomy, type Anatomy, type AnatomyMesh } from "@/lib/sim/anatomy";

/**
 * The visual pathway in MNI152 space: eye → optic nerve → chiasm → optic
 * tract → LGN → optic radiation → V1.
 *
 * Cortex, LGN and V1 are the real atlas meshes the CIRCUIT simulator uses.
 * The eyes, chiasm and the waypoints of the tracts are schematic, placed by
 * standard anatomy, and say so in their labels. Brightness shows the inputs:
 * `retina` (light response reaching the optic nerve, fraction of healthy) and
 * `v1` (cortical response computed by the network model).
 */

type V3 = [number, number, number];
/** MNI RAS mm → three.js world (y up, anterior toward −z). */
const w = ([x, y, z]: V3) => new THREE.Vector3(x, z, -y);

const SCHEMATIC: { eyeL: V3; eyeR: V3; chiasm: V3 } = {
  eyeL: [-32, 62, -36],
  eyeR: [32, 62, -36],
  chiasm: [0, 4, -14],
};

const LABELS = [
  {
    key: "eye",
    text: "Eye · retina",
    sub: "where the therapy acts",
    at: SCHEMATIC.eyeR,
  },
  {
    key: "nerve",
    text: "Optic nerve",
    sub: "schematic route",
    at: [18, 34, -26] as V3,
  },
  {
    key: "chiasm",
    text: "Optic chiasm",
    sub: "fibres cross here",
    at: SCHEMATIC.chiasm,
  },
  {
    key: "lgn",
    text: "LGN (thalamus)",
    sub: "relay · MNI atlas",
    at: [24, -24, -7] as V3,
  },
  {
    key: "radiation",
    text: "Optic radiation",
    sub: "schematic route",
    at: [30, -55, 0] as V3,
  },
  {
    key: "v1",
    text: "Visual cortex (V1)",
    sub: "cerebral cortex · MNI atlas",
    at: [11, -84, 4] as V3,
  },
];

let anatomyPromise: Promise<Anatomy> | null = null;

function meshGeometry(m: AnatomyMesh) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(m.positions.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    p[i] = m.positions[i]!;
    p[i + 1] = m.positions[i + 2]!;
    p[i + 2] = -m.positions[i + 1]!;
  }
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeVertexNormals();
  return g;
}

type Path = { curve: THREE.CatmullRomCurve3; stage: "retina" | "cortex" };

function pathways(lgnL: V3, lgnR: V3, v1L: V3, v1R: V3): Path[] {
  const out: Path[] = [];
  for (const side of [-1, 1] as const) {
    const eye = side < 0 ? SCHEMATIC.eyeL : SCHEMATIC.eyeR;
    const lgn = side < 0 ? lgnL : lgnR;
    const v1 = side < 0 ? v1L : v1R;
    // Each eye sends fibres to both sides; the nasal half crosses at the chiasm.
    for (const toSide of [-1, 1] as const) {
      const target = toSide < 0 ? lgnL : lgnR;
      out.push({
        stage: "retina",
        curve: new THREE.CatmullRomCurve3(
          [
            eye,
            [side * 22, 40, -30],
            [side * 9, 14, -20],
            SCHEMATIC.chiasm,
            [toSide * 12, -6, -12],
            [toSide * 19, -16, -10],
            target,
          ].map((p) => w(p as V3)),
        ),
      });
    }
    out.push({
      stage: "cortex",
      curve: new THREE.CatmullRomCurve3(
        [lgn, [side * 33, -34, -2], [side * 31, -58, 2], [side * 20, -76, 3], v1].map((p) =>
          w(p as V3),
        ),
      ),
    });
  }
  return out;
}

type Props = { retina: number; v1: number };

export function CortexPathway({ retina, v1 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const labelEls = useRef(new Map<string, HTMLDivElement>());
  const lineEls = useRef(new Map<string, SVGLineElement>());
  const levels = useRef({ retina, v1 });
  levels.current = { retina, v1 };
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError("WebGL is not available in this browser.");
      return;
    }
    let disposed = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x050a1e, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.style.display = "block";
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x050a1e, 260, 520);
    scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x0a0f2a, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(-120, 200, -160);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
    camera.position.set(-205, 95, -120);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.target.set(0, 0, 15);
    controls.minDistance = 140;
    controls.maxDistance = 520;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    renderer.domElement.addEventListener("pointerdown", () => (controls.autoRotate = false), {
      once: true,
    });

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.15);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const trash: { dispose(): void }[] = [];
    const glow: { v1: THREE.MeshStandardMaterial[]; lgn: THREE.MeshStandardMaterial[] } = {
      v1: [],
      lgn: [],
    };
    const pulses: { mesh: THREE.Mesh; path: Path; offset: number; speed: number }[] = [];
    const tubes: { mat: THREE.MeshBasicMaterial; stage: Path["stage"] }[] = [];
    const anchors = new Map<string, THREE.Vector3>();
    for (const l of LABELS) anchors.set(l.key, w(l.at));

    (anatomyPromise ??= loadAnatomy())
      .then((an) => {
        if (disposed) return;
        const add = (key: string, mat: THREE.Material) => {
          const m = an.meshes.get(key);
          if (!m || !m.indices.length) return null;
          const g = meshGeometry(m);
          trash.push(g, mat);
          const mesh = new THREE.Mesh(g, mat);
          scene.add(mesh);
          return m;
        };
        // Glass cortex: transparent face-on, glowing at grazing angles.
        add(
          "cortex",
          new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            uniforms: { tint: { value: new THREE.Color(0x6f8dff) } },
            vertexShader: `
              varying vec3 vN; varying vec3 vV;
              void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vN = normalize(normalMatrix * normal);
                vV = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
              }`,
            fragmentShader: `
              uniform vec3 tint; varying vec3 vN; varying vec3 vV;
              void main() {
                float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
                gl_FragColor = vec4(tint * (0.006 + 0.22 * rim), 1.0);
              }`,
          }),
        );
        add(
          "thalamus",
          new THREE.MeshStandardMaterial({
            color: 0x3a4f8f,
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
          }),
        );
        const v1Mat = new THREE.MeshStandardMaterial({
          color: 0x8a6bff,
          emissive: 0x8a6bff,
          roughness: 0.4,
        });
        const lgnMat = new THREE.MeshStandardMaterial({
          color: 0x7fd8ff,
          emissive: 0x7fd8ff,
          roughness: 0.4,
        });
        glow.v1.push(v1Mat);
        glow.lgn.push(lgnMat);
        const v1 = add("v1", v1Mat);
        const lgn = add("lgn", lgnMat);
        const side = (m: AnatomyMesh | null, s: "left" | "right", fb: V3): V3 => {
          const p = m?.sides?.[s];
          return p ? [p[0], p[1], p[2]] : fb;
        };
        const paths = pathways(
          side(lgn, "left", [-24, -24, -8]),
          side(lgn, "right", [24, -24, -7]),
          side(v1, "left", [-8, -88, 1]),
          side(v1, "right", [11, -80, 4]),
        );
        const pulseGeo = new THREE.SphereGeometry(1.6, 12, 8);
        trash.push(pulseGeo);
        for (const p of paths) {
          const g = new THREE.TubeGeometry(
            p.curve,
            120,
            p.stage === "retina" ? 1.1 : 1.6,
            10,
            false,
          );
          const mat = new THREE.MeshBasicMaterial({
            color: p.stage === "retina" ? 0x7fd8ff : 0xa58bff,
            transparent: true,
            opacity: 0.35,
          });
          trash.push(g, mat);
          scene.add(new THREE.Mesh(g, mat));
          tubes.push({ mat, stage: p.stage });
          const pmat = new THREE.MeshBasicMaterial({
            color: p.stage === "retina" ? 0xc9f1ff : 0xe0d6ff,
            transparent: true,
          });
          trash.push(pmat);
          for (let k = 0; k < 9; k++) {
            const mesh = new THREE.Mesh(pulseGeo, pmat);
            scene.add(mesh);
            pulses.push({
              mesh,
              path: p,
              offset: k / 9 + Math.random() * 0.05,
              speed: p.stage === "retina" ? 0.32 : 0.26,
            });
          }
        }
        // Eyes: schematic globes with an iris.
        for (const pos of [SCHEMATIC.eyeL, SCHEMATIC.eyeR]) {
          const g = new THREE.SphereGeometry(12, 40, 28);
          const mat = new THREE.MeshPhysicalMaterial({
            color: 0x8f8a84,
            roughness: 0.35,
            clearcoat: 1,
          });
          const iris = new THREE.CircleGeometry(5.2, 40);
          const imat = new THREE.MeshStandardMaterial({
            color: 0x4f7fb0,
            emissive: 0x1e63c4,
            emissiveIntensity: 0.4,
          });
          trash.push(g, mat, iris, imat);
          const eye = new THREE.Mesh(g, mat);
          eye.position.copy(w(pos));
          const ir = new THREE.Mesh(iris, imat);
          ir.position.set(0, 0, -11.9);
          ir.rotation.y = Math.PI;
          eye.add(ir);
          scene.add(eye);
        }
        setReady(true);
      })
      .catch(
        (e: Error) => !disposed && setError(`Brain anatomy could not be loaded: ${e.message}`),
      );

    const resize = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      renderer.setSize(W, H, false);
      composer.setSize(W, H);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const v = new THREE.Vector3();
    const t0 = performance.now();
    renderer.setAnimationLoop(() => {
      const t = (performance.now() - t0) / 1000;
      const { retina: r, v1: c } = levels.current;
      for (const m of glow.v1) m.emissiveIntensity = 0.08 + 1.6 * c;
      for (const m of glow.lgn) m.emissiveIntensity = 0.08 + 1.4 * r;
      for (const tb of tubes) tb.mat.opacity = 0.12 + 0.4 * (tb.stage === "retina" ? r : c);
      for (const p of pulses) {
        const level = p.path.stage === "retina" ? r : c;
        const u = (t * p.speed + p.offset) % 1;
        p.mesh.position.copy(p.path.curve.getPointAt(u));
        // A share of pulses proportional to the signal is shown.
        const shown = (p.offset * 9) % 1 < level + 0.02;
        p.mesh.visible = shown && level > 0.01;
        p.mesh.scale.setScalar(0.6 + level);
      }
      controls.update();
      composer.render();

      const W = el.clientWidth;
      const H = el.clientHeight;
      const reach = Math.min(70, W / 9);
      const boxes: {
        k: string;
        ax: number;
        ay: number;
        x: number;
        y: number;
        hw: number;
        hh: number;
        on: boolean;
      }[] = [];
      for (const [k, a] of anchors) {
        const lab = labelEls.current.get(k);
        if (!lab) continue;
        v.copy(a).project(camera);
        const ax = ((v.x + 1) / 2) * W;
        const ay = ((1 - v.y) / 2) * H;
        // Push each label outward from the centre of the view, along its anchor's direction.
        let dx = ax - W / 2;
        let dy = ay - H / 2;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        boxes.push({
          k,
          ax,
          ay,
          x: ax + dx * reach,
          y: ay + dy * reach * 0.6,
          hw: lab.offsetWidth / 2 + 4,
          hh: lab.offsetHeight / 2 + 3,
          on: v.z < 1,
        });
      }
      // Separate overlapping labels vertically, a few relaxation passes.
      for (let it = 0; it < 12; it++) {
        let moved = false;
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            const ox = a.hw + b.hw - Math.abs(a.x - b.x);
            const oy = a.hh + b.hh - Math.abs(a.y - b.y);
            if (ox <= 0 || oy <= 0) continue;
            const push = oy / 2 + 1;
            const dir = a.y <= b.y ? -1 : 1;
            a.y += dir * push;
            b.y -= dir * push;
            moved = true;
          }
        for (const b of boxes) {
          b.x = Math.min(W - b.hw, Math.max(b.hw, b.x));
          b.y = Math.min(H - b.hh, Math.max(b.hh, b.y));
        }
        if (!moved) break;
      }
      for (const b of boxes) {
        const lab = labelEls.current.get(b.k)!;
        const line = lineEls.current.get(b.k);
        lab.style.transform = `translate(${b.x}px, ${b.y}px) translate(-50%, -50%)`;
        lab.style.opacity = b.on ? "1" : "0";
        if (!line) continue;
        line.setAttribute("x1", String(b.ax));
        line.setAttribute("y1", String(b.ay));
        line.setAttribute("x2", String(b.x));
        line.setAttribute("y2", String(b.y));
      }
    });

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      for (const t of trash) t.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={host}
      className="absolute inset-0 overflow-hidden"
      role="img"
      aria-label="Visual pathway from the eyes to the visual cortex"
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {LABELS.map((l) => (
          <line
            key={l.key}
            ref={(e) => {
              if (e) lineEls.current.set(l.key, e);
            }}
            stroke="#c9d6ff"
            strokeOpacity="0.35"
          />
        ))}
      </svg>
      {LABELS.map((l) => (
        <div
          key={l.key}
          ref={(e) => {
            if (e) labelEls.current.set(l.key, e);
          }}
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-full border border-white/15 bg-[color:var(--kv-0b1433)]/85 px-2.5 py-1 text-[11px] leading-tight text-white backdrop-blur"
        >
          <span className="block font-medium">{l.text}</span>
          <span className="block text-[10px] text-white/60">{l.sub}</span>
        </div>
      ))}
      {!ready && !error && (
        <p className="absolute inset-0 grid place-items-center text-sm text-white/70">
          Loading brain anatomy…
        </p>
      )}
      {error && (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
          {error}
        </p>
      )}
    </div>
  );
}
