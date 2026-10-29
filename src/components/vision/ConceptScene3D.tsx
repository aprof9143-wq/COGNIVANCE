import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BAND_CODES, type Region, type SpectrumMode } from "@/lib/vision/spectrum";

/**
 * CONCEPT. A small 3D meadow in which every surface carries three
 * illustrative values: its visible colour, its ultraviolet reflectance and
 * its near-infrared reflectance. One shader draws the left of the view as a
 * human eye sees it and the right in false colour, using exactly the
 * translation in BAND_CODES (and the 2D composite() it replaces). The split is
 * draggable. Values are chosen to illustrate documented effects, not measured.
 */

type Paint = { vis: string; uv: number; nir: number };

/** Surface kinds the shader treats specially. */
const KIND = { plain: 0, petal: 1, grass: 2, water: 3, sky: 4, foliage: 5 } as const;

export const PAINTS: Record<Region, Paint> = {
  sky: { vis: "#a9cdf5", uv: 0.6, nir: 0.25 },
  hills: { vis: "#86b46a", uv: 0.06, nir: 0.62 },
  grass: { vis: "#5f9e45", uv: 0.05, nir: 0.78 },
  pond: { vis: "#3f7097", uv: 0.2, nir: 0.03 },
  trunk: { vis: "#6e4a2d", uv: 0.05, nir: 0.35 },
  leaves: { vis: "#3b8a4c", uv: 0.04, nir: 0.86 },
  petal: { vis: "#f6ce2c", uv: 0.9, nir: 0.6 },
  "flower centre": { vis: "#8c5a1e", uv: 0.02, nir: 0.4 },
};

const vec = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uKind;
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vLocal;
  varying float vSeed;
  void main() {
    vec3 p = position;
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
      vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
    #else
      vSeed = 0.5;
    #endif
    // Grass blades sway; the tip moves most.
    if (uKind == 2.0) {
      float h = clamp(p.y / 0.5, 0.0, 1.0);
      vec4 base = m * vec4(0.0, 0.0, 0.0, 1.0);
      p.x += h * h * 0.08 * sin(uTime * 1.6 + base.x * 0.7 + base.z * 0.5);
    }
    vLocal = position.xy;
    vec4 w = m * vec4(p, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uVis;
  uniform float uUv;
  uniform float uNir;
  uniform float uKind;
  uniform float uSplit;
  uniform vec2 uRes;
  uniform vec2 uMode;
  uniform vec3 uSun;
  uniform vec3 uCam;
  uniform vec3 uUvColour;
  uniform vec3 uSkyVis;
  uniform vec2 uSkyBands;
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vLocal;
  varying float vSeed;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  // Human view, or the false-colour translation of the same surface.
  vec3 encode(vec3 vis, float uv, float nir, bool concept) {
    vec3 c = vis;
    if (!concept) return c;
    if (uMode.y > 0.5) c = vec3(nir, c.r, c.g);
    if (uMode.x > 0.5) c = mix(c, uUvColour, 0.85 * uv);
    return c;
  }

  void main() {
    bool concept = gl_FragCoord.x / uRes.x > uSplit;
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 vis = uVis;
    float uv = uUv;
    float nir = uNir;

    if (uKind == 4.0) {
      // Sky: lighter toward the horizon.
      float t = clamp(normalize(vW - uCam).y * 2.2, 0.0, 1.0);
      vis = mix(vec3(0.91, 0.95, 1.0), uVis * 0.92, t);
      gl_FragColor = vec4(encode(vis, uv, nir, concept), 1.0);
      return;
    }
    if (uKind == 1.0) {
      // Petals: ultraviolet at the tips, absorbed toward the centre.
      float d = length(vLocal) / 0.26;
      if (d < 0.26) { vis = vec3(0.55, 0.35, 0.12); uv = 0.02; nir = 0.4; }
      else { uv = d > 0.55 ? uUv : 0.04; vis *= 0.92 + 0.08 * d; }
    }
    if (uKind == 5.0) {
      float v = noise(vW.xz * 5.0 + vW.y * 3.0);
      vis *= 0.75 + 0.45 * v;
      nir *= 0.9 + 0.15 * v;
    }
    if (uKind == 2.0) {
      float v = noise(vW.xz * 0.9) * 0.5 + noise(vW.xz * 4.0) * 0.25 + vSeed * 0.25;
      vis *= 0.72 + 0.5 * v;
      nir *= 0.85 + 0.2 * v;
    }

    float diff = max(dot(n, uSun), 0.0);
    float hemi = 0.55 + 0.45 * n.y;
    float light = 0.42 * hemi + 0.78 * diff;

    if (uKind == 3.0) {
      // Water: dark body plus sky reflected at grazing angles.
      vec3 view = normalize(uCam - vW);
      float fres = 0.08 + 0.75 * pow(1.0 - max(view.y, 0.0), 4.0);
      float ripple = noise(vW.xz * 3.0) * 0.06;
      vis = mix(uVis * 0.8, uSkyVis, fres + ripple);
      uv = mix(uv, uSkyBands.x, fres);
      nir = mix(nir, uSkyBands.y, fres * 0.5);
      light = 1.0;
    }

    vec3 col = encode(vis * light, uv * light, nir * light, concept);
    // Haze toward the sky colour with distance.
    float fog = smoothstep(18.0, 70.0, length(vW - uCam));
    vec3 sky = encode(vec3(0.91, 0.95, 1.0), uSkyBands.x, uSkyBands.y, concept);
    gl_FragColor = vec4(mix(col, sky, fog), 1.0);
  }
`;

type Props = { mode: SpectrumMode; onInspect: (r: Region | null) => void };

export function ConceptScene3D({ mode, onInspect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const shared = useRef({
    uSplit: { value: 0.5 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uMode: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uSun: { value: new THREE.Vector3(-0.5, 0.75, 0.45).normalize() },
    uCam: { value: new THREE.Vector3() },
    uUvColour: { value: new THREE.Vector3(...BAND_CODES.uv.colour.map((c) => c / 255)) },
    uSkyVis: { value: vec(PAINTS.sky.vis) },
    uSkyBands: { value: new THREE.Vector2(PAINTS.sky.uv, PAINTS.sky.nir) },
  });
  const inspect = useRef(onInspect);
  inspect.current = onInspect;

  useEffect(() => {
    const u = shared.current;
    u.uMode.value.set(
      mode === "uv" || mode === "both" ? 1 : 0,
      mode === "nir" || mode === "both" ? 1 : 0,
    );
  }, [mode]);
  useEffect(() => {
    shared.current.uSplit.value = split;
  }, [split]);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError("WebGL is not available in this browser, so the 3D scene cannot be drawn.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = "block";
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    camera.position.set(7.5, 2.4, 7.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.6, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 16;
    controls.minPolarAngle = 0.9;
    controls.maxPolarAngle = 1.48;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;

    const trash: { dispose(): void }[] = [];
    const pickable: THREE.Object3D[] = [];
    const material = (region: Region, kind: number) => {
      const p = PAINTS[region];
      const m = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.DoubleSide,
        uniforms: {
          ...shared.current,
          uVis: { value: vec(p.vis) },
          uUv: { value: p.uv },
          uNir: { value: p.nir },
          uKind: { value: kind },
        },
      });
      trash.push(m);
      return m;
    };
    const add = (g: THREE.BufferGeometry, region: Region, kind: number, pick = true) => {
      trash.push(g);
      const mesh = new THREE.Mesh(g, material(region, kind));
      mesh.userData["region"] = region;
      scene.add(mesh);
      if (pick) pickable.push(mesh);
      return mesh;
    };
    const instanced = (
      g: THREE.BufferGeometry,
      region: Region,
      kind: number,
      mats: THREE.Matrix4[],
    ) => {
      trash.push(g);
      const mesh = new THREE.InstancedMesh(g, material(region, kind), mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.userData["region"] = region;
      scene.add(mesh);
      pickable.push(mesh);
      return mesh;
    };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    // Sky and ground.
    add(new THREE.SphereGeometry(180, 32, 16), "sky", KIND.sky);
    const ground = add(new THREE.CircleGeometry(160, 64), "grass", KIND.grass);
    ground.rotation.x = -Math.PI / 2;
    for (const [x, z, sx, sy] of [
      [-40, -60, 40, 9],
      [30, -70, 50, 12],
      [70, -20, 30, 8],
      [-70, 10, 35, 10],
    ] as const) {
      const h = add(new THREE.SphereGeometry(1, 32, 16), "hills", KIND.grass);
      h.position.set(x, -sy * 0.15, z);
      h.scale.set(sx, sy, sx * 0.8);
    }

    // Pond: an ellipse 3.1 × 2.4 around (−2.6, 1.4).
    const inPond = (x: number, z: number, margin: number) =>
      Math.hypot((x + 2.6) / (3.1 + margin), (z - 1.4) / (2.4 + margin)) < 1;
    const pond = add(new THREE.CircleGeometry(2.4, 64), "pond", KIND.water);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(-2.6, 0.02, 1.4);
    pond.scale.set(1.3, 1, 1);

    // A bumpy, smooth-shaded ball: the bumps depend only on direction, so
    // shared vertices move together and the surface stays closed.
    const lump = (radius: number) => {
      const g = mergeVertices(new THREE.IcosahedronGeometry(radius, 3).deleteAttribute("uv"));
      const pos = g.attributes["position"]!;
      const v = new THREE.Vector3();
      const k = rnd() * 10;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const d = v.clone().normalize();
        const f =
          0.86 +
          0.1 * Math.sin(d.x * 7 + k) * Math.sin(d.y * 6 + k) +
          0.06 * Math.sin(d.z * 13 + d.x * 5 + k);
        v.multiplyScalar(f);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      return g;
    };

    // Trees: trunk and a cluster of leafy lumps.
    for (const [x, z, s] of [
      [3.2, -2.6, 1.15],
      [-4.6, -4.2, 1.4],
      [6.4, 2.6, 0.9],
    ] as const) {
      const trunk = add(
        new THREE.CylinderGeometry(0.12 * s, 0.2 * s, 2.2 * s, 10),
        "trunk",
        KIND.plain,
      );
      trunk.position.set(x, 1.1 * s, z);
      for (let k = 0; k < 6; k++) {
        const g = lump(0.75 * s);
        const leaf = add(g, "leaves", KIND.foliage);
        const a = (k / 6) * Math.PI * 2;
        leaf.position.set(
          x + Math.cos(a) * 0.55 * s,
          (2.3 + (k % 2) * 0.5) * s,
          z + Math.sin(a) * 0.55 * s,
        );
      }
      const top = add(lump(0.85 * s), "leaves", KIND.foliage);
      top.position.set(x, 3.0 * s, z);
    }

    // Grass blades.
    const blade = new THREE.BufferGeometry();
    blade.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-0.025, 0, 0, 0.025, 0, 0, 0, 0.5, 0], 3),
    );
    blade.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute([0, 0.4, 1, 0, 0.4, 1, 0, 1, 0.3], 3),
    );
    const bm: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < 5000; i++) {
      const r = 9 * Math.sqrt(rnd());
      const a = rnd() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (inPond(x, z, 0.1)) continue;
      e.set((rnd() - 0.5) * 0.4, rnd() * Math.PI, (rnd() - 0.5) * 0.4);
      const s = 0.6 + rnd() * 0.9;
      bm.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0, z),
          q.setFromEuler(e),
          new THREE.Vector3(s, s, s),
        ),
      );
    }
    instanced(blade, "grass", KIND.grass, bm);

    // Flowers: five-petal heads on stems, in loose clumps.
    const outline = new THREE.Shape();
    for (let i = 0; i <= 100; i++) {
      const a = (i / 100) * Math.PI * 2;
      const r = 0.26 * (0.72 + 0.28 * Math.abs(Math.cos(2.5 * a)));
      if (i) outline.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else outline.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const head = new THREE.ShapeGeometry(outline, 6);
    const stem = new THREE.CylinderGeometry(0.012, 0.016, 1, 5);
    stem.translate(0, 0.5, 0);
    const hm: THREE.Matrix4[] = [];
    const sm: THREE.Matrix4[] = [];
    for (const [cx, cz, n] of [
      [0.6, 1.8, 14],
      [1.8, -0.4, 10],
      [-0.6, 3.6, 12],
      [2.6, 2.8, 9],
      [-1.4, -1.6, 8],
      [0.2, 0.2, 7],
    ] as const) {
      for (let i = 0; i < n; i++) {
        const x = cx + (rnd() - 0.5) * 1.6;
        const z = cz + (rnd() - 0.5) * 1.6;
        if (inPond(x, z, 0.3)) continue;
        const h = 0.35 + rnd() * 0.3;
        sm.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, 0, z),
            q.identity(),
            new THREE.Vector3(1, h, 1),
          ),
        );
        e.set(-Math.PI / 2 + (rnd() - 0.5) * 0.7, 0, rnd() * Math.PI * 2, "XZY");
        const s = 0.75 + rnd() * 0.5;
        hm.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, h, z),
            q.setFromEuler(e),
            new THREE.Vector3(s, s, s),
          ),
        );
      }
    }
    instanced(stem, "leaves", KIND.plain, sm);
    instanced(head, "petal", KIND.petal, hm);

    const resize = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      renderer.setSize(W, H, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      const db = renderer.getDrawingBufferSize(new THREE.Vector2());
      shared.current.uRes.value.copy(db);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Point at a surface to inspect it.
    const ray = new THREE.Raycaster();
    const onMove = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((ev.clientX - r.left) / r.width) * 2 - 1,
          -((ev.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(pickable, false)[0];
      inspect.current((hit?.object.userData["region"] as Region | undefined) ?? null);
    };
    const onLeave = () => inspect.current(null);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointerdown", () => (controls.autoRotate = false), {
      once: true,
    });

    const t0 = performance.now();
    renderer.setAnimationLoop(() => {
      shared.current.uTime.value = (performance.now() - t0) / 1000;
      controls.update();
      shared.current.uCam.value.copy(camera.position);
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      for (const t of trash) t.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Drag the divider.
  const drag = (ev: React.PointerEvent<HTMLDivElement>) => {
    const r = host.current!.getBoundingClientRect();
    setSplit(Math.min(0.97, Math.max(0.03, (ev.clientX - r.left) / r.width)));
  };

  return (
    <div
      ref={host}
      className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-[color:var(--kv-dfeaf7)] ring-1 ring-[var(--v-line)]"
      role="img"
      aria-label="3D meadow: left half as a human eye sees it, right half in false colour"
    >
      <div
        className="absolute inset-y-0 z-10 w-0.5 bg-[color-mix(in_oklab,var(--v-card)_90%,transparent)] shadow-[0_0_0_1px_rgba(22,21,29,0.25)]"
        style={{ left: `${split * 100}%` }}
        aria-hidden
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Split between human view and concept view"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSplit((s) => Math.max(0.03, s - 0.05));
          if (e.key === "ArrowRight") setSplit((s) => Math.min(0.97, s + 0.05));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) drag(e);
        }}
        className="absolute top-1/2 z-20 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none place-items-center rounded-full bg-[var(--v-card)] text-[13px] text-[var(--v-ink)] shadow-[0_4px_16px_rgba(22,21,29,0.25)]"
        style={{ left: `${split * 100}%` }}
      >
        ⇆
      </div>
      <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-[color-mix(in_oklab,var(--v-card)_90%,transparent)] px-2.5 py-1 text-[11px] font-medium">
        Human eye · visible light
      </span>
      <span className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-[color:var(--kv-b0306a)] px-2.5 py-1 text-[11px] font-medium text-white">
        Concept ·{" "}
        {mode === "human"
          ? "same as human"
          : mode === "uv"
            ? "+ ultraviolet"
            : mode === "nir"
              ? "+ near-infrared"
              : "+ UV + near-infrared"}
      </span>
      {error && (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-[var(--v-ink-2)]">
          {error}
        </p>
      )}
    </div>
  );
}
