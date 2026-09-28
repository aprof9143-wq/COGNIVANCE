import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BRATS_CLASSES, type LabelVolume, type NiftiVolume } from "@/lib/nifti";
import { directionColour, type Tractogram } from "@/lib/tractography";

/**
 * GPU raymarched volume renderer with every layer in one coordinate frame.
 *
 * Layers, all sharing the anatomy's space:
 *   - the MRI volume itself, raymarched on the GPU
 *   - a lesion segmentation, composited so it stays visible through the cortex
 *   - tractography streamlines, coloured by fibre direction
 *   - EEG electrodes projected onto the scalp, lit by band power
 *   - EEG coherence drawn as arcs between electrode pairs
 *
 * Putting these in one frame is the point. Each exists in some tool on its own;
 * seeing a lesion, the fibres running past it and the electrical coupling above
 * it in the same rotating view is what this is for.
 */

export type RenderMode = "volume" | "glass" | "iso";
export type Palette = "neural" | "thermal" | "clinical";
/**
 * fusion  — raymarched MRI with every layer.
 * fibres  — opaque MRI slice planes cutting through the tractogram, the way
 *           diffusion tractography is conventionally shown.
 * tumour  — glass brain with the segmentation drawn as a particle field.
 */
export type Scene = "fusion" | "fibres" | "tumour";

export type Electrode = {
  label: string;
  dir: [number, number, number];
  value: number | null;
};

export type Connection = { a: string; b: string; value: number };

type Props = {
  volume: NiftiVolume;
  mode: RenderMode;
  palette: Palette;
  threshold: number;
  opacity: number;
  cutaway: number;
  slice: number;
  electrodes: Electrode[];
  showElectrodes: boolean;
  connections: Connection[];
  showConnections: boolean;
  tractogram: Tractogram | null;
  showTracts: boolean;
  tractOpacity: number;
  lesion: LabelVolume | null;
  showLesion: boolean;
  /** The demonstration lesion: the callout says so, not "localised". */
  lesionSynthetic: boolean;
  showHud: boolean;
  scene: Scene;
  /**
   * False when a grid-space tractogram (registered to the bundled template) is
   * shown on a different brain; it is then fitted instead of placed exactly.
   */
  tractsRegistered: boolean;
  autoRotate: boolean;
  onHoverElectrode?: (label: string | null) => void;
  hoveredElectrode?: string | null;
};

const VERT = /* glsl */ `
  uniform vec3 uCamera;
  out vec3 vOrigin;
  out vec3 vDirection;
  void main() {
    vOrigin = uCamera;
    vDirection = position - uCamera;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uVolume;
  uniform sampler3D uLabels;
  uniform int uHasLabels;
  uniform float uLesionOpacity;
  uniform vec3 uLesionMin;
  uniform vec3 uLesionMax;
  uniform float uThreshold;
  uniform float uOpacity;
  uniform float uSteps;
  uniform float uCut;
  uniform float uSlice;
  uniform int uMode;      // 0 volume, 1 glass, 2 iso-surface
  uniform int uPalette;   // 0 neural, 1 thermal, 2 clinical
  uniform float uTime;

  in vec3 vOrigin;
  in vec3 vDirection;
  out vec4 outColor;

  vec2 hitBox(vec3 o, vec3 d) {
    vec3 inv = 1.0 / d;
    vec3 t0 = (vec3(-0.5) - o) * inv;
    vec3 t1 = (vec3( 0.5) - o) * inv;
    vec3 lo = min(t0, t1);
    vec3 hi = max(t0, t1);
    return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
  }

  vec2 hitRange(vec3 o, vec3 d, vec3 bmin, vec3 bmax) {
    vec3 inv = 1.0 / d;
    vec3 t0 = (bmin - o) * inv;
    vec3 t1 = (bmax - o) * inv;
    vec3 lo = min(t0, t1);
    vec3 hi = max(t0, t1);
    return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
  }

  float sampleAt(vec3 p) { return texture(uVolume, p + 0.5).r; }

  // Labels are stored as bytes and sampled with NEAREST filtering; linear
  // filtering between label 1 and 4 would invent a 2.5 — a class that is not
  // in the data — along every boundary.
  int labelAt(vec3 p) { return int(texture(uLabels, p + 0.5).r * 255.0 + 0.5); }

  vec3 gradient(vec3 p) {
    const float e = 0.006;
    return vec3(
      sampleAt(p + vec3(e, 0, 0)) - sampleAt(p - vec3(e, 0, 0)),
      sampleAt(p + vec3(0, e, 0)) - sampleAt(p - vec3(0, e, 0)),
      sampleAt(p + vec3(0, 0, e)) - sampleAt(p - vec3(0, 0, e))
    );
  }

  vec3 ramp(float t) {
    t = clamp(t, 0.0, 1.0);
    if (uPalette == 1) {
      return mix(mix(vec3(0.05, 0.02, 0.25), vec3(0.85, 0.12, 0.35), smoothstep(0.0, 0.5, t)),
                 vec3(1.0, 0.86, 0.35), smoothstep(0.5, 1.0, t));
    }
    if (uPalette == 2) return vec3(pow(t, 0.8)) * vec3(0.93, 0.97, 1.0);
    vec3 a = vec3(0.00, 0.06, 0.31);
    vec3 b = vec3(0.12, 0.39, 0.77);
    vec3 c = vec3(0.50, 0.85, 1.00);
    vec3 d = vec3(0.92, 0.97, 1.00);
    if (t < 0.4) return mix(a, b, t / 0.4);
    if (t < 0.78) return mix(b, c, (t - 0.4) / 0.38);
    return mix(c, d, (t - 0.78) / 0.22);
  }

  // BraTS classes: 1 necrotic core, 2 oedema, 3 or 4 enhancing tumour.
  // Kept in sync with BRATS_CLASSES in lib/nifti.ts.
  vec3 labelColour(int l) {
    if (l == 1) return vec3(1.00, 0.36, 0.28);
    if (l == 2) return vec3(0.75, 0.55, 1.00);
    if (l == 3 || l == 4) return vec3(1.00, 0.84, 0.35);
    return vec3(0.85, 0.55, 1.0);
  }

  void main() {
    vec3 rayDir = normalize(vDirection);
    vec2 b = hitBox(vOrigin, rayDir);
    if (b.x > b.y) discard;
    b.x = max(b.x, 0.0);

    vec3 inc = 1.0 / abs(rayDir);
    float delta = min(inc.x, min(inc.y, inc.z)) / uSteps;
    vec3 p = vOrigin + b.x * rayDir;

    vec4 acc = vec4(0.0);
    vec4 lesion = vec4(0.0);
    bool planeDone = false;
    // Where this ray crosses the lesion's bounding box. Rays that miss it get an
    // empty range, so they skip label lookups and terminate early as normal.
    //
    // A ray that MISSES the box still gets a finite range back, with lb.x > lb.y
    // but lb.y possibly large — a ray grazing past might see (1.5, 1.2). Early
    // exit tests t > lb.y, so an unnormalised miss would keep that ray marching
    // to t = 1.2 long after the brain went opaque. Collapse every miss to the
    // canonical empty range so it terminates exactly as if no lesion existed.
    vec2 lb = vec2(1.0, -1.0);
    if (uHasLabels == 1) {
      vec2 h = hitRange(vOrigin, rayDir, uLesionMin, uLesionMax);
      if (h.x <= h.y) lb = h;
    }
    vec3 lightDir = normalize(vec3(0.45, 0.7, 0.55));

    for (int i = 0; i < 768; i++) {
      float t = b.x + float(i) * delta;
      if (t > b.y) break;

      bool cut = uCut > 0.0 && p.y > 0.5 - uCut;

      // Lesion is accumulated on its own channel and never occluded by the
      // brain, so a tumour stays visible through the cortex like an x-ray.
      if (t >= lb.x && t <= lb.y && lesion.a < 0.96) {
        int l = labelAt(p);
        if (l > 0) {
          float la = uLesionOpacity * 0.16;
          // A slow pulse on the enhancing rim draws the eye without faking data.
          if (l == 3 || l == 4) la *= 0.85 + 0.25 * sin(uTime * 2.2);
          lesion.rgb += (1.0 - lesion.a) * la * labelColour(l);
          lesion.a += (1.0 - lesion.a) * la;
        }
      }

      if (!cut && acc.a < 0.97) {
        float d = sampleAt(p);
        if (d > uThreshold) {
          vec3 g = gradient(p);
          float gl = length(g);
          vec3 n = gl > 1e-5 ? -g / gl : vec3(0.0);
          float diffuse = max(dot(n, lightDir), 0.0);
          float rim = pow(1.0 - abs(dot(n, -rayDir)), 2.2);

          float a;
          vec3 col;
          if (uMode == 1) {
            float edge = clamp(gl * 9.0, 0.0, 1.0);
            a = clamp(edge * edge * uOpacity * 0.42, 0.0, 1.0);
            col = ramp(0.32 + 0.42 * edge) * (0.55 + 0.45 * diffuse) + ramp(0.82) * rim * 0.7;
          } else if (uMode == 2) {
            a = 1.0;
            col = ramp(0.55 + 0.4 * d) * (0.25 + 0.85 * diffuse) + ramp(0.95) * rim * 0.55;
          } else {
            float x = smoothstep(uThreshold, 1.0, d);
            a = clamp(x * uOpacity * (0.35 + 2.6 * gl), 0.0, 1.0);
            col = ramp(x) * (0.42 + 0.78 * diffuse) + ramp(0.96) * rim * 0.42 * x;
          }
          acc.rgb += (1.0 - acc.a) * a * col;
          acc.a += (1.0 - acc.a) * a;
        }

        float z = p.z + 0.5;
        if (!planeDone && abs(z - uSlice) < delta * 0.75) {
          planeDone = true;
          float tissue = sampleAt(p);
          if (tissue > uThreshold * 0.6) {
            float band = 0.2 * (1.0 - acc.a) * smoothstep(uThreshold * 0.6, 0.5, tissue);
            acc.rgb += band * vec3(0.5, 0.88, 1.0);
            acc.a += band * 0.35;
          }
        }
      }

      // Once the brain is opaque, keep marching only while the ray is still
      // inside the lesion's box. Without that bound every pixel ran the full
      // step budget whenever a lesion was loaded — a steep frame-rate cost.
      if (acc.a >= 0.97 && (t > lb.y || lesion.a >= 0.96)) break;
      p += rayDir * delta;
    }

    // Dim the brain where lesion sits, then lay the lesion over it.
    vec3 rgb = acc.rgb * (1.0 - lesion.a * 0.72) + lesion.rgb * 1.35;
    float alpha = max(acc.a, lesion.a);
    if (alpha < 0.01) discard;
    outColor = vec4(rgb, alpha);
  }
`;

// Lesion particles: soft round points that twinkle on their own phase. Size is in
// world units and converted to pixels so the field keeps its scale on zoom.
const PARTICLE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixel;
  attribute vec3 colour;
  attribute float phase;
  attribute float size;
  varying vec3 vColour;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.55 + 0.45 * sin(uTime * (1.3 + phase * 0.9) + phase * 6.2831);
    vAlpha = tw;
    vColour = colour;
    gl_PointSize = max(1.5, size * uPixel * (0.75 + 0.45 * tw) / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAG = /* glsl */ `
  varying vec3 vColour;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.2) * vAlpha * 0.8;
    gl_FragColor = vec4(vColour * a, a);
  }
`;

const MODE_INDEX: Record<RenderMode, number> = { volume: 0, glass: 1, iso: 2 };
const PALETTE_INDEX: Record<Palette, number> = { neural: 0, thermal: 1, clinical: 2 };

function projectToScalp(
  vol: NiftiVolume,
  dir: [number, number, number],
  scale: THREE.Vector3,
  threshold: number,
): THREE.Vector3 {
  const [nx, ny, nz] = vol.size;
  const cutoff = Math.max(18, threshold * 255 * 0.7);
  let last = 0.18;
  for (let t = 0.02; t < 0.9; t += 0.004) {
    const gx = (dir[0] * t) / scale.x + 0.5;
    const gy = (dir[1] * t) / scale.y + 0.5;
    const gz = (dir[2] * t) / scale.z + 0.5;
    if (gx < 0 || gx > 1 || gy < 0 || gy > 1 || gz < 0 || gz > 1) break;
    const x = Math.round(gx * (nx - 1));
    const y = Math.round(gy * (ny - 1));
    const z = Math.round(gz * (nz - 1));
    if (vol.data[x + nx * (y + ny * z)]! > cutoff) last = t;
  }
  const r = last + 0.022;
  return new THREE.Vector3(dir[0] * r, dir[1] * r, dir[2] * r);
}

/** Bounding box of tissue in 0–1 grid coordinates, used to seat tractography. */
function tissueBounds(
  vol: NiftiVolume,
  threshold: number,
): { min: THREE.Vector3; max: THREE.Vector3 } {
  const [nx, ny, nz] = vol.size;
  const cut = Math.max(18, threshold * 255);
  const min = new THREE.Vector3(1, 1, 1);
  const max = new THREE.Vector3(0, 0, 0);
  for (let z = 0; z < nz; z += 2) {
    for (let y = 0; y < ny; y += 2) {
      const row = nx * (y + ny * z);
      for (let x = 0; x < nx; x += 2) {
        if (vol.data[row + x]! <= cut) continue;
        const gx = x / (nx - 1);
        const gy = y / (ny - 1);
        const gz = z / (nz - 1);
        if (gx < min.x) min.x = gx;
        if (gy < min.y) min.y = gy;
        if (gz < min.z) min.z = gz;
        if (gx > max.x) max.x = gx;
        if (gy > max.y) max.y = gy;
        if (gz > max.z) max.z = gz;
      }
    }
  }
  if (max.x <= min.x)
    return { min: new THREE.Vector3(0.1, 0.1, 0.1), max: new THREE.Vector3(0.9, 0.9, 0.9) };
  return { min, max };
}

function electrodeColour(v: number): THREE.Color {
  const stops = [
    new THREE.Color(0x0b2a78),
    new THREE.Color(0x1e63c4),
    new THREE.Color(0x7fd8ff),
    new THREE.Color(0xffffff),
  ];
  const t = Math.max(0, Math.min(1, v)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return stops[i]!.clone().lerp(stops[i + 1]!, t - i);
}

type Handles = {
  material?: THREE.ShaderMaterial;
  texture?: THREE.Data3DTexture;
  labelTexture?: THREE.Data3DTexture;
  emptyLabels?: THREE.Data3DTexture;
  mesh?: THREE.Mesh;
  head?: THREE.Group;
  scale?: THREE.Vector3;
  electrodeGroup?: THREE.Group;
  arcGroup?: THREE.Group;
  tractGroup?: THREE.Group;
  lesionGroup?: THREE.Group;
  planeGroup?: THREE.Group;
  hud?: THREE.Group;
  /** Lesion centroid in head-local space; the callout's leader line ends here. */
  calloutAnchor?: THREE.Vector3 | null;
  callout?: HTMLDivElement;
  particleUniforms?: { uTime: { value: number }; uPixel: { value: number } };
  positions?: Map<string, THREE.Vector3>;
};

export function VolumeRenderer(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const handles = useRef<Handles>({});

  /* ------------------------------------------------------------- GL setup */
  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      el.innerHTML =
        '<div style="display:grid;place-items:center;height:100%;color:#8095bf;font:13px system-ui">WebGL2 is unavailable in this browser.</div>';
      return;
    }
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      el.innerHTML =
        '<div style="display:grid;place-items:center;height:100%;color:#8095bf;font:13px system-ui">Volume rendering needs WebGL2.</div>';
      return;
    }
    // Quality ladder. A raymarch costs per pixel, and a retina laptop at full
    // device pixel ratio renders ~3× the pixels for no visible gain on a soft
    // volume. The loop below steps down under load and back up with headroom,
    // so an unknown demo machine stays interactive instead of stuttering.
    const dpr = window.devicePixelRatio || 1;
    const LEVELS = [
      { steps: 300, ratio: Math.min(dpr, 1.5) },
      { steps: 220, ratio: Math.min(dpr, 1.15) },
      { steps: 150, ratio: Math.min(dpr, 0.9) },
      { steps: 110, ratio: Math.min(dpr, 0.7) },
    ];
    let level = 0;
    renderer.setPixelRatio(LEVELS[0]!.ratio);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none";
    // Screen-space overlay for the lesion callout: crisp text and a leader line
    // that tracks the 3D centroid every frame.
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.cssText = "position:absolute;inset:0";
    const leader = document.createElementNS(svgNs, "polyline");
    leader.setAttribute("fill", "none");
    leader.setAttribute("stroke", "#ffd65a");
    leader.setAttribute("stroke-width", "1");
    leader.setAttribute("stroke-opacity", "0.85");
    const dot = document.createElementNS(svgNs, "circle");
    dot.setAttribute("r", "3.5");
    dot.setAttribute("fill", "none");
    dot.setAttribute("stroke", "#ffd65a");
    svg.append(leader, dot);
    const callout = document.createElement("div");
    callout.style.cssText =
      "position:absolute;left:0;top:0;min-width:10.5rem;padding:8px 10px;border:1px solid rgba(255,214,90,0.45);" +
      "background:rgba(3,8,26,0.78);backdrop-filter:blur(6px);border-radius:6px;" +
      "font:10px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.08em;color:#c8d6f0;";
    overlay.append(svg, callout);
    overlay.style.display = "none";
    el.replaceChildren(renderer.domElement, overlay);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 60);

    const orbit = new THREE.Group();
    scene.add(orbit);
    const head = new THREE.Group();
    head.rotation.x = -Math.PI / 2; // RAS superior (+z) becomes screen up
    orbit.add(head);

    // A 1³ placeholder so the shader always has a bound label sampler.
    const emptyLabels = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1);
    emptyLabels.format = THREE.RedFormat;
    emptyLabels.type = THREE.UnsignedByteType;
    emptyLabels.minFilter = THREE.NearestFilter;
    emptyLabels.magFilter = THREE.NearestFilter;
    emptyLabels.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uVolume: { value: null },
        uLabels: { value: emptyLabels },
        uHasLabels: { value: 0 },
        uLesionOpacity: { value: 0.9 },
        uLesionMin: { value: new THREE.Vector3(1, 1, 1) },
        uLesionMax: { value: new THREE.Vector3(-1, -1, -1) },
        uCamera: { value: new THREE.Vector3() },
        uThreshold: { value: 0.1 },
        uOpacity: { value: 0.1 },
        uSteps: { value: 300 },
        uCut: { value: 0 },
        uSlice: { value: 0.5 },
        uMode: { value: 0 },
        uPalette: { value: 0 },
        uTime: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    // Drawn last among transparent objects so lines inside the head read correctly.
    mesh.renderOrder = 2;
    head.add(mesh);

    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x3d8bf5, transparent: true, opacity: 0.1 }),
    );
    mesh.add(frame);

    const electrodeGroup = new THREE.Group();
    const arcGroup = new THREE.Group();
    const tractGroup = new THREE.Group();
    const lesionGroup = new THREE.Group();
    const planeGroup = new THREE.Group();
    head.add(electrodeGroup, arcGroup, tractGroup, lesionGroup, planeGroup);
    const particleUniforms = { uTime: { value: 0 }, uPixel: { value: 600 } };
    tractGroup.renderOrder = 1;

    /* ---- HUD: orbital rings, ticks and drifting motes (screen-fixed frame) ---- */
    const hud = new THREE.Group();
    scene.add(hud);
    const hudMaterials: THREE.Material[] = [];
    const hudGeometries: THREE.BufferGeometry[] = [];

    const ring = (
      radius: number,
      tiltX: number,
      tiltZ: number,
      color: number,
      opacity: number,
      dashed: boolean,
    ) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 256; i++) {
        const a = (i / 256) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = dashed
        ? new THREE.LineDashedMaterial({
            color,
            transparent: true,
            opacity,
            dashSize: 0.02,
            gapSize: 0.035,
          })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const line = new THREE.Line(g, m);
      if (dashed) line.computeLineDistances();
      line.rotation.set(tiltX, 0, tiltZ);
      hudGeometries.push(g);
      hudMaterials.push(m);
      return line;
    };
    const ringA = ring(0.78, 0.32, 0.12, 0x7fd8ff, 0.32, false);
    const ringB = ring(0.86, -0.5, -0.3, 0x3d8bf5, 0.22, true);
    const ringC = ring(0.96, 1.2, 0.4, 0x8a6bff, 0.16, true);
    hud.add(ringA, ringB, ringC);

    // Tick marks on the inner ring, like an instrument bezel.
    const tickPts: number[] = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const r0 = 0.78;
      const r1 = i % 6 === 0 ? 0.815 : 0.795;
      tickPts.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1);
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute("position", new THREE.Float32BufferAttribute(tickPts, 3));
    const tickMat = new THREE.LineBasicMaterial({
      color: 0x7fd8ff,
      transparent: true,
      opacity: 0.4,
    });
    const ticks = new THREE.LineSegments(tickGeo, tickMat);
    ticks.rotation.copy(ringA.rotation);
    hud.add(ticks);
    hudGeometries.push(tickGeo);
    hudMaterials.push(tickMat);

    // Satellites riding the rings.
    const glowTex = makeGlowTexture();
    const sats: {
      sprite: THREE.Sprite;
      ring: THREE.Line;
      radius: number;
      speed: number;
      phase: number;
    }[] = [];
    for (const [r, rad, speed, color] of [
      [ringA, 0.78, 0.45, 0x7fd8ff],
      [ringA, 0.78, 0.45, 0x7fd8ff],
      [ringB, 0.86, -0.3, 0x63b0ff],
      [ringC, 0.96, 0.22, 0xa07cff],
    ] as const) {
      const m = new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(m);
      sprite.scale.setScalar(0.07);
      hud.add(sprite);
      hudMaterials.push(m);
      sats.push({ sprite, ring: r, radius: rad, speed, phase: sats.length * 1.9 });
    }

    // Drifting motes give depth without competing with the data.
    const moteCount = 420;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      const r = 1.1 + Math.random() * 1.6;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      motePos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      motePos[i * 3 + 1] = r * Math.cos(ph) * 0.7;
      motePos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.PointsMaterial({
      color: 0x7fd8ff,
      size: 0.011,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: glowTex,
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

    const grid = new THREE.GridHelper(2.6, 26, 0x1e63c4, 0x0a1f4a);
    grid.position.y = -0.66;
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.3;
    scene.add(grid);

    handles.current = {
      material,
      mesh,
      head,
      electrodeGroup,
      arcGroup,
      tractGroup,
      lesionGroup,
      planeGroup,
      hud,
      emptyLabels,
      callout,
      particleUniforms,
      calloutAnchor: null,
    };

    /* ---- interaction ---- */
    const state = { yaw: 2.55, pitch: 0.22, zoom: 2.05, dragging: false, lx: 0, ly: 0 };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster
        .intersectObjects(electrodeGroup.children, false)
        .find((h: THREE.Intersection) => h.object.userData.label);
      live.current.onHoverElectrode?.(hit ? (hit.object.userData.label as string) : null);
    };
    const down = (e: PointerEvent) => {
      state.dragging = true;
      state.lx = e.clientX;
      state.ly = e.clientY;
      renderer.domElement.setPointerCapture?.(e.pointerId);
      renderer.domElement.style.cursor = "grabbing";
    };
    const up = () => {
      state.dragging = false;
      renderer.domElement.style.cursor = "grab";
    };
    const move = (e: PointerEvent) => {
      if (state.dragging) {
        state.yaw += (e.clientX - state.lx) * 0.008;
        state.pitch = Math.max(-1.35, Math.min(1.35, state.pitch + (e.clientY - state.ly) * 0.006));
        state.lx = e.clientX;
        state.ly = e.clientY;
      } else pick(e);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      state.zoom = Math.max(1.25, Math.min(4.4, state.zoom + e.deltaY * 0.0014));
    };
    const leave = () => live.current.onHoverElectrode?.(null);
    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", down);
    dom.addEventListener("pointerup", up);
    dom.addEventListener("pointercancel", up);
    dom.addEventListener("pointermove", move);
    dom.addEventListener("pointerleave", leave);
    dom.addEventListener("wheel", wheel, { passive: false });

    const resize = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // World size -> pixels at unit distance, for the lesion particles.
      particleUniforms.uPixel.value =
        (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    /* ---- frame loop ---- */
    const local = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    let raf = 0;
    let t = 0;
    let lastFrame = performance.now();
    let ema = 16;
    let calmFrames = 0;
    const applyLevel = (next: number) => {
      level = next;
      material.uniforms.uSteps!.value = LEVELS[level]!.steps;
      renderer.setPixelRatio(LEVELS[level]!.ratio);
      resize();
    };
    const animate = () => {
      t += 0.016;
      const p = live.current;

      // Exponential moving average of frame time, with hysteresis so quality
      // doesn't flicker: step down fast when slow, step up only after a sustained
      // run of comfortable frames.
      const now = performance.now();
      const dt = Math.min(1000, now - lastFrame);
      lastFrame = now;
      ema = ema * 0.9 + dt * 0.1;
      if (ema > 42 && level < LEVELS.length - 1) {
        applyLevel(level + 1);
        ema = 24;
        calmFrames = 0;
      } else if (ema < 20 && level > 0) {
        if (++calmFrames > 150) {
          applyLevel(level - 1);
          calmFrames = 0;
        }
      } else {
        calmFrames = 0;
      }
      if (!state.dragging && p.autoRotate) state.yaw += 0.0019;
      orbit.rotation.set(state.pitch, state.yaw, 0);
      camera.position.set(0, 0, state.zoom);
      camera.lookAt(0, 0, 0);

      scene.updateMatrixWorld();
      local.copy(camera.position);
      mesh.worldToLocal(local);
      material.uniforms.uCamera!.value.copy(local);
      material.uniforms.uTime!.value = t;
      particleUniforms.uTime.value = t;

      // Scene: the fibre view swaps the raymarch for opaque slice planes.
      mesh.visible = p.scene !== "fibres";
      planeGroup.visible = p.scene === "fibres";
      material.uniforms.uLesionOpacity!.value = p.scene === "tumour" ? 0.1 : 0.9;

      // HUD turns slowly on its own axes, independent of the user's orbit.
      hud.visible = p.showHud;
      motes.visible = p.showHud;
      ringA.rotation.y = t * 0.12;
      ticks.rotation.y = t * 0.12;
      ringB.rotation.y = -t * 0.08;
      ringC.rotation.y = t * 0.05;
      for (const s of sats) {
        const a = t * s.speed + s.phase;
        tmp.set(Math.cos(a) * s.radius, 0, Math.sin(a) * s.radius);
        tmp.applyEuler(s.ring.rotation);
        s.sprite.position.copy(tmp);
      }
      motes.rotation.y = t * 0.012;

      // Electrodes breathe; the hovered one pulses.
      const hovered = p.hoveredElectrode;
      for (const child of electrodeGroup.children) {
        const label = child.userData.label as string | undefined;
        if (!label) continue;
        child.scale.setScalar(
          label === hovered ? 1.6 + 0.2 * Math.sin(t * 7) : 1 + 0.06 * Math.sin(t * 2 + child.id),
        );
      }

      // Coherence arcs: dashes flow along each arc, faster when coupling is stronger.
      for (const child of arcGroup.children) {
        const m = (child as THREE.Line).material as THREE.LineDashedMaterial;
        if (m.isLineDashedMaterial)
          m.dashOffset = -t * (0.25 + (child.userData.value as number) * 0.9);
      }

      // Lesion core glow breathes.
      for (const child of lesionGroup.children) {
        if (child.userData.core)
          child.scale.setScalar((child.userData.core as number) * (1 + 0.12 * Math.sin(t * 2.4)));
      }

      renderer.render(scene, camera);

      // Callout: project the centroid to the screen and hang the label off it.
      const anchor = handles.current.calloutAnchor;
      if (anchor && p.showLesion && lesionGroup.children.length) {
        tmp.copy(anchor);
        head.localToWorld(tmp);
        tmp.project(camera);
        const w = el.clientWidth;
        const h = el.clientHeight;
        const ax = ((tmp.x + 1) / 2) * w;
        const ay = ((1 - tmp.y) / 2) * h;
        // Prefer the right: the layer read-out occupies the top-left corner.
        const side = ax > w * 0.64 ? -1 : 1;
        const cw = callout.offsetWidth || 170;
        const ch = callout.offsetHeight || 90;
        const lx = Math.max(12, Math.min(w - cw - 12, ax + side * 110 - (side < 0 ? cw : 0)));
        const ly = Math.max(56, Math.min(h - ch - 12, ay - 120));
        const ex = side > 0 ? lx : lx + cw;
        const ey = ly + 14;
        leader.setAttribute("points", `${ax},${ay} ${ex - side * 26},${ey} ${ex},${ey}`);
        dot.setAttribute("cx", String(ax));
        dot.setAttribute("cy", String(ay));
        callout.style.transform = `translate(${lx}px, ${ly}px)`;
        overlay.style.display = "";
      } else {
        overlay.style.display = "none";
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", down);
      dom.removeEventListener("pointerup", up);
      dom.removeEventListener("pointercancel", up);
      dom.removeEventListener("pointermove", move);
      dom.removeEventListener("pointerleave", leave);
      dom.removeEventListener("wheel", wheel);
      const h = handles.current;
      h.texture?.dispose();
      h.labelTexture?.dispose();
      emptyLabels.dispose();
      for (const g of [electrodeGroup, arcGroup, tractGroup, lesionGroup, planeGroup])
        disposeGroup(g);
      hudGeometries.forEach((g) => g.dispose());
      hudMaterials.forEach((m) => m.dispose());
      moteGeo.dispose();
      moteMat.dispose();
      material.dispose();
      mesh.geometry.dispose();
      frame.geometry.dispose();
      (frame.material as THREE.Material).dispose();
      grid.geometry.dispose();
      gridMat.dispose();
      renderer.dispose();
      el.replaceChildren();
      handles.current = {};
    };
  }, []);

  /* ------------------------------------------------------ volume upload */
  useEffect(() => {
    const { material, mesh } = handles.current;
    if (!material || !mesh) return;
    const [nx, ny, nz] = props.volume.size;
    handles.current.texture?.dispose();
    const texture = new THREE.Data3DTexture(props.volume.data, nx, ny, nz);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    material.uniforms.uVolume!.value = texture;
    handles.current.texture = texture;

    const [ex, ey, ez] = props.volume.extent;
    const m = Math.max(ex, ey, ez) || 1;
    const scale = new THREE.Vector3(ex / m, ey / m, ez / m);
    mesh.scale.copy(scale);
    handles.current.scale = scale;
  }, [props.volume]);

  /* ------------------------------------------------------ lesion upload */
  useEffect(() => {
    const { material, lesionGroup, scale, emptyLabels } = handles.current;
    if (!material || !lesionGroup || !scale || !emptyLabels) return;
    disposeGroup(lesionGroup);
    handles.current.labelTexture?.dispose();
    handles.current.labelTexture = undefined;

    const lesion = props.lesion;
    const on = Boolean(lesion && props.showLesion);
    if (!lesion || !on) {
      material.uniforms.uLabels!.value = emptyLabels;
      material.uniforms.uHasLabels!.value = 0;
      handles.current.calloutAnchor = null;
      return;
    }

    const [nx, ny, nz] = lesion.size;
    const tex = new THREE.Data3DTexture(lesion.labels, nx, ny, nz);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    material.uniforms.uLabels!.value = tex;
    material.uniforms.uHasLabels!.value = 1;
    handles.current.labelTexture = tex;

    // Bounding box of labelled voxels in local space (grid − 0.5), padded by a
    // voxel so the ray range never clips a boundary label.
    let mnx = nx,
      mny = ny,
      mnz = nz,
      mxx = -1,
      mxy = -1,
      mxz = -1;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        const row = nx * (y + ny * z);
        for (let x = 0; x < nx; x++) {
          if (!lesion.labels[row + x]) continue;
          if (x < mnx) mnx = x;
          if (y < mny) mny = y;
          if (z < mnz) mnz = z;
          if (x > mxx) mxx = x;
          if (y > mxy) mxy = y;
          if (z > mxz) mxz = z;
        }
      }
    }
    const pad = 1.5;
    material.uniforms.uLesionMin!.value.set(
      (mnx - pad) / (nx - 1) - 0.5,
      (mny - pad) / (ny - 1) - 0.5,
      (mnz - pad) / (nz - 1) - 0.5,
    );
    material.uniforms.uLesionMax!.value.set(
      (mxx + pad) / (nx - 1) - 0.5,
      (mxy + pad) / (ny - 1) - 0.5,
      (mxz + pad) / (nz - 1) - 0.5,
    );

    // Particle field: every point is a labelled voxel, jittered within it, so
    // the cloud's shape is the segmentation's shape. Enhancing tumour is densest
    // and brightest; oedema is a sparse haze around it.
    const budget: Record<number, { max: number; size: number }> = {
      1: { max: 700, size: 0.0065 },
      2: { max: 900, size: 0.0045 },
      3: { max: 1500, size: 0.0075 },
      4: { max: 1500, size: 0.0075 },
    };
    const byClass = new Map<number, number[]>();
    for (let z = mnz; z <= mxz; z++) {
      for (let y = mny; y <= mxy; y++) {
        const row = nx * (y + ny * z);
        for (let x = mnx; x <= mxx; x++) {
          const l = lesion.labels[row + x]!;
          if (!l) continue;
          let list = byClass.get(l);
          if (!list) byClass.set(l, (list = []));
          list.push(x, y, z);
        }
      }
    }
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const pos: number[] = [];
    const col: number[] = [];
    const phase: number[] = [];
    const size: number[] = [];
    for (const [l, list] of byClass) {
      const n = list.length / 3;
      const cfg = budget[l] ?? { max: 1200, size: 0.009 };
      const take = Math.min(cfg.max, n);
      const rgb = BRATS_CLASSES[l]?.colour ?? [200, 150, 255];
      for (let i = 0; i < take; i++) {
        const k = Math.floor(rnd() * n) * 3;
        pos.push(
          ((list[k]! + rnd() - 0.5) / (nx - 1) - 0.5) * scale.x,
          ((list[k + 1]! + rnd() - 0.5) / (ny - 1) - 0.5) * scale.y,
          ((list[k + 2]! + rnd() - 0.5) / (nz - 1) - 0.5) * scale.z,
        );
        // A few hot white sparks among the class colour read as intensity.
        const spark = rnd() < 0.08 ? 0.55 : 0;
        col.push(
          (rgb[0] / 255) * (1 - spark) + spark,
          (rgb[1] / 255) * (1 - spark) + spark,
          (rgb[2] / 255) * (1 - spark) + spark,
        );
        phase.push(rnd());
        size.push(cfg.size * (0.6 + rnd() * 0.9));
      }
    }
    const { particleUniforms } = handles.current;
    if (pos.length && particleUniforms) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("colour", new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute("phase", new THREE.Float32BufferAttribute(phase, 1));
      g.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
      const cloud = new THREE.Points(
        g,
        new THREE.ShaderMaterial({
          vertexShader: PARTICLE_VERT,
          fragmentShader: PARTICLE_FRAG,
          uniforms: particleUniforms,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      cloud.renderOrder = 12;
      lesionGroup.add(cloud);
    }

    // Callout anchored on the largest labelled region's centroid — it points at
    // real data, never at a guessed location.
    let best = -1;
    let bestCount = 0;
    for (const [label, count] of lesion.counts)
      if (count > bestCount) {
        best = label;
        bestCount = count;
      }
    const c = best > 0 ? lesion.centroids.get(best) : undefined;
    if (!c) {
      handles.current.calloutAnchor = null;
      return;
    }
    const centre = new THREE.Vector3(
      (c[0] - 0.5) * scale.x,
      (c[1] - 0.5) * scale.y,
      (c[2] - 0.5) * scale.z,
    );
    handles.current.calloutAnchor = centre;

    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: 0xffd65a,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    core.position.copy(centre);
    core.userData.core = 0.22;
    core.scale.setScalar(0.22);
    core.renderOrder = 11;
    lesionGroup.add(core);

    const callout = handles.current.callout;
    if (callout) {
      const rows = [...lesion.volumesCm3.entries()]
        .filter(([l]) => BRATS_CLASSES[l])
        .sort((x, y) => y[1] - x[1])
        .map(([l, v]) => {
          const cls = BRATS_CLASSES[l]!;
          const [r, g2, b2] = cls.colour;
          return `<div style="display:flex;justify-content:space-between;gap:14px"><span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;background:rgb(${r},${g2},${b2});box-shadow:0 0 6px rgb(${r},${g2},${b2})"></span>${cls.short}</span><span style="color:#fff">${v.toFixed(2)} cm³</span></div>`;
        })
        .join("");
      const total = [...lesion.volumesCm3.values()].reduce((x, y) => x + y, 0);
      callout.innerHTML =
        `<div style="color:#ffd65a;margin-bottom:4px">${props.lesionSynthetic ? "DEMO LESION · SYNTHETIC" : "LESION · LOCALISED"}</div>${rows}` +
        `<div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,214,90,0.25)"><span>TOTAL</span><span style="color:#fff">${total.toFixed(2)} cm³</span></div>` +
        `<div style="margin-top:3px;color:#7f8fb3">FROM SEGMENTATION LABELS</div>`;
    }
  }, [props.lesion, props.showLesion, props.lesionSynthetic, props.volume]);

  /* ------------------------------------------------------ tractography */
  useEffect(() => {
    const { tractGroup, scale } = handles.current;
    if (!tractGroup || !scale) return;
    disposeGroup(tractGroup);
    const tg = props.tractogram;
    if (!tg || !props.showTracts || tg.count === 0) return;

    const pts = tg.points;
    const grid = tg.space === "grid" && props.tractsRegistered;

    // "grid" tractograms were registered to the bundled template offline and are
    // placed exactly. Anything else is fitted: its extent is mapped onto the
    // brain's tissue extent, shrunk slightly because white matter sits inside
    // the cortical ribbon. That is a fit, not a registration; the UI says so.
    let ox = 0,
      oy = 0,
      oz = 0,
      kx = 1,
      ky = 1,
      kz = 1;
    if (!grid) {
      const tb = tissueBounds(props.volume, props.threshold);
      const shrink = 0.07;
      const gmin = tb.min.clone().lerp(tb.max, shrink);
      const gmax = tb.max.clone().lerp(tb.min, shrink);
      let x0 = Infinity,
        y0 = Infinity,
        z0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity,
        z1 = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i]!,
          y = pts[i + 1]!,
          z = pts[i + 2]!;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      kx = (gmax.x - gmin.x) / (x1 - x0 || 1);
      ky = (gmax.y - gmin.y) / (y1 - y0 || 1);
      kz = (gmax.z - gmin.z) / (z1 - z0 || 1);
      ox = gmin.x - x0 * kx;
      oy = gmin.y - y0 * ky;
      oz = gmin.z - z0 * kz;
    }
    // Grid units differ per axis (the box is the scan's extent); scale deltas
    // back to physical proportions before colouring by direction.
    const dxs = grid ? scale.x : 1;
    const dys = grid ? scale.y : 1;
    const dzs = grid ? scale.z : 1;

    // One LineSegments object for the whole tractogram: a single draw call.
    const segCount = tg.offsets[tg.count]! - tg.count;
    const positions = new Float32Array(segCount * 6);
    const colours = new Float32Array(segCount * 6);
    // A slight lift keeps dark-blue (S–I) bundles legible on the dark stage
    // without washing the direction code toward white.
    const lift = (c: number) => 0.06 + 0.94 * c;
    let w = 0;
    for (let s = 0; s < tg.count; s++) {
      const start = tg.offsets[s]!;
      const end = tg.offsets[s + 1]!;
      for (let i = start; i < end - 1; i++) {
        const ax = pts[i * 3]!,
          ay = pts[i * 3 + 1]!,
          az = pts[i * 3 + 2]!;
        const bx = pts[i * 3 + 3]!,
          by = pts[i * 3 + 4]!,
          bz = pts[i * 3 + 5]!;
        positions[w] = (ox + ax * kx - 0.5) * scale.x;
        positions[w + 1] = (oy + ay * ky - 0.5) * scale.y;
        positions[w + 2] = (oz + az * kz - 0.5) * scale.z;
        positions[w + 3] = (ox + bx * kx - 0.5) * scale.x;
        positions[w + 4] = (oy + by * ky - 0.5) * scale.y;
        positions[w + 5] = (oz + bz * kz - 0.5) * scale.z;
        // Colour from the direction before any fit, so per-axis fitting cannot
        // tint a bundle.
        const [r, g, bl] = directionColour((bx - ax) * dxs, (by - ay) * dys, (bz - az) * dzs);
        // Saturation boost: an oblique fibre mixes all three channels into a
        // pastel. Raising each channel, relative to the strongest, to a power
        // keeps the dominant axis's hue and makes bundles read as bundles.
        const m = Math.max(r, g, bl) || 1;
        colours[w] = colours[w + 3] = lift((r / m) ** 2.2);
        colours[w + 1] = colours[w + 4] = lift((g / m) ** 2.2);
        colours[w + 2] = colours[w + 5] = lift((bl / m) ** 2.2);
        w += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions.subarray(0, w), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colours.subarray(0, w), 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Normal blending, not additive: thousands of overlapping fibres summed
      // additively saturate to a white blob and erase the direction colours.
      opacity: 0.15 + props.tractOpacity * 0.75,
      depthWrite: false,
    });
    tractGroup.add(new THREE.LineSegments(geo, mat));
  }, [
    props.tractogram,
    props.showTracts,
    props.tractOpacity,
    props.tractsRegistered,
    props.volume,
    props.threshold,
  ]);

  /* ------------------------------------------------ fibre-scene planes */
  useEffect(() => {
    const { planeGroup, scale } = handles.current;
    if (!planeGroup || !scale) return;
    disposeGroup(planeGroup);
    if (props.scene !== "fibres") return;

    const vol = props.volume;
    const [nx, ny, nz] = vol.size;
    const cut = Math.max(14, props.threshold * 255 * 0.55);

    // An opaque, softly lit MRI slice. Background voxels are cut away with an
    // alpha test so the plane has the head's outline, not a square edge, and
    // it writes depth so fibres behind it are hidden — which is what makes a
    // tractogram read as three-dimensional.
    const slicePlane = (axis: "x" | "z", at: number) => {
      const [w, h] = axis === "x" ? [ny, nz] : [nx, ny];
      const idx = Math.round(at * ((axis === "x" ? nx : nz) - 1));
      const rgba = new Uint8Array(w * h * 4);
      for (let v = 0; v < h; v++) {
        for (let u = 0; u < w; u++) {
          const val =
            axis === "x" ? vol.data[idx + nx * (u + ny * v)]! : vol.data[u + nx * (v + ny * idx)]!;
          const k = (u + w * v) * 4;
          const g = Math.pow(val / 255, 0.9) * 235;
          rgba[k] = g * 0.86;
          rgba[k + 1] = g * 0.92;
          rgba[k + 2] = g;
          rgba[k + 3] = val > cut ? 255 : 0;
        }
      }
      const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      const corners =
        axis === "x"
          ? [
              [at, 0, 0],
              [at, 1, 0],
              [at, 1, 1],
              [at, 0, 1],
            ]
          : [
              [0, 0, at],
              [1, 0, at],
              [1, 1, at],
              [0, 1, at],
            ];
      const position = new Float32Array(12);
      corners.forEach(([gx, gy, gz], i) => {
        position[i * 3] = (gx! - 0.5) * scale.x;
        position[i * 3 + 1] = (gy! - 0.5) * scale.y;
        position[i * 3 + 2] = (gz! - 0.5) * scale.z;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
      geo.setAttribute(
        "uv",
        new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
      );
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.texture = tex;
      planeGroup.add(mesh);
    };
    slicePlane("x", 0.5);
    slicePlane("z", 0.24);
  }, [props.scene, props.volume, props.threshold]);

  /* -------------------------------------------------- electrodes + arcs */
  useEffect(() => {
    const { electrodeGroup, arcGroup, scale } = handles.current;
    if (!electrodeGroup || !arcGroup || !scale) return;
    disposeGroup(electrodeGroup);
    disposeGroup(arcGroup);

    const positions = new Map<string, THREE.Vector3>();
    for (const e of props.electrodes)
      positions.set(e.label, projectToScalp(props.volume, e.dir, scale, props.threshold));
    handles.current.positions = positions;

    const glowTexture = makeGlowTexture();
    if (props.showElectrodes) {
      for (const e of props.electrodes) {
        const pos = positions.get(e.label)!;
        const colour = e.value === null ? new THREE.Color(0x334766) : electrodeColour(e.value);
        const size = e.value === null ? 0.011 : 0.013 + 0.012 * e.value;
        const node = new THREE.Mesh(
          new THREE.SphereGeometry(size, 20, 20),
          new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.96 }),
        );
        node.position.copy(pos);
        node.userData.label = e.label;
        electrodeGroup.add(node);
        if (e.value !== null) {
          const glow = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: glowTexture,
              color: colour,
              transparent: true,
              opacity: 0.18 + 0.42 * e.value,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            }),
          );
          glow.scale.setScalar(0.05 + 0.07 * e.value);
          node.add(glow);
        }
      }
    }

    if (props.showConnections) {
      const lo = Math.min(...props.connections.map((c) => c.value));
      const hi = Math.max(...props.connections.map((c) => c.value));
      const span = hi - lo || 1;
      for (const c of props.connections) {
        const pa = positions.get(c.a);
        const pb = positions.get(c.b);
        if (!pa || !pb) continue;
        const strength = (c.value - lo) / span;
        // Bulge outward from the head centre so arcs ride above the scalp.
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        const lift = 0.1 + pa.distanceTo(pb) * 0.42;
        const ctrl = mid
          .clone()
          .normalize()
          .multiplyScalar(mid.length() + lift);
        const curve = new THREE.QuadraticBezierCurve3(pa, ctrl, pb);
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
        const colour = new THREE.Color(0x3d8bf5).lerp(new THREE.Color(0xb8f0ff), strength);
        const mat = new THREE.LineDashedMaterial({
          color: colour,
          transparent: true,
          opacity: 0.28 + 0.62 * strength,
          dashSize: 0.018 + 0.02 * strength,
          gapSize: 0.012,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        line.userData.value = strength;
        arcGroup.add(line);
      }
    }
  }, [
    props.electrodes,
    props.showElectrodes,
    props.connections,
    props.showConnections,
    props.volume,
    props.threshold,
  ]);

  /* ------------------------------------------------------ cheap uniforms */
  useEffect(() => {
    const m = handles.current.material;
    if (!m) return;
    m.uniforms.uThreshold!.value = props.threshold;
    m.uniforms.uOpacity!.value = props.opacity;
    m.uniforms.uCut!.value = props.cutaway;
    m.uniforms.uSlice!.value = props.slice;
    m.uniforms.uMode!.value = MODE_INDEX[props.mode];
    m.uniforms.uPalette!.value = PALETTE_INDEX[props.palette];
  }, [props.threshold, props.opacity, props.cutaway, props.slice, props.mode, props.palette]);

  return <div ref={host} className="relative h-full w-full" />;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((o: THREE.Object3D) => {
    const obj = o as THREE.Mesh;
    if (obj.geometry) obj.geometry.dispose();
    const mat = obj.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
    (obj.userData.texture as THREE.Texture | undefined)?.dispose();
  });
  group.clear();
}

let cachedGlow: THREE.Texture | null = null;
function makeGlowTexture(): THREE.Texture {
  if (cachedGlow) return cachedGlow;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  cachedGlow = new THREE.CanvasTexture(c);
  return cachedGlow;
}
