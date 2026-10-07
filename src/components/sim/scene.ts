/**
 * The Simulation Window's 3D scene (three.js, imperative).
 *
 * World space is MNI152 RAS millimetres mapped to three.js as
 * (x, y, z)_RAS → (x, z, −y), so +y is superior. The implant is modelled at
 * true scale and placed on the outer brain surface nearest its target.
 *
 * Nothing here computes physiology or physics: activity, beams, pressures and
 * gate decisions come from src/lib/sim and are only drawn.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { ArrayDesign, FieldPlane, Vec3 } from "@/lib/sim/acoustics";
import type { Anatomy, Placement } from "@/lib/sim/anatomy";
import type { Net } from "@/lib/sim/autoconnect";
import type { Stage } from "@/lib/sim/loop";
import type { PortType } from "@/lib/sim/specs";

export type View = "cinematic" | "implant" | "explode" | "section" | "beam";

export const toThree = (p: Vec3 | number[]) => new THREE.Vector3(p[0]!, p[2]!, -p[1]!);

const NET_COLOUR: Record<PortType, number> = {
  electrode: 0x6fd3ff,
  "neural-data": 0x3fa9ff,
  prediction: 0xb58cff,
  intent: 0x41e0a2,
  gate: 0x41e0a2,
  drive: 0xffc04d,
  acoustic: 0xffc04d,
  payload: 0xff8fb3,
  power: 0xff6b5b,
};

/** Which nets carry data in each loop stage (for the packet animation). */
export const STAGE_NETS: Record<Stage, PortType[]> = {
  SENSE: ["electrode"],
  PREDICT: ["neural-data"],
  VERIFY: ["prediction"],
  WRITE: ["intent", "gate", "drive"],
  MEASURE: ["electrode"],
};

type Part = {
  id: string;
  group: THREE.Group;
  slot: THREE.Vector3;
  tray: THREE.Vector3;
  layer: number;
  ports: Record<string, THREE.Vector3>;
  label: HTMLDivElement;
  placed: boolean;
};

type BeamVis = {
  region: string;
  group: THREE.Group;
  cone: THREE.Mesh;
  coneMat: THREE.ShaderMaterial;
  plane: THREE.Mesh | null;
  glow: THREE.Sprite;
  barrier: THREE.Mesh;
  focus: THREE.Vector3;
  reachable: boolean;
};

export type LoopVisual = {
  stage: Stage | null;
  /** 0–1 progress through the current stage. */
  phase: number;
  verified: boolean | null;
  halted: boolean;
  delivered: string[];
  /** Region key → normalised activity 0–1. */
  activity: Record<string, number>;
  /** Region key → plasticity index (1 = baseline). */
  plasticity: Record<string, number>;
  payload: boolean;
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dieTexture(kind: string, accent: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0d1626";
  g.fillRect(0, 0, 256, 256);
  // Bond-pad ring.
  g.fillStyle = "#c9a227";
  for (let i = 0; i < 24; i++) {
    const t = 18 + i * 9;
    g.fillRect(t, 6, 5, 8);
    g.fillRect(t, 242, 5, 8);
    g.fillRect(6, t, 8, 5);
    g.fillRect(242, t, 8, 5);
  }
  // Functional blocks with routing.
  const rnd = (() => {
    let s = kind.length * 977;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  })();
  for (let i = 0; i < 18; i++) {
    const x = 26 + rnd() * 180;
    const y = 26 + rnd() * 180;
    const w = 14 + rnd() * 50;
    const h = 10 + rnd() * 40;
    g.fillStyle = i % 3 === 0 ? accent : i % 3 === 1 ? "#1d3d70" : "#16305e";
    g.globalAlpha = 0.85;
    g.fillRect(x, y, Math.min(w, 230 - x), Math.min(h, 230 - y));
  }
  g.globalAlpha = 1;
  g.strokeStyle = "rgba(127,216,255,0.35)";
  g.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.moveTo(26 + rnd() * 200, 26 + rnd() * 200);
    g.lineTo(26 + rnd() * 200, 26 + rnd() * 200);
    g.stroke();
  }
  g.fillStyle = "rgba(230,239,255,0.9)";
  g.font = "bold 18px monospace";
  g.fillText(kind, 28, 232);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const glassVert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vW;
#include <clipping_planes_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mvPosition.xyz);
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mvPosition;
}`;
const glassFrag = /* glsl */ `
uniform vec3 uColor; uniform vec3 uRim; uniform float uBase; uniform float uRimStrength; uniform float uTime; uniform float uFade;
varying vec3 vN; varying vec3 vV; varying vec3 vW;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
  float scan = 0.5 + 0.5 * sin(vW.y * 0.35 - uTime * 1.2);
  vec3 col = mix(uColor, uRim, f) * (uBase + uRimStrength * f) * (0.85 + 0.15 * scan);
  gl_FragColor = vec4(col * uFade, (uBase + uRimStrength * f) * 0.9 * uFade);
}`;

const pointsVert = /* glsl */ `
attribute float aPhase; uniform float uTime; uniform float uActivity; uniform float uSize; uniform float uPx;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.5 + 0.5 * sin(uTime * (3.0 + 9.0 * uActivity) + aPhase * 6.2831);
  vA = (0.15 + 0.85 * uActivity) * (0.35 + 0.65 * tw);
  // World-sized (mm) points, capped so close-ups do not flood the frame.
  gl_PointSize = clamp(uSize * (0.6 + 0.6 * uActivity) * uPx / -mv.z, 1.0, 7.0);
  gl_Position = projectionMatrix * mv;
}`;
const pointsFrag = /* glsl */ `
uniform vec3 uColor; uniform float uFade; varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5; float r = length(d);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r) * vA * 0.75 * uFade;
  gl_FragColor = vec4(uColor * (0.7 + 0.5 * vA), a);
}`;

const coneVert = /* glsl */ `
varying float vY; varying vec2 vUv;
void main() { vY = uv.y; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const coneFrag = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform float uOn; uniform float uWaves;
varying float vY; varying vec2 vUv;
void main() {
  // vY: 0 at the focus (top), 1 at the aperture.
  float toFocus = 1.0 - vY;
  float waves = 0.55 + 0.45 * sin((toFocus * uWaves - uTime * 6.0) * 6.2831);
  float edge = 0.6 + 0.4 * sin(vUv.x * 6.2831 * 3.0 + uTime);
  float a = uOn * (0.04 + 0.32 * pow(toFocus, 2.2)) * waves * edge;
  gl_FragColor = vec4(uColor * (0.8 + 1.4 * toFocus), a);
}`;

export class SimScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private clock = new THREE.Clock();
  private raf = 0;
  private host: HTMLElement;
  private labels: HTMLElement;
  private glow = glowTexture();

  private brain = new THREE.Group();
  private cortexMat: THREE.ShaderMaterial | null = null;
  private regions = new Map<
    string,
    {
      mesh: THREE.Mesh;
      mat: THREE.MeshStandardMaterial;
      points: THREE.Points;
      pmat: THREE.ShaderMaterial;
      colour: THREE.Color;
      label: HTMLDivElement;
    }
  >();
  private targets = new Set<string>();
  private clip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e6);

  private implant = new THREE.Group();
  private parts = new Map<string, Part>();
  private nets: {
    net: Net;
    curve: THREE.CatmullRomCurve3;
    mesh: THREE.Mesh;
    drawn: number;
    packets: THREE.Sprite[];
  }[] = [];
  private gateRing: THREE.Mesh | null = null;
  private beams: BeamVis[] = [];
  private nanobots: { mesh: THREE.Mesh; path: THREE.CatmullRomCurve3; t: number; speed: number }[] =
    [];

  private explode = 0;
  private explodeTarget = 0;
  private camFrom: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private camTo: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private camT = 1;
  private loop: LoopVisual = {
    stage: null,
    phase: 0,
    verified: null,
    halted: false,
    delivered: [],
    activity: {},
    plasticity: {},
    payload: false,
  };
  private anim: { until: number; fn: (t: number) => void; done?: () => void; start: number }[] = [];
  private view: View = "cinematic";
  private placement: Placement | null = null;
  private showLabels = true;
  /** Pixels per world unit at distance 1 (for world-sized points). */
  private pxScale = 1000;
  private fade = 1;
  private otherFade = 1;

  constructor(host: HTMLElement, labels: HTMLElement) {
    this.host = host;
    this.labels = labels;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    this.scene.background = new THREE.Color(0x01040d);
    this.scene.fog = new THREE.FogExp2(0x01040d, 0.0018);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 3000);
    this.camera.position.set(-260, 120, 230);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 900;
    this.controls.target.set(0, 10, -15);

    this.scene.add(new THREE.HemisphereLight(0x9cc9ff, 0x0a0f20, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-200, 300, 200);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x5ab8ff, 1.2);
    rim.position.set(250, 60, -260);
    this.scene.add(rim);
    const fill = new THREE.PointLight(0xa070ff, 1.2, 0, 0);
    fill.position.set(0, -120, 160);
    this.scene.add(fill);

    this.scene.add(this.brain, this.implant);
    this.addEnvironment();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.resize();
    this.tick();
  }

  private addEnvironment() {
    // Orbital floor rings and a slow starfield: depth cues, not data.
    const ringMat = new THREE.LineBasicMaterial({
      color: 0x1d4f9a,
      transparent: true,
      opacity: 0.35,
    });
    for (const r of [150, 190, 240]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, -95, Math.sin(a) * r - 15));
      }
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    }
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 600 + Math.random() * 900;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(
      new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: 0x6f8fd0,
          size: 1.6,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.55,
        }),
      ),
    );
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pxScale =
      (h * this.renderer.getPixelRatio()) /
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  /* -------------------------------------------------------------- anatomy */

  setAnatomy(an: Anatomy) {
    const toGeom = (positions: Float32Array, indices: Uint32Array) => {
      const p = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        p[i] = positions[i]!;
        p[i + 1] = positions[i + 2]!;
        p[i + 2] = -positions[i + 1]!;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(p, 3));
      g.setIndex(new THREE.BufferAttribute(indices, 1));
      g.computeVertexNormals();
      return g;
    };
    const cortex = an.meshes.get("cortex");
    if (cortex) {
      this.cortexMat = new THREE.ShaderMaterial({
        vertexShader: glassVert,
        fragmentShader: glassFrag,
        uniforms: {
          uColor: { value: new THREE.Color(0x2a6fd6) },
          uRim: { value: new THREE.Color(0x8fe3ff) },
          uBase: { value: 0.05 },
          uRimStrength: { value: 0.6 },
          uTime: { value: 0 },
          uFade: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        clipping: true,
        clippingPlanes: [this.clip],
      });
      const m = new THREE.Mesh(toGeom(cortex.positions, cortex.indices), this.cortexMat);
      m.renderOrder = 5;
      this.brain.add(m);
    }
    for (const [key, mesh] of an.meshes) {
      // Surfaces, not target regions; the scalp is only measured against.
      if (key === "cortex" || key === "outer" || key === "scalp") continue;
      const colour = new THREE.Color(mesh.colour);
      const mat = new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: 0.25,
        roughness: 0.45,
        metalness: 0.1,
        transparent: true,
        opacity: 0.32,
        clippingPlanes: [this.clip],
      });
      const g = toGeom(mesh.positions, mesh.indices);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 2;
      this.brain.add(m);
      // Activity particles sampled from the region's own surface.
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const n = Math.min(500, pos.count);
      const pp = new Float32Array(n * 3);
      const ph = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const k = Math.floor(Math.random() * pos.count);
        pp[i * 3] = pos.getX(k) + (Math.random() - 0.5) * 1.5;
        pp[i * 3 + 1] = pos.getY(k) + (Math.random() - 0.5) * 1.5;
        pp[i * 3 + 2] = pos.getZ(k) + (Math.random() - 0.5) * 1.5;
        ph[i] = Math.random();
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.BufferAttribute(pp, 3));
      pg.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
      const pmat = new THREE.ShaderMaterial({
        vertexShader: pointsVert,
        fragmentShader: pointsFrag,
        uniforms: {
          uTime: { value: 0 },
          uActivity: { value: 0.2 },
          uSize: { value: 0.55 },
          uPx: { value: 1000 },
          uFade: { value: 1 },
          uColor: { value: colour.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(pg, pmat);
      points.renderOrder = 6;
      this.brain.add(points);
      const label = this.makeLabel(mesh.name, "region");
      this.regions.set(key, { mesh: m, mat, points, pmat, colour, label });
    }
  }

  setTargets(keys: string[]) {
    this.targets = new Set(keys);
    for (const [k, r] of this.regions) {
      const on = this.targets.has(k);
      r.mat.opacity = on ? 0.85 : 0.22;
      r.points.visible = true;
      r.label.dataset["kind"] = on ? "target" : "region";
    }
  }

  /* -------------------------------------------------------------- implant */

  /** Build the implant's parts in the tray, at the placement site. */
  buildImplant(placement: Placement, components: string[], design: ArrayDesign) {
    this.clearImplant();
    this.placement = placement;
    const centre = toThree(placement.centre);
    const inward = toThree(placement.normal).normalize();
    const outward = inward.clone().negate();
    this.implant.position.copy(centre.clone().add(outward.clone().multiplyScalar(0.6)));
    this.implant.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);

    const make = (id: string) => this.makePart(id, design);
    components.forEach((id, i) => {
      const part = make(id);
      if (!part) return;
      const a = (i / components.length) * Math.PI * 2;
      part.tray = new THREE.Vector3(Math.cos(a) * 26, Math.sin(a) * 26, 14 + (i % 2) * 4);
      part.group.position.copy(part.tray);
      part.group.scale.setScalar(1.6);
      this.implant.add(part.group);
      this.parts.set(id, part);
    });

    // PRISM gate halo around the whole implant.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(10.5, 0.18, 12, 160),
      new THREE.MeshBasicMaterial({
        color: 0x41e0a2,
        transparent: true,
        opacity: 0,
        toneMapped: false,
      }),
    );
    ring.position.z = 1.2;
    ring.visible = components.includes("prism");
    this.implant.add(ring);
    this.gateRing = ring;
  }

  private clearImplant() {
    for (const p of this.parts.values()) p.label.remove();
    this.parts.clear();
    for (const n of this.nets) for (const s of n.packets) s.removeFromParent();
    this.nets = [];
    for (const b of this.beams) b.group.removeFromParent();
    this.beams = [];
    for (const n of this.nanobots) n.mesh.removeFromParent();
    this.nanobots = [];
    this.implant.clear();
    this.gateRing = null;
  }

  private makePart(id: string, design: ArrayDesign): Part | null {
    const g = new THREE.Group();
    const ports: Record<string, THREE.Vector3> = {};
    let slot = new THREE.Vector3();
    let layer = 0;
    const die = (w: number, h: number, t: number, kind: string, accent: string) => {
      const tex = dieTexture(kind, accent);
      const top = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.35,
        metalness: 0.6,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.12,
        emissiveMap: tex,
      });
      const side = new THREE.MeshStandardMaterial({
        color: 0x1b2433,
        roughness: 0.5,
        metalness: 0.7,
      });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), [side, side, side, side, top, side]);
      m.position.z = t / 2;
      g.add(m);
      // Bond wires to the substrate.
      const wireMat = new THREE.MeshStandardMaterial({
        color: 0xd8b04a,
        metalness: 1,
        roughness: 0.3,
      });
      for (let i = 0; i < 6; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / 6;
        for (const sy of [-1, 1]) {
          const c = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(x, (sy * h) / 2 - sy * 0.15, t),
            new THREE.Vector3(x, sy * (h / 2 + 0.25), t + 0.35),
            new THREE.Vector3(x, sy * (h / 2 + 0.55), 0),
          );
          g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 8, 0.025, 4), wireMat));
        }
      }
      return t;
    };
    switch (id) {
      case "mesh": {
        // Conformal PEDOT:PSS lattice (dark blue) with 1024 gold contacts.
        const R = 7.2;
        const lat = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
          color: 0x1f3fa6,
          emissive: 0x112a7a,
          emissiveIntensity: 0.5,
          roughness: 0.6,
        });
        const seg = (a: THREE.Vector3, b: THREE.Vector3) => {
          const d = b.clone().sub(a);
          const m = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.035, d.length(), 4, 1, true),
            mat,
          );
          m.position.copy(a.clone().add(b).multiplyScalar(0.5));
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
          lat.add(m);
        };
        const s = 0.8;
        for (let q = -10; q <= 10; q++) {
          for (let r = -10; r <= 10; r++) {
            const x = s * (q + r / 2);
            const y = s * r * 0.866;
            if (Math.hypot(x, y) > R) continue;
            const p = new THREE.Vector3(x, y, 0);
            for (const [dx, dy] of [
              [s, 0],
              [s / 2, s * 0.866],
              [-s / 2, s * 0.866],
            ] as const) {
              const qn = new THREE.Vector3(x + dx, y + dy, 0);
              if (Math.hypot(qn.x, qn.y) <= R) seg(p, qn);
            }
          }
        }
        g.add(lat);
        const contacts = new THREE.InstancedMesh(
          new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8),
          new THREE.MeshStandardMaterial({
            color: 0xffd36b,
            emissive: 0x7a5a10,
            emissiveIntensity: 0.6,
            metalness: 1,
            roughness: 0.25,
          }),
          1024,
        );
        const mtx = new THREE.Matrix4();
        const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
        let k = 0;
        for (let i = 0; i < 32; i++)
          for (let j = 0; j < 32; j++) {
            mtx.makeTranslation((i - 15.5) * 0.38, (j - 15.5) * 0.38, 0.02).multiply(rot);
            contacts.setMatrixAt(k++, mtx);
          }
        g.add(contacts);
        slot = new THREE.Vector3(0, 0, 0);
        layer = 0;
        ports["contacts"] = new THREE.Vector3(-6.2, 2.5, 0.05);
        break;
      }
      case "array": {
        const n = design.elementsPerSide;
        const pitch = design.pitchM * 1000;
        const el = pitch * design.fill;
        const backing = new THREE.Mesh(
          new THREE.BoxGeometry(n * pitch + 0.4, n * pitch + 0.4, 0.25),
          new THREE.MeshStandardMaterial({ color: 0x2a3448, metalness: 0.6, roughness: 0.4 }),
        );
        backing.position.z = 0.35;
        g.add(backing);
        const elems = new THREE.InstancedMesh(
          new THREE.BoxGeometry(el, el, 0.22),
          new THREE.MeshStandardMaterial({
            color: 0xdfe8f5,
            emissive: 0xffc04d,
            emissiveIntensity: 0.05,
            metalness: 0.5,
            roughness: 0.3,
          }),
          n * n,
        );
        const mtx = new THREE.Matrix4();
        let k = 0;
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            mtx.makeTranslation((i - (n - 1) / 2) * pitch, (j - (n - 1) / 2) * pitch, 0.11);
            elems.setMatrixAt(k++, mtx);
          }
        g.add(elems);
        g.userData["elements"] = elems;
        slot = new THREE.Vector3(0, 0, 0.15);
        layer = 1;
        ports["drive"] = new THREE.Vector3(0, -(n * pitch) / 2 - 0.2, 0.5);
        ports["gate"] = new THREE.Vector3((n * pitch) / 2 + 0.2, -1, 0.5);
        ports["pwr"] = new THREE.Vector3(-(n * pitch) / 2 - 0.2, -1, 0.5);
        break;
      }
      case "asic": {
        die(3, 3, 0.4, "NB-ASIC-1024", "#2f7bff");
        slot = new THREE.Vector3(-4.6, 2.4, 1.2);
        layer = 2;
        ports["in"] = new THREE.Vector3(-1.5, 0, 0.2);
        ports["out"] = new THREE.Vector3(1.5, 0.6, 0.2);
        ports["pwr"] = new THREE.Vector3(0, -1.5, 0.2);
        break;
      }
      case "synapse": {
        die(2.6, 2.6, 0.4, "SA-PREDICT", "#8f5bff");
        slot = new THREE.Vector3(-0.6, 3.0, 1.2);
        layer = 2;
        ports["in"] = new THREE.Vector3(-1.3, 0, 0.2);
        ports["out"] = new THREE.Vector3(1.3, 0, 0.2);
        ports["pwr"] = new THREE.Vector3(0, -1.3, 0.2);
        break;
      }
      case "prism": {
        die(2.4, 2.4, 0.4, "PR-VERIFY", "#21c08a");
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(1.7, 0.06, 8, 48),
          new THREE.MeshBasicMaterial({ color: 0x41e0a2, toneMapped: false }),
        );
        halo.position.z = 0.45;
        g.add(halo);
        g.userData["halo"] = halo;
        slot = new THREE.Vector3(3.4, 2.6, 1.2);
        layer = 2;
        ports["in"] = new THREE.Vector3(-1.2, 0, 0.2);
        ports["intent"] = new THREE.Vector3(0, -1.2, 0.2);
        ports["gate"] = new THREE.Vector3(1.2, -0.5, 0.2);
        ports["pwr"] = new THREE.Vector3(0.6, -1.2, 0.2);
        break;
      }
      case "steerer": {
        die(1.9, 1.9, 0.35, "EC-STEER", "#ffb020");
        slot = new THREE.Vector3(0.9, -1.4, 1.2);
        layer = 2;
        ports["intent"] = new THREE.Vector3(0.95, 0.4, 0.2);
        ports["gate"] = new THREE.Vector3(0.95, -0.4, 0.2);
        ports["drive"] = new THREE.Vector3(-0.95, 0, 0.2);
        ports["pwr"] = new THREE.Vector3(0, -0.95, 0.2);
        break;
      }
      case "nanobots": {
        const shell = new THREE.Mesh(
          new THREE.CapsuleGeometry(1.1, 2.8, 8, 24),
          new THREE.MeshPhysicalMaterial({
            color: 0xff8fb3,
            transparent: true,
            opacity: 0.28,
            roughness: 0.1,
            metalness: 0,
            emissive: 0x6a1f3f,
            emissiveIntensity: 0.4,
          }),
        );
        shell.rotation.z = Math.PI / 2;
        shell.position.z = 1.1;
        g.add(shell);
        for (let i = 0; i < 10; i++) {
          const a = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.18, 0.45, 4, 10),
            new THREE.MeshStandardMaterial({
              color: 0xffd1e0,
              emissive: 0xff5a8f,
              emissiveIntensity: 0.8,
            }),
          );
          a.position.set(-1.5 + (i % 5) * 0.75, i < 5 ? -0.3 : 0.3, 1.1);
          a.rotation.z = (i * 0.7) % Math.PI;
          g.add(a);
        }
        slot = new THREE.Vector3(-5.4, -3.6, 1.2);
        layer = 3;
        ports["gate"] = new THREE.Vector3(2.4, 0, 1.1);
        ports["pwr"] = new THREE.Vector3(0, -1.1, 1.1);
        ports["out"] = new THREE.Vector3(-2.4, 0, 1.1);
        break;
      }
      case "harvester": {
        const coil = new THREE.Mesh(
          new THREE.TorusGeometry(8.6, 0.16, 10, 120),
          new THREE.MeshStandardMaterial({
            color: 0xc87533,
            metalness: 1,
            roughness: 0.3,
            emissive: 0x5a2a0a,
            emissiveIntensity: 0.4,
          }),
        );
        for (let i = 0; i < 4; i++) {
          const c = coil.clone();
          c.scale.setScalar(1 - i * 0.035);
          c.position.z = 0.3 + i * 0.18;
          g.add(c);
        }
        const stack = new THREE.Group();
        for (let i = 0; i < 6; i++) {
          const disc = new THREE.Mesh(
            new THREE.CylinderGeometry(1.4, 1.4, 0.18, 32),
            new THREE.MeshStandardMaterial({
              color: i % 2 ? 0xdfe8f5 : 0x9aa9bf,
              metalness: 0.7,
              roughness: 0.3,
            }),
          );
          disc.rotation.x = Math.PI / 2;
          disc.position.z = 0.4 + i * 0.2;
          stack.add(disc);
        }
        stack.position.set(5.2, -3.4, 0);
        g.add(stack);
        slot = new THREE.Vector3(0, 0, 2.3);
        layer = 4;
        ports["out"] = new THREE.Vector3(5.2, -2, 1.2);
        break;
      }
      default:
        return null;
    }
    // Flex substrate under the dies (attached to the ASIC part so it assembles with it).
    if (id === "asic") {
      const shape = new THREE.Shape();
      const W = 8.5;
      const H = 6.5;
      const r = 1.6;
      shape.moveTo(-W + r, -H);
      shape.lineTo(W - r, -H);
      shape.quadraticCurveTo(W, -H, W, -H + r);
      shape.lineTo(W, H - r);
      shape.quadraticCurveTo(W, H, W - r, H);
      shape.lineTo(-W + r, H);
      shape.quadraticCurveTo(-W, H, -W, H - r);
      shape.lineTo(-W, -H + r);
      shape.quadraticCurveTo(-W, -H, -W + r, -H);
      const board = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false }),
        new THREE.MeshStandardMaterial({
          color: 0xd98b2b,
          transparent: true,
          opacity: 0.55,
          roughness: 0.4,
          emissive: 0x4a2a05,
          emissiveIntensity: 0.3,
        }),
      );
      board.position.set(4.6, -2.4, -0.12);
      g.add(board);
    }
    const label = this.makeLabel(id, "part");
    return { id, group: g, slot, tray: new THREE.Vector3(), layer, ports, label, placed: false };
  }

  private makeLabel(text: string, kind: "part" | "region"): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "sim-label";
    el.dataset["kind"] = kind;
    el.textContent = text;
    this.labels.appendChild(el);
    return el;
  }

  setPartLabel(id: string, text: string) {
    const p = this.parts.get(id);
    if (p) p.label.textContent = text;
  }

  /** Slot position including the explode offset. */
  private slotOf(p: Part, explode = this.explode) {
    return p.slot.clone().add(new THREE.Vector3(0, 0, p.layer * 4.2 * explode));
  }

  private portWorld(p: Part, port: string): THREE.Vector3 {
    const local = (p.ports[port] ?? new THREE.Vector3())
      .clone()
      .multiply(p.group.scale)
      .add(p.group.position);
    return local; // implant-local
  }

  /** Fly every part to its slot in `order`, wiring nets as both ends land. */
  assemble(
    order: string[],
    nets: Net[],
    onStep?: (id: string, netsDone: Net[]) => void,
  ): Promise<void> {
    const per = 0.75;
    const now = this.clock.getElapsedTime();
    return new Promise((resolve) => {
      order.forEach((id, i) => {
        const p = this.parts.get(id);
        if (!p) return;
        const start = now + i * per;
        const from = p.tray.clone();
        this.anim.push({
          start,
          until: start + per,
          fn: (t) => {
            const e = ease(t);
            const to = this.slotOf(p);
            const ctrl = from
              .clone()
              .lerp(to, 0.5)
              .add(new THREE.Vector3(0, 0, 10));
            const a = from.clone().lerp(ctrl, e);
            const b = ctrl.clone().lerp(to, e);
            p.group.position.copy(a.lerp(b, e));
            p.group.scale.setScalar(1.6 - 0.6 * e);
            p.group.rotation.z = (1 - e) * 1.2;
          },
          done: () => {
            p.placed = true;
            p.group.position.copy(this.slotOf(p));
            p.group.scale.setScalar(1);
            p.group.rotation.z = 0;
            this.flash(p.group.position);
            const ready = nets.filter(
              (n) =>
                (n.from.component === id || n.to.component === id) &&
                this.parts.get(n.from.component)?.placed &&
                this.parts.get(n.to.component)?.placed,
            );
            for (const n of ready) this.addNet(n);
            onStep?.(id, ready);
            if (i === order.length - 1) setTimeout(resolve, 600);
          },
        });
      });
    });
  }

  /** Put every part in its slot and wire all nets at once (no animation). */
  placeAll(nets: Net[]) {
    for (const p of this.parts.values()) {
      p.placed = true;
      p.group.position.copy(this.slotOf(p));
      p.group.scale.setScalar(1);
      p.group.rotation.z = 0;
    }
    for (const n of nets) this.addNet(n);
  }

  private flash(at: THREE.Vector3) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glow,
        color: 0x7fd8ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    s.position.copy(at).add(new THREE.Vector3(0, 0, 1));
    this.implant.add(s);
    const t0 = this.clock.getElapsedTime();
    this.anim.push({
      start: t0,
      until: t0 + 0.6,
      fn: (t) => {
        s.scale.setScalar(2 + 10 * t);
        (s.material as THREE.SpriteMaterial).opacity = 1 - t;
      },
      done: () => s.removeFromParent(),
    });
  }

  private netCurve(n: Net): THREE.CatmullRomCurve3 | null {
    const a = this.parts.get(n.from.component);
    const b = this.parts.get(n.to.component);
    if (!a || !b) return null;
    const pa = this.portWorld(a, n.from.port);
    const pb = this.portWorld(b, n.to.port);
    const lift = n.type === "power" ? 0.4 : 0.9 + 0.25 * (this.nets.length % 3);
    const mid = pa.clone().lerp(pb, 0.5);
    mid.z = Math.max(pa.z, pb.z) + lift;
    return new THREE.CatmullRomCurve3([
      pa,
      pa.clone().setZ(pa.z + lift * 0.6),
      mid,
      pb.clone().setZ(pb.z + lift * 0.6),
      pb,
    ]);
  }

  private addNet(n: Net) {
    if (this.nets.some((x) => x.net.id === n.id)) return;
    const curve = this.netCurve(n);
    if (!curve) return;
    const geo = new THREE.TubeGeometry(curve, 64, n.type === "power" ? 0.05 : 0.07, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: NET_COLOUR[n.type],
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const total = geo.index!.count;
    geo.setDrawRange(0, 0);
    this.implant.add(mesh);
    const rec = { net: n, curve, mesh, drawn: 0, packets: [] as THREE.Sprite[] };
    this.nets.push(rec);
    const t0 = this.clock.getElapsedTime();
    this.anim.push({
      start: t0,
      until: t0 + 0.55,
      fn: (t) => geo.setDrawRange(0, Math.floor(total * t)),
      done: () => geo.setDrawRange(0, total),
    });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glow,
          color: NET_COLOUR[n.type],
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        }),
      );
      s.scale.setScalar(0.9);
      this.implant.add(s);
      rec.packets.push(s);
    }
  }

  /** Re-route nets after an explode change. */
  private rerouteNets() {
    for (const r of this.nets) {
      const c = this.netCurve(r.net);
      if (!c) continue;
      r.curve = c;
      const total = (r.mesh.geometry as THREE.TubeGeometry).index!.count;
      r.mesh.geometry.dispose();
      const geo = new THREE.TubeGeometry(c, 64, r.net.type === "power" ? 0.05 : 0.07, 6);
      geo.setDrawRange(0, total);
      r.mesh.geometry = geo;
    }
  }

  /** Remove a set of parts (topology edit) and nets touching them. */
  removeNets() {
    for (const r of this.nets) {
      r.mesh.removeFromParent();
      for (const s of r.packets) s.removeFromParent();
    }
    this.nets = [];
  }

  /* -------------------------------------------------------------- beams */

  setBeams(
    beams: {
      region: string;
      placement: Placement;
      plane: FieldPlane | null;
      lateralFwhmMm: number;
      apertureMm: number;
      reachable: boolean;
      design?: ArrayDesign;
    }[],
  ) {
    for (const b of this.beams) b.group.removeFromParent();
    this.beams = [];
    for (const b of beams) {
      const group = new THREE.Group();
      const start = toThree(b.placement.centre);
      const focus = toThree(b.placement.target);
      const axis = focus.clone().sub(start);
      const len = axis.length();
      const coneMat = new THREE.ShaderMaterial({
        vertexShader: coneVert,
        fragmentShader: coneFrag,
        uniforms: {
          uColor: { value: new THREE.Color(b.reachable ? 0xffc04d : 0xff4b5c) },
          uTime: { value: 0 },
          uOn: { value: 0 },
          uWaves: { value: Math.max(4, Math.min(40, len / 2)) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const cone = new THREE.Mesh(
        new THREE.CylinderGeometry(
          Math.max(0.35, b.lateralFwhmMm / 2),
          b.apertureMm / 2,
          len,
          48,
          24,
          true,
        ),
        coneMat,
      );
      cone.position.copy(start.clone().lerp(focus, 0.5));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
      cone.renderOrder = 8;
      group.add(cone);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glow,
          color: 0xffd27a,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        }),
      );
      glow.position.copy(focus);
      glow.scale.setScalar(6);
      group.add(glow);

      // PRISM barrier: drawn at the array face when the gate halts.
      const barrier = new THREE.Mesh(
        new THREE.CircleGeometry(b.apertureMm * 0.9, 48),
        new THREE.MeshBasicMaterial({
          color: 0xff3b4f,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          toneMapped: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      barrier.position.copy(start.clone().add(axis.clone().normalize().multiplyScalar(1.2)));
      barrier.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
      group.add(barrier);

      let plane: THREE.Mesh | null = null;
      if (b.plane) plane = this.fieldPlane(b.plane);
      if (plane) group.add(plane);

      // A target with its own surface site gets a satellite array on a lead.
      const site = this.placement ? toThree(this.placement.centre) : null;
      if (site && start.distanceTo(site) > 4 && b.design) {
        group.add(this.satellite(b.design, b.placement, site));
      }

      this.scene.add(group);
      this.beams.push({
        region: b.region,
        group,
        cone,
        coneMat,
        plane,
        glow,
        barrier,
        focus,
        reachable: b.reachable,
      });
    }
  }

  /** A satellite 16 × 16 array at its own site, with a flexible lead to the implant. */
  private satellite(design: ArrayDesign, pl: Placement, implantSite: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    const centre = toThree(pl.centre);
    const out = toThree(pl.normal).negate().normalize();
    const n = design.elementsPerSide;
    const pitch = design.pitchM * 1000;
    const holder = new THREE.Group();
    holder.position.copy(centre.clone().add(out.clone().multiplyScalar(0.6)));
    holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out);
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(n * pitch + 0.6, n * pitch + 0.6, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2a3448, metalness: 0.6, roughness: 0.4 }),
    );
    backing.position.z = 0.35;
    holder.add(backing);
    const elems = new THREE.InstancedMesh(
      new THREE.BoxGeometry(pitch * design.fill, pitch * design.fill, 0.22),
      new THREE.MeshStandardMaterial({
        color: 0xdfe8f5,
        emissive: 0xffc04d,
        emissiveIntensity: 0.2,
        metalness: 0.5,
        roughness: 0.3,
      }),
      n * n,
    );
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        m.makeTranslation((i - (n - 1) / 2) * pitch, (j - (n - 1) / 2) * pitch, 0.11);
        elems.setMatrixAt(k++, m);
      }
    holder.add(elems);
    g.add(holder);
    // Lead: arcs out from the brain surface between the two sites.
    const mid = implantSite.clone().lerp(centre, 0.5);
    const lift = mid.clone().normalize().multiplyScalar(18);
    const curve = new THREE.CatmullRomCurve3([
      implantSite.clone().add(out.clone().multiplyScalar(1.5)),
      implantSite.clone().lerp(mid, 0.5).add(lift.clone().multiplyScalar(0.7)),
      mid.clone().add(lift),
      centre.clone().lerp(mid, 0.5).add(lift.clone().multiplyScalar(0.7)),
      centre.clone().add(out.clone().multiplyScalar(1.2)),
    ]);
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 120, 0.35, 8),
        new THREE.MeshStandardMaterial({
          color: 0xd98b2b,
          transparent: true,
          opacity: 0.85,
          emissive: 0x6a3a08,
          emissiveIntensity: 0.6,
        }),
      ),
    );
    return g;
  }

  /** The computed pressure field on the beam plane, as a glowing texture. */
  private fieldPlane(f: FieldPlane): THREE.Mesh {
    const { cols, rows, pressure } = f;
    let max = 0;
    for (const v of pressure) max = Math.max(max, v);
    const data = new Uint8Array(cols * rows * 4);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = max > 0 ? pressure[r * cols + c]! / max : 0;
        const k = (r * cols + c) * 4;
        // Dark → amber → white, alpha follows intensity.
        data[k] = Math.round(255 * Math.min(1, v * 1.6));
        data[k + 1] = Math.round(255 * Math.min(1, v * v * 1.3 + 0.1 * v));
        data[k + 2] = Math.round(255 * Math.min(1, v ** 4));
        data[k + 3] = Math.round(255 * Math.min(1, v * 1.2));
      }
    }
    const tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const w = f.widthM * 1000;
    const h = f.depthM * 1000;
    const geo = new THREE.PlaneGeometry(w, h);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0,
        toneMapped: false,
      }),
    );
    // Plane axes: x across, y along the beam (toward depth).
    const across = toThree([f.across[0], f.across[1], f.across[2]]).normalize();
    const depth = toThree([f.depth[0], f.depth[1], f.depth[2]]).normalize();
    const normal = across.clone().cross(depth).normalize();
    const basis = new THREE.Matrix4().makeBasis(across, depth, normal);
    mesh.quaternion.setFromRotationMatrix(basis);
    const origin = toThree([f.origin[0] * 1000, f.origin[1] * 1000, f.origin[2] * 1000]);
    mesh.position.copy(origin.add(across.multiplyScalar(w / 2)).add(depth.multiplyScalar(h / 2)));
    mesh.renderOrder = 9;
    return mesh;
  }

  /* -------------------------------------------------------------- state */

  setLoop(v: LoopVisual) {
    this.loop = v;
  }

  setView(view: View) {
    this.view = view;
    this.explodeTarget = view === "explode" ? 1 : 0;
    this.bloom.strength = view === "cinematic" ? 0.7 : 0.45;
    const site = this.placement ? toThree(this.placement.centre) : new THREE.Vector3();
    const out = this.placement
      ? toThree(this.placement.normal).negate().normalize()
      : new THREE.Vector3(0, 1, 0);
    let pos: THREE.Vector3;
    let target: THREE.Vector3;
    const side = new THREE.Vector3(0, 1, 0).cross(out).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    switch (view) {
      case "implant":
        target = site.clone();
        pos = site
          .clone()
          .add(out.clone().multiplyScalar(30))
          .add(side.clone().multiplyScalar(22))
          .add(new THREE.Vector3(0, 12, 0));
        break;
      case "explode":
        target = site.clone().add(out.clone().multiplyScalar(8));
        pos = site
          .clone()
          .add(out.clone().multiplyScalar(26))
          .add(side.clone().multiplyScalar(34))
          .add(new THREE.Vector3(0, 6, 0));
        break;
      case "beam": {
        const f = this.beams[0]?.focus ?? site;
        target = site.clone().lerp(f, 0.5);
        const axis = f.clone().sub(site).normalize();
        const perp = axis
          .clone()
          .cross(new THREE.Vector3(0, 1, 0))
          .normalize();
        if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
        pos = target
          .clone()
          .add(perp.multiplyScalar(70))
          .add(new THREE.Vector3(0, 18, 0));
        break;
      }
      case "section": {
        target = (this.beams[0]?.focus ?? site).clone();
        pos = target.clone().add(new THREE.Vector3(-170, 60, 90));
        break;
      }
      default:
        target = new THREE.Vector3(0, 10, -15);
        pos = new THREE.Vector3(-250, 115, 220);
    }
    this.camFrom = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    this.camTo = { pos, target };
    this.camT = 0;
    // Section: clip the brain through the first focus, facing the camera.
    if (view === "section" && this.beams[0]) {
      const f = this.beams[0].focus;
      const n = pos.clone().sub(f).normalize();
      this.clip.setFromNormalAndCoplanarPoint(n.negate(), f);
    } else {
      this.clip.set(new THREE.Vector3(1, 0, 0), 1e6);
    }
  }

  setLabelsVisible(on: boolean) {
    this.showLabels = on;
  }

  /* -------------------------------------------------------------- frame */

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.getElapsedTime();

    // Timed animations.
    this.anim = this.anim.filter((a) => {
      if (t < a.start) return true;
      const k = Math.min(1, (t - a.start) / Math.max(1e-3, a.until - a.start));
      a.fn(k);
      if (k >= 1) {
        a.done?.();
        return false;
      }
      return true;
    });

    // Camera transitions.
    if (this.camTo && this.camFrom && this.camT < 1) {
      this.camT = Math.min(1, this.camT + dt / 1.4);
      const e = ease(this.camT);
      this.camera.position.lerpVectors(this.camFrom.pos, this.camTo.pos, e);
      this.controls.target.lerpVectors(this.camFrom.target, this.camTo.target, e);
    }

    // Explode.
    const prevExplode = this.explode;
    this.explode += (this.explodeTarget - this.explode) * Math.min(1, dt * 4);
    if (Math.abs(this.explode - prevExplode) > 1e-4) {
      for (const p of this.parts.values()) if (p.placed) p.group.position.copy(this.slotOf(p));
      this.rerouteNets();
    }

    // Close-up implant views fade the anatomy so the hardware reads clearly.
    const fadeTo = this.view === "implant" || this.view === "explode" ? 0.2 : 1;
    this.fade += (fadeTo - this.fade) * Math.min(1, dt * 3);
    // Beam and section views thin out the non-target regions around the beam path.
    const otherTo = this.view === "beam" || this.view === "section" ? 0.18 : 1;
    this.otherFade += (otherTo - this.otherFade) * Math.min(1, dt * 3);
    if (this.cortexMat) {
      this.cortexMat.uniforms["uTime"]!.value = t;
      this.cortexMat.uniforms["uFade"]!.value = 0.35 + 0.65 * this.fade;
    }

    // Region activity and plasticity tint (warm = potentiation, cool = depression).
    const L = this.loop;
    for (const [k, r] of this.regions) {
      const a = L.activity[k] ?? 0.2;
      r.pmat.uniforms["uTime"]!.value = t;
      r.pmat.uniforms["uPx"]!.value = this.pxScale;
      r.pmat.uniforms["uActivity"]!.value +=
        (a - r.pmat.uniforms["uActivity"]!.value) * Math.min(1, dt * 6);
      const pl = L.plasticity[k];
      const target = this.targets.has(k);
      if (pl !== undefined && target) {
        const warm = new THREE.Color(0xff8a3d);
        const cool = new THREE.Color(0x3d8bff);
        const c = r.colour.clone().lerp(pl >= 1 ? warm : cool, Math.min(1, Math.abs(pl - 1) * 2.5));
        r.mat.emissive.copy(c);
      }
      const stim = L.delivered.includes(k);
      const f = this.fade * (target ? 1 : this.otherFade);
      r.mat.opacity = (target ? 0.85 : 0.22) * f;
      r.mat.depthWrite = f > 0.6;
      r.pmat.uniforms["uFade"]!.value = f;
      r.mat.emissiveIntensity =
        (target ? 0.28 : 0.1) + a * 0.3 + (stim ? 0.45 + 0.2 * Math.sin(t * 30) : 0);
    }

    // Gate visuals.
    const gateOn = L.verified === true;
    const halted = L.halted;
    if (this.gateRing) {
      const m = this.gateRing.material as THREE.MeshBasicMaterial;
      const want =
        L.stage === "VERIFY" || L.stage === "WRITE" ? 0.95 : halted || gateOn ? 0.55 : 0.12;
      m.opacity += (want - m.opacity) * Math.min(1, dt * 8);
      m.color.setHex(halted ? 0xff3b4f : 0x41e0a2);
      this.gateRing.rotation.z += dt * (halted ? 0.2 : 0.8);
    }
    const prism = this.parts.get("prism");
    const halo = prism?.group.userData["halo"] as THREE.Mesh | undefined;
    if (halo) (halo.material as THREE.MeshBasicMaterial).color.setHex(halted ? 0xff3b4f : 0x41e0a2);

    // Beams: only delivered regions fire.
    for (const b of this.beams) {
      const firing = L.delivered.includes(b.region);
      const want = firing ? 1 : 0;
      const cur = b.coneMat.uniforms["uOn"]!.value as number;
      b.coneMat.uniforms["uOn"]!.value = cur + (want - cur) * Math.min(1, dt * 10);
      b.coneMat.uniforms["uTime"]!.value = t;
      const gm = b.glow.material as THREE.SpriteMaterial;
      gm.opacity += ((firing ? 0.95 : 0) - gm.opacity) * Math.min(1, dt * 8);
      b.glow.scale.setScalar(5 + (firing ? 2 * Math.sin(t * 18) : 0));
      const bm = b.barrier.material as THREE.MeshBasicMaterial;
      bm.opacity += ((halted ? 0.55 : 0) - bm.opacity) * Math.min(1, dt * 8);
      if (b.plane) {
        const pm = b.plane.material as THREE.MeshBasicMaterial;
        const show = this.view === "beam" || this.view === "section" ? 0.95 : firing ? 0.55 : 0;
        pm.opacity += (show - pm.opacity) * Math.min(1, dt * 6);
      }
    }
    const elems = this.parts.get("array")?.group.userData["elements"] as
      THREE.InstancedMesh | undefined;
    if (elems) {
      const m = elems.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = L.delivered.length ? 0.6 + 0.4 * Math.sin(t * 40) : 0.05;
    }

    // Data packets along the nets of the current stage.
    const active = L.stage ? STAGE_NETS[L.stage] : [];
    for (const r of this.nets) {
      const on =
        active.includes(r.net.type) &&
        !(halted && (r.net.type === "gate" || r.net.type === "drive" || r.net.type === "intent"));
      const isPower = r.net.type === "power";
      r.packets.forEach((s, i) => {
        const m = s.material as THREE.SpriteMaterial;
        const visible = on || isPower;
        const speed = isPower ? 0.25 : 1;
        const u = isPower ? (t * speed + i / 3) % 1 : (L.phase + i * 0.12) % 1;
        m.opacity += ((visible ? (isPower ? 0.25 : 0.95) : 0) - m.opacity) * Math.min(1, dt * 10);
        s.position.copy(r.curve.getPointAt(u));
      });
    }

    // Nanorobots: released only on a verified gate with a payload programme.
    this.updateNanobots(dt, L.payload && gateOn);

    this.controls.update();
    this.composer.render();
    this.placeLabels();
  };

  private updateNanobots(dt: number, release: boolean) {
    if (!this.placement || !this.parts.get("nanobots")?.placed) return;
    if (release && this.nanobots.length < 10 && Math.random() < dt * 4) {
      const start = this.implant.localToWorld(
        this.parts
          .get("nanobots")!
          .group.position.clone()
          .add(new THREE.Vector3(-2.4, 0, 1.1)),
      );
      const goal = toThree(this.placement.target).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
        ),
      );
      const mid = start
        .clone()
        .lerp(goal, 0.5)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 8,
          ),
        );
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.25, 0.6, 4, 10),
        new THREE.MeshStandardMaterial({
          color: 0xffd1e0,
          emissive: 0xff5a8f,
          emissiveIntensity: 1.4,
        }),
      );
      this.scene.add(mesh);
      this.nanobots.push({
        mesh,
        path: new THREE.CatmullRomCurve3([start, mid, goal]),
        t: 0,
        speed: 0.12 + Math.random() * 0.08,
      });
    }
    for (const n of this.nanobots) {
      n.t = Math.min(1, n.t + dt * n.speed);
      const p = n.path.getPointAt(n.t);
      n.mesh.position.copy(p);
      n.mesh.lookAt(n.path.getPointAt(Math.min(1, n.t + 0.01)));
      if (n.t >= 1)
        n.mesh.position.add(
          new THREE.Vector3(Math.sin(this.clock.elapsedTime * 3 + n.speed * 100) * 0.4, 0, 0),
        );
    }
  }

  private placeLabels() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const v = new THREE.Vector3();
    const show = (el: HTMLDivElement, world: THREE.Vector3, on: boolean) => {
      v.copy(world).project(this.camera);
      const vis = on && this.showLabels && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.display = vis ? "block" : "none";
      if (vis) el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    };
    const close = this.view === "implant" || this.view === "explode";
    for (const p of this.parts.values()) {
      const world = this.implant.localToWorld(
        p.group.position.clone().add(new THREE.Vector3(0, 0, 1.5)),
      );
      show(p.label, world, close || !p.placed);
    }
    for (const [k, r] of this.regions) {
      const g = r.mesh.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      show(r.label, g.boundingSphere!.center, this.targets.has(k) && !close);
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.innerHTML = "";
  }
}
