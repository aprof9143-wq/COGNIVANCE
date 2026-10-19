import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { PARTS, RAY_COLOURS, type PartKey } from "@/lib/vision/eyeContent";
import {
  RETINA_RADIUS,
  rayFan,
  type EyeResult,
  type ObjectPoint,
  type Vec,
} from "@/lib/vision/optics";

/**
 * A cutaway eye. The optical surfaces (cornea, lens, iris position, retina)
 * are drawn at the scale the optics use; other tissues are drawn
 * approximately, and the RPE much thicker than life so it can be seen.
 *
 * Optical coordinates (z along the axis from the cornea, y up) map to world
 * x = z, y = y. Every part is revolved through half a turn (the far half), so
 * the cut face lies in the plane z = 0, where the rays are drawn.
 */

type Props = {
  result: EyeResult;
  distance: number;
  showLabels: boolean;
  showRays: boolean;
  /** Parts to emphasise: the selected part or the current step's parts. */
  highlight: PartKey[];
  onSelect: (k: PartKey) => void;
};

const { top: RAY_TOP, bottom: RAY_BOTTOM } = RAY_COLOURS;
const FIELD_DEG = 4;

const PART_TAG = Object.fromEntries(PARTS.map((p) => [p.key, p]));

/** Label offsets from their anchor, px. Chosen so labels fan out around the eye. */
const LABEL_OFFSET: Record<PartKey, [number, number]> = {
  cornea: [-70, -150],
  aqueous: [-120, 120],
  iris: [-10, -205],
  lens: [40, -175],
  ciliary: [90, -140],
  vitreous: [10, 150],
  retina: [70, -110],
  rpe: [120, -40],
  choroid: [110, 70],
  sclera: [20, 115],
  macula: [130, 20],
  disc: [110, -100],
  nerve: [70, 110],
};

const sag = (R: number, y: number) => {
  const a = Math.abs(R);
  return a - Math.sqrt(Math.max(0, a * a - y * y));
};

const arc = (cz: number, r: number, from: number, to: number, n = 48): Vec[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    return [cz + r * Math.cos(t), r * Math.sin(t)];
  });

const quad = (a: Vec, c: Vec, b: Vec, n = 16): Vec[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
    ];
  });

/** Profiles of each solid part in the optical (z, y ≥ 0) half-plane, as closed outlines. */
function profiles(r: EyeResult) {
  const s = r.eye.surfaces;
  const L = r.eye.axialLength;
  const cz = L + RETINA_RADIUS; // centre of the retinal sphere
  const R = -RETINA_RADIUS;
  const out: Partial<Record<PartKey, Vec[]>> = {};

  const yC = 5.8;
  const front = Array.from({ length: 25 }, (_, i): Vec => {
    const y = (yC * i) / 24;
    return [s[0]!.z + sag(s[0]!.R, y), y];
  });
  const back = Array.from({ length: 25 }, (_, i): Vec => {
    const y = 5.3 * (1 - i / 24);
    return [s[1]!.z + sag(s[1]!.R, y), y];
  });
  out.cornea = [...front, ...back];

  let ye = 4.4;
  const lf = (y: number) => s[2]!.z + sag(s[2]!.R, y);
  const lb = (y: number) => s[3]!.z - sag(s[3]!.R, y);
  while (lf(ye) > lb(ye) - 0.15 && ye > 2) ye -= 0.05;
  const lens: Vec[] = [];
  for (let i = 0; i <= 24; i++) lens.push([lf((ye * i) / 24), (ye * i) / 24]);
  lens.push([(lf(ye) + lb(ye)) / 2, ye + 0.12]);
  for (let i = 24; i >= 0; i--) lens.push([lb((ye * i) / 24), (ye * i) / 24]);
  out.lens = lens;

  const zi = r.eye.stopZ;
  const pr = r.eye.pupilRadius;
  out.iris = [
    [zi - 0.42, 6.0],
    [zi - 0.3, pr + 0.4],
    [zi - 0.12, pr],
    [zi - 0.02, pr + 0.3],
    [zi - 0.05, 5.9],
  ];

  const shell = (r0: number, r1: number, to: number) => [
    ...arc(cz, r1, 0, to),
    ...arc(cz, r0, to, 0),
  ];
  out.retina = shell(R - 0.25, R, 114);
  out.rpe = shell(R, R + 0.14, 116);
  out.choroid = shell(R + 0.14, R + 0.42, 119);

  const so = R + 1.42;
  const si = R + 0.42;
  const outer = arc(cz, so, 0, 128);
  const inner = arc(cz, si, 128, 0);
  const eo = outer[outer.length - 1]!;
  const ei = inner[0]!;
  out.sclera = [
    ...outer,
    ...quad(eo, [eo[0] - 2.2, eo[1] - 2.6], [2.35, 6.35]).slice(1),
    ...quad([2.75, 5.75], [ei[0] - 2.0, ei[1] - 2.8], ei).slice(0, -1),
    ...inner,
  ];

  out.ciliary = [
    [3.0, 5.85],
    [5.6, 9.0],
    [7.4, 10.3],
    [6.6, 9.1],
    [5.0, 6.9],
    [3.9, 6.1],
  ];
  return { out, cz, R };
}

function lathe(outline: Vec[]) {
  const pts = outline.map(([z, y]) => new THREE.Vector2(Math.max(0, y), z));
  const g = new THREE.LatheGeometry(pts, 64, Math.PI / 2, Math.PI);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** The cross-section where the cut passes through the part, top and bottom halves. */
function cap(outline: Vec[]) {
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  const top = new THREE.ShapeGeometry(shape);
  const bottom = new THREE.ShapeGeometry(shape);
  bottom.scale(1, -1, 1);
  return [top, bottom];
}

type Look = {
  color: string;
  capColor?: string;
  opacity?: number;
  clearcoat?: number;
  roughness?: number;
};

const LOOK: Partial<Record<PartKey, Look>> = {
  cornea: { color: "#cfe8f6", opacity: 0.38, clearcoat: 1, roughness: 0.05 },
  lens: { color: "#e6f1ff", capColor: "#d8e8fb", opacity: 0.7, clearcoat: 1, roughness: 0.1 },
  iris: { color: "#5d86a8", capColor: "#3f6385" },
  retina: { color: "#f3a99d", capColor: "#ec9686" },
  rpe: { color: "#5a3426", capColor: "#4a2a1f" },
  choroid: { color: "#cf5f58", capColor: "#bb4f49" },
  sclera: { color: "#f6f1ec", capColor: "#ece0d6", clearcoat: 0.6, roughness: 0.35 },
  ciliary: { color: "#a85a4e", capColor: "#934b40" },
};

const HIGHLIGHT = new THREE.Color("#6a58e0");

type Built = {
  group: THREE.Group;
  meshes: Map<PartKey, THREE.Mesh[]>;
  anchors: Map<PartKey, THREE.Vector3>;
  dispose: () => void;
};

function buildEye(r: EyeResult): Built {
  const { out, cz, R } = profiles(r);
  const group = new THREE.Group();
  const meshes = new Map<PartKey, THREE.Mesh[]>();
  const anchors = new Map<PartKey, THREE.Vector3>();
  const trash: { dispose(): void }[] = [];
  const add = (k: PartKey, m: THREE.Mesh) => {
    m.userData["part"] = k;
    group.add(m);
    meshes.set(k, [...(meshes.get(k) ?? []), m]);
    trash.push(m.geometry, m.material as THREE.Material);
  };

  for (const [k, outline] of Object.entries(out) as [PartKey, Vec[]][]) {
    const look = LOOK[k]!;
    const transparent = look.opacity !== undefined;
    add(
      k,
      new THREE.Mesh(
        lathe(outline),
        new THREE.MeshPhysicalMaterial({
          color: look.color,
          roughness: look.roughness ?? 0.5,
          clearcoat: look.clearcoat ?? 0.3,
          clearcoatRoughness: 0.2,
          side: THREE.DoubleSide,
          transparent,
          opacity: look.opacity ?? 1,
          depthWrite: !transparent,
        }),
      ),
    );
    if (k === "cornea") continue;
    for (const g of cap(outline))
      add(
        k,
        new THREE.Mesh(
          g,
          new THREE.MeshStandardMaterial({
            color: look.capColor ?? look.color,
            roughness: 0.75,
            side: THREE.DoubleSide,
            transparent,
            opacity: transparent ? Math.min(1, (look.opacity ?? 1) + 0.15) : 1,
            depthWrite: !transparent,
            polygonOffset: true,
            polygonOffsetFactor: -1,
          }),
        ),
      );
  }

  // Zonule fibres: from the ciliary body to the lens equator, in the cut plane.
  const zMat = new THREE.LineBasicMaterial({ color: "#c9b8a8" });
  trash.push(zMat);
  for (const sgn of [1, -1])
    for (const [a, b] of [
      [
        [4.8, 6.6],
        [4.9, 4.45],
      ],
      [
        [5.3, 7.2],
        [5.3, 4.5],
      ],
      [
        [4.3, 6.3],
        [4.55, 4.4],
      ],
    ] as [Vec, Vec][]) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a[0], sgn * a[1], 0.02),
        new THREE.Vector3(b[0], sgn * b[1], 0.02),
      ]);
      trash.push(g);
      group.add(new THREE.Line(g, zMat));
    }

  // Points on the far (inside) wall of the eye, at angle a from the back pole.
  const wall = (a: number, tilt: number, rad: number) => {
    const t = (a * Math.PI) / 180;
    const p = (tilt * Math.PI) / 180;
    return new THREE.Vector3(
      cz + rad * Math.cos(t),
      rad * Math.sin(t) * Math.cos(p),
      -rad * Math.sin(t) * Math.sin(p),
    );
  };
  const spot = (k: PartKey, pos: THREE.Vector3, radius: number, color: string) => {
    const g = new THREE.CircleGeometry(radius, 32);
    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide }),
    );
    m.position.copy(pos);
    m.lookAt(new THREE.Vector3(cz, 0, 0));
    add(k, m);
  };
  const maculaPos = wall(9, -90, R - 0.27);
  spot("macula", maculaPos, 1.3, "#e5b84a");
  const discPos = wall(17, 70, R - 0.27);
  spot("disc", discPos, 0.9, "#fbf3dc");

  const outward = discPos
    .clone()
    .sub(new THREE.Vector3(cz, 0, 0))
    .normalize();
  const n0 = discPos.clone();
  const n1 = discPos.clone().addScaledVector(outward, 3);
  const n2 = n1.clone().add(new THREE.Vector3(3.5, 0.6, -0.5));
  const n3 = n2.clone().add(new THREE.Vector3(6, 0.6, -0.4));
  const tube = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([n0, n1, n2, n3]),
    48,
    1.5,
    24,
    false,
  );
  add(
    "nerve",
    new THREE.Mesh(
      tube,
      new THREE.MeshPhysicalMaterial({ color: "#f1e3c4", roughness: 0.45, clearcoat: 0.4 }),
    ),
  );

  const opt = (z: number, y: number) => new THREE.Vector3(z, y, 0);
  anchors.set("cornea", opt(r.eye.surfaces[0]!.z + sag(7.8, 4.6), 4.6));
  anchors.set("aqueous", opt(2.0, -2.2));
  anchors.set("iris", opt(r.eye.stopZ - 0.25, (r.eye.pupilRadius + 5.9) / 2));
  anchors.set("lens", opt((r.eye.surfaces[2]!.z + r.eye.surfaces[3]!.z) / 2, 1.6));
  anchors.set("ciliary", opt(5.6, 8.6));
  anchors.set("vitreous", opt(cz - 1, -4));
  const onShell = (deg: number, rad: number) =>
    opt(cz + rad * Math.cos((deg * Math.PI) / 180), rad * Math.sin((deg * Math.PI) / 180));
  anchors.set("retina", onShell(62, R - 0.12));
  anchors.set("rpe", onShell(38, R + 0.07));
  anchors.set("choroid", onShell(-42, R + 0.28));
  anchors.set("sclera", onShell(-78, R + 0.92));
  anchors.set("macula", maculaPos.clone());
  anchors.set("disc", discPos.clone());
  anchors.set("nerve", n2.clone());

  return {
    group,
    meshes,
    anchors,
    dispose: () => {
      for (const t of trash) t.dispose();
    },
  };
}

type Photon = {
  path: THREE.Vector3[];
  lengths: number[];
  total: number;
  offset: number;
  mesh: THREE.Mesh;
};

function buildRays(r: EyeResult, distance: number) {
  const group = new THREE.Group();
  const trash: { dispose(): void }[] = [];
  const photons: Photon[] = [];
  const START = -14;
  const bundles: [ObjectPoint, string][] = Number.isFinite(distance)
    ? [
        [{ distance, height: distance * Math.tan((FIELD_DEG * Math.PI) / 180) }, RAY_TOP],
        [{ distance, height: -distance * Math.tan((FIELD_DEG * Math.PI) / 180) }, RAY_BOTTOM],
      ]
    : [
        [{ distance: Infinity, angleDeg: FIELD_DEG }, RAY_TOP],
        [{ distance: Infinity, angleDeg: -FIELD_DEG }, RAY_BOTTOM],
      ];
  const photonGeo = new THREE.SphereGeometry(0.17, 12, 8);
  trash.push(photonGeo);
  for (const [obj, color] of bundles) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const pMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    trash.push(mat, pMat);
    for (const ray of rayFan(r.eye, obj, 7)) {
      const pts = ray.points.slice();
      // Shorten the incoming leg so the object can be off-screen.
      const [a, b] = [pts[0]!, pts[1]!];
      if (a[0] < START) {
        const t = (START - a[0]) / (b[0] - a[0]);
        pts[0] = [START, a[1] + t * (b[1] - a[1])];
      }
      const path = pts.map(([z, y]) => new THREE.Vector3(z, y, 0.06));
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < path.length; i++) curve.add(new THREE.LineCurve3(path[i - 1]!, path[i]!));
      const g = new THREE.TubeGeometry(curve, path.length * 24, 0.045, 6, false);
      trash.push(g);
      group.add(new THREE.Mesh(g, mat));
      const lengths = [0];
      for (let i = 1; i < path.length; i++)
        lengths.push(lengths[i - 1]! + path[i]!.distanceTo(path[i - 1]!));
      for (let k = 0; k < 2; k++) {
        const m = new THREE.Mesh(photonGeo, pMat);
        group.add(m);
        photons.push({
          path,
          lengths,
          total: lengths[lengths.length - 1]!,
          offset: Math.random() + k * 0.5,
          mesh: m,
        });
      }
    }
  }
  return { group, photons, dispose: () => trash.forEach((t) => t.dispose()) };
}

function placePhoton(p: Photon, t: number) {
  const d = ((t + p.offset) % 1) * p.total;
  let i = 1;
  while (i < p.lengths.length - 1 && p.lengths[i]! < d) i++;
  const a = p.path[i - 1]!;
  const b = p.path[i]!;
  const seg = p.lengths[i]! - p.lengths[i - 1]!;
  p.mesh.position.lerpVectors(a, b, seg > 0 ? (d - p.lengths[i - 1]!) / seg : 0);
}

export function EyeModel3D({ result, distance, showLabels, showRays, highlight, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const labelEls = useRef(new Map<PartKey, HTMLButtonElement>());
  const lineEls = useRef(new Map<PartKey, SVGLineElement>());
  const dotEls = useRef(new Map<PartKey, SVGCircleElement>());
  const three = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    eye: Built | null;
    rays: ReturnType<typeof buildRays> | null;
  } | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // Renderer, camera, lights, loop: once.
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.textContent = "WebGL is not available in this browser, so the 3D eye cannot be drawn.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = "block";
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xe6defa, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(-10, 20, 40);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(30, 1, 1, 1000);
    const target = new THREE.Vector3(11.5, 0, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minAzimuthAngle = -0.75;
    controls.maxAzimuthAngle = 0.75;
    controls.minPolarAngle = 1.0;
    controls.maxPolarAngle = 2.1;
    controls.target.copy(target);
    three.current = { scene, camera, eye: null, rays: null };

    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      // Fit roughly 56 mm wide and 34 mm tall.
      const vh = 2 * Math.tan((camera.fov * Math.PI) / 360);
      const dist = Math.max(34 / vh, 56 / (vh * camera.aspect));
      controls.minDistance = dist * 0.55;
      controls.maxDistance = dist * 1.4;
      if (camera.position.lengthSq() === 0) camera.position.set(target.x, target.y + 2, dist);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();

    // Click (not drag) selects a part.
    let down: [number, number] | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const meshes = [...(three.current?.eye?.meshes.values() ?? [])].flat();
      const hit = ray.intersectObjects(meshes, false).find((h) => h.object.userData["part"]);
      if (hit) selectRef.current(hit.object.userData["part"] as PartKey);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const v = new THREE.Vector3();
    const t0 = performance.now();
    renderer.setAnimationLoop(() => {
      controls.update();
      const t = (performance.now() - t0) / 2400;
      for (const p of three.current?.rays?.photons ?? []) placePhoton(p, t);
      renderer.render(scene, camera);

      const anchors = three.current?.eye?.anchors;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!anchors) return;
      for (const [k, a] of anchors) {
        const lab = labelEls.current.get(k);
        const line = lineEls.current.get(k);
        const dot = dotEls.current.get(k);
        if (!lab || !line || !dot) continue;
        v.copy(a).project(camera);
        const ax = ((v.x + 1) / 2) * w;
        const ay = ((1 - v.y) / 2) * h;
        const [dx, dy] = LABEL_OFFSET[k];
        const s = Math.min(1, w / 900);
        // Keep the whole label inside the frame, not just its centre.
        const hw = lab.offsetWidth / 2 + 6;
        const hh = lab.offsetHeight / 2 + 6;
        const lx = Math.min(w - hw, Math.max(hw, ax + dx * s));
        const ly = Math.min(h - hh, Math.max(hh, ay + dy * s));
        lab.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -50%)`;
        line.setAttribute("x1", String(ax));
        line.setAttribute("y1", String(ay));
        line.setAttribute("x2", String(lx));
        line.setAttribute("y2", String(ly));
        dot.setAttribute("cx", String(ax));
        dot.setAttribute("cy", String(ay));
      }
    });

    return () => {
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      ro.disconnect();
      controls.dispose();
      three.current?.eye?.dispose();
      three.current?.rays?.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // The eye itself: rebuilt when its shape changes.
  const { accommodation, eye } = result;
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.eye?.dispose();
    if (t.eye) t.scene.remove(t.eye.group);
    t.eye = buildEye(result);
    t.scene.add(t.eye.group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accommodation, eye.pupilRadius, eye.axialLength]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.rays?.dispose();
    if (t.rays) t.scene.remove(t.rays.group);
    t.rays = showRays ? buildRays(result, distance) : null;
    if (t.rays) t.scene.add(t.rays.group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accommodation, eye.pupilRadius, eye.axialLength, distance, showRays]);

  const hl = highlight.join(",");
  useEffect(() => {
    const meshes = three.current?.eye?.meshes;
    if (!meshes) return;
    for (const [k, ms] of meshes)
      for (const m of ms) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.emissive.copy(highlight.includes(k) ? HIGHLIGHT : new THREE.Color(0));
        mat.emissiveIntensity = highlight.includes(k) ? 0.45 : 0;
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hl, accommodation, eye.pupilRadius, eye.axialLength]);

  return (
    <div
      ref={host}
      className="absolute inset-0"
      aria-label="Cutaway 3D model of the human eye"
      role="img"
    >
      <svg ref={svg} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {showLabels &&
          PARTS.map((p) => (
            <g
              key={p.key}
              opacity={highlight.length && !highlight.includes(p.key) ? 0.35 : 1}
              // On phones only the parts in focus are labelled; the rest would pile up.
              className={highlight.includes(p.key) ? "" : "max-sm:hidden"}
            >
              <line
                ref={(e) => {
                  if (e) lineEls.current.set(p.key, e);
                }}
                stroke="#16151d"
                strokeOpacity="0.35"
                strokeWidth="1"
              />
              <circle
                ref={(e) => {
                  if (e) dotEls.current.set(p.key, e);
                }}
                r="3"
                fill="#fff"
                stroke="#16151d"
                strokeWidth="1.5"
              />
            </g>
          ))}
      </svg>
      {showLabels &&
        PARTS.map((p) => {
          const on = highlight.includes(p.key);
          return (
            <button
              key={p.key}
              ref={(e) => {
                if (e) labelEls.current.set(p.key, e);
              }}
              onClick={() => onSelect(p.key)}
              className={`absolute left-0 top-0 whitespace-nowrap rounded-full px-2.5 py-1 text-left text-[11px] leading-tight shadow-[0_4px_16px_rgba(22,21,29,0.08)] transition-opacity ${
                on ? "bg-[var(--v-accent)] text-white" : "bg-white/95 text-[var(--v-ink)]"
              } ${highlight.length && !on ? "opacity-50" : ""} ${on ? "" : "max-sm:hidden"}`}
            >
              <span className="block font-medium">{p.name}</span>
              <span
                className={`block text-[10px] ${on ? "text-white/85" : "text-[var(--v-ink-3)]"}`}
              >
                {PART_TAG[p.key]!.tag}
              </span>
            </button>
          );
        })}
    </div>
  );
}
