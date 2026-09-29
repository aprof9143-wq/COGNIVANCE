import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  Box,
  Brain,
  FileUp,
  Microscope,
  Layers,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  ScanLine,
  Sparkles,
  Waves,
} from "lucide-react";
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
import { parseNifti, phantomVolume, readNiftiBytes, type NiftiVolume } from "@/lib/nifti";
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
  offerLinked,
  setLinked,
  toLinkedMarkers,
  useLinked,
  type LinkKind,
} from "@/lib/neuro/linked";

/** EEG analysed over at most this many seconds, so a long recording stays responsive. */
const ANALYSIS_WINDOW_S = 300;

type Source = "phantom" | "upload";
/** A volume can also be the bundled population template: real anatomy, no patient. */
type VolumeSource = Source | "template";

const TEMPLATE_URL = "/templates/mni152_template.nii.gz";
const TEMPLATE_NAME = "MNI152 template (ICBM 2009a)";

const sourceLabel = (src: VolumeSource) =>
  src === "upload" ? "subject" : src === "template" ? "template" : "phantom";
const linkKind = (src: VolumeSource): LinkKind =>
  src === "upload" ? "subject" : src === "template" ? "template" : "phantom";

async function fetchTemplate(): Promise<NiftiVolume> {
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`template: HTTP ${res.status}`);
  const file = new File([await res.blob()], "mni152_template.nii.gz");
  return parseNifti(await readNiftiBytes(file), 160);
}

const FREESURFER_NAMES = LABEL_CONVENTIONS[FREESURFER_CONVENTION]!;

export function ResearchConsole() {
  const navigate = useNavigate();

  // -- data -----------------------------------------------------------------
  const [volume, setVolume] = useState<NiftiVolume>(() => phantomVolume(144));
  const [volumeName, setVolumeName] = useState("Synthetic phantom");
  const [volumeSource, setVolumeSource] = useState<VolumeSource>("phantom");

  const [recording, setRecording] = useState<EdfRecording>(() => phantomRecording(30));
  const [recordingName, setRecordingName] = useState("Synthetic 10-20 recording");
  const [recordingSource, setRecordingSource] = useState<Source>("phantom");

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
  const [autoRotate, setAutoRotate] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [clock, setClock] = useState("");

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

  // Open on the population template rather than the phantom sphere: real
  // anatomy, labelled "template", and nothing on it is a finding. If the fetch
  // fails the phantom stays.
  const template = useRef<NiftiVolume | null>(null);
  const sourceRef = useRef<VolumeSource>(volumeSource);
  useEffect(() => {
    sourceRef.current = volumeSource;
  }, [volumeSource]);
  useEffect(() => {
    let alive = true;
    fetchTemplate()
      .then((vol) => {
        template.current = vol;
        // Never replace a scan the user loaded while the template was downloading.
        if (!alive || sourceRef.current !== "phantom") return;
        setVolume(vol);
        setVolumeName(TEMPLATE_NAME);
        setVolumeSource("template");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
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

  // Alzheimer's-literature EEG markers: measurements, never a score.
  const alphaCoherence = useMemo(() => {
    const montage = channels.filter((c) => findElectrode(c.label));
    if (montage.length < 2) return null;
    return coherenceMatrix(
      montage,
      sampleRate,
      BANDS.find((b) => b.name === "alpha")!,
    );
  }, [channels, sampleRate]);
  const markers = useMemo(
    () => alzheimerBiomarkers(spectra, alphaCoherence),
    [spectra, alphaCoherence],
  );

  // -- link to Neurodegeneration Tracking ------------------------------------
  // Descriptive numbers only: no file names, no pixels, no identifiers.
  useEffect(() => {
    offerLinked("mri", {
      origin: "console",
      kind: linkKind(volumeSource),
      label:
        volumeSource === "upload"
          ? "Uploaded NIfTI volume"
          : volumeSource === "template"
            ? TEMPLATE_NAME
            : "Synthetic phantom",
      dims: volume.dims,
      spacingMm: volume.spacing,
      acquisitionMonth: null,
      manufacturer: null,
      model: null,
      fieldStrength: null,
      sequence: null,
      linkedAt: new Date().toISOString(),
    });
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
      markers: toLinkedMarkers(markers),
      linkedAt: new Date().toISOString(),
    });
  }, [markers, recording, recordingSource, mapped.length, sampleRate, analysedSeconds]);

  const linked = useLinked();

  const focus = hovered
    ? (spectra.get(hovered) ?? null)
    : (spectra.get("O1") ?? [...spectra.values()][0] ?? null);

  // -- uploads --------------------------------------------------------------
  const mriInput = useRef<HTMLInputElement>(null);
  const eegInput = useRef<HTMLInputElement>(null);
  const segInput = useRef<HTMLInputElement>(null);

  const loadSegmentation = useCallback(async (file: File) => {
    setError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const bytes = await readNiftiBytes(file);
      const seg = parseNiftiSegmentation(
        bytes,
        "label map",
        FREESURFER_NAMES,
        FREESURFER_CONVENTION,
      );
      const classes = classVolumes(seg).filter((k) => k.voxels > 0 && FREESURFER_NAMES[k.label]);
      if (!classes.length) {
        throw new Error(
          "No FreeSurfer aseg/aparc label IDs found in this label map (e.g. 17/53 hippocampus). Regional volumes need a FreeSurfer-convention segmentation.",
        );
      }
      setLinked({
        segmentation: {
          origin: "console",
          label: "Uploaded FreeSurfer label map",
          convention: FREESURFER_CONVENTION,
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

  const loadMri = useCallback(async (file: File) => {
    setError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      // Yield so the busy state paints before the synchronous parse.
      await new Promise((r) => setTimeout(r, 30));
      const bytes = await readNiftiBytes(file);
      const vol = parseNifti(bytes, 160);
      setVolume(vol);
      setVolumeName(file.name);
      setVolumeSource("upload");
      // A label map belongs to the scan it was made from.
      setLinked({ segmentation: null });
      setAxial(0.5);
      setCoronal(0.5);
      setSagittal(0.5);
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

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      for (const file of Array.from(e.dataTransfer.files)) {
        if (/\.nii(\.gz)?$/i.test(file.name)) void loadMri(file);
        else if (/\.edf$/i.test(file.name)) void loadEeg(file);
        else setError(`${file.name}: drop a .nii / .nii.gz scan or an .edf recording.`);
      }
    },
    [loadMri, loadEeg],
  );

  const resetAll = () => {
    if (template.current) {
      setVolume(template.current);
      setVolumeName(TEMPLATE_NAME);
      setVolumeSource("template");
    } else {
      setVolume(phantomVolume(144));
      setVolumeName("Synthetic phantom");
      setVolumeSource("phantom");
    }
    // An explicit reset replaces the subject's linked data with the demo data.
    setLinked({ mri: null, eeg: null, segmentation: null });
    setRecording(phantomRecording(30));
    setRecordingName("Synthetic 10-20 recording");
    setRecordingSource("phantom");
    setError(null);
  };

  const signOut = () => {
    localStorage.removeItem("cognivance_session");
    navigate({ to: "/" });
  };

  const fused = volumeSource === "upload" && recordingSource === "upload";

  return (
    <div
      className="min-h-screen bg-[#00030b] text-[#e6efff]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* ============================ HEADER ============================ */}
      <header className="z-30 border-b md:sticky md:top-0 border-[#16305e] bg-[#00030b]/92 backdrop-blur-xl">
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
            <StatusChip on label="MRI" detail={sourceLabel(volumeSource)} />
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
              <Microscope className="h-3.5 w-3.5" />
              Neurodegeneration
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
                icon={<Layers className="h-4 w-4" />}
                label="Load label map"
                hint="FreeSurfer aseg · .nii · .nii.gz"
                onClick={() => segInput.current?.click()}
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
              ref={segInput}
              type="file"
              accept=".nii,.gz"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadSegmentation(f);
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

          <Panel title="MRI volume" meta={sourceLabel(volumeSource)}>
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
              <Toggle
                on={showElectrodes}
                onClick={() => setShowElectrodes((v) => !v)}
                label="Electrodes"
              />
              <Toggle on={autoRotate} onClick={() => setAutoRotate((v) => !v)} label="Rotate" />
            </div>
          </Panel>
        </aside>

        {/* ----------------------------- CENTRE ----------------------------- */}
        {/* On narrow screens the 3D view comes first, controls after it. */}
        <section className="order-first flex min-w-0 flex-col gap-3 xl:order-none">
          <Panel
            title="3D volume · EEG fusion"
            meta={`${volume.size.join("³ / ").split(" / ")[0]} texture · ${mapped.length} electrodes`}
            flush
          >
            <div className="relative h-[clamp(24rem,52vh,40rem)] overflow-hidden bg-[radial-gradient(ellipse_at_50%_45%,#0a1f4a_0%,#01071a_55%,#00030b_100%)]">
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
                <span>BAND · {band.toUpperCase()}</span>
              </div>

              {hovered ? (
                <ElectrodeCard
                  label={hovered}
                  spectrum={spectra.get(hovered) ?? null}
                  band={band}
                />
              ) : null}

              <div className="pointer-events-none absolute bottom-3 left-4 right-4 flex flex-wrap items-end justify-between gap-3">
                <p className="max-w-[46ch] font-mono text-[0.6rem] leading-relaxed tracking-[0.06em] text-[#5e719a]">
                  DRAG TO ORBIT · SCROLL TO ZOOM · HOVER AN ELECTRODE · 10-20 POSITIONS PROJECTED
                  ONTO THIS SCALP (APPROXIMATE, NO FIDUCIALS)
                </p>
                <BandLegend band={band} />
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

          <NeuroPanel linked={linked} markers={markers} />

          <p className="rounded-md border border-[#16305e] bg-[#01071a] px-3 py-2.5 text-[0.66rem] leading-relaxed text-[#8095bf]">
            <span className="font-semibold text-[#e6efff]">Research use only.</span> Every figure
            here is computed from the loaded files and is a measurement, not a diagnosis. Diagnostic
            outputs are gated behind the published benchmarks.
          </p>
        </aside>
      </main>
    </div>
  );
}

/* ================================ PARTS ================================ */

const NAV_BUTTON =
  "flex items-center gap-1.5 rounded-md border border-[#16305e] px-2.5 py-1.5 text-[0.72rem] text-[#8095bf] transition hover:border-[#3d8bf5] hover:text-[#e6efff]";

/**
 * What Neurodegeneration Tracking receives from this console, live. The
 * markers are measurements with the direction the literature associates with
 * Alzheimer's — never a threshold, flag or combined score.
 */
function NeuroPanel({
  linked,
  markers,
}: {
  linked: ReturnType<typeof useLinked>;
  markers: ReturnType<typeof alzheimerBiomarkers>;
}) {
  const seg = linked.segmentation;
  const hippo = seg?.classes.filter((k) => k.label === 17 || k.label === 53) ?? [];
  const kindNote = (k: LinkKind | undefined) =>
    k === "template"
      ? "template"
      : k === "phantom"
        ? "synthetic"
        : k === "subject"
          ? "subject"
          : "—";
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
        <Stat k="MRI" v={kindNote(linked.mri?.kind)} />
        <Stat k="Label map" v={seg ? `${seg.classes.length} regions` : "none"} />
        <Stat k="EEG" v={kindNote(linked.eeg?.kind)} />
      </dl>
      {hippo.length ? (
        <p className="mt-2 font-mono text-[0.66rem] text-[#e6efff]">
          Hippocampus{" "}
          {hippo
            .map((k) => `${k.label === 17 ? "L" : "R"} ${(k.mm3 / 1000).toFixed(2)} mL`)
            .join(" · ")}
        </p>
      ) : (
        <p className="mt-2 text-[0.66rem] leading-relaxed text-[#8095bf]">
          Regional volumes appear when a FreeSurfer label map is loaded.
        </p>
      )}
      <table className="mt-2 w-full border-collapse text-[0.72rem]">
        <tbody>
          {markers.map((m) => (
            <tr key={m.id} className="border-t border-[#0e2247]">
              <td className="py-1.5 text-[#e6efff]">{m.name}</td>
              <td className="py-1.5 text-right font-mono tabular-nums text-[#e6efff]">
                {m.format(m.value)}
                {Number.isFinite(m.value) && m.unit.startsWith("%") ? "%" : ""}
                {Number.isFinite(m.value) && m.unit === "Hz" ? " Hz" : ""}
              </td>
              <td
                className="w-8 py-1.5 text-right font-mono text-[0.6rem] text-[#8095bf]"
                title="Direction the Alzheimer's literature associates with disease"
              >
                AD {m.adDirection === "higher" ? "↑" : "↓"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[0.62rem] leading-relaxed text-[#5e719a]">
        EEG measures from the loaded recording, sent with the MRI summary to the tracking dashboard.
        Nonspecific; no cut-off, flag or probability.
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
    <section className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-[#16305e] bg-[#04102b]/70">
      <Brackets />
      <header className="flex items-center justify-between gap-3 border-b border-[#16305e] bg-[#061733]/60 px-3 py-2">
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
      <span className={`${c} left-0 top-0 rounded-tl-lg border-l border-t`} />
      <span className={`${c} right-0 top-0 rounded-tr-lg border-r border-t`} />
      <span
        className={`${c} bottom-0 left-0 rounded-bl-lg border-b border-l !border-[#7fd8ff]/20`}
      />
      <span
        className={`${c} bottom-0 right-0 rounded-br-lg border-b border-r !border-[#7fd8ff]/20`}
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
        <span className="tabular-nums text-[#e6efff]">{value.toFixed(2)}</span>
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
      {label === "Electrodes" ? (
        <Layers className="h-3.5 w-3.5" />
      ) : (
        <Scissors className="h-3.5 w-3.5" />
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
