import { useEffect, useMemo, useRef, useState } from "react";
import {
  canvasToWorld,
  dot,
  edgeLabels,
  fitMmPerPixel,
  PLANE_AXES,
  sliceGeometry,
  worldToCanvas,
  type Plane,
  type ViewState,
} from "@/lib/imaging/geometry";
import {
  enhance,
  enhancementActive,
  toRgba,
  windowed,
  type Enhancement,
} from "@/lib/imaging/display";
import { ellipseAreaMm2, ellipseStats, lengthMm } from "@/lib/imaging/measure";
import { reslice, resliceLabels, valueAtWorld } from "@/lib/imaging/reslice";
import type { ImageVolume, Interpolation, SegmentationVolume, Vec3 } from "@/lib/imaging/types";
import type { Annotation, Tool } from "./types";

export type SegOverlay = {
  seg: SegmentationVolume;
  visible: boolean;
  opacity: number;
  outline: boolean;
  hidden: Set<number>;
};

type Props = {
  plane: Plane;
  volume: ImageVolume;
  view: ViewState;
  onView: (v: ViewState) => void;
  crosshair: Vec3;
  onCrosshair: (p: Vec3) => void;
  showCrosshair: boolean;
  win: { center: number; width: number };
  onWindow: (w: { center: number; width: number }) => void;
  interpolation: Interpolation;
  enhancement: Enhancement;
  original: boolean;
  split: number | null;
  overlay: SegOverlay | null;
  tool: Tool;
  annotations: Annotation[];
  onAnnotate: (a: Annotation) => void;
  onHover: (p: Vec3 | null) => void;
  focused: boolean;
  onFocus: () => void;
  /** Step the slice by n positions (wheel, keys and cine share one path). */
  onScroll: (steps: number) => void;
  /** Changing this refits the view to the canvas. */
  fitNonce: number;
  canvasRef?: (el: HTMLCanvasElement | null) => void;
};

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

export function MprViewport(props: Props) {
  const { plane, volume, view, crosshair, win, interpolation } = props;
  const host = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLCanvasElement>(null);
  const vector = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 });
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<Vec3 | null>(null);
  const drag = useRef<{
    button: number;
    x: number;
    y: number;
    view: ViewState;
    win: { center: number; width: number };
    start: Vec3;
  } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({
        w: Math.max(1, Math.floor(r.width)),
        h: Math.max(1, Math.floor(r.height)),
        dpr: Math.min(2, window.devicePixelRatio || 1),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geometry = useMemo(
    () => sliceGeometry(volume.ijkToLps, volume.dims, PLANE_AXES[plane].normal),
    [volume, plane],
  );
  const slicePos = dot(view.focal, PLANE_AXES[plane].normal);
  const sliceIndex = Math.round((slicePos - geometry.lo) / geometry.step);

  // Device-pixel view: same world framing, finer sampling.
  const W = Math.round(size.w * size.dpr);
  const H = Math.round(size.h * size.dpr);
  const deviceView = useMemo<ViewState>(
    () => ({
      ...view,
      mmPerPixel: view.mmPerPixel / size.dpr,
      pan: [view.pan[0] * size.dpr, view.pan[1] * size.dpr],
    }),
    [view, size.dpr],
  );

  // Reslice only when geometry, data or interpolation change — a window drag
  // re-windows the cached values instead of re-sampling the volume.
  const values = useMemo(
    () => (W > 1 && H > 1 ? reslice(volume, deviceView, W, H, interpolation) : null),
    [volume, deviceView, W, H, interpolation],
  );
  const labels = useMemo(
    () =>
      props.overlay?.visible && W > 1 ? resliceLabels(props.overlay.seg, deviceView, W, H) : null,
    [props.overlay?.visible, props.overlay?.seg, deviceView, W, H],
  );

  const enhanced = !props.original && enhancementActive(props.enhancement);

  useEffect(() => {
    const c = image.current;
    if (!c || !values) return;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const base = windowed(values, win.center, win.width, volume.voiFunction);
    const enh = enhanced ? enhance(base, W, H, props.enhancement) : null;
    const img = ctx.createImageData(W, H);
    toRgba(base, enh, W, H, volume.photometric, img.data, {
      split: enh ? props.split : null,
      labels,
      classes: props.overlay?.seg.classes,
      hidden: props.overlay?.hidden,
      overlay: props.overlay
        ? { opacity: props.overlay.opacity, outline: props.overlay.outline }
        : undefined,
    });
    ctx.putImageData(img, 0, 0);
  }, [
    values,
    labels,
    W,
    H,
    win.center,
    win.width,
    volume.voiFunction,
    volume.photometric,
    enhanced,
    props.enhancement,
    props.split,
    props.overlay,
  ]);

  /* ---------------------------------------------------------- vector layer */
  const onSlice = (a: Annotation) =>
    a.plane === plane && Math.abs(a.slice - slicePos) <= geometry.step / 2;
  const visible = props.annotations.filter(onSlice);

  useEffect(() => {
    const c = vector.current;
    if (!c || size.w < 2) return;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const toCanvas = (p: Vec3) => worldToCanvas(view, size.w, size.h, p);

    if (props.showCrosshair) {
      const [cx, cy] = toCanvas(crosshair);
      ctx.strokeStyle = "rgba(255, 196, 0, 0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Gap around the centre so the crosshair never covers the structure it marks.
      ctx.moveTo(0, cy);
      ctx.lineTo(cx - 10, cy);
      ctx.moveTo(cx + 10, cy);
      ctx.lineTo(size.w, cy);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, cy - 10);
      ctx.moveTo(cx, cy + 10);
      ctx.lineTo(cx, size.h);
      ctx.stroke();
    }

    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const label = (text: string, x: number, y: number) => {
      const w = ctx.measureText(text).width + 8;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(x, y - 12, w, 16);
      ctx.fillStyle = "#7fe0ff";
      ctx.fillText(text, x + 4, y);
    };
    for (const a of draft ? [...visible, draft] : visible) {
      ctx.strokeStyle = "#7fe0ff";
      ctx.fillStyle = "#7fe0ff";
      ctx.lineWidth = 1.5;
      if (a.kind === "length" && a.points.length === 2) {
        const [x0, y0] = toCanvas(a.points[0]!);
        const [x1, y1] = toCanvas(a.points[1]!);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        for (const [x, y] of [
          [x0, y0],
          [x1, y1],
        ] as const)
          ctx.fillRect(x - 2, y - 2, 4, 4);
        label(`${fmt(lengthMm(a.points[0]!, a.points[1]!), 2)} mm`, x1 + 6, y1);
      } else if (a.kind === "ellipse" && a.points.length === 2) {
        const [x0, y0] = toCanvas(a.points[0]!);
        const [x1, y1] = toCanvas(a.points[1]!);
        ctx.beginPath();
        ctx.ellipse(
          (x0 + x1) / 2,
          (y0 + y1) / 2,
          Math.abs(x1 - x0) / 2,
          Math.abs(y1 - y0) / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        const s = ellipseStats(volume, plane, a.points[0]!, a.points[1]!);
        label(
          `${fmt(ellipseAreaMm2(a.points[0]!, a.points[1]!, plane), 1)} mm²  mean ${fmt(s.mean, 1)} ± ${fmt(s.sd, 1)}`,
          Math.max(x0, x1) + 6,
          Math.min(y0, y1) + 12,
        );
      } else if (a.kind === "probe" && a.points.length === 1) {
        const [x, y] = toCanvas(a.points[0]!);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.stroke();
        const { value } = valueAtWorld(volume, a.points[0]!);
        label(
          `${fmt(value, volume.quantitative ? 0 : 1)} ${volume.unit === "HU" ? "HU" : ""}`.trim(),
          x + 6,
          y,
        );
      }
    }

    if (enhanced && props.split !== null) {
      // Before/after divider: original to the left, enhanced to the right.
      const x = props.split * size.w;
      ctx.strokeStyle = "#ffc400";
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.h);
      ctx.stroke();
      ctx.setLineDash([]);
      label("ORIGINAL", Math.max(4, x - 84), size.h - 28);
      label("ENHANCED", x + 6, size.h - 28);
    }

    if (loupe && values) {
      // Magnifier: re-sample the source at 3× under the cursor, not an upscale.
      const R = 70;
      const z = 3;
      const lv: ViewState = {
        ...view,
        mmPerPixel: view.mmPerPixel / z / size.dpr,
        pan: [0, 0],
        focal: canvasToWorld(view, size.w, size.h, loupe.x, loupe.y),
      };
      const n = Math.round(2 * R * size.dpr);
      const vals = reslice(volume, lv, n, n, interpolation);
      const base = windowed(vals, win.center, win.width, volume.voiFunction);
      const off = document.createElement("canvas");
      off.width = n;
      off.height = n;
      const octx = off.getContext("2d")!;
      const img = octx.createImageData(n, n);
      toRgba(base, null, n, n, volume.photometric, img.data);
      octx.putImageData(img, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.arc(loupe.x, loupe.y, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(off, loupe.x - R, loupe.y - R, 2 * R, 2 * R);
      ctx.restore();
      ctx.strokeStyle = "#ffc400";
      ctx.beginPath();
      ctx.arc(loupe.x, loupe.y, R, 0, Math.PI * 2);
      ctx.stroke();
      label(`${z}× · source re-sampled`, loupe.x - R, loupe.y + R + 14);
    }
  }, [
    visible,
    draft,
    view,
    size,
    crosshair,
    props.showCrosshair,
    loupe,
    values,
    volume,
    plane,
    win.center,
    win.width,
    interpolation,
    W,
    H,
    enhanced,
    props.split,
  ]);

  /* ---------------------------------------------------------- interaction */
  const worldAt = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    return canvasToWorld(view, size.w, size.h, e.clientX - r.left, e.clientY - r.top);
  };

  // Fit once the canvas has a size, and whenever the parent asks.
  const fitted = useRef(-1);
  useEffect(() => {
    if (size.w < 2 || fitted.current === props.fitNonce) return;
    fitted.current = props.fitNonce;
    props.onView({
      ...view,
      mmPerPixel: fitMmPerPixel(volume.ijkToLps, volume.dims, plane, size.w, size.h),
      pan: [0, 0],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, props.fitNonce]);

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(e.deltaY * 0.0015);
      const before = worldAt(e);
      const next: ViewState = {
        ...view,
        mmPerPixel: Math.min(20, Math.max(0.01, view.mmPerPixel * f)),
      };
      // Zoom about the cursor: keep the point under it fixed.
      const r = host.current!.getBoundingClientRect();
      const after = canvasToWorld(next, size.w, size.h, e.clientX - r.left, e.clientY - r.top);
      const { right, down } = PLANE_AXES[plane];
      const d: Vec3 = [before[0] - after[0], before[1] - after[1], before[2] - after[2]];
      next.pan = [
        view.pan[0] - dot(d, right) / next.mmPerPixel,
        view.pan[1] - dot(d, down) / next.mmPerPixel,
      ];
      props.onView(next);
      return;
    }
    props.onScroll(e.deltaY > 0 ? 1 : -1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    props.onFocus();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = worldAt(e);
    drag.current = { button: e.button, x: e.clientX, y: e.clientY, view, win, start: p };
    if (e.button !== 0) return;
    if (props.tool === "navigate") props.onCrosshair(p);
    if (props.tool === "length" || props.tool === "ellipse") {
      setDraft({ id: "draft", plane, kind: props.tool, points: [p, p], slice: slicePos });
    }
    if (props.tool === "probe") {
      props.onAnnotate({
        id: crypto.randomUUID(),
        plane,
        kind: "probe",
        points: [p],
        slice: slicePos,
      });
    }
    if (props.tool === "magnify") {
      const r = host.current!.getBoundingClientRect();
      setLoupe({ x: e.clientX - r.left, y: e.clientY - r.top });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = worldAt(e);
    setHover(p);
    props.onHover(p);
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const mode: Tool | "none" = d.button === 1 ? "pan" : d.button === 2 ? "zoom" : props.tool;
    if (mode === "navigate") props.onCrosshair(p);
    else if (mode === "pan")
      props.onView({ ...d.view, pan: [d.view.pan[0] + dx, d.view.pan[1] + dy] });
    else if (mode === "zoom")
      props.onView({
        ...d.view,
        mmPerPixel: Math.min(20, Math.max(0.01, d.view.mmPerPixel * Math.exp(dy * 0.01))),
      });
    else if (mode === "wl") {
      // Sensitivity scales with the data range so CT (thousands of HU) and MR
      // (arbitrary units) both respond usefully.
      const k = Math.max(0.01, (volume.range.max - volume.range.min) / 600);
      props.onWindow({ center: d.win.center - dy * k, width: Math.max(1, d.win.width + dx * k) });
    } else if ((mode === "length" || mode === "ellipse") && draft) {
      setDraft({ ...draft, points: [draft.points[0]!, p] });
    } else if (mode === "magnify") {
      const r = host.current!.getBoundingClientRect();
      setLoupe({ x: e.clientX - r.left, y: e.clientY - r.top });
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    setLoupe(null);
    if (draft) {
      if (lengthMm(draft.points[0]!, draft.points[1]!) > 0.5)
        props.onAnnotate({ ...draft, id: crypto.randomUUID() });
      setDraft(null);
    }
  };

  const [top, right, bottom, left] = edgeLabels(PLANE_AXES[plane].right, PLANE_AXES[plane].down);
  const hv = hover ? valueAtWorld(volume, hover) : null;
  const unitLabel = volume.unit === "HU" ? "HU" : volume.unit;

  return (
    <div
      ref={host}
      className={`relative h-full w-full select-none overflow-hidden bg-black ${props.focused ? "ring-1 ring-[#ffc400]/70" : ""}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        setHover(null);
        props.onHover(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor: props.tool === "pan" ? "grab" : "crosshair", touchAction: "none" }}
      role="img"
      aria-label={`${plane} view, slice ${sliceIndex + 1} of ${geometry.count}`}
    >
      <canvas
        ref={(el) => {
          image.current = el;
          props.canvasRef?.(el);
        }}
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: interpolation === "nearest" ? "pixelated" : "auto" }}
      />
      <canvas ref={vector} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Orientation markers, derived from the view's world axes. */}
      <Marker className="left-1/2 top-1 -translate-x-1/2">{top}</Marker>
      <Marker className="right-1.5 top-1/2 -translate-y-1/2">{right}</Marker>
      <Marker className="bottom-1 left-1/2 -translate-x-1/2">{bottom}</Marker>
      <Marker className="left-1.5 top-1/2 -translate-y-1/2">{left}</Marker>

      <Corner className="left-2 top-1.5">
        <span className="font-semibold uppercase tracking-wider text-white">{plane}</span>
        <span>
          Im {Math.min(geometry.count, Math.max(1, sliceIndex + 1))}/{geometry.count} ·{" "}
          {fmt(slicePos, 1)} mm
        </span>
        <span>
          {volume.metadata.acquisitionPlane === plane
            ? "Acquired plane"
            : `Reformatted (acq. ${volume.metadata.acquisitionPlane})`}
        </span>
      </Corner>
      <Corner className="right-2 top-1.5 items-end">
        <span>
          W {fmt(win.width, 0)} · L {fmt(win.center, 0)}
        </span>
        <span>
          {fmt(view.mmPerPixel, 3)} mm/px · {interpolation === "nearest" ? "raw pixels" : "linear"}
        </span>
        {enhanced ? <span className="text-[#ffc400]">Display enhancement active</span> : null}
      </Corner>
      <Corner className="bottom-1.5 left-2">
        {hv && hover ? (
          <>
            <span>
              LPS {fmt(hover[0])}, {fmt(hover[1])}, {fmt(hover[2])} mm
            </span>
            <span>
              ijk {hv.ijk.join(", ")} ·{" "}
              {Number.isNaN(hv.value)
                ? "outside volume"
                : `${fmt(hv.value, volume.quantitative ? 0 : 1)} ${unitLabel}`}
            </span>
          </>
        ) : (
          <span>
            {volume.dims.join("×")} · {volume.spacing.map((s) => s.toFixed(2)).join("×")} mm
          </span>
        )}
      </Corner>
    </div>
  );
}

function Marker({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`pointer-events-none absolute font-mono text-[13px] font-semibold text-[#ffc400] [text-shadow:0_0_3px_#000] ${className}`}
    >
      {children}
    </span>
  );
}

function Corner({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div
      className={`pointer-events-none absolute flex flex-col gap-0.5 font-mono text-[11px] leading-tight text-[#d5e2fa] [text-shadow:0_0_3px_#000,0_0_2px_#000] ${className}`}
    >
      {children}
    </div>
  );
}
