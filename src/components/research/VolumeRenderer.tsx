import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { NiftiVolume } from "@/lib/nifti";

/**
 * GPU raymarched volume renderer.
 *
 * The previous viewer drew a stack of 2D planes, each textured from one reused
 * canvas — so every plane showed the same last-drawn slice, and the 3D view
 * came up as an empty box. This renders the actual volume: the scan is uploaded
 * once as a 3D texture and every pixel marches a ray through it, compositing
 * front to back. It is the technique clinical viewers use, and it is what makes
 * the whole head visible at once rather than a single slice.
 *
 * EEG fusion lives here too. Each electrode is projected onto the scalp surface
 * of *this* scan — found by marching outward from the centre until the tissue
 * ends — and glows with the band power computed from its own channel. The two
 * modalities share one coordinate frame, which is the point.
 */

export type RenderMode = "volume" | "glass" | "iso";
export type Palette = "neural" | "thermal" | "clinical";

export type Electrode = {
  label: string;
  /** Unit direction in RAS: x right, y anterior, z superior. */
  dir: [number, number, number];
  /** 0–1 normalised value to display, or null when the channel is absent. */
  value: number | null;
};

type Props = {
  volume: NiftiVolume;
  mode: RenderMode;
  palette: Palette;
  threshold: number;
  opacity: number;
  /** 0 = no cut, 1 = cut away the front half. Reveals interior structure. */
  cutaway: number;
  /** Axial slice position 0–1, drawn as a lit plane through the volume. */
  slice: number;
  electrodes: Electrode[];
  showElectrodes: boolean;
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
  uniform float uThreshold;
  uniform float uOpacity;
  uniform float uSteps;
  uniform float uCut;
  uniform float uSlice;
  uniform int uMode;      // 0 volume, 1 glass, 2 iso-surface
  uniform int uPalette;   // 0 neural, 1 thermal, 2 clinical

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

  float sampleAt(vec3 p) { return texture(uVolume, p + 0.5).r; }

  vec3 gradient(vec3 p) {
    const float e = 0.006;
    return vec3(
      sampleAt(p + vec3(e, 0, 0)) - sampleAt(p - vec3(e, 0, 0)),
      sampleAt(p + vec3(0, e, 0)) - sampleAt(p - vec3(0, e, 0)),
      sampleAt(p + vec3(0, 0, e)) - sampleAt(p - vec3(0, 0, e))
    );
  }

  // Colour ramps. "neural" is sampled from the brand: deep navy through
  // electric blue to cyan filament, so the scan reads as part of the product.
  vec3 ramp(float t) {
    t = clamp(t, 0.0, 1.0);
    if (uPalette == 1) {
      return mix(mix(vec3(0.05, 0.02, 0.25), vec3(0.85, 0.12, 0.35), smoothstep(0.0, 0.5, t)),
                 vec3(1.0, 0.86, 0.35), smoothstep(0.5, 1.0, t));
    }
    if (uPalette == 2) {
      return vec3(pow(t, 0.8)) * vec3(0.93, 0.97, 1.0);
    }
    vec3 a = vec3(0.00, 0.06, 0.31);  // navy core
    vec3 b = vec3(0.12, 0.39, 0.77);  // electric
    vec3 c = vec3(0.50, 0.85, 1.00);  // ion cyan
    vec3 d = vec3(0.92, 0.97, 1.00);  // near-white highlight
    if (t < 0.4) return mix(a, b, t / 0.4);
    if (t < 0.78) return mix(b, c, (t - 0.4) / 0.38);
    return mix(c, d, (t - 0.78) / 0.22);
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
    bool planeDone = false;
    vec3 lightDir = normalize(vec3(0.45, 0.7, 0.55));

    for (int i = 0; i < 768; i++) {
      float t = b.x + float(i) * delta;
      if (t > b.y) break;

      // Cutaway: discard the anterior half so interior structure shows.
      bool cut = uCut > 0.0 && p.y > 0.5 - uCut;

      if (!cut) {
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
            // Glass: opacity comes almost entirely from the gradient, so tissue
            // boundaries glow while interiors stay clear. Every fold becomes a
            // lit contour — the translucent "holographic" read, from real data.
            // A folded cortex has edges almost everywhere, so alpha must stay
            // low per step or it saturates to a solid. The colour is held in the
            // electric-to-cyan band and the rim tops out at cyan, never white —
            // otherwise the whole brain washes out to grey.
            float edge = clamp(gl * 9.0, 0.0, 1.0);
            a = clamp(edge * edge * uOpacity * 0.42, 0.0, 1.0);
            col = ramp(0.32 + 0.42 * edge) * (0.55 + 0.45 * diffuse) + ramp(0.82) * rim * 0.7;
          } else if (uMode == 2) {
            // Iso-surface: the first crossing is opaque, like a rendered skin.
            a = 1.0;
            col = ramp(0.55 + 0.4 * d) * (0.25 + 0.85 * diffuse) + ramp(0.95) * rim * 0.55;
          } else {
            float x = smoothstep(uThreshold, 1.0, d);
            // Edges carry more opacity than flat interiors — surface detail
            // survives instead of being lost in a uniform fog.
            a = clamp(x * uOpacity * (0.35 + 2.6 * gl), 0.0, 1.0);
            col = ramp(x) * (0.42 + 0.78 * diffuse) + ramp(0.96) * rim * 0.42 * x;
          }

          acc.rgb += (1.0 - acc.a) * a * col;
          acc.a += (1.0 - acc.a) * a;
          if (acc.a >= 0.97) break;
        }

        // The axial slice plane. Contributes once per ray and only inside
        // tissue: a ray grazing the plane would otherwise cross it for many
        // consecutive steps and accumulate into an opaque disc, and the plane
        // would also paint the empty space around the head.
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
      p += rayDir * delta;
    }

    if (acc.a < 0.01) discard;
    outColor = acc;
  }
`;

const MODE_INDEX: Record<RenderMode, number> = { volume: 0, glass: 1, iso: 2 };
const PALETTE_INDEX: Record<Palette, number> = { neural: 0, thermal: 1, clinical: 2 };

/**
 * Find the scalp along a direction from the centre of the head.
 *
 * Marches outward in physical space and keeps the last point still inside
 * tissue. This is an approximate projection, not a fiducial-based
 * co-registration — the UI labels it as such.
 */
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
  // A few millimetres proud of the surface, where a real electrode sits.
  const r = last + 0.022;
  return new THREE.Vector3(dir[0] * r, dir[1] * r, dir[2] * r);
}

/** Brand ramp for electrode glow, matching the shader's "neural" palette. */
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

export function VolumeRenderer(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;

  // Scene objects that survive prop changes without rebuilding the GL context.
  const handles = useRef<{
    material?: THREE.ShaderMaterial;
    texture?: THREE.Data3DTexture;
    mesh?: THREE.Mesh;
    electrodeGroup?: THREE.Group;
    head?: THREE.Group;
    scale?: THREE.Vector3;
  }>({});

  // -- one-time GL setup ---------------------------------------------------
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

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none";
    el.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    camera.position.set(0, 0, 2.35);

    // Orbit pivot: user yaw/pitch.
    const orbit = new THREE.Group();
    scene.add(orbit);
    // Anatomical frame: RAS superior (+z) becomes screen up (+y).
    const head = new THREE.Group();
    head.rotation.x = -Math.PI / 2;
    orbit.add(head);

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uVolume: { value: null },
        uCamera: { value: new THREE.Vector3() },
        uThreshold: { value: 0.1 },
        uOpacity: { value: 0.1 },
        uSteps: { value: 320 },
        uCut: { value: 0 },
        uSlice: { value: 0.5 },
        uMode: { value: 0 },
        uPalette: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    head.add(mesh);

    // Bounding frame and floor grid: instrument framing, kept faint.
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x3d8bf5, transparent: true, opacity: 0.14 }),
    );
    mesh.add(frame);

    const grid = new THREE.GridHelper(2.4, 24, 0x1e63c4, 0x0a1f4a);
    grid.position.y = -0.62;
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.35;
    scene.add(grid);

    const electrodeGroup = new THREE.Group();
    head.add(electrodeGroup);

    handles.current = { material, mesh, electrodeGroup, head };

    // -- interaction ---------------------------------------------------------
    const state = { yaw: 2.55, pitch: 0.22, zoom: 2.35, dragging: false, lx: 0, ly: 0, moved: 0 };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const pick = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(electrodeGroup.children, false);
      const hit = hits.find((h) => h.object.userData["label"]);
      live.current.onHoverElectrode?.(hit ? (hit.object.userData["label"] as string) : null);
    };

    const down = (e: PointerEvent) => {
      state.dragging = true;
      state.moved = 0;
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
        const dx = e.clientX - state.lx;
        const dy = e.clientY - state.ly;
        state.moved += Math.abs(dx) + Math.abs(dy);
        state.yaw += dx * 0.008;
        state.pitch = Math.max(-1.35, Math.min(1.35, state.pitch + dy * 0.006));
        state.lx = e.clientX;
        state.ly = e.clientY;
      } else {
        pick(e);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      state.zoom = Math.max(1.2, Math.min(4.2, state.zoom + e.deltaY * 0.0014));
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
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const local = new THREE.Vector3();
    let raf = 0;
    let t = 0;
    const animate = () => {
      t += 0.016;
      if (!state.dragging && live.current.autoRotate) state.yaw += 0.0019;
      orbit.rotation.set(state.pitch, state.yaw, 0);
      camera.position.set(0, 0, state.zoom);
      camera.lookAt(0, 0, 0);

      // The shader works in the volume's local space, so the camera must be
      // expressed there too — this is what makes non-cubic scans render with
      // correct proportions.
      scene.updateMatrixWorld();
      local.copy(camera.position);
      mesh.worldToLocal(local);
      material.uniforms["uCamera"]!.value.copy(local);

      // Electrodes breathe gently; the hovered one pulses harder.
      const hovered = live.current.hoveredElectrode;
      for (const child of electrodeGroup.children) {
        const label = child.userData["label"] as string | undefined;
        if (!label) continue;
        const pulse =
          label === hovered ? 1.55 + 0.18 * Math.sin(t * 7) : 1 + 0.06 * Math.sin(t * 2 + child.id);
        child.scale.setScalar(pulse);
      }

      renderer.render(scene, camera);
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
      handles.current.texture?.dispose();
      material.dispose();
      mesh.geometry.dispose();
      frame.geometry.dispose();
      (frame.material as THREE.Material).dispose();
      grid.geometry.dispose();
      gridMat.dispose();
      electrodeGroup.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          o.geometry?.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      el.replaceChildren();
      handles.current = {};
    };
  }, []);

  // -- volume upload: only when the scan itself changes ---------------------
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
    material.uniforms["uVolume"]!.value = texture;
    handles.current.texture = texture;

    // Keep physical proportions: normalise the extent so the longest axis is 1.
    const [ex, ey, ez] = props.volume.extent;
    const m = Math.max(ex, ey, ez) || 1;
    const scale = new THREE.Vector3(ex / m, ey / m, ez / m);
    mesh.scale.copy(scale);
    handles.current.scale = scale;
  }, [props.volume]);

  // -- electrode placement: when the scan or montage changes ----------------
  useEffect(() => {
    const { electrodeGroup, scale } = handles.current;
    if (!electrodeGroup || !scale) return;

    electrodeGroup.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry?.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    electrodeGroup.clear();
    if (!props.showElectrodes) return;

    const glowTexture = makeGlowTexture();
    for (const e of props.electrodes) {
      const pos = projectToScalp(props.volume, e.dir, scale, props.threshold);
      const colour = e.value === null ? new THREE.Color(0x334766) : electrodeColour(e.value);
      const size = e.value === null ? 0.011 : 0.013 + 0.012 * e.value;

      const node = new THREE.Mesh(
        new THREE.SphereGeometry(size, 20, 20),
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.96 }),
      );
      node.position.copy(pos);
      node.userData["label"] = e.label;
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
  }, [props.electrodes, props.showElectrodes, props.volume, props.threshold]);

  // -- cheap uniform updates -------------------------------------------------
  useEffect(() => {
    const m = handles.current.material;
    if (!m) return;
    m.uniforms["uThreshold"]!.value = props.threshold;
    m.uniforms["uOpacity"]!.value = props.opacity;
    m.uniforms["uCut"]!.value = props.cutaway;
    m.uniforms["uSlice"]!.value = props.slice;
    m.uniforms["uMode"]!.value = MODE_INDEX[props.mode];
    m.uniforms["uPalette"]!.value = PALETTE_INDEX[props.palette];
  }, [props.threshold, props.opacity, props.cutaway, props.slice, props.mode, props.palette]);

  return <div ref={host} className="h-full w-full" />;
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
