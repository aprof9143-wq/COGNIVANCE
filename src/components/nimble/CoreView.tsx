import { useEffect, useRef } from "react";
import * as THREE from "three";
import { MONTAGE_1020 } from "@/lib/montage";
import type { Faults, SimStream } from "@/lib/nimbleSim";

/**
 * The acquisition core, drawn as an instrument: a lattice sphere carrying the
 * 19 electrode nodes where the 10-20 montage puts them, packets streaming from
 * each node down to the HAL bus ring and into the core. Node brightness is the
 * channel's live RMS; lost packets fall away red. It is driven entirely by the
 * simulated stream — nothing on it is decorative data.
 */
export function CoreView({
  stream,
  faults,
  selected,
}: {
  stream: React.RefObject<SimStream | null>;
  faults: React.RefObject<Faults>;
  selected: React.RefObject<number>;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    el.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    const root = new THREE.Group();
    scene.add(root);
    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

    const glowTex = track(makeGlow());
    const additive = {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    } as const;

    // Lattice sphere and its inner glow.
    const lattice = new THREE.LineSegments(
      track(new THREE.WireframeGeometry(track(new THREE.IcosahedronGeometry(1, 3)))),
      track(new THREE.LineBasicMaterial({ color: 0x3d8bf5, transparent: true, opacity: 0.16 })),
    );
    root.add(lattice);
    const inner = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.34, 48, 48)),
      track(new THREE.MeshBasicMaterial({ color: 0x0b3a8a, transparent: true, opacity: 0.55 })),
    );
    root.add(inner);
    const coreGlow = new THREE.Sprite(
      track(new THREE.SpriteMaterial({ map: glowTex, color: 0x5fc8ff, opacity: 0.9, ...additive })),
    );
    coreGlow.scale.setScalar(1.5);
    root.add(coreGlow);
    const halo = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({ map: glowTex, color: 0x1e63c4, opacity: 0.45, ...additive }),
      ),
    );
    halo.scale.setScalar(3.6);
    root.add(halo);

    // Rings: the HAL bus at the equator, two instrument rings around it.
    const ring = (r: number, color: number, opacity: number, tilt: number, dashed = false) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 200; i++) {
        const a = (i / 200) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      const g = track(new THREE.BufferGeometry().setFromPoints(pts));
      const m = track(
        dashed
          ? new THREE.LineDashedMaterial({
              color,
              transparent: true,
              opacity,
              dashSize: 0.05,
              gapSize: 0.06,
            })
          : new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
      );
      const line = new THREE.Line(g, m);
      if (dashed) line.computeLineDistances();
      line.rotation.x = tilt;
      root.add(line);
      return line;
    };
    const bus = ring(1.28, 0x7fd8ff, 0.7, 0);
    const ringB = ring(1.55, 0x3d8bf5, 0.3, 0.42, true);
    const ringC = ring(1.8, 0x8a6bff, 0.2, -0.3, true);
    const tickPts: number[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const r1 = i % 8 === 0 ? 1.38 : 1.33;
      tickPts.push(
        Math.cos(a) * 1.28,
        0,
        Math.sin(a) * 1.28,
        Math.cos(a) * r1,
        0,
        Math.sin(a) * r1,
      );
    }
    const tickGeo = track(new THREE.BufferGeometry());
    tickGeo.setAttribute("position", new THREE.Float32BufferAttribute(tickPts, 3));
    const ticks = new THREE.LineSegments(
      tickGeo,
      track(new THREE.LineBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.45 })),
    );
    root.add(ticks);

    // Electrode nodes on the upper hemisphere, montage x right, y anterior, z up.
    const nodes = MONTAGE_1020.map((e) => {
      const [x, y, z] = e.dir;
      const pos = new THREE.Vector3(x, Math.max(0.12, z) * 0.95 + 0.05, -y).normalize();
      const mat = track(new THREE.SpriteMaterial({ map: glowTex, color: 0x7fd8ff, ...additive }));
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(pos);
      root.add(sprite);
      const dotMat = track(new THREE.MeshBasicMaterial({ color: 0xe6f6ff }));
      const dot = new THREE.Mesh(track(new THREE.SphereGeometry(0.022, 12, 12)), dotMat);
      dot.position.copy(pos);
      root.add(dot);
      return { pos, sprite, mat, dotMat };
    });

    // Packet particles: a fixed pool, recycled. Each travels node -> bus -> core.
    const POOL = 700;
    const pPos = new Float32Array(POOL * 3);
    const pCol = new Float32Array(POOL * 3);
    const life = new Float32Array(POOL).fill(-1);
    const from = new Uint8Array(POOL);
    const lost = new Uint8Array(POOL);
    const busAngle = new Float32Array(POOL);
    const pGeo = track(new THREE.BufferGeometry());
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
    const pMat = track(
      new THREE.PointsMaterial({ size: 0.07, map: glowTex, vertexColors: true, ...additive }),
    );
    root.add(new THREE.Points(pGeo, pMat));
    let cursor = 0;
    let spawnAcc = 0;
    let lastLost = 0;
    let lastPackets = 0;

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

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let raf = 0;
    let t = 0;
    const loop = () => {
      t += 1 / 60;
      const s = stream.current;
      const f = faults.current;
      const sel = selected.current;
      camera.position.set(
        Math.sin(t * 0.07) * 4.6,
        1.55 + Math.sin(t * 0.05) * 0.25,
        Math.cos(t * 0.07) * 4.6,
      );
      camera.lookAt(0, 0.05, 0);
      ringB.rotation.y = t * 0.1;
      ringC.rotation.y = -t * 0.06;
      ticks.rotation.y = t * 0.04;
      bus.rotation.y = t * 0.04;
      coreGlow.scale.setScalar(1.45 + 0.08 * Math.sin(t * 2.1));

      const live = Boolean(s && s.profile.available);
      nodes.forEach((n, c) => {
        const lifted = f.liftedChannel === c;
        const rms = live && s ? s.rms(c, 0.4) : 0;
        const k = Math.min(1, rms / 40);
        n.mat.color.set(lifted ? 0xff4860 : c === sel ? 0xffffff : 0x7fd8ff);
        n.mat.opacity = live ? 0.25 + 0.75 * k : 0.12;
        n.sprite.scale.setScalar((c === sel ? 0.34 : 0.2) + 0.28 * k);
        n.dotMat.color.set(lifted ? 0xff4860 : 0xe6f6ff);
      });

      // Spawn in proportion to the real packet rate; lost packets spawn red.
      if (live && s) {
        const newPackets = s.packets - lastPackets;
        const newLost = s.lostPackets - lastLost;
        lastPackets = s.packets;
        lastLost = s.lostPackets;
        spawnAcc += Math.min(40, newPackets * 0.9);
        let lostToSpawn = newLost;
        while (spawnAcc >= 1) {
          spawnAcc -= 1;
          const i = cursor;
          cursor = (cursor + 1) % POOL;
          life[i] = 0;
          from[i] = Math.floor(Math.random() * nodes.length);
          lost[i] = lostToSpawn > 0 ? 1 : 0;
          if (lostToSpawn > 0) lostToSpawn--;
          busAngle[i] =
            Math.atan2(nodes[from[i]!]!.pos.z, nodes[from[i]!]!.pos.x) +
            (Math.random() - 0.5) * 0.4;
        }
      }
      for (let i = 0; i < POOL; i++) {
        if (life[i]! < 0) {
          pPos[i * 3 + 1] = 99;
          continue;
        }
        life[i]! += 1 / 60 / 1.6;
        const L = life[i]!;
        if (L >= 1 || (lost[i] && L > 0.45)) {
          life[i] = -1;
          continue;
        }
        const node = nodes[from[i]!]!.pos;
        b.set(Math.cos(busAngle[i]!) * 1.28, 0, Math.sin(busAngle[i]!) * 1.28);
        if (L < 0.5) a.copy(node).lerp(b, L / 0.5);
        else a.copy(b).lerp(new THREE.Vector3(0, 0, 0), (L - 0.5) / 0.5);
        if (lost[i]) a.y -= (L / 0.45) * 0.4; // lost packets fall away
        pPos[i * 3] = a.x;
        pPos[i * 3 + 1] = a.y;
        pPos[i * 3 + 2] = a.z;
        const fade = lost[i] ? 1 - L / 0.45 : L < 0.1 ? L / 0.1 : 1 - Math.max(0, L - 0.85) / 0.15;
        if (lost[i]) {
          pCol[i * 3] = 1 * fade;
          pCol[i * 3 + 1] = 0.28 * fade;
          pCol[i * 3 + 2] = 0.38 * fade;
        } else {
          pCol[i * 3] = 0.5 * fade;
          pCol[i * 3 + 1] = 0.85 * fade;
          pCol[i * 3 + 2] = 1 * fade;
        }
      }
      pGeo.attributes["position"]!.needsUpdate = true;
      pGeo.attributes["color"]!.needsUpdate = true;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      el.replaceChildren();
    };
  }, [stream, faults, selected]);

  return <div ref={host} className="h-full w-full" />;
}

function makeGlow(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.22, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
