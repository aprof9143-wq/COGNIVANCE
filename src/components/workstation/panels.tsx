import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Enhancement } from "@/lib/imaging/display";
import { lengthMm, ellipseAreaMm2, ellipseStats } from "@/lib/imaging/measure";
import { valueAtWorld } from "@/lib/imaging/reslice";
import type { ClassVolume } from "@/lib/imaging/segmentation";
import type { ImageVolume, VoiWindow } from "@/lib/imaging/types";
import { clippedFractions, type Histogram } from "@/lib/imaging/voi";
import { LABEL_CONVENTIONS } from "@/lib/imaging/nifti";
import type { Annotation } from "./types";
import { Panel, Pill } from "./ui";

/* ------------------------------------------------------------ window/level */

export function WindowPanel({
  volume,
  histogram,
  win,
  onWindow,
  options,
}: {
  volume: ImageVolume;
  histogram: Histogram;
  win: VoiWindow;
  onWindow: (w: VoiWindow) => void;
  options: VoiWindow[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const clip = clippedFractions(histogram, win);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = 280;
    const H = 80;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    // Log counts: background voxels would otherwise flatten everything else.
    const bins = histogram.bins;
    const max = Math.log1p(Math.max(...bins));
    const bw = W / bins.length;
    ctx.fillStyle = "#6f7c90";
    bins.forEach((n, i) => {
      const h = (Math.log1p(n) / (max || 1)) * (H - 4);
      ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.2), h);
    });
    const x = (v: number) => ((v - histogram.min) / (histogram.max - histogram.min || 1)) * W;
    const lo = x(win.center - win.width / 2);
    const hi = x(win.center + win.width / 2);
    ctx.fillStyle = "rgba(255,196,0,0.18)";
    ctx.fillRect(lo, 0, hi - lo, H);
    ctx.strokeStyle = "#ffc400";
    ctx.beginPath();
    ctx.moveTo(lo, 0);
    ctx.lineTo(lo, H);
    ctx.moveTo(hi, 0);
    ctx.lineTo(hi, H);
    ctx.stroke();
  }, [histogram, win]);

  const unit = volume.unit === "HU" ? "HU" : "a.u.";
  return (
    <Panel
      title="Window / level"
      tag="derived"
      note={`VOI ${volume.voiFunction} · ${volume.photometric}`}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[12px] text-[#aab6c8]">
          Width ({unit})
          <input
            type="number"
            className="field"
            value={Math.round(win.width * 10) / 10}
            onChange={(e) =>
              onWindow({
                ...win,
                width: Math.max(1, Number(e.target.value) || 1),
                source: "user",
                label: "User",
              })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[#aab6c8]">
          Level ({unit})
          <input
            type="number"
            className="field"
            value={Math.round(win.center * 10) / 10}
            onChange={(e) =>
              onWindow({
                ...win,
                center: Number(e.target.value) || 0,
                source: "user",
                label: "User",
              })
            }
          />
        </label>
      </div>
      <p className="mt-2 text-[12px] text-[#8a97ab]">Current: {win.label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o, i) => (
          <button
            key={`${o.label}-${i}`}
            type="button"
            className={`chip ${o.label === win.label && o.center === win.center ? "chip-on" : ""}`}
            onClick={() => onWindow(o)}
            title={`W ${o.width.toFixed(0)} / L ${o.center.toFixed(0)} · ${o.source === "dicom" ? "from the file" : o.source === "preset" ? "CT preset" : "from the data"}`}
          >
            {i < 9 ? <span className="mr-1 text-[#8a97ab]">{i + 1}</span> : null}
            {o.label}
          </button>
        ))}
      </div>
      <canvas
        ref={ref}
        className="mt-3 h-20 w-full"
        aria-label="Intensity histogram with the current window"
      />
      <div className="mt-1 flex justify-between font-mono text-[11px] text-[#8a97ab]">
        <span>{histogram.min.toFixed(0)}</span>
        <span>{volume.unit}</span>
        <span>{histogram.max.toFixed(0)}</span>
      </div>
      <p
        className={`mt-2 text-[12px] ${clip.below + clip.above > 0.02 ? "text-[#f0d68a]" : "text-[#8a97ab]"}`}
      >
        Shown fully black: {(clip.below * 100).toFixed(1)} % of voxels · fully white:{" "}
        {(clip.above * 100).toFixed(1)} %
      </p>
      <p className="mt-1 text-[12px] text-[#8a97ab]">
        Drag with the W/L tool: horizontal = width, vertical = level. Keys 1–9 select a window.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------ display tools */

export function DisplayPanel({
  interpolation,
  setInterpolation,
  enhancement,
  setEnhancement,
  original,
  setOriginal,
  split,
  setSplit,
}: {
  interpolation: "nearest" | "linear";
  setInterpolation: (i: "nearest" | "linear") => void;
  enhancement: Enhancement;
  setEnhancement: (e: Enhancement) => void;
  original: boolean;
  setOriginal: (b: boolean) => void;
  split: number | null;
  setSplit: (s: number | null) => void;
}) {
  const slider = (
    key: keyof Enhancement,
    label: string,
    min: number,
    max: number,
    step: number,
    off: number,
  ) => (
    <label className="flex flex-col gap-1 text-[12px] text-[#aab6c8]">
      <span className="flex justify-between">
        {label}
        <span className="font-mono">
          {enhancement[key] === off ? "off" : enhancement[key].toFixed(2)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={enhancement[key]}
        onChange={(e) => setEnhancement({ ...enhancement, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <Panel title="Display" tag="derived" note="never alters source data">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`chip ${interpolation === "nearest" ? "chip-on" : ""}`}
          onClick={() => setInterpolation("nearest")}
        >
          Raw pixels (nearest)
        </button>
        <button
          type="button"
          className={`chip ${interpolation === "linear" ? "chip-on" : ""}`}
          onClick={() => setInterpolation("linear")}
        >
          Linear interpolation
        </button>
      </div>
      <p className="mt-3 text-[12px] font-semibold text-[#c3cbd6]">
        Display enhancement — off by default, not clinically validated
      </p>
      <div className="mt-2 grid gap-2">
        {slider("gamma", "Gamma", 0.5, 2, 0.05, 1)}
        {slider("localContrast", "Local contrast", 0, 1.5, 0.05, 0)}
        {slider("denoise", "Edge-preserving denoise (mild)", 0, 1, 0.05, 0)}
        {slider("sharpen", "Sharpen (unsharp mask)", 0, 2, 0.05, 0)}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`chip ${original ? "chip-on" : ""}`}
          onClick={() => setOriginal(!original)}
          title="O"
        >
          Original
        </button>
        <button
          type="button"
          className={`chip ${split !== null ? "chip-on" : ""}`}
          onClick={() => setSplit(split === null ? 0.5 : null)}
        >
          Before/after split
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => setEnhancement({ gamma: 1, sharpen: 0, localContrast: 0, denoise: 0 })}
        >
          Reset enhancements
        </button>
      </div>
      {split !== null ? (
        <label className="mt-2 flex flex-col gap-1 text-[12px] text-[#aab6c8]">
          Split position (left = original)
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.01}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
          />
        </label>
      ) : null}
      <p className="mt-2 text-[12px] text-[#8a97ab]">
        No generative or AI enhancement is used. Probe values and measurements always read the
        source volume.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------ segmentation */

export function SegmentationPanel({
  volumes,
  convention,
  setConvention,
  alignment,
  visible,
  setVisible,
  opacity,
  setOpacity,
  outline,
  setOutline,
  hidden,
  toggleClass,
  colours,
  provenance,
}: {
  volumes: ClassVolume[] | null;
  convention: string;
  setConvention: (c: string) => void;
  alignment: string | null;
  visible: boolean;
  setVisible: (b: boolean) => void;
  opacity: number;
  setOpacity: (n: number) => void;
  outline: boolean;
  setOutline: (b: boolean) => void;
  hidden: Set<number>;
  toggleClass: (l: number) => void;
  colours: Map<number, [number, number, number]>;
  provenance: string[];
}) {
  if (!volumes) {
    return (
      <Panel title="Segmentation">
        <p className="text-[13px] text-[#aab6c8]">No validated segmentation loaded.</p>
        <p className="mt-1 text-[12px] text-[#8a97ab]">
          Load an integer label map (NIfTI). Class names are not assumed; choose the convention the
          file follows.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Segmentation" tag="measured" note="volumes from the native label grid">
      <label className="flex flex-col gap-1 text-[12px] text-[#aab6c8]">
        Label convention
        <select
          className="field"
          value={convention}
          onChange={(e) => setConvention(e.target.value)}
        >
          <option value="">Unknown — show label numbers</option>
          {Object.keys(LABEL_CONVENTIONS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {alignment ? (
        <p className="mt-2">
          <Pill tone={alignment.startsWith("Registration") ? "error" : "info"}>{alignment}</Pill>
        </p>
      ) : null}
      <table className="mt-3 w-full text-[12px]">
        <thead className="text-left text-[#8a97ab]">
          <tr>
            <th className="font-normal" />
            <th className="font-normal">Class</th>
            <th className="text-right font-normal">Voxels</th>
            <th className="text-right font-normal">mm³</th>
            <th className="text-right font-normal">mL</th>
          </tr>
        </thead>
        <tbody>
          {volumes.map((v) => {
            const c = colours.get(v.label) ?? [200, 200, 200];
            return (
              <tr key={v.label} className="border-t border-[#222b38] text-[#e8eef8]">
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => toggleClass(v.label)}
                    aria-label={`Toggle ${v.name}`}
                    className="flex items-center gap-1"
                  >
                    {hidden.has(v.label) ? (
                      <EyeOff className="h-3.5 w-3.5 text-[#8a97ab]" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                    <span
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ background: `rgb(${c.join(",")})` }}
                    />
                  </button>
                </td>
                <td>{v.name}</td>
                <td className="text-right font-mono">{v.voxels.toLocaleString()}</td>
                <td className="text-right font-mono">{v.mm3.toFixed(1)}</td>
                <td className="text-right font-mono">{v.mL.toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-[#8a97ab]">
        Volume = voxel count × voxel volume. A label map holds one label per voxel, so classes are
        mutually exclusive.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-[#aab6c8]">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />{" "}
          Show
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} />{" "}
          Outline
        </label>
        <label className="flex flex-1 items-center gap-2">
          Opacity
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="flex-1"
          />
        </label>
      </div>
      {provenance.length ? (
        <ul className="mt-2 list-disc pl-4 text-[12px] text-[#8a97ab]">
          {provenance.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------ measurements */

export function MeasurementsPanel({
  volume,
  annotations,
  remove,
  clear,
}: {
  volume: ImageVolume;
  annotations: Annotation[];
  remove: (id: string) => void;
  clear: () => void;
}) {
  return (
    <Panel
      title="Measurements"
      tag="measured"
      note="patient-space mm"
      actions={
        annotations.length ? (
          <button type="button" className="chip" onClick={clear}>
            Clear all
          </button>
        ) : null
      }
    >
      {!annotations.length ? (
        <p className="text-[13px] text-[#aab6c8]">
          None. Use Length, Ellipse ROI or Probe on any view.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[12px]">
          {annotations.map((a) => {
            let text = "";
            if (a.kind === "length") text = `${lengthMm(a.points[0]!, a.points[1]!).toFixed(2)} mm`;
            else if (a.kind === "ellipse") {
              const s = ellipseStats(volume, a.plane, a.points[0]!, a.points[1]!);
              text = `${ellipseAreaMm2(a.points[0]!, a.points[1]!, a.plane).toFixed(1)} mm² · mean ${s.mean.toFixed(1)} ± ${s.sd.toFixed(1)} (n=${s.n})`;
            } else {
              const v = valueAtWorld(volume, a.points[0]!);
              text = `${Number.isNaN(v.value) ? "outside" : v.value.toFixed(volume.quantitative ? 0 : 1)} ${volume.unit}`;
            }
            return (
              <li key={a.id} className="flex items-center gap-2 text-[#e8eef8]">
                <span className="w-16 capitalize text-[#8a97ab]">{a.kind}</span>
                <span className="w-16 text-[#8a97ab]">{a.plane}</span>
                <span className="flex-1 font-mono">{text}</span>
                <button type="button" onClick={() => remove(a.id)} aria-label="Delete measurement">
                  <Trash2 className="h-3.5 w-3.5 text-[#8a97ab] hover:text-[#f2a7a7]" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[12px] text-[#8a97ab]">
        Values are{" "}
        {volume.quantitative
          ? "Hounsfield units (calibrated CT)"
          : "signal intensity in arbitrary units — not quantitative"}
        .
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------ metadata */

export function MetadataPanel({ volume }: { volume: ImageVolume }) {
  const m = volume.metadata;
  const rows: [string, string | number | null][] = [
    ["Format", m.format.toUpperCase()],
    ["Modality", m.modality ?? "not recorded"],
    ["Series description", m.seriesDescription],
    ["Protocol", m.protocolName],
    ["Scanning sequence", m.scanningSequence],
    ["Sequence variant", m.sequenceVariant],
    ["MR acquisition type", m.mrAcquisitionType],
    ["Field strength (T)", m.magneticFieldStrength],
    ["Manufacturer / model", [m.manufacturer, m.model].filter(Boolean).join(" ") || null],
    ["Acquisition (month)", m.acquisitionDate],
    ["Body part", m.bodyPart],
    ["Acquisition plane", m.acquisitionPlane],
    ["Dimensions (i × j × k)", volume.dims.join(" × ")],
    ["Voxel spacing (mm)", volume.spacing.map((s) => s.toFixed(3)).join(" × ")],
    ["Slice thickness (mm)", m.sliceThickness],
    ["Spacing between slices (mm)", m.spacingBetweenSlices],
    ["Images / frames", `${m.instances} / ${m.frames}`],
    ["Photometric", m.photometricInterpretation],
    [
      "Bits alloc / stored / signed",
      [m.bitsAllocated, m.bitsStored, m.pixelRepresentation].map((v) => v ?? "–").join(" / "),
    ],
    [
      "Rescale slope / intercept",
      `${m.rescaleSlope} / ${m.rescaleIntercept}${m.rescaleType ? ` (${m.rescaleType})` : ""}`,
    ],
    ["Transfer syntax", m.transferSyntaxUid],
    ["Value unit", volume.unit],
    ["Value range", `${volume.range.min.toFixed(1)} … ${volume.range.max.toFixed(1)}`],
  ];
  return (
    <Panel title="Metadata" tag="measured" note="identifiers withheld">
      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-3 gap-y-1 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[#8a97ab]">{k}</dt>
            <dd className="break-words font-mono text-[#e8eef8]">
              {v === null || v === "" ? "—" : String(v)}
            </dd>
          </div>
        ))}
      </dl>
      {m.phiTagsPresent.length ? (
        <p className="mt-3 rounded border border-[#7a6320] bg-[#221c0a] px-2 py-1.5 text-[12px] text-[#f0d68a]">
          The file contains identifying attributes ({m.phiTagsPresent.join(", ")}). They are not
          read into the viewer, displayed, logged or exported. The source file itself is not
          anonymised.
        </p>
      ) : (
        <p className="mt-3 text-[12px] text-[#8a97ab]">
          No identifying attributes found in the header.
        </p>
      )}
      {volume.warnings.length ? (
        <ul className="mt-2 list-disc pl-4 text-[12px] text-[#f0d68a]">
          {volume.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
