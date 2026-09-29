import { useEffect, useRef } from "react";
import * as THREE from "three";
import { apply, multiply, mat4 } from "@/lib/imaging/geometry";
import type {
  ElectrodeSet,
  ImageVolume,
  Mat4,
  SegmentationVolume,
  Vec3,
} from "@/lib/imaging/types";
import { directionColour, type Tractogram } from "@/lib/tractography";
import { viridis } from "./colormaps";

/**
 * 3D view of the loaded volume, in patient space.
 *
 * Frame: the scene's world group holds LPS millimetres. It is mapped to
 * three.js by the proper rotation (x, y, z)_LPS → (x, z, −y)_three, so +y
 * (three) is Superior and +z (three) is Anterior. Every layer — volume,
 * segmentation, tracts, electrodes — is placed through that one group, so a
 * layer is only ever where its own coordinates put it.
 *
 * The volume is raymarched in its own voxel grid; the mesh's matrix is the
 * volume's ijk → LPS affine, so obliquely acquired or radiologically stored
 * data sits correctly with no resampling.
 */

export type Render3DMode = "composite" | "mip" | "surface";

export type Layers3D = {
  segmentation: {
    seg: SegmentationVolume;
    visible: boolean;
    opacity: number;
    hidden: Set<number>;
  } | null;
  tracts: { tractogram: Tractogram; visible: boolean; opacity: number } | null;
  electrodes: {
    set: ElectrodeSet;
    visible: boolean;
    /** Measured per-electrode value (e.g. relative band power), 0–1 normalised. */
    values: Map<string, number> | null;
  } | null;
  connections: { pairs: { a: string; b: string; value: number }[]; visible: boolean } | null;
};

type Props = {
  volume: ImageVolume;
  win: { center: number; width: number };
  mode: Render3DMode;
  opacity: number;
  threshold: number;
  clip: { min: Vec3; max: Vec3 };
  layers: Layers3D;
  preset: { name: CameraPreset; nonce: number };
  onCanvas?: (c: HTMLCanvasElement | null) => void;
};

export type CameraPreset = "anterior" | "posterior" | "left" | "right" | "superior" | "inferior";

/** Camera direction (from target toward camera), in three.js coordinates. */
const PRESETS: Record<CameraPreset, [number, number, number]> = {
  anterior: [0, 0, 1],
  posterior: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
  superior: [0, 1, 0.0001],
  inferior: [0, -1, 0.0001],
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
  uniform vec3 uClassColour[16];
  uniform float uLabelOpacity;
  uniform float uThreshold;
  uniform float uOpacity;
  uniform int uMode;          // 0 composite, 1 MIP, 2 surface
  uniform mat4 uLocalToLps;
  uniform vec3 uClipMin;
  uniform vec3 uClipMax;
  in vec3 vOrigin;
  in vec3 vDirection;
  out vec4 outColor;

  vec2 hitBox(vec3 o, vec3 d) {
    vec3 inv = 1.0 / d;
    vec3 t0 = (vec3(-0.5) - o) * inv;
    vec3 t1 = (vec3(0.5) - o) * inv;
    vec3 lo = min(t0, t1);
    vec3 hi = max(t0, t1);
    return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
  }
  float sampleAt(vec3 p) { return texture(uVolume, p + 0.5).r; }
  bool clipped(vec3 p) {
    vec3 w = (uLocalToLps * vec4(p, 1.0)).xyz;
    return any(lessThan(w, uClipMin)) || any(greaterThan(w, uClipMax));
  }
  vec3 gradient(vec3 p) {
    const float e = 0.004;
    return vec3(
      sampleAt(p + vec3(e, 0, 0)) - sampleAt(p - vec3(e, 0, 0)),
      sampleAt(p + vec3(0, e, 0)) - sampleAt(p - vec3(0, e, 0)),
      sampleAt(p + vec3(0, 0, e)) - sampleAt(p - vec3(0, 0, e)));
  }

  void main() {
    vec3 dir = normalize(vDirection);
    vec2 b = hitBox(vOrigin, dir);
    if (b.x > b.y) discard;
    b.x = max(b.x, 0.0);
    float delta = 1.0 / 400.0;
    vec4 acc = vec4(0.0);
    vec4 lab = vec4(0.0);
    float mip = 0.0;
    vec3 light = normalize(vec3(0.3, 0.6, 0.75));
    for (int i = 0; i < 1400; i++) {
      float t = b.x + float(i) * delta;
      if (t > b.y) break;
      vec3 p = vOrigin + t * dir;
      if (clipped(p)) continue;
      float v = sampleAt(p);
      if (uMode == 1) { mip = max(mip, v); continue; }
      if (uHasLabels == 1 && lab.a < 0.95) {
        int l = int(texture(uLabels, p + 0.5).r * 255.0 + 0.5);
        if (l > 0 && l < 16) {
          float la = uLabelOpacity * 0.12;
          lab.rgb += (1.0 - lab.a) * la * uClassColour[l];
          lab.a += (1.0 - lab.a) * la;
        }
      }
      if (v <= uThreshold || acc.a >= 0.97) continue;
      vec3 g = gradient(p);
      float gl = length(g);
      vec3 n = gl > 1e-5 ? -g / gl : vec3(0.0);
      float diffuse = 0.35 + 0.65 * max(dot(n, light), 0.0);
      float a = uMode == 2 ? 1.0 : clamp((v - uThreshold) / max(1e-3, 1.0 - uThreshold) * uOpacity * (0.4 + 3.0 * gl), 0.0, 1.0);
      vec3 grey = vec3(uMode == 2 ? 0.82 : v) * diffuse;
      acc.rgb += (1.0 - acc.a) * a * grey;
      acc.a += (1.0 - acc.a) * a;
      if (acc.a >= 0.97 && (uHasLabels == 0 || lab.a >= 0.95)) break;
    }
    if (uMode == 1) {
      if (mip <= uThreshold) discard;
      outColor = vec4(vec3(mip), 1.0);
      return;
    }
    // Labels are laid over the anatomy at their own opacity, so a lesion stays
    // visible without erasing the tissue around it.
    vec3 rgb = acc.rgb * (1.0 - lab.a) + lab.rgb;
    float alpha = max(acc.a, lab.a);
    if (alpha < 0.01) discard;
    outColor = vec4(rgb, alpha);
  }
`;

/** LPS → three.js: (x, y, z) → (x, z, −y). A proper rotation (det = +1). */
const LPS_TO_THREE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);

function toThree(m: Mat4): THREE.Matrix4 {
  const out = new THREE.Matrix4();
  out.set(
    m[0]!,
    m[1]!,
    m[2]!,
    m[3]!,
    m[4]!,
    m[5]!,
    m[6]!,
    m[7]!,
    m[8]!,
    m[9]!,
    m[10]!,
    m[11]!,
    0,
    0,
    0,
    1,
  );
  return out;
}

/** Unit box [−0.5, 0.5]³ → voxel indices, texel centres at the box's 1/(2n). */
function boxToIjk(dims: Vec3): Mat4 {
  return mat4([
    dims[0],
    0,
    0,
    dims[0] / 2 - 0.5,
    0,
    dims[1],
    0,
    dims[1] / 2 - 0.5,
    0,
    0,
    dims[2],
    dims[2] / 2 - 0.5,
    0,
    0,
    0,
    1,
  ]);
}

/**
 * Display texture: the volume windowed to 8 bits, block-averaged when it is
 * too large for a 3D texture. Derived and display-only; the 2D views and every
 * number use the source values.
 */
function displayTexture(vol: ImageVolume, win: { center: number; width: number }) {
  const [nx, ny, nz] = vol.dims;
  const f = Math.max(
    1,
    Math.ceil(Math.cbrt((nx * ny * nz) / (256 * 256 * 256))),
    Math.ceil(Math.max(nx, ny, nz) / 512),
  );
  const tx = Math.ceil(nx / f);
  const ty = Math.ceil(ny / f);
  const tz = Math.ceil(nz / f);
  const out = new Uint8Array(tx * ty * tz);
  const lo = win.center - win.width / 2;
  const s = vol.valueScale;
  for (let z = 0; z < tz; z++) {
    for (let y = 0; y < ty; y++) {
      for (let x = 0; x < tx; x++) {
        let sum = 0;
        let n = 0;
        for (let dz = 0; dz < f; dz++) {
          const k = z * f + dz;
          if (k >= nz) break;
          for (let dy = 0; dy < f; dy++) {
            const j = y * f + dy;
            if (j >= ny) break;
            for (let dx = 0; dx < f; dx++) {
              const i = x * f + dx;
              if (i >= nx) break;
              const raw = vol.data[i + nx * (j + ny * k)]!;
              sum += s ? raw * s.slope + s.intercept : raw;
              n++;
            }
          }
        }
        const v = (sum / n - lo) / win.width;
        const g = Math.max(0, Math.min(1, v));
        out[x + tx * (y + ty * z)] = Math.round(
          (vol.photometric === "MONOCHROME1" ? 1 - g : g) * 255,
        );
      }
    }
  }
  return { data: out, size: [tx, ty, tz] as Vec3, factor: f };
}

/** Segmentation labels resampled (nearest) onto the image texture grid. */
function labelTexture(seg: SegmentationVolume, vol: ImageVolume, size: Vec3, hidden: Set<number>) {
  const [tx, ty, tz] = size;
  const out = new Uint8Array(tx * ty * tz);
  const index = new Map<number, number>();
  seg.classes.forEach((c, i) => {
    if (!hidden.has(c.label) && i < 15) index.set(c.label, i + 1);
  });
  const fx = vol.dims[0] / tx;
  const fy = vol.dims[1] / ty;
  const fz = vol.dims[2] / tz;
  const imgToSeg = multiply(seg.lpsToIjk, vol.ijkToLps);
  const [sx, sy, sz] = seg.dims;
  for (let z = 0; z < tz; z++) {
    for (let y = 0; y < ty; y++) {
      for (let x = 0; x < tx; x++) {
        const p = apply(imgToSeg, [
          (x + 0.5) * fx - 0.5,
          (y + 0.5) * fy - 0.5,
          (z + 0.5) * fz - 0.5,
        ]);
        const i = Math.round(p[0]);
        const j = Math.round(p[1]);
        const k = Math.round(p[2]);
        if (i < 0 || j < 0 || k < 0 || i >= sx || j >= sy || k >= sz) continue;
        out[x + tx * (y + ty * z)] = index.get(seg.labels[i + sx * (j + sy * k)]!) ?? 0;
      }
    }
  }
  return out;
}

function disposeChildren(group: THREE.Group) {
  group.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
    const tex =
      (o as THREE.Sprite).material instanceof THREE.SpriteMaterial
        ? ((o as THREE.Sprite).material as THREE.SpriteMaterial).map
        : null;
    tex?.dispose();
  });
  group.clear();
}

function textSprite(text: string, colour = "#e8eef8"): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 48;
  const g = c.getContext("2d")!;
  g.font = "600 28px ui-monospace, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.85)";
  g.strokeText(text, 64, 24);
  g.fillStyle = colour;
  g.fillText(text, 64, 24);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      depthTest: false,
      transparent: true,
    }),
  );
  s.renderOrder = 20;
  return s;
}

type Handles = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  world: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  layers: { tracts: THREE.Group; electrodes: THREE.Group; connections: THREE.Group };
  orbit: { theta: number; phi: number; radius: number };
  volumeTexture: THREE.Data3DTexture | null;
  labelTexture: THREE.Data3DTexture | null;
  texSize: Vec3 | null;
  emptyLabels: THREE.Data3DTexture;
  unitScale: number;
};

export function Volume3D(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cubeHost = useRef<HTMLCanvasElement>(null);
  const h = useRef<Handles | null>(null);
  const live = useRef(props);
  live.current = props;

  /* ----------------------------------------------------------------- setup */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      el.textContent = "WebGL2 is unavailable; the 3D view cannot be shown.";
      return;
    }
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      el.textContent = "The 3D view needs WebGL2.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 1);
    renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;touch-action:none;cursor:grab";
    el.replaceChildren(renderer.domElement);
    live.current.onCanvas?.(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const world = new THREE.Group();
    world.matrixAutoUpdate = false;
    scene.add(world);

    const emptyLabels = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1);
    emptyLabels.format = THREE.RedFormat;
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
        uClassColour: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
        uLabelOpacity: { value: 0.5 },
        uThreshold: { value: 0.1 },
        uOpacity: { value: 0.5 },
        uMode: { value: 0 },
        uLocalToLps: { value: new THREE.Matrix4() },
        uClipMin: { value: new THREE.Vector3(-1e9, -1e9, -1e9) },
        uClipMax: { value: new THREE.Vector3(1e9, 1e9, 1e9) },
        uCamera: { value: new THREE.Vector3() },
      },
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 2;
    world.add(mesh);
    const tracts = new THREE.Group();
    const electrodes = new THREE.Group();
    const connections = new THREE.Group();
    world.add(tracts, electrodes, connections);

    h.current = {
      renderer,
      camera,
      world,
      mesh,
      material,
      layers: { tracts, electrodes, connections },
      orbit: { theta: 0.5, phi: 1.2, radius: 2.6 },
      volumeTexture: null,
      labelTexture: null,
      texSize: null,
      emptyLabels,
      unitScale: 1,
    };

    // Orientation cube: its own tiny scene, rotated with the camera.
    const cubeRenderer = cubeHost.current
      ? new THREE.WebGLRenderer({ canvas: cubeHost.current, alpha: true, antialias: true })
      : null;
    const cubeScene = new THREE.Scene();
    const cubeCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    const faces = ["L", "R", "S", "I", "A", "P"]; // three.js +x, −x, +y, −y, +z, −z
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      faces.map((f) => {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const g = c.getContext("2d")!;
        g.fillStyle = "#1b2433";
        g.fillRect(0, 0, 64, 64);
        g.strokeStyle = "#6b7a90";
        g.strokeRect(1, 1, 62, 62);
        g.fillStyle = "#e8eef8";
        g.font = "600 34px ui-sans-serif, system-ui";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(f, 32, 34);
        return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) });
      }),
    );
    cubeScene.add(cube);

    let dragging = false;
    let lx = 0;
    let ly = 0;
    const dom = renderer.domElement;
    const down = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    };
    const up = () => (dragging = false);
    const move = (e: PointerEvent) => {
      if (!dragging || !h.current) return;
      const o = h.current.orbit;
      o.theta -= (e.clientX - lx) * 0.008;
      o.phi = Math.min(Math.PI - 0.05, Math.max(0.05, o.phi - (e.clientY - ly) * 0.008));
      lx = e.clientX;
      ly = e.clientY;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (h.current)
        h.current.orbit.radius = Math.min(
          8,
          Math.max(0.8, h.current.orbit.radius * Math.exp(e.deltaY * 0.001)),
        );
    };
    dom.addEventListener("pointerdown", down);
    dom.addEventListener("pointerup", up);
    dom.addEventListener("pointermove", move);
    dom.addEventListener("wheel", wheel, { passive: false });

    const resize = () => {
      const w = Math.max(1, el.clientWidth);
      const hh = Math.max(1, el.clientHeight);
      renderer.setSize(w, hh, false);
      camera.aspect = w / hh;
      camera.updateProjectionMatrix();
      cubeRenderer?.setSize(84, 84, false);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const local = new THREE.Vector3();
    let raf = 0;
    const loop = () => {
      const s = h.current;
      if (!s) return;
      const o = s.orbit;
      camera.position.set(
        o.radius * Math.sin(o.phi) * Math.sin(o.theta),
        o.radius * Math.cos(o.phi),
        o.radius * Math.sin(o.phi) * Math.cos(o.theta),
      );
      camera.lookAt(0, 0, 0);
      scene.updateMatrixWorld();
      local.copy(camera.position);
      mesh.worldToLocal(local);
      material.uniforms["uCamera"]!.value.copy(local);
      renderer.render(scene, camera);
      if (cubeRenderer) {
        cubeCamera.position.copy(camera.position).normalize().multiplyScalar(3.2);
        cubeCamera.lookAt(0, 0, 0);
        cubeRenderer.render(cubeScene, cubeCamera);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", down);
      dom.removeEventListener("pointerup", up);
      dom.removeEventListener("pointermove", move);
      dom.removeEventListener("wheel", wheel);
      const s = h.current;
      s?.volumeTexture?.dispose();
      s?.labelTexture?.dispose();
      emptyLabels.dispose();
      for (const g of [tracts, electrodes, connections]) disposeChildren(g);
      material.dispose();
      mesh.geometry.dispose();
      cube.geometry.dispose();
      (cube.material as THREE.MeshBasicMaterial[]).forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      cubeRenderer?.dispose();
      renderer.dispose();
      live.current.onCanvas?.(null);
      el.replaceChildren();
      h.current = null;
    };
  }, []);

  /* ------------------------------------------------ geometry of the volume */
  useEffect(() => {
    const s = h.current;
    if (!s) return;
    const vol = props.volume;
    const local = multiply(vol.ijkToLps, boxToIjk(vol.dims));
    s.mesh.matrix.copy(toThree(local));
    s.mesh.matrixWorldNeedsUpdate = true;
    s.material.uniforms["uLocalToLps"]!.value.copy(toThree(local));
    // World group: centre the volume and scale its largest extent to ~1 unit.
    const c = apply(vol.ijkToLps, [
      (vol.dims[0] - 1) / 2,
      (vol.dims[1] - 1) / 2,
      (vol.dims[2] - 1) / 2,
    ]);
    const extent = Math.max(...vol.dims.map((d, i) => d * vol.spacing[i]!));
    s.unitScale = 1 / extent;
    const m = new THREE.Matrix4()
      .makeScale(s.unitScale, s.unitScale, s.unitScale)
      .multiply(LPS_TO_THREE)
      .multiply(new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
    s.world.matrix.copy(m);
    s.world.matrixWorldNeedsUpdate = true;
  }, [props.volume]);

  /* --------------------------------------------- display texture (windowed) */
  const { center, width } = props.win;
  useEffect(() => {
    const s = h.current;
    if (!s) return;
    // Debounced: a window drag in 2D should not rebuild the texture per pixel.
    const t = setTimeout(() => {
      const tex = displayTexture(props.volume, { center, width });
      s.volumeTexture?.dispose();
      const texture = new THREE.Data3DTexture(tex.data, tex.size[0], tex.size[1], tex.size[2]);
      texture.format = THREE.RedFormat;
      texture.type = THREE.UnsignedByteType;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
      s.volumeTexture = texture;
      s.texSize = tex.size;
      s.material.uniforms["uVolume"]!.value = texture;
    }, 120);
    return () => clearTimeout(t);
  }, [props.volume, center, width]);

  /* ------------------------------------------------------------- uniforms */
  useEffect(() => {
    const s = h.current;
    if (!s) return;
    const u = s.material.uniforms;
    u["uMode"]!.value = props.mode === "composite" ? 0 : props.mode === "mip" ? 1 : 2;
    u["uOpacity"]!.value = props.opacity;
    u["uThreshold"]!.value = props.threshold;
    u["uClipMin"]!.value.set(...props.clip.min);
    u["uClipMax"]!.value.set(...props.clip.max);
  }, [props.mode, props.opacity, props.threshold, props.clip]);

  /* ------------------------------------------------------- segmentation */
  const seg = props.layers.segmentation;
  useEffect(() => {
    const s = h.current;
    if (!s) return;
    const u = s.material.uniforms;
    s.labelTexture?.dispose();
    s.labelTexture = null;
    if (!seg || !seg.visible) {
      u["uLabels"]!.value = s.emptyLabels;
      u["uHasLabels"]!.value = 0;
      return;
    }
    const t = setTimeout(() => {
      const size = s.texSize ?? props.volume.dims;
      const data = labelTexture(seg.seg, props.volume, size, seg.hidden);
      const tex = new THREE.Data3DTexture(data, size[0], size[1], size[2]);
      tex.format = THREE.RedFormat;
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      s.labelTexture = tex;
      u["uLabels"]!.value = tex;
      u["uHasLabels"]!.value = 1;
      const colours = u["uClassColour"]!.value as THREE.Vector3[];
      seg.seg.classes.forEach((c, i) => {
        if (i < 15) colours[i + 1]!.set(c.colour[0] / 255, c.colour[1] / 255, c.colour[2] / 255);
      });
    }, 150);
    return () => clearTimeout(t);
  }, [seg, seg?.visible, seg?.hidden, props.volume]);
  useEffect(() => {
    const s = h.current;
    if (s && seg) s.material.uniforms["uLabelOpacity"]!.value = seg.opacity;
  }, [seg, seg?.opacity]);

  /* ------------------------------------------------------------- tracts */
  const tr = props.layers.tracts;
  useEffect(() => {
    const s = h.current;
    if (!s) return;
    disposeChildren(s.layers.tracts);
    if (!tr || !tr.visible || tr.tractogram.space !== "lps") return;
    const tg = tr.tractogram;
    const segs = tg.offsets[tg.count]! - tg.count;
    const pos = new Float32Array(segs * 6);
    const col = new Float32Array(segs * 6);
    let w = 0;
    for (let k = 0; k < tg.count; k++) {
      for (let i = tg.offsets[k]!; i < tg.offsets[k + 1]! - 1; i++) {
        const p = tg.points;
        pos.set(
          [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!, p[i * 3 + 3]!, p[i * 3 + 4]!, p[i * 3 + 5]!],
          w,
        );
        // Direction-encoded colour, the tractography convention: red L–R,
        // green A–P, blue S–I. It encodes orientation, not a measured quantity.
        const [r, g, b] = directionColour(
          p[i * 3 + 3]! - p[i * 3]!,
          p[i * 3 + 4]! - p[i * 3 + 1]!,
          p[i * 3 + 5]! - p[i * 3 + 2]!,
        );
        col.set([r, g, b, r, g, b], w);
        w += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, w), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, w), 3));
    s.layers.tracts.add(
      new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: tr.opacity,
          depthWrite: false,
        }),
      ),
    );
  }, [tr, tr?.visible, tr?.opacity]);

  /* ------------------------------------------- electrodes and connections */
  const el = props.layers.electrodes;
  const cn = props.layers.connections;
  useEffect(() => {
    const s = h.current;
    if (!s) return;
    disposeChildren(s.layers.electrodes);
    disposeChildren(s.layers.connections);
    if (!el || !el.visible || !el.set.registered) return;
    const r = 3; // mm
    const byId = new Map(el.set.electrodes.map((e) => [e.id, e.position]));
    for (const e of el.set.electrodes) {
      const v = el.values?.get(e.id);
      const [cr, cg, cb] = v === undefined ? [0.75, 0.78, 0.82] : viridis(v);
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 16, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(cr, cg, cb) }),
      );
      m.position.set(...e.position);
      s.layers.electrodes.add(m);
      const label = textSprite(e.id);
      label.position.set(e.position[0], e.position[1], e.position[2] + 7);
      label.scale.set(16, 6, 1);
      s.layers.electrodes.add(label);
    }
    if (cn && cn.visible && cn.pairs.length) {
      const lo = Math.min(...cn.pairs.map((p) => p.value));
      const hi = Math.max(...cn.pairs.map((p) => p.value));
      for (const p of cn.pairs) {
        const a = byId.get(p.a);
        const b = byId.get(p.b);
        if (!a || !b) continue;
        const t = hi > lo ? (p.value - lo) / (hi - lo) : 1;
        const [cr, cg, cb] = viridis(t);
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...a),
          new THREE.Vector3(...b),
        ]);
        s.layers.connections.add(
          new THREE.Line(
            geo,
            new THREE.LineBasicMaterial({
              color: new THREE.Color(cr, cg, cb),
              transparent: true,
              opacity: 0.35 + 0.6 * t,
            }),
          ),
        );
      }
    }
  }, [el, el?.visible, el?.values, cn, cn?.visible, cn?.pairs]);

  /* -------------------------------------------------------- camera presets */
  useEffect(() => {
    const s = h.current;
    if (!s) return;
    const [x, y, z] = PRESETS[props.preset.name];
    const r = s.orbit.radius;
    s.orbit.phi = Math.acos(Math.max(-1, Math.min(1, y)));
    s.orbit.theta = Math.atan2(x, z);
    s.orbit.radius = r;
  }, [props.preset.name, props.preset.nonce]);

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={host} className="absolute inset-0" />
      <canvas
        ref={cubeHost}
        className="pointer-events-none absolute bottom-2 left-2 h-[84px] w-[84px]"
        aria-hidden
      />
    </div>
  );
}
