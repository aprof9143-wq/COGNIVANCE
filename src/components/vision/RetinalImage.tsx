import { useEffect, useMemo, useRef, useState } from "react";
import { ImageUp, RotateCcw } from "lucide-react";
import type { EyeResult } from "@/lib/vision/optics";
import {
  SCENE_FIELD_DEG,
  blur,
  invert,
  retinalPosition,
  sigmaPx,
  type Pixels,
} from "@/lib/vision/retinalImage";
import { EvidenceTag } from "./ui";

const SIZE = 256;

/** A test scene drawn by this app, covering the central 10° of view. */
function drawTestScene(ctx: CanvasRenderingContext2D) {
  const s = SIZE;
  const sky = ctx.createLinearGradient(0, 0, 0, s * 0.62);
  sky.addColorStop(0, "#bcdcfb");
  sky.addColorStop(1, "#eef6ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = "#a9d18e";
  ctx.fillRect(0, s * 0.62, s, s * 0.38);

  // House
  ctx.fillStyle = "#f3e2c7";
  ctx.fillRect(18, 120, 70, 50);
  ctx.fillStyle = "#c8553d";
  ctx.beginPath();
  ctx.moveTo(12, 122);
  ctx.lineTo(53, 92);
  ctx.lineTo(94, 122);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#6b4f3a";
  ctx.fillRect(46, 144, 14, 26);
  ctx.fillStyle = "#5fa8d3";
  ctx.fillRect(25, 130, 14, 12);
  ctx.fillRect(68, 130, 14, 12);

  // Tree
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(208, 128, 9, 44);
  ctx.fillStyle = "#3f8f52";
  ctx.beginPath();
  ctx.arc(212, 116, 24, 0, Math.PI * 2);
  ctx.fill();

  // Ball
  ctx.fillStyle = "#e63946";
  ctx.beginPath();
  ctx.arc(150, 196, 13, 0, Math.PI * 2);
  ctx.fill();

  // Letter board, rows getting smaller
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(98, 14, 92, 92);
  ctx.strokeStyle = "#d6d3e3";
  ctx.strokeRect(98.5, 14.5, 91, 91);
  ctx.fillStyle = "#16151d";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const rows: [string, number, number][] = [
    ["E", 26, 34],
    ["F P", 14, 58],
    ["T O Z", 9, 75],
    ["L P E D", 6, 88],
    ["P E C F D", 4, 98],
  ];
  for (const [t, px, y] of rows) {
    ctx.font = `700 ${px}px Inter, system-ui, sans-serif`;
    ctx.fillText(t, 144, y);
  }
}

function toPixels(c: HTMLCanvasElement): Pixels {
  const d = c.getContext("2d")!.getImageData(0, 0, SIZE, SIZE);
  return { width: d.width, height: d.height, data: d.data };
}

function paint(c: HTMLCanvasElement | null, p: Pixels | null) {
  if (!c || !p) return;
  c.getContext("2d")!.putImageData(
    new ImageData(new Uint8ClampedArray(p.data), p.width, p.height),
    0,
    0,
  );
}

const rgb = (p: Pixels, x: number, y: number) => {
  const i = (y * p.width + x) * 4;
  return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!] as const;
};

export function RetinalImage({ result }: { result: EyeResult }) {
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const retinaRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<Pixels | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [upright, setUpright] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const loadTestScene = () => {
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    drawTestScene(c.getContext("2d")!);
    setScene(toPixels(c));
    setUploaded(false);
  };
  useEffect(loadTestScene, []);

  // Geometric spot from the ray trace, combined with a Gaussian approximation
  // of diffraction (sigma ≈ 0.42·λ/D, i.e. Airy diameter × 0.172).
  const diffRms = 2 * Math.SQRT2 * 0.172 * result.airyUm;
  const rmsUm = Math.hypot(result.rmsBlurUm ?? 0, diffRms);
  const sigma = sigmaPx(rmsUm, result.mmPerDegree, SIZE);

  const retina = useMemo(() => {
    if (!scene) return null;
    const b = blur(scene, sigma);
    return upright ? b : invert(b);
  }, [scene, sigma, upright]);

  // Repaint after every render: two 256² copies, and immune to the canvas
  // being replaced or cleared between renders.
  useEffect(() => {
    paint(sceneRef.current, scene);
    paint(retinaRef.current, retina);
  });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const bmp = await createImageBitmap(f);
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const k = Math.max(SIZE / bmp.width, SIZE / bmp.height);
    c.getContext("2d")!.drawImage(
      bmp,
      (SIZE - bmp.width * k) / 2,
      (SIZE - bmp.height * k) / 2,
      bmp.width * k,
      bmp.height * k,
    );
    bmp.close();
    setScene(toPixels(c));
    setUploaded(true);
  };

  /** Hover position in scene pixels, from either canvas. */
  const track = (from: "scene" | "retina") => (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let x = Math.floor(((e.clientX - r.left) / r.width) * SIZE);
    let y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
    x = Math.min(SIZE - 1, Math.max(0, x));
    y = Math.min(SIZE - 1, Math.max(0, y));
    if (from === "retina" && !upright) [x, y] = [SIZE - 1 - x, SIZE - 1 - y];
    setHover({ x, y });
  };

  const onRetina = hover && (upright ? hover : { x: SIZE - 1 - hover.x, y: SIZE - 1 - hover.y });
  const pos = hover && retinalPosition(hover.x, hover.y, SIZE, result.mmPerDegree);
  const mark = (p: { x: number; y: number } | null) =>
    p && (
      <span
        aria-hidden
        className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(22,21,29,0.6)]"
        style={{ left: `${((p.x + 0.5) / SIZE) * 100}%`, top: `${((p.y + 0.5) / SIZE) * 100}%` }}
      />
    );

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <figure>
          <div className="relative overflow-hidden rounded-2xl ring-1 ring-[var(--v-line)]">
            <canvas
              ref={sceneRef}
              width={SIZE}
              height={SIZE}
              className="block aspect-square w-full cursor-crosshair"
              onPointerMove={track("scene")}
              onPointerLeave={() => setHover(null)}
            />
            {mark(hover)}
          </div>
          <figcaption className="mt-1.5 text-[12px]">
            <span className="font-medium">What the eye looks at</span>
            <span className="block text-[11px] text-[var(--v-ink-3)]">
              {uploaded ? "Your image (stays in this browser)" : "Test scene drawn by this app"} ·
              central {SCENE_FIELD_DEG}° of view
            </span>
          </figcaption>
        </figure>
        <figure>
          <div className="relative overflow-hidden rounded-2xl ring-1 ring-[var(--v-line)]">
            <canvas
              ref={retinaRef}
              width={SIZE}
              height={SIZE}
              className="block aspect-square w-full cursor-crosshair"
              onPointerMove={track("retina")}
              onPointerLeave={() => setHover(null)}
            />
            {mark(onRetina)}
          </div>
          <figcaption className="mt-1.5 text-[12px]">
            <span className="font-medium">Image on the retina</span>{" "}
            <EvidenceTag kind="computed" label="Simulated" />
            <span className="block text-[11px] text-[var(--v-ink-3)]">
              {upright ? "Shown upright for comparison" : "Upside down, as the optics form it"} ·
              not what a person perceives
            </span>
          </figcaption>
        </figure>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--v-soft)] px-3 py-1.5">
          <input
            type="checkbox"
            checked={upright}
            onChange={(e) => setUpright(e.target.checked)}
            className="accent-[var(--v-accent)]"
          />
          Turn it upright, as the brain does
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--v-soft)] px-3 py-1.5">
          <ImageUp className="h-3.5 w-3.5" aria-hidden />
          Try your own picture
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        {uploaded && (
          <button
            onClick={loadTestScene}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--v-soft)] px-3 py-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Test scene
          </button>
        )}
      </div>

      <div className="mt-3 rounded-2xl bg-[var(--v-soft)] p-3 text-[12px]" aria-live="polite">
        {hover && pos && scene && retina && onRetina ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-[var(--v-ink-3)]">Point in view</dt>
            <dd>
              {Math.abs(pos.degX).toFixed(2)}° {pos.degX < 0 ? "left" : "right"},{" "}
              {Math.abs(pos.degY).toFixed(2)}° {pos.degY < 0 ? "down" : "up"} from where the eye
              looks
            </dd>
            <dt className="text-[var(--v-ink-3)]">Lands on retina</dt>
            <dd>
              {Math.abs(pos.mmX * 1000).toFixed(0)} µm {pos.mmX < 0 ? "left" : "right"},{" "}
              {Math.abs(pos.mmY * 1000).toFixed(0)} µm {pos.mmY < 0 ? "down" : "up"} of the fovea
              (flipped)
            </dd>
            <dt className="text-[var(--v-ink-3)]">Colour (scene → retina)</dt>
            <dd className="flex items-center gap-2 font-mono text-[11px]">
              {[rgb(scene, hover.x, hover.y), rgb(retina, onRetina.x, onRetina.y)].map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {i === 1 && "→ "}
                  <span
                    className="inline-block h-3 w-3 rounded-sm ring-1 ring-black/10"
                    style={{ background: `rgb(${c.join(",")})` }}
                  />
                  {c.join(", ")}
                </span>
              ))}
            </dd>
          </dl>
        ) : (
          <p className="text-[var(--v-ink-2)]">
            Point at either picture to see where that spot lands on the retina and how its colour
            changes.
          </p>
        )}
      </div>

      <p className="mt-3 text-[11px] text-[var(--v-ink-3)]">
        Blur used: {rmsUm.toFixed(1)} µm on the retina (ray-traced spot{" "}
        {result.rmsBlurUm !== null ? `${result.rmsBlurUm.toFixed(1)} µm` : "not available"}, plus
        diffraction), drawn as a Gaussian of σ = {sigma.toFixed(2)} px. Not modelled: the eye's real
        aberrations, colour fringing, scatter, how rods and cones sample the image, and anything the
        brain does.
      </p>
    </div>
  );
}
