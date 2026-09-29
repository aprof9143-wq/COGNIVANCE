import { Activity, FileUp, FlaskConical } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EegTraces, SpectrumPlot, Topomap } from "@/components/research/EegPanels";
import {
  alzheimerBiomarkers,
  posteriorDominantRhythm,
  type Biomarker,
} from "@/components/research/fusion";
import { canonicalChannelName, parseEdf, phantomRecording, type EdfRecording } from "@/lib/edf";
import { findElectrode, MONTAGE_1020 } from "@/lib/montage";
import { analyseChannel, BANDS, coherenceMatrix, type ChannelSpectrum } from "@/lib/signal";
import { offerLinked, toLinkedMarkers } from "@/lib/neuro/linked";
import { Panel, Pill } from "./ui";
import { viridis } from "./colormaps";

export type EegDerived = {
  /** Measured per-electrode relative band power, normalised 0–1 across electrodes. */
  values: Map<string, number>;
  /** Inferred connectivity: strongest coherence pairs in the band. */
  pairs: { a: string; b: string; value: number }[];
  band: string;
} | null;

/**
 * EEG workspace. Three kinds of output are kept visibly apart:
 *   measured    — traces, per-channel spectra, band powers at electrodes
 *   interpolated— the scalp map between electrodes (display only)
 *   inferred    — coherence, a statistical estimate of coupling
 */
export function EegSection({ onDerived }: { onDerived: (d: EegDerived) => void }) {
  const [recording, setRecording] = useState<EdfRecording | null>(null);
  const [source, setSource] = useState<"file" | "demo" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [band, setBand] = useState("alpha");
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(60);
  const [hovered, setHovered] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [topK, setTopK] = useState(12);
  const input = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    setError(null);
    try {
      const rec = parseEdf(await file.arrayBuffer());
      setRecording(rec);
      setSource("file");
      setName(file.name);
      setStart(0);
      setLength(Math.min(60, Math.floor(rec.durationSeconds)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the EDF file.");
    }
  };

  const duration = recording?.durationSeconds ?? 0;
  const s0 = Math.min(start, Math.max(0, duration - 4));
  const len = Math.max(4, Math.min(length, duration - s0));

  const analysis = useMemo(() => {
    if (!recording) return null;
    const spectra = new Map<string, ChannelSpectrum>();
    const channels: { label: string; data: Float32Array }[] = [];
    let fs = 256;
    for (const sig of recording.eegSignals) {
      const label = canonicalChannelName(sig.label) || sig.label;
      fs = sig.sampleRate;
      const a = Math.floor(s0 * sig.sampleRate);
      const b = Math.min(sig.data.length, Math.floor((s0 + len) * sig.sampleRate));
      const window = sig.data.subarray(a, b);
      spectra.set(label, analyseChannel(label, window, sig.sampleRate));
      channels.push({ label, data: window });
    }
    return { spectra, channels, fs };
  }, [recording, s0, len]);

  const mapped = useMemo(
    () =>
      analysis ? MONTAGE_1020.filter((e) => analysis.spectra.has(e.label)).map((e) => e.label) : [],
    [analysis],
  );

  const bandPower = useMemo(() => {
    const raw = new Map<string, number>();
    if (!analysis) return { raw, scaled: new Map<string, number>(), lo: 0, hi: 0 };
    for (const l of mapped) {
      const v = analysis.spectra.get(l)?.relative[band];
      if (v !== undefined && Number.isFinite(v)) raw.set(l, v);
    }
    const vals = [...raw.values()];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const scaled = new Map([...raw].map(([k, v]) => [k, hi > lo ? (v - lo) / (hi - lo) : 0.5]));
    return { raw, scaled, lo, hi };
  }, [analysis, mapped, band]);

  const coherence = useMemo(() => {
    if (!analysis) return null;
    const montage = analysis.channels.filter((c) => findElectrode(c.label));
    return coherenceMatrix(montage, analysis.fs, BANDS.find((b) => b.name === band) ?? BANDS[2]!);
  }, [analysis, band]);

  const alpha = useMemo(() => {
    if (!analysis) return null;
    const montage = analysis.channels.filter((c) => findElectrode(c.label));
    return coherenceMatrix(
      montage,
      analysis.fs,
      BANDS.find((b) => b.name === "alpha")!,
    );
  }, [analysis]);

  const pairs = useMemo(() => {
    if (!coherence) return [];
    const n = coherence.labels.length;
    const floor = 1 / Math.max(1, coherence.segments);
    const out: { a: string; b: string; value: number }[] = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const v = coherence.values[i * n + j]!;
        if (v > 3 * floor) out.push({ a: coherence.labels[i]!, b: coherence.labels[j]!, value: v });
      }
    return out.sort((x, y) => y.value - x.value).slice(0, topK);
  }, [coherence, topK]);

  const markers = useMemo<Biomarker[]>(
    () => (analysis ? alzheimerBiomarkers(analysis.spectra, alpha) : []),
    [analysis, alpha],
  );
  const pdr = useMemo(
    () => (analysis ? posteriorDominantRhythm(analysis.spectra) : Number.NaN),
    [analysis],
  );

  useEffect(() => {
    onDerived(
      recording && bandPower.scaled.size ? { values: bandPower.scaled, pairs, band } : null,
    );
  }, [recording, bandPower, pairs, band, onDerived]);

  // Link the measures to Neurodegeneration Tracking (numbers only, no file name).
  useEffect(() => {
    if (!recording || !analysis) return;
    offerLinked("eeg", {
      origin: "viewer",
      kind: source === "file" ? "subject" : "phantom",
      label: source === "file" ? "Uploaded EDF recording" : "Synthetic demonstration recording",
      channels: recording.eegSignals.length,
      mapped: mapped.length,
      sampleRate: analysis.fs,
      analysedSeconds: len,
      markers: toLinkedMarkers(markers),
      linkedAt: new Date().toISOString(),
    });
  }, [recording, analysis, source, mapped.length, len, markers]);

  const focus = analysis
    ? ((hovered
        ? analysis.spectra.get(hovered)
        : (analysis.spectra.get("O1") ?? [...analysis.spectra.values()][0])) ?? null)
    : null;

  return (
    <section aria-label="EEG" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[15px] font-semibold text-[#e6efff]">EEG</h2>
        <button type="button" onClick={() => input.current?.click()} className="btn">
          <FileUp className="h-4 w-4" /> Load EDF
        </button>
        <button
          type="button"
          onClick={() => {
            setRecording(phantomRecording(60));
            setSource("demo");
            setName("Synthetic demonstration recording");
            setStart(0);
            setLength(60);
          }}
          className="btn"
        >
          <FlaskConical className="h-4 w-4" /> Synthetic demo
        </button>
        <input
          ref={input}
          type="file"
          accept=".edf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = "";
          }}
        />
        {recording ? (
          <span className="text-[13px] text-[#a9bbdc]">
            {name} · {recording.eegSignals.length} channels · {mapped.length} on the 10-20 layout ·{" "}
            {duration.toFixed(0)} s
          </span>
        ) : null}
        {source === "demo" ? <Pill tone="warn">SYNTHETIC — generated, not recorded</Pill> : null}
        {error ? <Pill tone="error">{error}</Pill> : null}
      </div>

      {!recording || !analysis ? (
        <p className="rounded-md border border-[#16305e] bg-[#020a1f] px-4 py-6 text-center text-[13px] text-[#a9bbdc]">
          No EEG loaded. Load an EDF/EDF+ recording. Electrodes appear in the 3D view only if
          registered coordinates (BIDS electrodes.tsv) are also loaded.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4 rounded-md border border-[#16305e] bg-[#020a1f] px-3 py-2">
            <label className="flex flex-col gap-1 text-[12px] text-[#a9bbdc]">
              Band
              <select value={band} onChange={(e) => setBand(e.target.value)} className="field">
                {BANDS.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name} {b.lo}–{b.hi} Hz
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-[#a9bbdc]">
              Analysis window start (s)
              <input
                type="number"
                min={0}
                max={Math.max(0, duration - 4)}
                value={s0}
                onChange={(e) => setStart(Number(e.target.value) || 0)}
                className="field w-28"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-[#a9bbdc]">
              Length (s)
              <input
                type="number"
                min={4}
                max={Math.floor(duration)}
                value={len}
                onChange={(e) => setLength(Number(e.target.value) || 4)}
                className="field w-24"
              />
            </label>
            <span className="text-[12px] text-[#8095bf]">
              Welch PSD, 2 s Hann segments, 50 % overlap, over {s0.toFixed(0)}–
              {(s0 + len).toFixed(0)} s
            </span>
            <button type="button" onClick={() => setPlaying((p) => !p)} className="btn ml-auto">
              <Activity className="h-4 w-4" /> {playing ? "Pause traces" : "Play traces"}
            </button>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Panel title="Traces" tag="measured" note={`${analysis.fs} Hz · analysis window`}>
              <div className="h-[18rem]">
                <EegTraces
                  channels={analysis.channels}
                  sampleRate={analysis.fs}
                  hovered={hovered}
                  playing={playing}
                />
              </div>
            </Panel>
            <Panel title={`Scalp map · ${band}`} tag="interpolated" note="relative power">
              <Topomap
                values={bandPower.scaled}
                hovered={hovered}
                onHover={setHovered}
                colormap="viridis"
              />
              <div className="mt-2">
                <div
                  className="h-2 rounded"
                  style={{
                    background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1]
                      .map((t) => {
                        const [r, g, b] = viridis(t);
                        return `rgb(${r * 255},${g * 255},${b * 255})`;
                      })
                      .join(",")})`,
                  }}
                />
                <div className="mt-1 flex justify-between text-[11px] text-[#8095bf]">
                  <span>{(bandPower.lo * 100).toFixed(1)} %</span>
                  <span>{(bandPower.hi * 100).toFixed(1)} %</span>
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-snug text-[#8095bf]">
                Dots are measured electrodes; colour between them is inverse-distance interpolation
                on a schematic 10-20 layout, for display only.
              </p>
            </Panel>
            <Panel
              title={`Spectrum · ${focus?.label ?? "—"}`}
              tag="measured"
              note={`PDR ${Number.isFinite(pdr) ? pdr.toFixed(1) : "—"} Hz`}
            >
              <div className="h-[11rem]">
                <SpectrumPlot spectrum={focus} />
              </div>
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel
              title={`Coherence · ${band}`}
              tag="inferred"
              note={`${coherence?.segments ?? 0} segments`}
            >
              <CoherenceTable
                labels={coherence?.labels ?? []}
                pairs={pairs}
                topK={topK}
                setTopK={setTopK}
              />
              <p className="mt-2 text-[12px] leading-snug text-[#8095bf]">
                Magnitude-squared coherence, a statistical estimate of coupling, not a measured
                connection. Scalp EEG against a common reference inflates coherence between
                neighbours (volume conduction).
              </p>
            </Panel>
            <Panel title="EEG spectral measures" tag="measured" note="no verdict">
              <div className="flex flex-col">
                {markers.map((m) => (
                  <div
                    key={m.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-[#0e2247] py-2 first:border-t-0"
                  >
                    <div>
                      <p className="text-[13px] text-[#e6efff]">{m.name}</p>
                      <p className="text-[12px] text-[#8095bf]">{m.meaning}</p>
                      <p className="text-[12px] text-[#8095bf]">
                        Literature direction in Alzheimer's:{" "}
                        {m.adDirection === "higher" ? "higher" : "lower"}. {m.basis}
                      </p>
                    </div>
                    <p className="text-right font-mono text-[15px] text-white">
                      {m.format(m.value)}
                      <span className="block text-[11px] text-[#8095bf]">{m.unit}</span>
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-2 rounded border border-[#3a3320] bg-[#1a160c] px-3 py-2 text-[12px] leading-snug text-[#e6d7a8]">
                Finding is nonspecific. Drowsiness, medication, metabolic or toxic encephalopathy,
                vascular disease, other neurodegenerative disease and recording artefact also slow
                the EEG. No reference range or score is applied. Clinical correlation required.
              </p>
            </Panel>
          </div>
        </>
      )}
    </section>
  );
}

function CoherenceTable({
  labels,
  pairs,
  topK,
  setTopK,
}: {
  labels: string[];
  pairs: { a: string; b: string; value: number }[];
  topK: number;
  setTopK: (n: number) => void;
}) {
  if (!labels.length)
    return (
      <p className="text-[13px] text-[#a9bbdc]">Not enough 10-20 channels to estimate coherence.</p>
    );
  return (
    <div>
      <label className="mb-2 flex items-center gap-2 text-[12px] text-[#a9bbdc]">
        Strongest pairs
        <input
          type="range"
          min={4}
          max={40}
          value={topK}
          onChange={(e) => setTopK(Number(e.target.value))}
        />
        <span className="font-mono">{topK}</span>
      </label>
      <table className="w-full text-[12px]">
        <thead className="text-left text-[#8095bf]">
          <tr>
            <th className="font-normal">Pair</th>
            <th className="font-normal">Coherence</th>
            <th className="w-1/2 font-normal" />
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => {
            const [r, g, b] = viridis(p.value);
            return (
              <tr key={`${p.a}-${p.b}`} className="border-t border-[#0e2247]">
                <td className="py-1 font-mono text-[#e6efff]">
                  {p.a}–{p.b}
                </td>
                <td className="font-mono text-[#e6efff]">{p.value.toFixed(2)}</td>
                <td>
                  <div
                    className="h-2 rounded"
                    style={{
                      width: `${p.value * 100}%`,
                      background: `rgb(${r * 255},${g * 255},${b * 255})`,
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
