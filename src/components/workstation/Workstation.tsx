import { Link } from "@tanstack/react-router";
import {
  Box,
  Circle,
  Crosshair,
  Download,
  FolderOpen,
  Hand,
  Layers,
  LayoutGrid,
  Maximize,
  Pause,
  Pipette,
  Play,
  RotateCcw,
  Ruler,
  Search,
  Square,
  SunMedium,
  ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagingClient, readFiles } from "@/lib/imaging/client";
import { NO_ENHANCEMENT, enhancementActive, type Enhancement } from "@/lib/imaging/display";
import { checkElectrodes, parseElectrodesTsv } from "@/lib/imaging/electrodes";
import {
  add,
  dot,
  PLANE_AXES,
  scale,
  sliceGeometry,
  throughPoint,
  volumeCentre,
  worldBounds,
  type Plane,
  type ViewState,
} from "@/lib/imaging/geometry";
import {
  gunzipIfNeeded,
  isNiftiName,
  parseLabelTable,
  type FileFailure,
  type SeriesSummary,
} from "@/lib/imaging/loader";
import { LABEL_CONVENTIONS } from "@/lib/imaging/nifti";
import { offerLinked, setLinked } from "@/lib/neuro/linked";
import { alignment as segAlignment, classVolumes } from "@/lib/imaging/segmentation";
import type {
  ElectrodeSet,
  ImageVolume,
  Interpolation,
  SegmentationVolume,
  Vec3,
  VoiWindow,
} from "@/lib/imaging/types";
import { defaultWindow, histogram as computeHistogram, windowOptions } from "@/lib/imaging/voi";
import {
  gridToLps,
  parseBundledTractogram,
  parseTck,
  parseTrk,
  type Tractogram,
} from "@/lib/tractography";
import { EegSection, type EegDerived } from "./EegSection";
import { MprViewport } from "./MprViewport";
import {
  DisplayPanel,
  MeasurementsPanel,
  MetadataPanel,
  SegmentationPanel,
  WindowPanel,
} from "./panels";
import { TOOL_LABELS, type Annotation, type Tool } from "./types";
import { DISCLAIMER, Panel, Pill, Tag } from "./ui";
import { Volume3D, type CameraPreset, type Render3DMode } from "./Volume3D";
import { viridisGradient } from "./colormaps";

const TEMPLATE_URL = "/templates/mni152_template.nii.gz";
const TEMPLATE_NAME = "MNI152 ICBM 2009a template";
const TRACTS_URL = "/templates/tractogram_ds000221.bin.gz";

/** Provenance of the bundled tractogram, from tools/demo-assets/build_tractogram.py. */
const BUNDLED_TRACT_PROVENANCE: [string, string][] = [
  [
    "Source",
    "OpenNeuro ds000221 (CC0), sub-010002 ses-01, DWI b = 1000 s/mm², 60 directions, 1.7 mm",
  ],
  ["Model", "DIPY 1.12 constrained spherical deconvolution, SH order 6"],
  ["Tracking", "Deterministic (maximum direction), step 0.5 mm, max angle 30°, stop FA < 0.15"],
  ["Seeds", "260,000 random seeds in FA > 0.25"],
  [
    "Selection",
    "Length 50–240 mm; 20,000 streamlines, length-weighted random subsample, 32 points each",
  ],
  [
    "Registration",
    "Affine (mutual information), mean b0 → MNI152 template; 98.3 % of points on template tissue",
  ],
  ["Scope", "One healthy adult. Displayed only on the template it was registered to."],
];

const PLANES: Plane[] = ["axial", "coronal", "sagittal"];

const ERROR_TITLES: Record<string, string> = {
  malformed: "Malformed file",
  "unsupported-transfer-syntax": "Unsupported transfer syntax",
  "unsupported-image": "Unsupported image type",
  "missing-geometry": "Missing geometry",
  "inconsistent-series": "Inconsistent series",
  empty: "No image data",
  unknown: "Could not load",
};

function initialViews(vol: ImageVolume): Record<Plane, ViewState> {
  const c = volumeCentre(vol.ijkToLps, vol.dims);
  return {
    axial: { plane: "axial", focal: c, mmPerPixel: 1, pan: [0, 0] },
    coronal: { plane: "coronal", focal: c, mmPerPixel: 1, pan: [0, 0] },
    sagittal: { plane: "sagittal", focal: c, mmPerPixel: 1, pan: [0, 0] },
  };
}

export function Workstation() {
  const client = useRef<ImagingClient | null>(null);
  const [volume, setVolume] = useState<ImageVolume | null>(null);
  const [isTemplate, setIsTemplate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failures, setFailures] = useState<FileFailure[]>([]);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [seriesUid, setSeriesUid] = useState<string | null>(null);

  // presentation
  const [win, setWin] = useState<VoiWindow | null>(null);
  const [views, setViews] = useState<Record<Plane, ViewState> | null>(null);
  const [crosshair, setCrosshair] = useState<Vec3>([0, 0, 0]);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [focus, setFocus] = useState<Plane>("axial");
  const [layout, setLayout] = useState<"quad" | "single">("quad");
  const [tool, setTool] = useState<Tool>("navigate");
  const [interpolation, setInterpolation] = useState<Interpolation>("linear");
  const [enhancement, setEnhancement] = useState<Enhancement>(NO_ENHANCEMENT);
  const [original, setOriginal] = useState(false);
  const [split, setSplit] = useState<number | null>(null);
  const [cine, setCine] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);

  // annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // segmentation
  const [seg, setSeg] = useState<SegmentationVolume | null>(null);
  const [convention, setConvention] = useState("");
  const [segVisible, setSegVisible] = useState(true);
  const [segOpacity, setSegOpacity] = useState(0.3);
  const [segOutline, setSegOutline] = useState(true);
  const [hidden, setHidden] = useState<Set<number>>(new Set());

  // 3D layers
  const [bundled, setBundled] = useState<Tractogram | null>(null);
  const [fileTracts, setFileTracts] = useState<{ tg: Tractogram; name: string } | null>(null);
  const [tractsVisible, setTractsVisible] = useState(true);
  const [tractOpacity, setTractOpacity] = useState(0.35);
  const [electrodes, setElectrodes] = useState<ElectrodeSet | null>(null);
  const [electrodesVisible, setElectrodesVisible] = useState(true);
  const [connectionsVisible, setConnectionsVisible] = useState(false);
  const [eeg, setEeg] = useState<EegDerived>(null);
  const [layerError, setLayerError] = useState<string | null>(null);
  const [mode3d, setMode3d] = useState<Render3DMode>("composite");
  const [opacity3d, setOpacity3d] = useState(0.5);
  const [threshold3d, setThreshold3d] = useState(0.15);
  const [clipFrac, setClipFrac] = useState({ x: [0, 1], y: [0, 1], z: [0, 1] } as Record<
    "x" | "y" | "z",
    [number, number]
  >);
  const [preset, setPreset] = useState<{ name: CameraPreset; nonce: number }>({
    name: "anterior",
    nonce: 0,
  });

  const canvases = useRef<Partial<Record<Plane | "3d", HTMLCanvasElement | null>>>({});
  const hostRef = useRef<HTMLDivElement>(null);

  /* --------------------------------------------------------------- loading */
  const adopt = useCallback((vol: ImageVolume, template: boolean) => {
    setVolume(vol);
    setIsTemplate(template);
    setAnnotations([]);
    setSeg(null);
    setFileTracts(null);
    setElectrodes((e) => (e ? checkElectrodes(e, vol) : e));
    const v = initialViews(vol);
    setViews(v);
    setCrosshair(v.axial.focal);
    setWin(defaultWindow(vol, computeHistogram(vol)));
    setFitNonce((n) => n + 1);
    setClipFrac({ x: [0, 1], y: [0, 1], z: [0, 1] });
  }, []);

  useEffect(() => {
    const c = new ImagingClient();
    client.current = c;
    let cancelled = false;
    setBusy("Loading the MNI152 template…");
    (async () => {
      try {
        const res = await fetch(TEMPLATE_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { nifti } = await c.load([
          { name: `${TEMPLATE_NAME}.nii.gz`, buffer: await res.arrayBuffer() },
        ]);
        if (!cancelled && nifti) adopt(nifti, true);
      } catch {
        // The template is a convenience; without it the viewer starts empty.
      } finally {
        if (!cancelled) setBusy(null);
      }
      try {
        const res = await fetch(TRACTS_URL);
        if (!res.ok) return;
        const buf = await gunzipIfNeeded(await res.arrayBuffer());
        if (!cancelled)
          setBundled(
            parseBundledTractogram(
              buf,
              "Whole-brain deterministic CSD tractography, one healthy adult",
            ),
          );
      } catch {
        // Optional layer.
      }
    })();
    return () => {
      cancelled = true;
      c.dispose();
    };
  }, [adopt]);

  const openImages = async (files: File[]) => {
    if (!files.length || !client.current) return;
    setBusy(`Decoding ${files.length} file${files.length > 1 ? "s" : ""}…`);
    setFailures([]);
    try {
      const {
        nifti,
        series: found,
        failures: bad,
      } = await client.current.load(await readFiles(files));
      setFailures(bad);
      if (nifti) {
        adopt(nifti, false);
        setSeries([]);
      } else if (found.length) {
        setSeries(found);
        setSeriesUid(found[0]!.uid);
        adopt(await client.current.build(found[0]!.uid), false);
      }
    } catch (e) {
      setFailures([
        {
          file: "series",
          kind: (e as { kind?: FileFailure["kind"] }).kind ?? "unknown",
          message: e instanceof Error ? e.message : String(e),
        },
      ]);
    } finally {
      setBusy(null);
    }
  };

  const pickSeries = async (uid: string) => {
    if (!client.current) return;
    setBusy("Building series…");
    try {
      setSeriesUid(uid);
      adopt(await client.current.build(uid), false);
      setFailures([]);
    } catch (e) {
      setFailures([
        {
          file: "series",
          kind: (e as { kind?: FileFailure["kind"] }).kind ?? "unknown",
          message: e instanceof Error ? e.message : String(e),
        },
      ]);
    } finally {
      setBusy(null);
    }
  };

  const openLayer = async (files: File[]) => {
    setLayerError(null);
    const labelTable = files.find((f) => /\.tsv$/i.test(f.name) && !/electrodes/i.test(f.name));
    const names = labelTable ? parseLabelTable(await labelTable.text()) : undefined;
    for (const f of files) {
      try {
        if (isNiftiName(f.name) && client.current) {
          setBusy("Reading segmentation…");
          const s = await client.current.segmentation(
            { name: f.name, buffer: await f.arrayBuffer() },
            names,
            names ? "file label table" : null,
          );
          setSeg(s);
          setConvention(names ? "__file" : "");
          setHidden(new Set());
        } else if (/\.tck$/i.test(f.name) || /\.trk$/i.test(f.name)) {
          const buf = await f.arrayBuffer();
          setFileTracts({
            tg: /\.tck$/i.test(f.name) ? parseTck(buf) : parseTrk(buf),
            name: f.name,
          });
        } else if (/electrodes.*\.tsv$/i.test(f.name)) {
          const set = parseElectrodesTsv(await f.text(), f.name);
          setElectrodes(volume ? checkElectrodes(set, volume) : set);
        }
      } catch (e) {
        setLayerError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(null);
      }
    }
  };

  /* --------------------------------------------------------- derived state */
  const hist = useMemo(() => (volume ? computeHistogram(volume) : null), [volume]);
  const options = useMemo(
    () => (volume && hist ? windowOptions(volume, hist) : []),
    [volume, hist],
  );

  const segClasses = useMemo(() => {
    if (!seg) return null;
    const table = convention && convention !== "__file" ? LABEL_CONVENTIONS[convention] : null;
    return {
      ...seg,
      convention: convention === "__file" ? "file label table" : convention || null,
      classes: seg.classes.map((c) => ({
        ...c,
        name: table ? (table[c.label] ?? `Label ${c.label} (not in ${convention})`) : c.name,
      })),
    };
  }, [seg, convention]);
  const segVolumes = useMemo(() => (segClasses ? classVolumes(segClasses) : null), [segClasses]);
  const segAlign = useMemo(() => (seg && volume ? segAlignment(seg, volume) : null), [seg, volume]);
  const segDisplayable = segAlign ? segAlign.status !== "no-overlap" : false;

  /* ------------------------------------- link to Neurodegeneration Tracking */
  // Descriptive metadata and computed volumes only — never pixels or identifiers.
  useEffect(() => {
    if (!volume) return;
    const md = volume.metadata;
    offerLinked("mri", {
      origin: "viewer",
      kind: isTemplate ? "template" : "subject",
      label: isTemplate
        ? TEMPLATE_NAME
        : md.format === "dicom"
          ? `DICOM series${md.modality ? ` (${md.modality})` : ""}`
          : "Uploaded NIfTI volume",
      dims: volume.dims,
      spacingMm: volume.spacing,
      acquisitionMonth: md.acquisitionDate ? md.acquisitionDate.slice(0, 7) : null,
      manufacturer: md.manufacturer,
      model: md.model,
      fieldStrength: md.magneticFieldStrength,
      sequence: md.seriesDescription ?? md.protocolName,
      linkedAt: new Date().toISOString(),
    });
    // A label map belongs to the scan it was made from.
    if (!isTemplate) setLinked({ segmentation: null });
  }, [volume, isTemplate]);

  useEffect(() => {
    if (!segClasses || !segVolumes) return;
    setLinked({
      segmentation: {
        origin: "viewer",
        label: "Label map loaded in the viewer",
        convention: segClasses.convention,
        classes: segVolumes
          .filter((k) => k.voxels > 0)
          .map((k) => ({ label: k.label, name: k.name, mm3: k.mm3 })),
        linkedAt: new Date().toISOString(),
      },
    });
  }, [segClasses, segVolumes]);

  const tracts = useMemo<{
    tg: Tractogram;
    source: string;
    provenance: [string, string][];
    status: string;
  } | null>(() => {
    if (fileTracts) {
      const tg = fileTracts.tg;
      const params = Object.entries(tg.parameters);
      return {
        tg,
        source: fileTracts.name,
        provenance: [
          ["Source", fileTracts.name],
          [
            "Streamlines",
            `${tg.count.toLocaleString()} shown of ${tg.totalInFile.toLocaleString()}`,
          ],
          ...(params.length
            ? params
            : ([["Parameters", "not recorded in the file"]] as [string, string][])),
        ],
        status:
          tg.space === "unplaced"
            ? tg.warnings.join(" ")
            : "Coordinates as stored; alignment with this image is assumed from the shared scanner space.",
      };
    }
    if (bundled && volume && isTemplate) {
      return {
        tg: gridToLps(bundled, volume.ijkToLps, volume.dims),
        source: "Bundled (ds000221)",
        provenance: BUNDLED_TRACT_PROVENANCE,
        status: "Registered to this template.",
      };
    }
    return null;
  }, [fileTracts, bundled, volume, isTemplate]);

  const clip = useMemo(() => {
    if (!volume) return { min: [-1e9, -1e9, -1e9] as Vec3, max: [1e9, 1e9, 1e9] as Vec3 };
    const b = worldBounds(volume.ijkToLps, volume.dims);
    const pad = 2;
    const at = (a: 0 | 1 | 2, f: number) => b.min[a]! - pad + (b.max[a]! - b.min[a]! + 2 * pad) * f;
    return {
      min: [at(0, clipFrac.x[0]), at(1, clipFrac.y[0]), at(2, clipFrac.z[0])] as Vec3,
      max: [at(0, clipFrac.x[1]), at(1, clipFrac.y[1]), at(2, clipFrac.z[1])] as Vec3,
    };
  }, [volume, clipFrac]);

  /* ----------------------------------------------------------- navigation */
  const moveCrosshair = useCallback((p: Vec3) => {
    setCrosshair(p);
    setViews((v) =>
      v
        ? {
            axial: throughPoint(v.axial, p),
            coronal: throughPoint(v.coronal, p),
            sagittal: throughPoint(v.sagittal, p),
          }
        : v,
    );
  }, []);

  const scrollPlane = useCallback(
    (plane: Plane, steps: number, wrap = false) => {
      if (!volume || !views) return;
      const n = PLANE_AXES[plane].normal;
      const g = sliceGeometry(volume.ijkToLps, volume.dims, n);
      let t = dot(views[plane].focal, n) + steps * g.step;
      if (t > g.hi + g.step / 2) t = wrap ? g.lo : g.hi;
      if (t < g.lo - g.step / 2) t = wrap ? g.hi : g.lo;
      moveCrosshair(add(crosshair, scale(n, t - dot(crosshair, n))));
    },
    [volume, views, crosshair, moveCrosshair],
  );

  // Cine: step the focused plane through the volume.
  useEffect(() => {
    if (!cine) return;
    const id = setInterval(() => scrollPlane(focus, 1, true), 1000 / 12);
    return () => clearInterval(id);
  }, [cine, focus, scrollPlane]);

  const resetAll = () => {
    if (!volume || !hist) return;
    const v = initialViews(volume);
    setViews(v);
    setCrosshair(v.axial.focal);
    setWin(defaultWindow(volume, hist));
    setEnhancement(NO_ENHANCEMENT);
    setOriginal(false);
    setSplit(null);
    setFitNonce((n) => n + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (
        !hostRef.current?.contains(document.activeElement) &&
        document.activeElement !== document.body
      )
        return;
      if (!volume || !views) return;
      const k = e.key;
      if (k === "ArrowUp" || k === "PageUp") scrollPlane(focus, k === "PageUp" ? -10 : -1);
      else if (k === "ArrowDown" || k === "PageDown") scrollPlane(focus, k === "PageDown" ? 10 : 1);
      else if (k === "+" || k === "=")
        setViews({
          ...views,
          [focus]: { ...views[focus], mmPerPixel: views[focus].mmPerPixel / 1.25 },
        });
      else if (k === "-")
        setViews({
          ...views,
          [focus]: { ...views[focus], mmPerPixel: views[focus].mmPerPixel * 1.25 },
        });
      else if (k === "f" || k === "F") setFitNonce((n) => n + 1);
      else if (k === "r" || k === "R") resetAll();
      else if (k === " ") setCine((c) => !c);
      else if (k === "o" || k === "O") setOriginal((o) => !o);
      else if (k === "Escape") setTool("navigate");
      else if (/^[1-9]$/.test(k) && options[Number(k) - 1]) setWin(options[Number(k) - 1]!);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------------------------------------------------------- export */
  const exportImage = () => {
    if (!volume || !win) return;
    const tiles: [string, HTMLCanvasElement | null | undefined][] = [
      ["Axial", canvases.current.axial],
      ["Coronal", canvases.current.coronal],
      ["Sagittal", canvases.current.sagittal],
      ["3D", canvases.current["3d"]],
    ];
    const T = 480;
    const out = document.createElement("canvas");
    out.width = T * 2;
    out.height = T * 2 + 230;
    const g = out.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, out.width, out.height);
    tiles.forEach(([label, c], i) => {
      const x = (i % 2) * T;
      const y = Math.floor(i / 2) * T;
      if (c) {
        const s = Math.min(T / c.width, T / c.height);
        g.drawImage(
          c,
          x + (T - c.width * s) / 2,
          y + (T - c.height * s) / 2,
          c.width * s,
          c.height * s,
        );
      }
      g.fillStyle = "#ffc400";
      g.font = "14px monospace";
      g.fillText(label, x + 8, y + 18);
    });
    const lines = [
      `Cognivance research viewer export · ${new Date().toISOString()}`,
      `Volume: ${volume.name} · ${volume.dims.join("×")} · ${volume.spacing.map((s) => s.toFixed(2)).join("×")} mm · ${volume.unit}`,
      `Window: W ${win.width.toFixed(0)} L ${win.center.toFixed(0)} (${win.label}) · VOI ${volume.voiFunction} · ${volume.photometric} · ${interpolation}`,
      `Display enhancement: ${!original && enhancementActive(enhancement) ? `ACTIVE (gamma ${enhancement.gamma}, local contrast ${enhancement.localContrast}, denoise ${enhancement.denoise}, sharpen ${enhancement.sharpen})` : "none"}`,
      `Crosshair (LPS mm): ${crosshair.map((v) => v.toFixed(1)).join(", ")}`,
      `Layers: segmentation ${segClasses ? `${segClasses.name} (${segClasses.convention ?? "labels unnamed"})` : "none"} · tracts ${tracts ? tracts.source : "none"} · electrodes ${electrodes?.registered ? electrodes.provenance.source : "none"}`,
      `Measurements: ${annotations.length}. Patient identifiers are never read into the viewer and are not in this image.`,
      DISCLAIMER,
    ];
    g.fillStyle = "#e6efff";
    g.font = "13px monospace";
    lines.forEach((l, i) => g.fillText(l, 12, T * 2 + 26 + i * 25));
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = `cognivance-export-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.png`;
    a.click();
  };

  /* ------------------------------------------------------------------ view */
  const imgInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const layerInput = useRef<HTMLInputElement>(null);

  const tools: [Tool, typeof Crosshair][] = [
    ["navigate", Crosshair],
    ["wl", SunMedium],
    ["pan", Hand],
    ["zoom", ZoomIn],
    ["length", Ruler],
    ["ellipse", Circle],
    ["probe", Pipette],
    ["magnify", Search],
  ];

  const viewport = (plane: Plane) =>
    volume && views && win ? (
      <MprViewport
        key={plane}
        plane={plane}
        volume={volume}
        view={views[plane]}
        onView={(v) => setViews((cur) => (cur ? { ...cur, [plane]: v } : cur))}
        crosshair={crosshair}
        onCrosshair={moveCrosshair}
        showCrosshair={showCrosshair}
        win={win}
        onWindow={(w) => setWin({ ...w, source: "user", label: "User" })}
        interpolation={interpolation}
        enhancement={enhancement}
        original={original}
        split={split}
        overlay={
          segClasses && segDisplayable
            ? {
                seg: segClasses,
                visible: segVisible,
                opacity: segOpacity,
                outline: segOutline,
                hidden,
              }
            : null
        }
        tool={tool}
        annotations={annotations}
        onAnnotate={(a) => setAnnotations((list) => [...list, a])}
        onHover={() => {}}
        focused={focus === plane}
        onFocus={() => setFocus(plane)}
        onScroll={(n) => scrollPlane(plane, n)}
        fitNonce={fitNonce}
        canvasRef={(el) => (canvases.current[plane] = el)}
      />
    ) : null;

  const threeD =
    volume && win ? (
      <Volume3D
        volume={volume}
        win={win}
        mode={mode3d}
        opacity={opacity3d}
        threshold={threshold3d}
        clip={clip}
        preset={preset}
        onCanvas={(c) => (canvases.current["3d"] = c)}
        layers={{
          segmentation:
            segClasses && segDisplayable
              ? {
                  seg: segClasses,
                  visible: segVisible,
                  opacity: Math.min(1, segOpacity + 0.3),
                  hidden,
                }
              : null,
          tracts:
            tracts && tracts.tg.space === "lps"
              ? { tractogram: tracts.tg, visible: tractsVisible, opacity: tractOpacity }
              : null,
          electrodes: electrodes
            ? { set: electrodes, visible: electrodesVisible, values: eeg?.values ?? null }
            : null,
          connections:
            eeg && electrodes?.registered
              ? { pairs: eeg.pairs, visible: connectionsVisible }
              : null,
        }}
      />
    ) : null;

  return (
    <div ref={hostRef} className="ws min-h-screen bg-[#00030b] text-[#e6efff]">
      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-[#16305e] bg-[#01071a] px-4 py-2.5">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo-mark.png" alt="Cognivance" className="h-7 w-7" />
        </Link>
        <div className="leading-tight">
          <h1 className="text-[15px] font-semibold">Diagnostic imaging viewer</h1>
          <p className="text-[12px] text-[#8095bf]">
            MRI · segmentation · tractography · EEG — decision-support visualisation
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={() => imgInput.current?.click()}>
            <FolderOpen className="h-4 w-4" /> Open DICOM / NIfTI
          </button>
          <button type="button" className="btn" onClick={() => dirInput.current?.click()}>
            <FolderOpen className="h-4 w-4" /> Open DICOM folder
          </button>
          <button type="button" className="btn" onClick={() => layerInput.current?.click()}>
            <Layers className="h-4 w-4" /> Add layer
          </button>
          <button type="button" className="btn" onClick={exportImage} disabled={!volume}>
            <Download className="h-4 w-4" /> Export PNG
          </button>
          <Link to="/research" className="btn">
            Research console
          </Link>
          <Link to="/neurodegeneration" className="btn">
            Neurodegeneration tracking
          </Link>
        </div>
        <input
          ref={imgInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void openImages([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <input
          ref={(el) => {
            dirInput.current = el;
            el?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void openImages([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <input
          ref={layerInput}
          type="file"
          multiple
          accept=".nii,.gz,.tck,.trk,.tsv"
          className="hidden"
          onChange={(e) => {
            void openLayer([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </header>
      <p
        role="note"
        className="border-b border-[#3a3320] bg-[#15120a] px-4 py-1.5 text-[12px] text-[#e6d7a8]"
      >
        {DISCLAIMER} Not a diagnostic device; no finding is generated by this software.
      </p>

      {/* ----------------------------------------------------------- toolbar */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b border-[#16305e] bg-[#01071a] px-4 py-2"
        role="toolbar"
        aria-label="Viewer tools"
      >
        {tools.map(([t, Icon]) => (
          <button
            key={t}
            type="button"
            className={`tool ${tool === t ? "tool-on" : ""}`}
            onClick={() => setTool(t)}
            title={TOOL_LABELS[t]}
          >
            <Icon className="h-4 w-4" />
            <span>{TOOL_LABELS[t]}</span>
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-[#16305e]" />
        <button type="button" className="tool" onClick={() => setFitNonce((n) => n + 1)} title="F">
          <Maximize className="h-4 w-4" /> Fit
        </button>
        <button type="button" className="tool" onClick={resetAll} title="R">
          <RotateCcw className="h-4 w-4" /> Reset
        </button>
        <button
          type="button"
          className={`tool ${cine ? "tool-on" : ""}`}
          onClick={() => setCine((c) => !c)}
          title="Space"
        >
          {cine ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} Cine
        </button>
        <button
          type="button"
          className={`tool ${showCrosshair ? "tool-on" : ""}`}
          onClick={() => setShowCrosshair((s) => !s)}
        >
          <Crosshair className="h-4 w-4" /> Crosshair
        </button>
        <button
          type="button"
          className="tool"
          onClick={() => setLayout((l) => (l === "quad" ? "single" : "quad"))}
        >
          {layout === "quad" ? <Square className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}{" "}
          {layout === "quad" ? "Single view" : "Four views"}
        </button>
        <span className="ml-auto text-[12px] text-[#8095bf]">
          Wheel: slice · Ctrl+wheel: zoom · middle-drag: pan · right-drag: zoom · ↑↓ PgUp PgDn · 1–9
          windows · O original · Space cine
        </span>
      </div>

      <main className="grid gap-3 p-3 xl:grid-cols-[17rem_minmax(0,1fr)_21rem]">
        {/* ------------------------------------------------------ left rail */}
        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Data">
            {busy ? <Pill tone="info">{busy}</Pill> : null}
            {volume ? (
              <div className="text-[13px]">
                <p className="font-medium">{volume.name}</p>
                <p className="text-[12px] text-[#8095bf]">
                  {isTemplate
                    ? "Population-average template — not a patient."
                    : volume.metadata.format === "dicom"
                      ? "DICOM series"
                      : "NIfTI volume"}
                </p>
              </div>
            ) : !busy ? (
              <p className="text-[13px] text-[#a9bbdc]">
                No image loaded. Open a DICOM series (files or folder) or a NIfTI volume.
              </p>
            ) : null}
            {series.length > 1 ? (
              <label className="mt-2 flex flex-col gap-1 text-[12px] text-[#a9bbdc]">
                Series in this load
                <select
                  className="field"
                  value={seriesUid ?? ""}
                  onChange={(e) => void pickSeries(e.target.value)}
                >
                  {series.map((s) => (
                    <option key={s.uid} value={s.uid}>
                      {s.description} · {s.modality ?? "?"} · {s.frames} images
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {failures.length ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {failures.slice(0, 6).map((f, i) => (
                  <li
                    key={i}
                    className="rounded border border-[#7a2d2d] bg-[#1a0c0c] px-2 py-1.5 text-[12px] text-[#f2c1c1]"
                  >
                    <span className="font-semibold">{ERROR_TITLES[f.kind] ?? "Error"}</span> —{" "}
                    {f.message}
                    <span className="block text-[#b98b8b]">file {i + 1} of the load</span>
                  </li>
                ))}
                {failures.length > 6 ? (
                  <li className="text-[12px] text-[#8095bf]">…and {failures.length - 6} more</li>
                ) : null}
              </ul>
            ) : null}
          </Panel>

          <SegmentationPanel
            volumes={segVolumes}
            convention={convention === "__file" ? "" : convention}
            setConvention={setConvention}
            alignment={
              !segAlign
                ? null
                : segAlign.status === "same-grid"
                  ? "Same grid as the image"
                  : segAlign.status === "different-grid"
                    ? `Different grid — resampled (nearest) for display; ${Math.round(segAlign.overlap * 100)} % overlap`
                    : "Registration failure: no overlap with the image — not displayed"
            }
            visible={segVisible}
            setVisible={setSegVisible}
            opacity={segOpacity}
            setOpacity={setSegOpacity}
            outline={segOutline}
            setOutline={setSegOutline}
            hidden={hidden}
            toggleClass={(l) =>
              setHidden((h) => {
                const n = new Set(h);
                if (n.has(l)) n.delete(l);
                else n.add(l);
                return n;
              })
            }
            colours={new Map(segClasses?.classes.map((c) => [c.label, c.colour]) ?? [])}
            provenance={
              seg
                ? [
                    `Source: ${seg.provenance.source}`,
                    seg.provenance.method,
                    ...seg.provenance.notes,
                  ]
                : []
            }
          />

          <Panel title="3D layers" note="each traced to its source">
            {layerError ? (
              <p className="mb-2">
                <Pill tone="error">{layerError}</Pill>
              </p>
            ) : null}
            <LayerBlock
              name="Fibre tracts"
              tag="derived"
              on={tractsVisible}
              setOn={setTractsVisible}
              available={Boolean(tracts && tracts.tg.space === "lps")}
              empty={
                tracts?.tg.space === "unplaced"
                  ? tracts.status
                  : "No registered tractogram for this image. Load .tck/.trk in this image's space."
              }
            >
              {tracts ? (
                <>
                  <p className="text-[12px] text-[#8095bf]">{tracts.status}</p>
                  <dl className="mt-1 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11.5px]">
                    {tracts.provenance.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-[#8095bf]">{k}</dt>
                        <dd className="text-[#c4d2ee]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-1 text-[11.5px] text-[#8095bf]">
                    Colour: fibre direction (red L–R, green A–P, blue S–I), not a measured value.
                  </p>
                  <label className="mt-1 flex items-center gap-2 text-[12px] text-[#a9bbdc]">
                    Opacity
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={tractOpacity}
                      onChange={(e) => setTractOpacity(Number(e.target.value))}
                      className="flex-1"
                    />
                  </label>
                </>
              ) : null}
            </LayerBlock>
            <LayerBlock
              name="Electrodes"
              tag="measured"
              on={electrodesVisible}
              setOn={setElectrodesVisible}
              available={Boolean(electrodes?.registered)}
              empty={
                electrodes
                  ? (electrodes.provenance.notes.at(-1) ?? "Not registered to this image.")
                  : "No registered electrode coordinates. Load a BIDS *_electrodes.tsv."
              }
            >
              {electrodes ? (
                <>
                  <p className="text-[12px] text-[#8095bf]">
                    {electrodes.electrodes.length} electrodes · {electrodes.coordinateSystem} ·{" "}
                    {electrodes.provenance.method}
                  </p>
                  <p className="text-[12px] text-[#8095bf]">{electrodes.provenance.notes.at(-1)}</p>
                  {eeg ? (
                    <div className="mt-1">
                      <p className="text-[12px] text-[#a9bbdc]">
                        Colour: measured relative {eeg.band} power
                      </p>
                      <div className="mt-1 h-2 rounded" style={{ background: viridisGradient() }} />
                      <div className="flex justify-between text-[11px] text-[#8095bf]">
                        <span>lowest</span>
                        <span>highest (this recording)</span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </LayerBlock>
            <LayerBlock
              name="EEG coherence"
              tag="inferred"
              on={connectionsVisible}
              setOn={setConnectionsVisible}
              available={Boolean(eeg && electrodes?.registered)}
              empty="Needs an EEG recording and registered electrodes."
            >
              <p className="text-[12px] text-[#8095bf]">
                Strongest {eeg?.pairs.length ?? 0} pairs in {eeg?.band}; a statistical estimate of
                coupling.
              </p>
            </LayerBlock>
          </Panel>

          <Panel title="3D rendering" tag="derived">
            <div className="flex flex-wrap gap-1.5">
              {(["composite", "mip", "surface"] as Render3DMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip ${mode3d === m ? "chip-on" : ""}`}
                  onClick={() => setMode3d(m)}
                >
                  {m === "composite" ? "Volume" : m === "mip" ? "MIP" : "Surface"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-[#8095bf]">
              Grayscale transfer function from the current window.
            </p>
            <Range label="Opacity" value={opacity3d} set={setOpacity3d} />
            <Range label="Threshold (of window)" value={threshold3d} set={setThreshold3d} />
            <p className="mt-2 text-[12px] font-semibold text-[#c4d2ee]">Clipping (patient axes)</p>
            {(
              [
                ["x", "R ↔ L"],
                ["y", "A ↔ P"],
                ["z", "I ↔ S"],
              ] as const
            ).map(([axis, label]) => (
              <div
                key={axis}
                className="mt-1 grid grid-cols-[3.2rem_1fr_1fr] items-center gap-2 text-[12px] text-[#a9bbdc]"
              >
                <span>{label}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={clipFrac[axis][0]}
                  onChange={(e) =>
                    setClipFrac((c) => ({
                      ...c,
                      [axis]: [Math.min(Number(e.target.value), c[axis][1] - 0.02), c[axis][1]],
                    }))
                  }
                  aria-label={`${label} minimum`}
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={clipFrac[axis][1]}
                  onChange={(e) =>
                    setClipFrac((c) => ({
                      ...c,
                      [axis]: [c[axis][0], Math.max(Number(e.target.value), c[axis][0] + 0.02)],
                    }))
                  }
                  aria-label={`${label} maximum`}
                />
              </div>
            ))}
            <p className="mt-2 text-[12px] font-semibold text-[#c4d2ee]">Camera</p>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(
                ["anterior", "posterior", "left", "right", "superior", "inferior"] as CameraPreset[]
              ).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="chip justify-center capitalize"
                  onClick={() => setPreset({ name: p, nonce: Date.now() })}
                >
                  {p}
                </button>
              ))}
            </div>
          </Panel>
        </aside>

        {/* ------------------------------------------------------- viewports */}
        <section className="min-w-0">
          {!volume ? (
            <div className="grid h-[70vh] place-items-center rounded-md border border-[#16305e] bg-black text-[14px] text-[#a9bbdc]">
              {busy ?? "No image loaded."}
            </div>
          ) : layout === "quad" ? (
            <div className="grid h-[calc(100vh-10rem)] min-h-[40rem] grid-cols-2 grid-rows-2 gap-1 rounded-md border border-[#16305e] bg-[#16305e] p-px">
              {PLANES.map((p) => (
                <div key={p} className="min-h-0 min-w-0">
                  {viewport(p)}
                </div>
              ))}
              <div className="relative min-h-0 min-w-0">
                {threeD}
                <span className="pointer-events-none absolute left-2 top-1.5 font-mono text-[11px] text-[#d5e2fa] [text-shadow:0_0_3px_#000]">
                  3D · {mode3d === "composite" ? "volume" : mode3d} ·{" "}
                  <Box className="inline h-3 w-3" /> patient space
                </span>
              </div>
            </div>
          ) : (
            <div className="h-[calc(100vh-10rem)] min-h-[40rem] rounded-md border border-[#16305e]">
              {viewport(focus)}
            </div>
          )}
        </section>

        {/* ----------------------------------------------------- right rail */}
        <aside className="flex min-w-0 flex-col gap-3">
          {volume && hist && win ? (
            <>
              <WindowPanel
                volume={volume}
                histogram={hist}
                win={win}
                onWindow={setWin}
                options={options}
              />
              <DisplayPanel
                interpolation={interpolation}
                setInterpolation={setInterpolation}
                enhancement={enhancement}
                setEnhancement={setEnhancement}
                original={original}
                setOriginal={setOriginal}
                split={split}
                setSplit={setSplit}
              />
              <MeasurementsPanel
                volume={volume}
                annotations={annotations}
                remove={(id) => setAnnotations((a) => a.filter((x) => x.id !== id))}
                clear={() => setAnnotations([])}
              />
              <MetadataPanel volume={volume} />
            </>
          ) : null}
        </aside>
      </main>

      <div className="px-3 pb-6">
        <EegSection onDerived={setEeg} />
      </div>
      <footer className="border-t border-[#16305e] px-4 py-3 text-[12px] text-[#8095bf]">
        {DISCLAIMER} Coordinates are DICOM patient space (LPS, mm); axial and coronal views follow
        radiological convention. No compliance with DICOM, FDA, CE/MDR or HIPAA is claimed.
      </footer>
    </div>
  );
}

function LayerBlock({
  name,
  tag,
  on,
  setOn,
  available,
  empty,
  children,
}: {
  name: string;
  tag: string;
  on: boolean;
  setOn: (b: boolean) => void;
  available: boolean;
  empty: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t border-[#0e2247] py-2 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[13px]">
          <input
            type="checkbox"
            checked={on && available}
            disabled={!available}
            onChange={(e) => setOn(e.target.checked)}
          />
          {name}
        </label>
        <Tag kind={tag} />
      </div>
      <div className="mt-1">{available || children ? children : null}</div>
      {!available ? <p className="mt-1 text-[12px] text-[#8095bf]">{empty}</p> : null}
    </div>
  );
}

function Range({ label, value, set }: { label: string; value: number; set: (n: number) => void }) {
  return (
    <label className="mt-2 flex flex-col gap-1 text-[12px] text-[#a9bbdc]">
      <span className="flex justify-between">
        {label}
        <span className="font-mono">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      />
    </label>
  );
}
