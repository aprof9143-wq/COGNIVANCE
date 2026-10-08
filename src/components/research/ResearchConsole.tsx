import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  Box,
  Brain,
  FileUp,
  Layers,
  LogOut,
  Microscope,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  Sparkles,
  Target,
  Waves,
  Workflow,
} from "lucide-react";
import { tractStride, type Scene } from "./scenes";
import { VolumeRenderer, type Palette, type RenderMode } from "./VolumeRenderer";
import { SliceView } from "./SliceView";
import { EegTraces, SpectrumPlot, Topomap } from "./EegPanels";
import {
  alzheimerBiomarkers,
  eegAsymmetry,
  mriAsymmetry,
  posteriorDominantRhythm,
  regionalSummary,
} from "./fusion";
import {
  BRATS_CLASSES,
  demonstrationLesion,
  parseNifti,
  parseNiftiLabels,
  phantomVolume,
  readNiftiBytes,
  type LabelVolume,
  type NiftiVolume,
} from "@/lib/nifti";
import {
  parseBundledTractogram,
  parseTck,
  parseTrk,
  syntheticTractogram,
  type Tractogram,
} from "./tractography";
import { canonicalChannelName, parseEdf, phantomRecording, type EdfRecording } from "@/lib/edf";
import { analyseChannel, BANDS, coherenceMatrix, type ChannelSpectrum } from "@/lib/signal";
import { findElectrode, MONTAGE_1020 } from "@/lib/montage";
import {
  FREESURFER_CONVENTION,
  LABEL_CONVENTIONS,
  parseNiftiSegmentation,
} from "@/lib/imaging/nifti";
import { classVolumes } from "@/lib/imaging/segmentation";
import {
  fingerprint,
  offerLinked,
  planLinked,
  setLinked,
  TEMPLATE_FINGERPRINT,
  toLinkedMarkers,
  useLinked,
  type LinkedState,
} from "@/lib/neuro/linked";
import { linkTemplateAseg } from "@/lib/neuro/templateAtlas";
import { setLinkedFiles, setLinkedParcellation } from "@/lib/neuro/linkedFiles";
import { endSession } from "@/lib/session";

/** EEG analysed over at most this many seconds, so a long recording stays responsive. */
const ANALYSIS_WINDOW_S = 300;

type Source = "phantom" | "upload";
/** A volume can also be the bundled population template: real anatomy, no patient. */
type VolumeSource = Source | "template";

const TEMPLATE_URL = "/templates/mni152_template.nii.gz";
const TEMPLATE_NAME = "MNI152 template (ICBM 2009a)";

const volumeLabel = (src: VolumeSource) =>
  src === "upload" ? "subject" : src === "template" ? "template" : "phantom";

/** A tractogram can also be the bundled one, computed offline from open data. */
type TractSource = Source | "bundled";

const TRACTS_URL = "/templates/tractogram_ds000221.bin.gz";
const TRACTS_NAME = "OpenNeuro ds000221 · DIPY CSD";

async function fetchBundledTracts(): Promise<Tractogram> {
  const res = await fetch(TRACTS_URL);
  if (!res.ok) throw new Error(`tractogram: HTTP ${res.status}`);
  // readNiftiBytes inflates by magic bytes, which is what a .gz here needs too.
  const buf = await readNiftiBytes(new File([await res.blob()], "tracts.bin.gz"));
  return parseBundledTractogram(
    buf,
    "Whole-brain probabilistic tractography of one healthy adult (OpenNeuro ds000221, CC0), affinely registered to the MNI152 template.",
  );
}

async function fetchTemplate(): Promise<NiftiVolume> {
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`template: HTTP ${res.status}`);
  const file = new File([await res.blob()], "mni152_template.nii.gz");
  return parseNifti(await readNiftiBytes(file), 160);
}

export function ResearchConsole() {
  const navigate = useNavigate();

  // -- data -----------------------------------------------------------------
  const [volume, setVolume] = useState<NiftiVolume>(() => phantomVolume(144));
  const [volumeName, setVolumeName] = useState("Synthetic phantom");
  const [volumeSource, setVolumeSource] = useState<VolumeSource>("phantom");

  const [recording, setRecording] = useState<EdfRecording>(() => phantomRecording(30));
  const [recordingName, setRecordingName] = useState("Synthetic 10-20 recording");
  const [recordingSource, setRecordingSource] = useState<Source>("phantom");

  const [tractogram, setTractogram] = useState<Tractogram>(() => syntheticTractogram());
  const [tractName, setTractName] = useState("Synthetic demo bundle");
  const [tractSource, setTractSource] = useState<TractSource>("phantom");

  // The demonstration lesion only ever appears on the phantom or the population
  // template, neither of which is a person. On an uploaded scan a synthetic
  // lesion would read as a finding, so it is switched off there.
  const [lesion, setLesion] = useState<LabelVolume | null>(() => demonstrationLesion(144));
  const [lesionName, setLesionName] = useState("Demonstration lesion");
  const [lesionSource, setLesionSource] = useState<Source>("phantom");
  const [lesionWarning, setLesionWarning] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // -- view state -----------------------------------------------------------
  const [mode, setMode] = useState<RenderMode>("volume");
  const [palette, setPalette] = useState<Palette>("neural");
  const [threshold, setThreshold] = useState(0.12);
  const [opacity, setOpacity] = useState(0.16);
  const [cutaway, setCutaway] = useState(0);
  const [axial, setAxial] = useState(0.5);
  const [coronal, setCoronal] = useState(0.5);
  const [sagittal, setSagittal] = useState(0.5);
  const [band, setBand] = useState("alpha");
  const [hovered, setHovered] = useState<string | null>(null);
  const [showElectrodes, setShowElectrodes] = useState(true);
  const [showConnections, setShowConnections] = useState(true);
  const [showTracts, setShowTracts] = useState(true);
  const [tractOpacity, setTractOpacity] = useState(0.3);
  const [showLesion, setShowLesion] = useState(true);
  const [showHud, setShowHud] = useState(true);
  // On a phone the lesion callout covers most of the brain; start with it off
  // there (the HUD toggle brings it back).
  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) setShowHud(false);
  }, []);
  const [topK, setTopK] = useState(18);
  const [autoRotate, setAutoRotate] = useState(true);
  const [scene, setScene] = useState<Scene>("fusion");
  const [playing, setPlaying] = useState(true);
  const [clock, setClock] = useState("");

  // Open on the population template rather than the phantom: a visitor sees real
  // cortical anatomy immediately. It is an average of many brains, not a person,
  // so it is labelled "template" and nothing on it is a finding. If the fetch
  // fails the phantom stays, and the console still works.
  const template = useRef<NiftiVolume | null>(null);
  const bundledTracts = useRef<Tractogram | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Real tractography replaces the synthetic bundles once it arrives.
    fetchBundledTracts()
      .then((tg) => {
        bundledTracts.current = tg;
        if (cancelled) return;
        setTractSource((src) => {
          if (src !== "phantom") return src;
          setTractogram(tg);
          setTractName(TRACTS_NAME);
          return "bundled";
        });
      })
      .catch(() => {});
    fetchTemplate()
      .then((vol) => {
        template.current = vol;
        if (cancelled) return;
        setVolumeSource((src) => {
          if (src !== "phantom") return src;
          setVolume(vol);
          setVolumeName(TEMPLATE_NAME);
          return "template";
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      setClock(
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // -- EEG analysis: real Welch spectra per channel --------------------------
  const { spectra, channels, sampleRate, analysedSeconds } = useMemo(() => {
    const map = new Map<string, ChannelSpectrum>();
    const traced: { label: string; data: Float32Array }[] = [];
    let fs = recording.eegSignals[0]?.sampleRate ?? 256;

    for (const sig of recording.eegSignals) {
      const label = canonicalChannelName(sig.label) || sig.label;
      fs = sig.sampleRate;
      const n = Math.min(sig.data.length, Math.round(ANALYSIS_WINDOW_S * sig.sampleRate));
      const window = sig.data.subarray(0, n);
      map.set(label, analyseChannel(label, window, sig.sampleRate));
      traced.push({ label, data: sig.data });
    }
    const seconds = Math.min(recording.durationSeconds, ANALYSIS_WINDOW_S);
    return { spectra: map, channels: traced, sampleRate: fs, analysedSeconds: seconds };
  }, [recording]);

  // Electrodes present in both the recording and the 10-20 montage.
  const mapped = useMemo(
    () => MONTAGE_1020.filter((e) => spectra.has(e.label)).map((e) => e.label),
    [spectra],
  );

  // Selected band's relative power, rescaled across electrodes so the spread is visible.
  const bandValues = useMemo(() => {
    const raw = new Map<string, number>();
    for (const label of mapped) {
      const v = spectra.get(label)?.relative[band];
      if (v !== undefined && Number.isFinite(v)) raw.set(label, v);
    }
    const vals = [...raw.values()];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    const scaled = new Map<string, number>();
    for (const [k, v] of raw) scaled.set(k, (v - lo) / span);
    return { raw, scaled };
  }, [mapped, spectra, band]);

  const electrodes = useMemo(
    () =>
      MONTAGE_1020.map((e) => ({
        label: e.label,
        dir: e.dir,
        value: bandValues.scaled.has(e.label) ? bandValues.scaled.get(e.label)! : null,
      })),
    [bandValues],
  );

  // -- fusion ---------------------------------------------------------------
  const mriAsym = useMemo(() => mriAsymmetry(volume, threshold), [volume, threshold]);
  const eegAsym = useMemo(() => eegAsymmetry(spectra, band), [spectra, band]);
  const regions = useMemo(() => regionalSummary(spectra, band), [spectra, band]);
  const pdr = useMemo(() => posteriorDominantRhythm(spectra), [spectra]);
  const globalTA = useMemo(() => {
    const v = [...spectra.values()].map((s) => s.thetaAlphaRatio).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : Number.NaN;
  }, [spectra]);

  // Coherence over the 10-20 channels only, so arcs always have two endpoints.
  const coherence = useMemo(() => {
    const montageChannels = channels.filter((c) => findElectrode(c.label));
    const selected = BANDS.find((b) => b.name === band) ?? BANDS[2]!;
    return coherenceMatrix(montageChannels, sampleRate, selected);
  }, [channels, sampleRate, band]);

  const alphaCoherence = useMemo(() => {
    const montageChannels = channels.filter((c) => findElectrode(c.label));
    return coherenceMatrix(
      montageChannels,
      sampleRate,
      BANDS.find((b) => b.name === "alpha")!,
    );
  }, [channels, sampleRate]);

  /**
   * The strongest pairs, after removing the estimator's own floor. With S
   * segments, coherence between two unrelated signals averages about 1/S, so
   * anything near that is noise and is not drawn as a connection.
   */
  const connections = useMemo(() => {
    const { labels, values, segments } = coherence;
    const n = labels.length;
    const floor = segments ? 1 / segments : 0;
    const out: { a: string; b: string; value: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = values[i * n + j]!;
        if (v > floor * 3) out.push({ a: labels[i]!, b: labels[j]!, value: v });
      }
    }
    out.sort((x, y) => y.value - x.value);
    return out.slice(0, topK);
  }, [coherence, topK]);

  const biomarkers = useMemo(
    () => alzheimerBiomarkers(spectra, alphaCoherence),
    [spectra, alphaCoherence],
  );

  // -- link to Neurodegeneration Tracking ------------------------------------
  // Descriptive numbers only: no file names, no pixels, no identifiers. The
  // phantom sphere is not a brain, so it is never linked.
  useEffect(() => {
    if (volumeSource === "phantom") return;
    const isTemplate = volumeSource === "template";
    offerLinked("mri", {
      origin: "console",
      kind: isTemplate ? "template" : "subject",
      label: isTemplate ? TEMPLATE_NAME : "Uploaded NIfTI volume",
      fingerprint: isTemplate ? TEMPLATE_FINGERPRINT : fingerprint(volume.data),
      dims: volume.dims,
      spacingMm: volume.spacing,
      acquisitionMonth: null,
      manufacturer: null,
      model: null,
      fieldStrength: null,
      sequence: null,
      linkedAt: new Date().toISOString(),
    });
    // The template ships with FreeSurfer labels; a subject needs a label map.
    if (isTemplate) {
      setLinkedFiles({ source: "template" });
      void linkTemplateAseg("console").catch(() => {});
    }
  }, [volume, volumeSource]);

  useEffect(() => {
    offerLinked("eeg", {
      origin: "console",
      kind: recordingSource === "upload" ? "subject" : "phantom",
      label: recordingSource === "upload" ? "Uploaded EDF recording" : "Synthetic 10-20 recording",
      channels: recording.eegSignals.length,
      mapped: mapped.length,
      sampleRate,
      analysedSeconds,
      markers: toLinkedMarkers(biomarkers),
      linkedAt: new Date().toISOString(),
    });
  }, [biomarkers, recording, recordingSource, mapped.length, sampleRate, analysedSeconds]);

  const linked = useLinked();

  const focus = hovered
    ? (spectra.get(hovered) ?? null)
    : (spectra.get("O1") ?? [...spectra.values()][0] ?? null);

  // -- uploads --------------------------------------------------------------
  const mriInput = useRef<HTMLInputElement>(null);
  const eegInput = useRef<HTMLInputElement>(null);

  const loadMri = useCallback(async (file: File) => {
    setError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      // Yield so the busy state paints before the synchronous parse.
      await new Promise((r) => setTimeout(r, 30));
      const bytes = await readNiftiBytes(file);
      const vol = parseNifti(bytes, 160);
      // Kept in memory so the tracking dashboard's 3D map shows this scan.
      setLinkedFiles({ source: "subject", t1: { name: "scan.nii", buffer: bytes }, parc: null });
      setVolume(vol);
      setVolumeName(file.name);
      setVolumeSource("upload");
      setAxial(0.5);
      setCoronal(0.5);
      setSagittal(0.5);
      // A synthetic lesion drawn on a real patient's anatomy would read as a
      // finding. Retire it; only a real segmentation brings the layer back.
      setLesionSource((src) => {
        if (src === "phantom") {
          setLesion(null);
          setLesionName("No segmentation loaded");
        }
        return src;
      });
      setLesionWarning(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that MRI file.");
    } finally {
      setBusy(null);
    }
  }, []);

  const loadEeg = useCallback(async (file: File) => {
    setError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const rec = parseEdf(await file.arrayBuffer());
      const recognised = rec.eegSignals.filter((s) => findElectrode(canonicalChannelName(s.label)));
      if (!recognised.length) {
        throw new Error(
          "No 10-20 channels recognised in this recording. Channels were: " +
            rec.eegSignals
              .slice(0, 8)
              .map((s) => s.label)
              .join(", ") +
            (rec.eegSignals.length > 8 ? "…" : ""),
        );
      }
      setRecording(rec);
      setRecordingName(file.name);
      setRecordingSource("upload");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that EEG file.");
    } finally {
      setBusy(null);
    }
  }, []);

  const tractInput = useRef<HTMLInputElement>(null);
  const lesionInput = useRef<HTMLInputElement>(null);
  const asegInput = useRef<HTMLInputElement>(null);

  /** A FreeSurfer label map for the loaded scan: regional volumes for tracking. */
  const loadAseg = useCallback(async (file: File) => {
    setError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const names = LABEL_CONVENTIONS[FREESURFER_CONVENTION]!;
      const bytes = await readNiftiBytes(file);
      setLinkedParcellation({ name: "labels.nii", buffer: bytes });
      const seg = parseNiftiSegmentation(bytes, "label map", names, FREESURFER_CONVENTION);
      const classes = classVolumes(seg).filter((k) => k.voxels > 0 && names[k.label]);
      if (!classes.length) {
        throw new Error(
          "No FreeSurfer aseg/aparc label IDs in this label map (e.g. 17/53 hippocampus). Regional volumes need a FreeSurfer-convention segmentation.",
        );
      }
      setLinked({
        segmentation: {
          origin: "console",
          label: "FreeSurfer label map loaded in the console",
          convention: FREESURFER_CONVENTION,
          method: "label map loaded by the user",
          classes: classes.map((k) => ({ label: k.label, name: k.name, mm3: k.mm3 })),
          linkedAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that label map.");
    } finally {
      setBusy(null);
    }
  }, []);

  const loadTracts = useCallback(async (file: File) => {
    setError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const buf = await file.arrayBuffer();
      const tg = /\.tck$/i.test(file.name) ? parseTck(buf) : parseTrk(buf);
      setTractogram(tg);
      setTractName(file.name);
      setTractSource("upload");
      setShowTracts(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that tractography file.");
    } finally {
      setBusy(null);
    }
  }, []);

  const loadLesion = useCallback(
    async (file: File) => {
      setError(null);
      setBusy(`Reading ${file.name}…`);
      try {
        await new Promise((r) => setTimeout(r, 30));
        const lv = parseNiftiLabels(await readNiftiBytes(file), 160);
        setLesion(lv);
        setLesionName(file.name);
        setLesionSource("upload");
        setShowLesion(true);
        // Alignment rests on the segmentation sharing the anatomy's grid.
        const same = lv.dims.every((d, i) => d === volume.dims[i]);
        setLesionWarning(
          same
            ? null
            : `Segmentation grid ${lv.dims.join("×")} differs from the scan's ${volume.dims.join("×")}. Overlay alignment assumes they share a field of view — check it before reading the overlay.`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that segmentation.");
      } finally {
        setBusy(null);
      }
    },
    [volume.dims],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      for (const file of Array.from(e.dataTransfer.files)) {
        const name = file.name;
        // A NIfTI named like a segmentation is routed to the lesion layer, so
        // dropping a BraTS folder's files all at once does the right thing.
        if (/\.nii(\.gz)?$/i.test(name) && /(aseg|aparc)/i.test(name)) void loadAseg(file);
        else if (/\.nii(\.gz)?$/i.test(name) && /(seg|label|mask|lesion)/i.test(name))
          void loadLesion(file);
        else if (/\.nii(\.gz)?$/i.test(name)) void loadMri(file);
        else if (/\.edf$/i.test(name)) void loadEeg(file);
        else if (/\.(trk|tck)$/i.test(name)) void loadTracts(file);
        else
          setError(
            `${name}: drop a .nii scan, a segmentation, an .edf recording, or a .trk / .tck tractogram.`,
          );
      }
    },
    [loadMri, loadEeg, loadTracts, loadLesion, loadAseg],
  );

  const resetAll = () => {
    // An explicit reset makes the demo data what is on screen again; the
    // tracking dashboard keeps every subject scan already linked.
    setLinked({ mri: null, eeg: null, segmentation: null });
    if (template.current) {
      setVolume(template.current);
      setVolumeName(TEMPLATE_NAME);
      setVolumeSource("template");
    } else {
      setVolume(phantomVolume(144));
      setVolumeName("Synthetic phantom");
      setVolumeSource("phantom");
    }
    setRecording(phantomRecording(30));
    setRecordingName("Synthetic 10-20 recording");
    setRecordingSource("phantom");
    if (bundledTracts.current) {
      setTractogram(bundledTracts.current);
      setTractName(TRACTS_NAME);
      setTractSource("bundled");
    } else {
      setTractogram(syntheticTractogram());
      setTractName("Synthetic demo bundle");
      setTractSource("phantom");
    }
    setLesion(demonstrationLesion(144));
    setLesionName("Demonstration lesion");
    setLesionSource("phantom");
    setLesionWarning(null);
    setError(null);
  };

  // Each scene is a preset over the same layers; every toggle stays adjustable.
  const applyScene = (next: Scene) => {
    setScene(next);
    if (next === "fusion") {
      setMode("volume");
      setPalette("neural");
      setShowTracts(true);
      setTractOpacity(0.3);
      setShowElectrodes(true);
      setShowConnections(true);
      setShowLesion(true);
    } else if (next === "fibres") {
      setShowTracts(true);
      setTractOpacity(0.85);
      setShowElectrodes(false);
      setShowConnections(false);
      setShowLesion(false);
    } else {
      setMode("glass");
      setPalette("neural");
      setShowTracts(false);
      setShowElectrodes(false);
      setShowConnections(false);
      setShowLesion(true);
    }
  };

  const signOut = () => {
    endSession();
    navigate({ to: "/" });
  };

  const fused = volumeSource === "upload" && recordingSource === "upload";

  return (
    <div
      className="min-h-screen bg-[#00030b] bg-[radial-gradient(ellipse_90%_50%_at_50%_-10%,#0b2459_0%,rgba(0,3,11,0)_60%),radial-gradient(ellipse_60%_40%_at_100%_100%,#07183d_0%,rgba(0,3,11,0)_70%)] text-[#e6efff]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* ============================ HEADER ============================ */}
      <header className="relative z-30 border-b border-[#16305e] bg-[#00030b]/85 backdrop-blur-xl md:sticky md:top-0">
        <span className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-px bg-gradient-to-r from-transparent via-[#7fd8ff]/60 to-transparent" />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <img src="/logo-mark.png" alt="Cognivance" className="h-8 w-auto" />
            <div className="leading-tight">
              <p className="font-mono text-[0.62rem] font-semibold tracking-[0.22em] text-[#7fd8ff]">
                NIMBLE / RESEARCH OS
              </p>
              <p className="text-[0.72rem] text-[#8095bf]">Multimodal neural workstation</p>
            </div>
          </div>

          <div className="hidden h-8 w-px bg-[#16305e] md:block" />

          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <StatusChip on label="MRI" detail={volumeLabel(volumeSource)} />
            <StatusChip
              on
              label="EEG"
              detail={recordingSource === "upload" ? "subject" : "phantom"}
            />
            <StatusChip on={fused} label="FUSION" detail={fused ? "live" : "phantom data"} accent />
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="mr-2 hidden font-mono text-[0.72rem] tracking-[0.06em] text-[#8095bf] 2xl:inline">
              {clock}
            </span>
            <Link to="/viewer" className={NAV_BUTTON}>
              <ScanLine className="h-3.5 w-3.5" />
              <span className="sm:hidden">Viewer</span>
              <span className="hidden sm:inline">Diagnostic viewer</span>
            </Link>
            <Link to="/neurodegeneration" className={NAV_BUTTON}>
              <Microscope className="h-3.5 w-3.5" /> Neurodegeneration
            </Link>
            <Link to="/simulation" className={NAV_BUTTON}>
              <Box className="h-3.5 w-3.5" /> Simulation
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-md border border-[#16305e] px-2.5 py-1.5 text-[0.72rem] text-[#8095bf] transition hover:border-[#3d8bf5] hover:text-[#e6efff]"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mx-3 mt-3 flex items-start gap-3 rounded-md border border-[#e5484d]/40 bg-[#e5484d]/[0.07] px-4 py-2.5 text-[0.82rem] text-[#ffc9cb]">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#e5484d]" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-[#ffc9cb]/70 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* ============================ GRID ============================ */}
      <main className="grid gap-3 p-3 xl:grid-cols-[17.5rem_minmax(0,1fr)_21rem]">
        {/* ----------------------------- LEFT ----------------------------- */}
        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Data sources" meta="drop files anywhere">
            <div className="flex flex-col gap-2">
              <UploadButton
                icon={<Brain className="h-4 w-4" />}
                label="Load MRI volume"
                hint=".nii · .nii.gz"
                onClick={() => mriInput.current?.click()}
              />
              <UploadButton
                icon={<Waves className="h-4 w-4" />}
                label="Load EEG recording"
                hint=".edf"
                onClick={() => eegInput.current?.click()}
              />
              <UploadButton
                icon={<Workflow className="h-4 w-4" />}
                label="Load tractography"
                hint=".trk · .tck"
                onClick={() => tractInput.current?.click()}
              />
              <UploadButton
                icon={<Target className="h-4 w-4" />}
                label="Load lesion segmentation"
                hint="BraTS seg · .nii.gz"
                onClick={() => lesionInput.current?.click()}
              />
              <UploadButton
                icon={<Microscope className="h-4 w-4" />}
                label="Load FreeSurfer label map"
                hint="aseg / aparc · regional volumes"
                onClick={() => asegInput.current?.click()}
              />
              <button
                type="button"
                onClick={resetAll}
                className="mt-1 flex items-center justify-center gap-2 rounded-md border border-[#16305e] px-3 py-2 text-[0.74rem] text-[#8095bf] transition hover:border-[#3d8bf5] hover:text-[#e6efff]"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset to demo data
              </button>
            </div>
            <input
              ref={mriInput}
              type="file"
              accept=".nii,.gz"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadMri(f);
                e.target.value = "";
              }}
            />
            <input
              ref={tractInput}
              type="file"
              accept=".trk,.tck"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadTracts(f);
                e.target.value = "";
              }}
            />
            <input
              ref={asegInput}
              type="file"
              accept=".nii,.gz"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadAseg(f);
                e.target.value = "";
              }}
            />
            <input
              ref={lesionInput}
              type="file"
              accept=".nii,.gz"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadLesion(f);
                e.target.value = "";
              }}
            />
            <input
              ref={eegInput}
              type="file"
              accept=".edf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadEeg(f);
                e.target.value = "";
              }}
            />
          </Panel>

          <Panel title="MRI volume" meta={volumeLabel(volumeSource)}>
            <p className="truncate font-mono text-[0.72rem] text-[#7fd8ff]" title={volumeName}>
              {volumeName}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-1.5">
              <Stat wide k="Matrix" v={volume.dims.join(" × ")} />
              <Stat
                wide
                k="Voxel spacing mm"
                v={volume.spacing.map((s) => s.toFixed(2)).join(" × ")}
              />
              <Stat k="Datatype" v={volume.datatypeLabel} />
              <Stat k="Frames" v={String(volume.frames)} />
              <Stat k="Tissue" v={`${(volume.stats.occupancy * 100).toFixed(1)}%`} />
              <Stat k="Window" v={`${fmt(volume.stats.p01)}–${fmt(volume.stats.p99)}`} />
            </dl>
          </Panel>

          <Panel title="EEG recording" meta={recordingSource === "upload" ? "subject" : "phantom"}>
            <p className="truncate font-mono text-[0.72rem] text-[#7fd8ff]" title={recordingName}>
              {recordingName}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-1.5">
              <Stat k="Channels" v={`${recording.eegSignals.length}`} />
              <Stat k="10-20 mapped" v={`${mapped.length}`} />
              <Stat k="Rate" v={`${sampleRate.toFixed(0)} Hz`} />
              <Stat k="Duration" v={`${recording.durationSeconds.toFixed(0)} s`} />
            </dl>
            {recording.durationSeconds > ANALYSIS_WINDOW_S ? (
              <p className="mt-2 text-[0.66rem] leading-relaxed text-[#8095bf]">
                Spectra computed over the first {ANALYSIS_WINDOW_S} s.
              </p>
            ) : null}
          </Panel>

          <Panel title="Rendering" meta="gpu raymarch">
            <p className="mb-1.5 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[#8095bf]">
              Mode
            </p>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as RenderMode)}
              options={[
                ["volume", "Volume"],
                ["iso", "Surface"],
                ["glass", "Glass"],
              ]}
            />
            <p className="mb-1.5 mt-3 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[#8095bf]">
              Palette
            </p>
            <Segmented
              value={palette}
              onChange={(v) => setPalette(v as Palette)}
              options={[
                ["neural", "Neural"],
                ["thermal", "Thermal"],
                ["clinical", "Grey"],
              ]}
            />
            <div className="mt-3 flex flex-col gap-3">
              <Slider
                id="threshold"
                label="Threshold"
                value={threshold}
                min={0.02}
                max={0.6}
                step={0.01}
                onChange={setThreshold}
              />
              <Slider
                id="opacity"
                label="Density"
                value={opacity}
                min={0.03}
                max={0.5}
                step={0.01}
                onChange={setOpacity}
              />
              <Slider
                id="cutaway"
                label="Cutaway"
                value={cutaway}
                min={0}
                max={0.95}
                step={0.01}
                onChange={setCutaway}
              />
              <Slider
                id="axial"
                label="Axial plane"
                value={axial}
                min={0}
                max={1}
                step={0.005}
                onChange={setAxial}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Toggle on={autoRotate} onClick={() => setAutoRotate((v) => !v)} label="Rotate" />
              <Toggle on={showHud} onClick={() => setShowHud((v) => !v)} label="HUD" />
            </div>
          </Panel>
        </aside>

        {/* ----------------------------- CENTRE ----------------------------- */}
        {/* On narrow screens the 3D view comes first, its controls after it. */}
        <section className="order-first flex min-w-0 flex-col gap-3 xl:order-none">
          <Panel
            title="3D volume · EEG fusion"
            meta={`${volume.size.join("³ / ").split(" / ")[0]} texture · ${mapped.length} electrodes`}
            flush
          >
            <div className="relative h-[clamp(28rem,62vh,46rem)] overflow-hidden bg-[radial-gradient(ellipse_at_50%_45%,#0a1f4a_0%,#01071a_55%,#00030b_100%)]">
              <VolumeRenderer
                volume={volume}
                mode={mode}
                palette={palette}
                threshold={threshold}
                opacity={opacity}
                cutaway={cutaway}
                slice={axial}
                electrodes={electrodes}
                showElectrodes={showElectrodes}
                connections={connections}
                showConnections={showConnections}
                tractogram={tractogram}
                showTracts={showTracts}
                tractOpacity={tractOpacity}
                lesion={lesion}
                showLesion={showLesion}
                lesionSynthetic={lesionSource !== "upload"}
                showHud={showHud}
                scene={scene}
                tractsRegistered={tractSource !== "bundled" || volumeSource === "template"}
                autoRotate={autoRotate && !hovered}
                onHoverElectrode={setHovered}
                hoveredElectrode={hovered}
              />

              {/* HUD overlays — read-outs, never interactive, so they don't block the orbit */}
              <div className="pointer-events-none absolute left-4 top-3 flex flex-col gap-1 font-mono text-[0.62rem] tracking-[0.1em] text-[#8095bf]">
                <span className="text-[#7fd8ff]">
                  {mode === "volume"
                    ? "DIRECT VOLUME"
                    : mode === "iso"
                      ? "ISO-SURFACE"
                      : "GRADIENT GLASS"}{" "}
                  · {palette.toUpperCase()}
                </span>
                <span>{volume.extent.map((v) => v.toFixed(0)).join(" × ")} mm</span>
                {/* The layer list needs room; on phones the Layers panel below carries it. */}
                <span className="mt-2 hidden flex-col gap-1 sm:flex">
                  <span className="text-[#5e719a]">LAYERS · ONE COORDINATE FRAME</span>
                  <HudLayer on label="MRI" detail={volumeLabel(volumeSource)} colour="#7fd8ff" />
                  <HudLayer
                    on={showTracts}
                    label="TRACTS"
                    detail={`${
                      tractStride(scene) > 1 && tractogram.count > 1
                        ? `${Math.ceil(tractogram.count / tractStride(scene)).toLocaleString()} of ${tractogram.count.toLocaleString()}`
                        : tractogram.count.toLocaleString()
                    } fibres · ${
                      tractSource === "upload"
                        ? "file"
                        : tractSource === "bundled"
                          ? volumeSource === "template"
                            ? "ds000221 · registered"
                            : "ds000221 · fitted"
                          : "synthetic"
                    }`}
                    colour="#63b0ff"
                    warn={
                      tractSource === "phantom" ||
                      (tractSource === "bundled" && volumeSource !== "template")
                    }
                  />
                  <HudLayer
                    on={showLesion && Boolean(lesion)}
                    label="LESION"
                    detail={
                      lesion
                        ? lesionSource === "upload"
                          ? "segmentation"
                          : "demonstration"
                        : "none loaded"
                    }
                    colour="#ff4860"
                    warn={lesionSource !== "upload" && Boolean(lesion)}
                  />
                  <HudLayer
                    on={showConnections}
                    label="EEG COHERENCE"
                    detail={`${connections.length} pairs · ${band}`}
                    colour="#b8f0ff"
                  />
                </span>
              </div>

              {showLesion && lesion && lesionSource !== "upload" ? (
                <div className="pointer-events-none absolute left-4 top-[3.3rem] rounded border border-[#ff4860]/50 bg-[#1a0508]/80 px-3 py-1.5 font-mono text-[0.6rem] tracking-[0.12em] text-[#ff9aa6] backdrop-blur lg:left-1/2 lg:top-3 lg:-translate-x-1/2">
                  <span className="lg:hidden">DEMO LESION · SYNTHETIC · NOT A FINDING</span>
                  <span className="hidden lg:inline">
                    DEMONSTRATION LESION · SYNTHETIC · NOT A FINDING
                  </span>
                </div>
              ) : null}

              <SceneSwitch scene={scene} onChange={applyScene} />

              {hovered ? (
                <ElectrodeCard
                  label={hovered}
                  spectrum={spectra.get(hovered) ?? null}
                  band={band}
                />
              ) : null}

              <div className="pointer-events-none absolute bottom-3 left-4 right-4 flex flex-wrap items-end justify-between gap-3">
                <p className="hidden max-w-[46ch] font-mono text-[0.6rem] leading-relaxed tracking-[0.06em] text-[#5e719a] sm:block">
                  DRAG TO ORBIT · SCROLL TO ZOOM · HOVER AN ELECTRODE · ELECTRODES PROJECTED ONTO
                  THIS SCALP — APPROXIMATE, NOT CO-REGISTERED ·{" "}
                  {tractSource === "bundled" && volumeSource === "template"
                    ? "TRACTS AFFINELY REGISTERED TO THIS TEMPLATE"
                    : "TRACTS FITTED TO THIS BRAIN"}
                </p>
                <div className="flex flex-col items-end gap-1.5">
                  {showTracts ? <TractLegend /> : null}
                  <BandLegend band={band} />
                </div>
              </div>

              {busy ? (
                <div className="absolute inset-0 grid place-items-center bg-[#00030b]/70 backdrop-blur-sm">
                  <div className="flex items-center gap-3 font-mono text-[0.78rem] text-[#7fd8ff]">
                    <Sparkles className="h-4 w-4 animate-pulse" /> {busy}
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>

          <div className="grid gap-3 md:grid-cols-3">
            {(
              [
                ["axial", axial, setAxial, [sagittal, coronal]],
                ["coronal", coronal, setCoronal, [sagittal, axial]],
                ["sagittal", sagittal, setSagittal, [coronal, axial]],
              ] as const
            ).map(([plane, pos, setPos, cross]) => (
              <Panel key={plane} title={plane} meta={`${Math.round(pos * 100)}%`} flush>
                <div className="relative aspect-square bg-black">
                  <SliceView
                    volume={volume}
                    plane={plane}
                    position={pos}
                    crosshair={[cross[0], cross[1]]}
                    onPick={(u, v) => {
                      // Clicking one slice moves the other two to that point.
                      if (plane === "axial") {
                        setSagittal(u);
                        setCoronal(v);
                      } else if (plane === "coronal") {
                        setSagittal(u);
                        setAxial(v);
                      } else {
                        setCoronal(u);
                        setAxial(v);
                      }
                    }}
                  />
                </div>
                <div className="border-t border-[#16305e] px-3 py-2">
                  <input
                    id={`slice-${plane}`}
                    type="range"
                    min={0}
                    max={1}
                    step={0.005}
                    value={pos}
                    onChange={(e) => setPos(Number(e.target.value))}
                    className="w-full accent-[#7fd8ff]"
                    aria-label={`${plane} position`}
                  />
                </div>
              </Panel>
            ))}
          </div>

          <Panel
            title="EEG · live traces"
            meta={`${sampleRate.toFixed(0)} Hz · 4 s window`}
            flush
            action={
              <button
                type="button"
                onClick={() => setPlaying((v) => !v)}
                className="flex items-center gap-1.5 rounded border border-[#16305e] px-2 py-1 font-mono text-[0.6rem] tracking-[0.1em] text-[#8095bf] transition hover:border-[#3d8bf5] hover:text-[#e6efff]"
              >
                {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {playing ? "PAUSE" : "PLAY"}
              </button>
            }
          >
            <div className="h-[18rem] bg-[#01071a] px-2 py-2">
              <EegTraces
                channels={channels}
                sampleRate={sampleRate}
                hovered={hovered}
                playing={playing}
              />
            </div>
          </Panel>
          <Panel title="Layers" meta="one frame">
            <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
              <LayerRow
                on={showTracts}
                onClick={() => setShowTracts((v) => !v)}
                colour="#63b0ff"
                label="Tractography"
                detail={`${tractogram.count.toLocaleString()} fibres`}
              />
              <LayerRow
                on={showLesion}
                onClick={() => setShowLesion((v) => !v)}
                colour="#ff4860"
                label="Lesion"
                detail={lesion ? `${lesion.counts.size} classes` : "none"}
                disabled={!lesion}
              />
              <LayerRow
                on={showElectrodes}
                onClick={() => setShowElectrodes((v) => !v)}
                colour="#7fd8ff"
                label="Electrodes"
                detail={`${mapped.length} on scalp`}
              />
              <LayerRow
                on={showConnections}
                onClick={() => setShowConnections((v) => !v)}
                colour="#b8f0ff"
                label="EEG coherence"
                detail={`${connections.length} arcs`}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Slider
                id="tract-opacity"
                label="Fibre brightness"
                value={tractOpacity}
                min={0.1}
                max={1}
                step={0.01}
                onChange={setTractOpacity}
              />
              <Slider
                id="top-k"
                label="Strongest pairs"
                value={topK}
                min={4}
                max={60}
                step={1}
                onChange={(v) => setTopK(Math.round(v))}
              />
            </div>
          </Panel>
        </section>

        {/* ----------------------------- RIGHT ----------------------------- */}
        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Scalp topography" meta="relative power">
            <div className="mb-3 flex flex-wrap gap-1">
              {BANDS.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => setBand(b.name)}
                  className={`rounded px-2 py-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] transition ${
                    band === b.name
                      ? "bg-[#7fd8ff] text-[#00030b]"
                      : "border border-[#16305e] text-[#8095bf] hover:border-[#3d8bf5] hover:text-[#e6efff]"
                  }`}
                >
                  {b.name}{" "}
                  <span className="opacity-60">
                    {b.lo}–{b.hi}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex justify-center">
              <Topomap values={bandValues.scaled} hovered={hovered} onHover={setHovered} />
            </div>
          </Panel>

          <Panel title="Fusion readout" meta="same head · two modalities">
            <p className="mb-3 text-[0.72rem] leading-relaxed text-[#8095bf]">
              Hemispheric asymmetry asked of both modalities. Index = (L − R) / (L + R); zero is
              symmetric.
            </p>
            <AsymmetryBar
              label="MRI · tissue signal"
              icon={<Box className="h-3.5 w-3.5" />}
              value={mriAsym.index}
            />
            <AsymmetryBar
              label={`EEG · ${band} power`}
              icon={<Activity className="h-3.5 w-3.5" />}
              value={eegAsym.index}
            />
            <dl className="mt-4 grid grid-cols-2 gap-1.5">
              <Stat k="Posterior rhythm" v={Number.isFinite(pdr) ? `${pdr.toFixed(1)} Hz` : "—"} />
              <Stat k="Mean θ/α" v={Number.isFinite(globalTA) ? globalTA.toFixed(2) : "—"} />
              <Stat k="Electrodes on scalp" v={`${mapped.length} / ${MONTAGE_1020.length}`} />
              <Stat k="Analysed" v={`${analysedSeconds.toFixed(0)} s`} />
            </dl>
          </Panel>

          <Panel title="By region" meta={band}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.74rem]">
                <thead>
                  <tr className="text-left font-mono text-[0.56rem] uppercase tracking-[0.12em] text-[#8095bf]">
                    <th className="pb-2 font-medium">Region</th>
                    <th className="pb-2 text-right font-medium">Ch</th>
                    <th className="pb-2 text-right font-medium">{band}</th>
                    <th className="pb-2 text-right font-medium">θ/α</th>
                  </tr>
                </thead>
                <tbody>
                  {regions.map((r) => (
                    <tr key={r.region} className="border-t border-[#0e2247]">
                      <td className="py-1.5 capitalize text-[#e6efff]">{r.region}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#8095bf]">
                        {r.channels}
                      </td>
                      <td className="py-1.5 text-right">
                        <span className="inline-flex items-center justify-end gap-2">
                          <span className="h-1 w-12 overflow-hidden rounded-full bg-[#0e2247]">
                            <span
                              className="block h-full rounded-full bg-[#7fd8ff]"
                              style={{ width: `${Math.max(0, Math.min(100, r.bandShare * 100))}%` }}
                            />
                          </span>
                          <span className="w-9 font-mono tabular-nums text-[#e6efff]">
                            {Number.isFinite(r.bandShare)
                              ? `${(r.bandShare * 100).toFixed(0)}%`
                              : "—"}
                          </span>
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#e6efff]">
                        {Number.isFinite(r.thetaAlpha) ? r.thetaAlpha.toFixed(2) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Power spectrum" meta={focus?.label ?? "—"} flush>
            <div className="h-[9.5rem] px-2 py-2">
              <SpectrumPlot spectrum={focus} />
            </div>
          </Panel>

          <NeuroPanel linked={linked} />

          <p className="rounded-md border border-[#16305e] bg-[#01071a] px-3 py-2.5 text-[0.66rem] leading-relaxed text-[#8095bf]">
            <span className="font-semibold text-[#e6efff]">Research use only.</span> Every figure
            here is computed from the loaded files and is a measurement, not a diagnosis. Diagnostic
            outputs are gated behind the published benchmarks.
          </p>
        </aside>

        {/* ======================= CLINICAL ANALYTICS ROW ======================= */}
        <section className="grid min-w-0 gap-3 xl:col-span-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
          <Panel
            title="Lesion localisation"
            meta={
              lesion
                ? lesionSource === "upload"
                  ? "segmentation"
                  : "demonstration"
                : "no segmentation"
            }
          >
            {lesion ? (
              <LesionPanel
                lesion={lesion}
                source={lesionSource}
                name={lesionName}
                warning={lesionWarning}
              />
            ) : (
              <EmptyState
                icon={<Target className="h-5 w-5" />}
                title="No segmentation loaded"
                body="Load a BraTS segmentation to localise tumour sub-regions in 3D with measured volumes. Detection from a raw scan needs a trained segmentation model — see DEMO_DATA.md."
                action="Load segmentation"
                onAction={() => lesionInput.current?.click()}
              />
            )}
          </Panel>

          <Panel title="Alzheimer's EEG biomarkers" meta="measured · no verdict">
            <p className="mb-3 text-[0.72rem] leading-relaxed text-[#8095bf]">
              Markers the literature reports altered in Alzheimer's, each computed from this
              recording. The arrow shows the direction associated with disease — it is not a flag on
              this subject.
            </p>
            <div className="flex flex-col">
              {biomarkers.map((b) => (
                <BiomarkerRow key={b.id} marker={b} />
              ))}
            </div>
            <div className="mt-3 rounded border border-[#d9a441]/35 bg-[#d9a441]/[0.06] px-3 py-2 text-[0.66rem] leading-relaxed text-[#e8c98a]">
              <span className="font-semibold">No risk score is shown, by design.</span> Combining
              these into a prediction needs a model trained and validated on labelled cohorts. That
              gate has not been passed — see <span className="font-mono">/benchmarks</span>.
            </div>
          </Panel>

          <Panel title="Coherence matrix" meta={`${band} · ${coherence.segments} segments`}>
            <CoherenceGrid matrix={coherence} hovered={hovered} onHover={setHovered} />
            <p className="mt-2 text-[0.64rem] leading-relaxed text-[#5e719a]">
              Magnitude-squared coherence, power-weighted across the band. Scalp EEG against a
              common reference inflates coupling between neighbours through volume conduction — read
              strong local pairs with that in mind.
            </p>
          </Panel>
        </section>
      </main>
    </div>
  );
}

/* ================================ PARTS ================================ */

const NAV_BUTTON =
  "flex items-center gap-1.5 rounded-md border border-[#16305e] bg-[#04102b]/60 px-2.5 py-1.5 text-[0.72rem] text-[#a9bbdc] transition hover:border-[#3d8bf5] hover:bg-[#0a1f45] hover:text-[#e6efff]";

/**
 * What Neurodegeneration Tracking has received from the imaging pages, live:
 * scans become visits, FreeSurfer labels become regional volumes, and each
 * recording's EEG measures become biomarkers.
 */
function NeuroPanel({ linked }: { linked: LinkedState }) {
  const plan = planLinked(linked);
  const current = linked.segmentation;
  const vol = (id: number) => current?.classes.find((k) => k.label === id)?.mm3;
  const rows: [string, number, number][] = [
    ["Hippocampus", 17, 53],
    ["Amygdala", 18, 54],
    ["Lateral ventricle", 4, 43],
    ["Inf. lateral ventricle", 5, 44],
  ];
  const kind = linked.mri?.kind;
  return (
    <Panel
      title="Neurodegeneration"
      meta="live link"
      action={
        <Link
          to="/neurodegeneration"
          className="flex items-center gap-1 rounded border border-[#16305e] px-2 py-1 font-mono text-[0.6rem] tracking-[0.1em] text-[#7fd8ff] transition hover:border-[#3d8bf5]"
        >
          OPEN <ArrowUpRight className="h-3 w-3" />
        </Link>
      }
    >
      <dl className="grid grid-cols-3 gap-1.5">
        <Stat k="Visits" v={`${plan.included.length}`} />
        <Stat k="Regions" v={current ? `${current.classes.length}` : "—"} />
        <Stat k="EEG recs" v={`${plan.recordings.length}`} />
      </dl>
      {current ? (
        <table className="mt-3 w-full border-collapse text-[0.72rem]">
          <thead>
            <tr className="text-left font-mono text-[0.54rem] uppercase tracking-[0.12em] text-[#8095bf]">
              <th className="pb-1.5 font-medium">Structure</th>
              <th className="pb-1.5 text-right font-medium">Left</th>
              <th className="pb-1.5 text-right font-medium">Right</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, l, r]) => (
              <tr key={name} className="border-t border-[#0e2247]">
                <td className="py-1.5 text-[#e6efff]">{name}</td>
                {[l, r].map((id) => (
                  <td key={id} className="py-1.5 text-right font-mono tabular-nums text-[#e6efff]">
                    {vol(id) !== undefined ? `${(vol(id)! / 1000).toFixed(2)} mL` : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-[0.66rem] leading-relaxed text-[#8095bf]">
          Load a FreeSurfer label map for this scan to add hippocampal, ventricular and other
          regional volumes.
        </p>
      )}
      <p className="mt-2 text-[0.62rem] leading-relaxed text-[#5e719a]">
        {kind === "template"
          ? "Volumes describe the MNI152 template (FreeSurfer aseg, TemplateFlow) — a population average, not a person. "
          : ""}
        Every scan and recording loaded here is added to the tracking dashboard automatically. No
        cut-off, flag or probability is computed.
      </p>
    </Panel>
  );
}

function Panel({
  title,
  meta,
  children,
  flush,
  action,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  flush?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <section className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#16305e] bg-gradient-to-b from-[#071a3d]/85 to-[#030b20]/90 shadow-[0_22px_48px_-30px_rgba(30,99,196,0.75)] transition-colors hover:border-[#1f4a8a]">
      <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#7fd8ff]/45 to-transparent" />
      <Brackets />
      <header className="flex items-center justify-between gap-3 border-b border-[#16305e] bg-gradient-to-r from-[#0b2150]/70 via-[#061733]/50 to-transparent px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-3 w-[2px] shrink-0 rounded-full bg-[#7fd8ff] shadow-[0_0_6px_#7fd8ff]" />
          <h2 className="truncate text-[0.74rem] font-semibold capitalize tracking-[-0.005em]">
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meta ? (
            <span className="font-mono text-[0.56rem] uppercase tracking-[0.12em] text-[#8095bf]">
              {meta}
            </span>
          ) : null}
          {action}
        </div>
      </header>
      <div className={flush ? "" : "p-3"}>{children}</div>
    </section>
  );
}

function Brackets() {
  const c = "pointer-events-none absolute h-2.5 w-2.5 border-[#7fd8ff]/50";
  return (
    <>
      <span className={`${c} left-0 top-0 rounded-tl-xl border-l border-t`} />
      <span className={`${c} right-0 top-0 rounded-tr-xl border-r border-t`} />
      <span
        className={`${c} bottom-0 left-0 rounded-bl-xl border-b border-l !border-[#7fd8ff]/20`}
      />
      <span
        className={`${c} bottom-0 right-0 rounded-br-xl border-b border-r !border-[#7fd8ff]/20`}
      />
    </>
  );
}

function StatusChip({
  on,
  label,
  detail,
  accent,
}: {
  on: boolean;
  label: string;
  detail: string;
  accent?: boolean;
}) {
  const colour = on ? (accent ? "#7fd8ff" : "#3fa87a") : "#5e719a";
  return (
    <span
      className="flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[0.6rem] tracking-[0.1em]"
      style={{ borderColor: `${colour}55`, color: colour }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: colour, boxShadow: on ? `0 0 6px ${colour}` : "none" }}
      />
      {label} <span className="opacity-70">· {detail}</span>
    </span>
  );
}

function UploadButton({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-md border border-[#1e63c4]/50 bg-[#1e63c4]/10 px-3 py-2.5 text-left transition hover:border-[#7fd8ff] hover:bg-[#1e63c4]/20"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-[#1e63c4]/25 text-[#7fd8ff]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8rem] font-medium">{label}</span>
        <span className="block font-mono text-[0.6rem] text-[#8095bf]">{hint}</span>
      </span>
      <FileUp className="h-3.5 w-3.5 text-[#8095bf] transition group-hover:text-[#7fd8ff]" />
    </button>
  );
}

function Stat({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div
      className={`min-w-0 rounded border border-[#0e2247] bg-[#01071a] px-2 py-1.5 ${wide ? "col-span-2" : ""}`}
    >
      <dt className="truncate font-mono text-[0.54rem] uppercase tracking-[0.12em] text-[#8095bf]">
        {k}
      </dt>
      <dd
        className="mt-0.5 truncate font-mono text-[0.76rem] tabular-nums text-[#e6efff]"
        title={v}
      >
        {v}
      </dd>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md border border-[#16305e] bg-[#01071a] p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded px-2 py-1.5 text-[0.7rem] font-medium transition ${
            value === v
              ? "bg-[#1e63c4] text-white shadow-[0_0_10px_#1e63c455]"
              : "text-[#8095bf] hover:text-[#e6efff]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 flex justify-between font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[#8095bf]">
        {label}
        <span className="tabular-nums text-[#e6efff]">
          {Number.isInteger(step) ? value.toFixed(0) : value.toFixed(2)}
        </span>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#7fd8ff]"
      />
    </label>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[0.7rem] transition ${
        on
          ? "border-[#7fd8ff]/60 bg-[#7fd8ff]/10 text-[#7fd8ff]"
          : "border-[#16305e] text-[#8095bf] hover:text-[#e6efff]"
      }`}
    >
      {label === "Rotate" ? (
        <RotateCcw className="h-3.5 w-3.5" />
      ) : label === "HUD" ? (
        <Sparkles className="h-3.5 w-3.5" />
      ) : (
        <Layers className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}

function AsymmetryBar({
  label,
  icon,
  value,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
}) {
  const ok = Number.isFinite(value);
  // Display range ±0.2 — real asymmetry indices are small, so ±1 would hide everything.
  const pct = ok ? Math.max(-1, Math.min(1, value / 0.2)) * 50 : 0;
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between text-[0.72rem]">
        <span className="flex items-center gap-1.5 text-[#e6efff]">
          <span className="text-[#7fd8ff]">{icon}</span>
          {label}
        </span>
        <span className="font-mono tabular-nums text-[#e6efff]">
          {ok ? (value >= 0 ? "+" : "") + value.toFixed(3) : "—"}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[#0e2247]">
        <span className="absolute left-1/2 top-[-3px] h-[14px] w-px bg-[#8095bf]/60" />
        {ok ? (
          <span
            className="absolute top-0 h-full rounded-full bg-gradient-to-r from-[#1e63c4] to-[#7fd8ff]"
            style={
              pct >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${-pct}%` }
            }
          />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[0.54rem] uppercase tracking-[0.1em] text-[#5e719a]">
        <span>Right</span>
        <span>Left</span>
      </div>
    </div>
  );
}

function ElectrodeCard({
  label,
  spectrum,
  band,
}: {
  label: string;
  spectrum: ChannelSpectrum | null;
  band: string;
}) {
  const pos = findElectrode(label);
  return (
    <div className="pointer-events-none absolute right-4 top-3 w-[13.5rem] rounded-md border border-[#7fd8ff]/40 bg-[#00030b]/85 p-3 backdrop-blur">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[1.05rem] font-semibold text-white">{label}</span>
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[#7fd8ff]">
          {pos?.region} · {pos?.hemisphere}
        </span>
      </div>
      {spectrum ? (
        <div className="mt-2 flex flex-col gap-1">
          {BANDS.map((b) => {
            const v = spectrum.relative[b.name] ?? 0;
            return (
              <div key={b.name} className="flex items-center gap-2">
                <span
                  className={`w-10 font-mono text-[0.58rem] uppercase ${b.name === band ? "text-[#7fd8ff]" : "text-[#8095bf]"}`}
                >
                  {b.name}
                </span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-[#0e2247]">
                  <span
                    className={`block h-full rounded-full ${b.name === band ? "bg-[#7fd8ff]" : "bg-[#1e63c4]"}`}
                    style={{ width: `${Math.max(0, Math.min(100, v * 100))}%` }}
                  />
                </span>
                <span className="w-8 text-right font-mono text-[0.62rem] tabular-nums text-[#e6efff]">
                  {Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : "—"}
                </span>
              </div>
            );
          })}
          <p className="mt-1 font-mono text-[0.6rem] text-[#8095bf]">
            peak{" "}
            {Number.isFinite(spectrum.peakFrequency)
              ? `${spectrum.peakFrequency.toFixed(1)} Hz`
              : "—"}{" "}
            · rms {Number.isFinite(spectrum.rms) ? `${spectrum.rms.toFixed(1)} µV` : "—"}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[0.66rem] text-[#8095bf]">Not present in this recording.</p>
      )}
    </div>
  );
}

function BandLegend({ band }: { band: string }) {
  return (
    <div className="flex items-center gap-2 rounded border border-[#16305e] bg-[#00030b]/70 px-2.5 py-1.5">
      <span className="font-mono text-[0.56rem] uppercase tracking-[0.12em] text-[#8095bf]">
        {band} low
      </span>
      <span className="h-1.5 w-24 rounded-full bg-gradient-to-r from-[#0b2a78] via-[#1e63c4] via-[#7fd8ff] to-white" />
      <span className="font-mono text-[0.56rem] uppercase tracking-[0.12em] text-[#8095bf]">
        high
      </span>
    </div>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

/* ============================ LAYER PARTS ============================ */

function HudLayer({
  on,
  label,
  detail,
  colour,
  warn,
}: {
  on: boolean;
  label: string;
  detail: string;
  colour: string;
  warn?: boolean;
}) {
  return (
    <span className="flex items-center gap-2" style={{ opacity: on ? 1 : 0.38 }}>
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: colour, boxShadow: on ? `0 0 6px ${colour}` : "none" }}
      />
      <span className="text-[#e6efff]">{label}</span>
      <span className={warn ? "text-[#e8c98a]" : "text-[#8095bf]"}>· {detail}</span>
    </span>
  );
}

/** The tractography colour convention, so a viewer never has to guess it. */
function TractLegend() {
  return (
    <div className="flex items-center gap-2.5 rounded border border-[#16305e] bg-[#00030b]/70 px-2.5 py-1.5 font-mono text-[0.56rem] uppercase tracking-[0.1em] text-[#8095bf]">
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-3 rounded-full bg-[#ff5a5a]" /> L–R
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-3 rounded-full bg-[#5aff8c]" /> A–P
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-3 rounded-full bg-[#5a8cff]" /> S–I
      </span>
    </div>
  );
}

function LayerRow({
  on,
  onClick,
  colour,
  label,
  detail,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  colour: string;
  label: string;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? "border-[#16305e] bg-[#061733]" : "border-[#0e2247] bg-transparent"
      } hover:border-[#3d8bf5]`}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full transition"
        style={{
          background: on ? colour : "transparent",
          border: `1.5px solid ${colour}`,
          boxShadow: on ? `0 0 8px ${colour}` : "none",
        }}
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[0.76rem] font-medium ${on ? "text-[#e6efff]" : "text-[#8095bf]"}`}
        >
          {label}
        </span>
        <span className="block font-mono text-[0.58rem] text-[#5e719a]">{detail}</span>
      </span>
      <span
        className={`font-mono text-[0.56rem] tracking-[0.1em] ${on ? "text-[#7fd8ff]" : "text-[#5e719a]"}`}
      >
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}

const SCENES: { id: Scene; label: string; hint: string }[] = [
  { id: "fusion", label: "Fusion", hint: "Every layer in one frame" },
  { id: "fibres", label: "Fibres", hint: "Tractography through MRI slice planes" },
  { id: "tumour", label: "Tumour", hint: "Segmentation as a particle field in a glass brain" },
];

function SceneSwitch({ scene, onChange }: { scene: Scene; onChange: (s: Scene) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Scene"
      className="absolute right-3 top-3 z-10 flex gap-1 rounded-md border border-[#16305e] bg-[#01071a]/80 p-1 backdrop-blur"
    >
      {SCENES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={scene === s.id}
          title={s.hint}
          onClick={() => onChange(s.id)}
          className={`rounded px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] transition ${
            scene === s.id
              ? "bg-[#1e63c4] text-white shadow-[0_0_14px_#1e63c4]"
              : "text-[#8095bf] hover:text-[#e6efff]"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2.5 py-2">
      <span className="grid h-9 w-9 place-items-center rounded-md bg-[#ff4860]/10 text-[#ff8a98]">
        {icon}
      </span>
      <p className="text-[0.82rem] font-medium text-[#e6efff]">{title}</p>
      <p className="text-[0.72rem] leading-relaxed text-[#8095bf]">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-1 rounded-md border border-[#ff4860]/50 px-3 py-1.5 text-[0.72rem] text-[#ff9aa6] transition hover:bg-[#ff4860]/10"
      >
        {action}
      </button>
    </div>
  );
}

function LesionPanel({
  lesion,
  source,
  name,
  warning,
}: {
  lesion: LabelVolume;
  source: "phantom" | "upload";
  name: string;
  warning: string | null;
}) {
  const rows = [...lesion.volumesCm3.entries()].sort((a, b) => a[0] - b[0]);
  const total = rows.reduce((acc, [, v]) => acc + v, 0);
  // Tumour core = necrotic + enhancing, the BraTS "TC" sub-region.
  const core = rows.filter(([l]) => l === 1 || l === 3 || l === 4).reduce((a, [, v]) => a + v, 0);
  return (
    <div>
      <p className="truncate font-mono text-[0.7rem] text-[#ff9aa6]" title={name}>
        {name}
      </p>
      {source !== "upload" ? (
        <p className="mt-1.5 rounded border border-[#ff4860]/35 bg-[#ff4860]/[0.06] px-2.5 py-1.5 text-[0.64rem] leading-relaxed text-[#ffb3bc]">
          Synthetic demonstration of the overlay. Not derived from any scan and not a finding.
        </p>
      ) : null}
      {warning ? (
        <p className="mt-1.5 rounded border border-[#d9a441]/40 bg-[#d9a441]/[0.07] px-2.5 py-1.5 text-[0.64rem] leading-relaxed text-[#e8c98a]">
          {warning}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {rows.map(([label, cm3]) => {
          const cls = BRATS_CLASSES[label];
          const [r, g, b] = cls?.colour ?? [210, 140, 255];
          return (
            <div key={label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-[0.74rem] text-[#e6efff]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: `rgb(${r},${g},${b})` }}
                  />
                  <span className="truncate">{cls?.name ?? `Label ${label}`}</span>
                  <span className="font-mono text-[0.58rem] text-[#5e719a]">
                    {cls?.short ?? label}
                  </span>
                </span>
                <span className="font-mono text-[0.74rem] tabular-nums text-[#e6efff]">
                  {cm3.toFixed(2)} cm³
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#0e2247]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${total ? (cm3 / total) * 100 : 0}%`,
                    background: `rgb(${r},${g},${b})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-1.5">
        <Stat k="Whole tumour" v={`${total.toFixed(2)} cm³`} />
        <Stat k="Tumour core" v={`${core.toFixed(2)} cm³`} />
      </dl>
      <p className="mt-2 text-[0.62rem] leading-relaxed text-[#5e719a]">
        Volumes counted at the segmentation&apos;s native resolution. The reticle marks the largest
        labelled region.
      </p>
    </div>
  );
}

function BiomarkerRow({ marker }: { marker: import("./fusion").Biomarker }) {
  const up = marker.adDirection === "higher";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 border-t border-[#0e2247] py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="text-[0.78rem] font-medium text-[#e6efff]">{marker.name}</p>
        <p className="text-[0.64rem] leading-relaxed text-[#8095bf]">{marker.meaning}</p>
      </div>
      <div className="flex flex-col items-end">
        <span className="font-mono text-[1.02rem] font-semibold tabular-nums text-white">
          {marker.format(marker.value)}
        </span>
        <span className="font-mono text-[0.56rem] text-[#5e719a]">{marker.unit}</span>
      </div>
      <p className="col-span-2 flex items-center gap-1.5 text-[0.62rem] text-[#5e719a]">
        <span
          className="inline-flex h-4 items-center gap-1 rounded border border-[#16305e] px-1.5 font-mono text-[0.56rem] text-[#8095bf]"
          title="Direction the Alzheimer's literature associates with disease"
        >
          AD {up ? "↑" : "↓"}
        </span>
        <span className="min-w-0">{marker.basis}</span>
      </p>
    </div>
  );
}

/**
 * Channel × channel coherence as a heatmap. Hovering a cell selects its row
 * electrode, so the matrix, topomap, 3D arcs and spectrum stay linked.
 */
function CoherenceGrid({
  matrix,
  hovered,
  onHover,
}: {
  matrix: { labels: string[]; values: Float32Array };
  hovered: string | null;
  onHover: (label: string | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = matrix.labels.length;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !n) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pad = 26;
    const cell = 14;
    const S = pad + n * cell;
    canvas.width = S;
    canvas.height = S;
    ctx.clearRect(0, 0, S, S);

    // Off-diagonal range, so the colour scale is not pinned by the diagonal's 1s.
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const v = matrix.values[i * n + j]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    const span = hi - lo || 1;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = i === j ? 1 : (matrix.values[i * n + j]! - lo) / span;
        const t = Math.max(0, Math.min(1, v));
        const r = Math.round(8 + t * (184 - 8));
        const g = Math.round(28 + t * (240 - 28));
        const b = Math.round(90 + t * (255 - 90));
        ctx.fillStyle = i === j ? "#16305e" : `rgb(${r},${g},${b})`;
        ctx.fillRect(pad + j * cell, pad + i * cell, cell - 1, cell - 1);
      }
    }
    // Axis labels, the hovered electrode emphasised on both axes.
    ctx.font = "600 8px ui-monospace, monospace";
    for (let i = 0; i < n; i++) {
      const label = matrix.labels[i]!;
      ctx.fillStyle = label === hovered ? "#ffffff" : "rgba(128,149,191,0.9)";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(label, pad - 3, pad + i * cell + cell / 2);
      ctx.save();
      ctx.translate(pad + i * cell + cell / 2, pad - 3);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "left";
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    if (hovered) {
      const k = matrix.labels.indexOf(hovered);
      if (k >= 0) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        ctx.strokeRect(pad - 0.5, pad + k * cell - 0.5, n * cell, cell);
        ctx.strokeRect(pad + k * cell - 0.5, pad - 0.5, cell, n * cell);
      }
    }
  }, [matrix, hovered, n]);

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = e.currentTarget.width / rect.width;
    const y = (e.clientY - rect.top) * scale;
    const row = Math.floor((y - 26) / 14);
    onHover(row >= 0 && row < n ? matrix.labels[row]! : null);
  };

  if (!n)
    return (
      <p className="text-[0.72rem] text-[#8095bf]">Not enough recording to estimate coherence.</p>
    );
  return (
    <div className="flex justify-center">
      <canvas
        ref={ref}
        onMouseMove={handleMove}
        onMouseLeave={() => onHover(null)}
        className="h-auto w-full max-w-[19rem] cursor-crosshair [image-rendering:pixelated]"
        aria-label="Coherence matrix between electrode pairs"
      />
    </div>
  );
}
