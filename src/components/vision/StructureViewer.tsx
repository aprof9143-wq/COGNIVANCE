import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  CHAIN_COLOURS,
  PLDDT_BANDS,
  plddtBand,
  type Backbone,
  type Residue,
} from "@/lib/vision/pdb";

export type ColourBy = "plddt" | "chain";

const BAND_COLOUR = Object.fromEntries(PLDDT_BANDS.map((b) => [b.band, b.colour]));

const RADIAL = 8;
const PER_RESIDUE = 6;

type Props = {
  backbone: Backbone;
  colourBy: ColourBy;
  autoRotate: boolean;
  /** Bump to return the camera to its starting view. */
  resetKey: number;
  onHover: (r: Residue | null) => void;
};

/**
 * The backbone as a smooth tube through the alpha carbons. A display of the
 * coordinates in the file, nothing more: no side chains, no surface, no
 * secondary structure.
 */
export function StructureViewer({ backbone, colourBy, autoRotate, resetKey, onHover }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const resetRef = useRef<() => void>(() => {});
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || backbone.residues.length === 0) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("WebGL is not available in this browser, so the structure cannot be drawn.");
      return;
    }
    setError(null);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d3f2, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 4);
    camera.add(key);
    scene.add(camera);

    const rs = backbone.residues;
    const centre = new THREE.Vector3();
    for (const r of rs) centre.add(new THREE.Vector3(r.x, r.y, r.z));
    centre.divideScalar(rs.length);
    let radius = 1;
    for (const r of rs)
      radius = Math.max(radius, centre.distanceTo(new THREE.Vector3(r.x, r.y, r.z)));

    const colourOf = (r: Residue) =>
      new THREE.Color(
        colourBy === "plddt" && Number.isFinite(r.b)
          ? BAND_COLOUR[plddtBand(r.b)]
          : CHAIN_COLOURS[Math.max(0, backbone.chains.indexOf(r.chain)) % CHAIN_COLOURS.length],
      );

    const disposables: { dispose(): void }[] = [];
    const meshes: THREE.Mesh[] = [];
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.05,
    });
    disposables.push(material);

    for (const seg of backbone.segments) {
      if (seg.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(seg.map((r) => new THREE.Vector3(r.x, r.y, r.z)));
      const tubular = (seg.length - 1) * PER_RESIDUE;
      const geo = new THREE.TubeGeometry(curve, tubular, 0.5, RADIAL, false);
      const count = geo.getAttribute("position").count;
      const colours = new Float32Array(count * 3);
      const segColours = seg.map(colourOf);
      for (let v = 0; v < count; v++) {
        const ring = Math.floor(v / (RADIAL + 1));
        const c = segColours[Math.round((ring / tubular) * (seg.length - 1))]!;
        colours.set([c.r, c.g, c.b], v * 3);
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      const mesh = new THREE.Mesh(geo, material);
      scene.add(mesh);
      meshes.push(mesh);
      disposables.push(geo);
    }
    // Residues with no bonded neighbour still get drawn.
    const lone = backbone.segments.filter((s) => s.length === 1).map((s) => s[0]!);
    if (lone.length) {
      const geo = new THREE.SphereGeometry(0.7, 12, 8);
      disposables.push(geo);
      for (const r of lone) {
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colourOf(r) }));
        disposables.push(m.material as THREE.Material);
        m.position.set(r.x, r.y, r.z);
        scene.add(m);
        meshes.push(m);
      }
    }

    const markerGeo = new THREE.SphereGeometry(1.1, 16, 12);
    const markerMat = new THREE.MeshStandardMaterial({ color: 0x16151d });
    disposables.push(markerGeo, markerMat);
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.visible = false;
    scene.add(marker);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotateSpeed = 0.8;
    controls.target.copy(centre);
    controlsRef.current = controls;

    const reset = () => {
      camera.position.copy(centre).add(new THREE.Vector3(0, 0, radius * 2.8));
      camera.near = radius / 100;
      camera.far = radius * 20;
      camera.updateProjectionMatrix();
      controls.target.copy(centre);
      controls.update();
    };
    resetRef.current = reset;
    reset();

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let pending: PointerEvent | null = null;
    const pick = () => {
      const e = pending;
      pending = null;
      if (!e) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (!hit) {
        marker.visible = false;
        hoverRef.current(null);
        return;
      }
      let best = rs[0]!;
      let bestD = Infinity;
      for (const r of rs) {
        const d = hit.point.distanceToSquared(new THREE.Vector3(r.x, r.y, r.z));
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
      marker.position.set(best.x, best.y, best.z);
      marker.visible = true;
      hoverRef.current(best);
    };
    const onMove = (e: PointerEvent) => {
      pending = e;
    };
    const onLeave = () => {
      pending = null;
      marker.visible = false;
      hoverRef.current(null);
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    renderer.setAnimationLoop(() => {
      pick();
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      ro.disconnect();
      controls.dispose();
      controlsRef.current = null;
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [backbone, colourBy]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate, backbone, colourBy]);

  useEffect(() => {
    if (resetKey) resetRef.current();
  }, [resetKey]);

  return (
    <div ref={host} className="absolute inset-0" role="img" aria-label="Protein backbone, 3D">
      {error && (
        <p className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-[var(--v-ink-2)]">
          {error}
        </p>
      )}
    </div>
  );
}
