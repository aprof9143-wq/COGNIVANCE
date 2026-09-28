import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Cable,
  Cpu,
  Pause,
  Play,
  RadioTower,
  Unplug,
  Waves,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MONTAGE_1020 } from "@/lib/montage";
import {
  NO_FAULTS,
  PLANTED,
  PROFILES,
  SimStream,
  type Faults,
  type SourceKind,
} from "@/lib/nimbleSim";
import { analyseChannel, BANDS, type ChannelSpectrum } from "@/lib/signal";
import { CoreView } from "./CoreView";

/**
 * NIMBLE hardware simulation platform.
 *
 * A live, in-browser twin of the acquisition layer. It exists to show the one
 * architectural claim the platform rests on — every signal origin sits behind
 * the same contract — and to exercise it: switch the source, inject a fault,
 * and watch health and signal respond while the analysis reading from it is
 * unchanged. Labelled SIMULATION everywhere, because it is one.
 */

const ICONS: Record<SourceKind, typeof Cpu> = { simulated: Waves, mcu: Cpu, implant: RadioTower };

export function NimbleSimulator() {
  const [kind, setKind] = useState<SourceKind>("simulated");
  const [faults, setFaults] = useState<Faults>(NO_FAULTS);
  const [selected, setSelected] = useState(MONTAGE_1020.findIndex((e) => e.label === "O1"));
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);

  const stream = useRef<SimStream | null>(null);
  const faultsRef = useRef<Faults>(faults);
  faultsRef.current = faults;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const runningRef = useRef(running);
  runningRef.current = running;

  // A new source is a new connection: fresh stream, fresh counters.
  useEffect(() => {
    stream.current = new SimStream(PROFILES[kind]);
  }, [kind]);

  // Acquisition clock, independent of rendering. Advances the stream in real
  // time and nudges React ~6×/s for the numeric read-outs.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let sinceUi = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (runningRef.current) stream.current?.advance(dt, faultsRef.current);
      sinceUi += dt;
      if (sinceUi > 0.16) {
        sinceUi = 0;
        setTick((n) => n + 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const s = stream.current;
  const profile = PROFILES[kind];
  const health = s?.health();
  const lossPct = s && s.packets ? (100 * s.lostPackets) / s.packets : 0;

  // Spectrum of the selected channel, recomputed at the read-out rate.
  const spectrum = useMemo<ChannelSpectrum | null>(() => {
    if (!s || !profile.available || s.written < profile.sampleRate * 2) return null;
    return analyseChannel(s.labels[selected]!, s.recent(selected, 4), profile.sampleRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, selected, kind]);

  const plantedHere = PLANTED.filter(
    (p) =>
      p.where === null || (p.where as readonly string[]).includes(MONTAGE_1020[selected]!.label),
  ).sort((a, b) => b.amp - a.amp)[0];

  const toggle = (k: keyof Faults) =>
    setFaults((f) =>
      k === "liftedChannel"
        ? { ...f, liftedChannel: f.liftedChannel >= 0 ? -1 : selected }
        : { ...f, [k]: !f[k] },
    );

  return (
    <div className="flex min-h-screen flex-col bg-[#00030b] text-[#e6efff]">
      {/* ------------------------------------------------------------ top bar */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[#16305e] bg-[#01071a]/90 px-4 py-2.5 backdrop-blur">
        <Link
          to="/"
          className="flex items-center gap-2 text-[#8095bf] transition hover:text-[#e6efff]"
        >
          <ArrowLeft className="h-4 w-4" />
          <img src="/logo-mark.png" alt="" className="h-7 w-7" />
        </Link>
        <div className="leading-tight">
          <p className="font-mono text-[0.62rem] tracking-[0.28em] text-[#7fd8ff]">
            NIMBLE / HARDWARE SIMULATION
          </p>
          <p className="text-[0.8rem] text-[#8095bf]">
            One acquisition contract, every signal origin
          </p>
        </div>
        <span className="rounded border border-[#ffb547]/60 bg-[#ffb547]/10 px-2.5 py-1 font-mono text-[0.62rem] tracking-[0.2em] text-[#ffcf7a] shadow-[0_0_18px_rgba(255,181,71,0.25)]">
          SIMULATION · NO HARDWARE CONNECTED
        </span>
        <div className="ml-auto flex items-center gap-3 font-mono text-[0.66rem] text-[#8095bf]">
          <span>
            T+{s ? s.clock.toFixed(1) : "0.0"} s · {s?.written.toLocaleString() ?? 0} samples/ch
          </span>
          <button
            type="button"
            onClick={() => setRunning((r) => !r)}
            className="flex items-center gap-1.5 rounded-md border border-[#16305e] px-2.5 py-1 text-[#7fd8ff] transition hover:bg-[#7fd8ff]/10"
          >
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "PAUSE" : "RUN"}
          </button>
        </div>
      </header>

      <main className="grid flex-1 gap-3 p-3 xl:grid-cols-[19rem_minmax(0,1fr)_21rem]">
        {/* ------------------------------------------------------------- left */}
        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Signal source" meta="NeuralDataSource">
            <div className="flex flex-col gap-2">
              {(Object.keys(PROFILES) as SourceKind[]).map((k) => {
                const p = PROFILES[k];
                const Icon = ICONS[k];
                const on = k === kind;
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={!p.available}
                    onClick={() => {
                      setKind(k);
                      setFaults(NO_FAULTS);
                    }}
                    className={`group flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition ${
                      on
                        ? "border-[#7fd8ff]/70 bg-[#7fd8ff]/10 shadow-[0_0_22px_rgba(127,216,255,0.15)]"
                        : p.available
                          ? "border-[#16305e] hover:border-[#2a5aa8]"
                          : "cursor-not-allowed border-dashed border-[#16305e] opacity-60"
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md ${on ? "bg-[#7fd8ff]/20 text-[#7fd8ff]" : "bg-[#0a1f4a] text-[#8095bf]"}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[0.8rem] text-[#e6efff]">
                        {p.name}
                        {!p.available ? (
                          <span className="rounded bg-[#16305e] px-1.5 py-0.5 font-mono text-[0.55rem] tracking-[0.12em] text-[#8095bf]">
                            DESIGN TARGET
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block font-mono text-[0.6rem] text-[#5e719a]">
                        {p.impl} · {p.sampleRate} Hz · {p.adcBits}-bit
                      </span>
                      <span className="mt-1 block text-[0.66rem] leading-snug text-[#8095bf]">
                        {p.detail}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[0.66rem] leading-relaxed text-[#5e719a]">
              Switching source changes only what sits behind the contract. The analysis on the right
              reads the same <code className="text-[#7fd8ff]">read_chunk()</code> either way.
            </p>
          </Panel>

          <Panel title="Channels" meta={`${MONTAGE_1020.length} · 10-20 · impedance`}>
            <div className="grid grid-cols-[2.2rem_minmax(0,1fr)_3.4rem_3rem] items-center gap-x-2 gap-y-1 font-mono text-[0.62rem]">
              {MONTAGE_1020.map((e, c) => {
                const z = s && profile.available ? s.impedance(c, faults) : 0;
                const rms = s && profile.available ? s.rms(c, 0.5) : 0;
                const bad = z > 50;
                const pick = c === selected;
                return (
                  <button
                    key={e.label}
                    type="button"
                    onClick={() => setSelected(c)}
                    className={`col-span-4 grid grid-cols-subgrid items-center rounded px-1 py-0.5 text-left transition ${pick ? "bg-[#7fd8ff]/10" : "hover:bg-[#0a1f4a]"}`}
                  >
                    <span className={pick ? "text-white" : "text-[#8095bf]"}>{e.label}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-[#0a1f4a]">
                      <span
                        className="block h-full rounded-full transition-[width] duration-300"
                        style={{
                          width: `${Math.min(100, (z / 25) * 100)}%`,
                          background: bad ? "#ff4860" : z > 10 ? "#ffcf7a" : "#4ade80",
                          boxShadow: bad ? "0 0 8px #ff4860" : "none",
                        }}
                      />
                    </span>
                    <span className={`text-right ${bad ? "text-[#ff8a98]" : "text-[#c8d6f0]"}`}>
                      {profile.available ? `${z.toFixed(z > 100 ? 0 : 1)}k` : "—"}
                    </span>
                    <span className="text-right text-[#5e719a]">
                      {profile.available ? `${rms.toFixed(0)}µV` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>
        </aside>

        {/* ----------------------------------------------------------- centre */}
        <section className="flex min-w-0 flex-col gap-3">
          <div className="relative h-[clamp(24rem,52vh,38rem)] overflow-hidden rounded-lg border border-[#16305e] bg-[radial-gradient(ellipse_at_50%_48%,#0a2a66_0%,#03102e_45%,#00030b_100%)]">
            <CoreView stream={stream} faults={faultsRef} selected={selectedRef} />
            <div className="pointer-events-none absolute left-4 top-3 font-mono text-[0.62rem] tracking-[0.12em] text-[#8095bf]">
              <p className="text-[#7fd8ff]">ACQUISITION CORE · {profile.impl.toUpperCase()}</p>
              <p>PACKETS → HAL BUS → PIPELINE</p>
              <p className="mt-1">
                {s?.packets.toLocaleString() ?? 0} packets · {s?.lostPackets ?? 0} lost
              </p>
            </div>
            <div className="pointer-events-none absolute right-4 top-3 text-right font-mono text-[0.62rem] tracking-[0.12em] text-[#8095bf]">
              <p>CAPABILITIES</p>
              <p className="text-[#7fd8ff]">{`{${profile.capabilities.join(", ")}}`}</p>
            </div>
            {!profile.available ? (
              <div className="absolute inset-0 grid place-items-center bg-[#00030b]/70 backdrop-blur-sm">
                <div className="max-w-sm text-center">
                  <Unplug className="mx-auto h-6 w-6 text-[#8095bf]" />
                  <p className="mt-3 font-mono text-[0.72rem] tracking-[0.16em] text-[#e6efff]">
                    IMPLANTSOURCE · NOT BUILT
                  </p>
                  <p className="mt-2 text-[0.75rem] leading-relaxed text-[#8095bf]">
                    The implant is a design target. It will implement the same contract; until it
                    exists there is nothing honest to simulate for it, so nothing is.
                  </p>
                </div>
              </div>
            ) : null}
            <div className="pointer-events-none absolute bottom-3 left-4 flex gap-4 font-mono text-[0.58rem] tracking-[0.14em] text-[#5e719a]">
              <Legend colour="#7fd8ff" label="PACKET DELIVERED" />
              <Legend colour="#ff4860" label="PACKET LOST" />
              <Legend colour="#ffffff" label="SELECTED CHANNEL" />
            </div>
          </div>

          <Panel
            title="Live stream"
            meta={`${profile.sampleRate} Hz · 5 s · gaps are lost packets`}
            flush
          >
            <Traces stream={stream} faults={faultsRef} selected={selectedRef} />
          </Panel>
        </section>

        {/* ------------------------------------------------------------ right */}
        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Link health" meta="SourceHealth">
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Latency · median"
                value={profile.available ? `${(health?.latencyMs ?? 0).toFixed(1)} ms` : "—"}
              />
              <Stat
                label="Packet loss"
                value={profile.available ? `${lossPct.toFixed(2)} %` : "—"}
                warn={lossPct > 1}
              />
              <Stat
                label="Dropped samples"
                value={profile.available ? (health?.dropped ?? 0).toLocaleString() : "—"}
                warn={(health?.dropped ?? 0) > 0}
              />
              <Stat
                label="Throughput"
                value={
                  profile.available
                    ? `${((profile.sampleRate * MONTAGE_1020.length) / 1000).toFixed(2)} kS/s`
                    : "—"
                }
              />
            </div>
            <LatencyHistogram stream={stream} tick={tick} />
            <div className="mt-2 flex items-center justify-between font-mono text-[0.6rem] text-[#5e719a]">
              <span>BUFFER FILL</span>
              <span className="text-[#c8d6f0]">
                {profile.available ? `${Math.round((health?.bufferFill ?? 0) * 100)} %` : "—"}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#0a1f4a]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#1e63c4] to-[#7fd8ff] transition-[width] duration-300"
                style={{ width: `${(profile.available ? (health?.bufferFill ?? 0) : 0) * 100}%` }}
              />
            </div>
          </Panel>

          <Panel title="Self-test" meta={`${MONTAGE_1020[selected]!.label} · planted vs measured`}>
            <SpectrumPlot spectrum={spectrum} />
            {spectrum && plantedHere ? (
              <div className="mt-2 flex items-center justify-between rounded-md border border-[#16305e] bg-[#01071a] px-3 py-2 font-mono text-[0.66rem]">
                <span className="text-[#8095bf]">
                  PLANTED {plantedHere.freq.toFixed(2)} Hz · MEASURED{" "}
                  <span className="text-white">{spectrum.peakFrequency.toFixed(2)} Hz</span>
                </span>
                {Math.abs(spectrum.peakFrequency - plantedHere.freq) <= 0.5 ? (
                  <span className="text-[#4ade80]">PASS</span>
                ) : (
                  <span className="text-[#ff8a98]">DIVERGED</span>
                )}
              </div>
            ) : null}
            <div className="mt-3 flex flex-col gap-1.5">
              {BANDS.map((b) => {
                const v = spectrum?.relative[b.name] ?? 0;
                return (
                  <div
                    key={b.name}
                    className="grid grid-cols-[3.2rem_minmax(0,1fr)_2.6rem] items-center gap-2 font-mono text-[0.6rem]"
                  >
                    <span className="uppercase text-[#8095bf]">{b.name}</span>
                    <span className="h-2 overflow-hidden rounded-sm bg-[#0a1f4a]">
                      <span
                        className="block h-full bg-gradient-to-r from-[#1e63c4] via-[#63b0ff] to-[#b8f0ff] transition-[width] duration-300"
                        style={{ width: `${v * 100}%` }}
                      />
                    </span>
                    <span className="text-right text-[#c8d6f0]">{(v * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[0.64rem] leading-relaxed text-[#5e719a]">
              Rhythms are planted at known frequencies; recovering them is how feature code is
              proved correct before it ever meets a patient recording.
            </p>
          </Panel>

          <Panel title="Fault injection" meta="what hardware does">
            <div className="grid grid-cols-2 gap-2">
              <FaultButton
                on={faults.packetLoss}
                onClick={() => toggle("packetLoss")}
                icon={<Cable className="h-3.5 w-3.5" />}
                label="Packet loss"
                detail="+6 % link drops"
                disabled={!profile.available}
              />
              <FaultButton
                on={faults.lineNoise}
                onClick={() => toggle("lineNoise")}
                icon={<Zap className="h-3.5 w-3.5" />}
                label="Mains noise"
                detail="50 Hz, 18 µV"
                disabled={!profile.available}
              />
              <FaultButton
                on={faults.liftedChannel >= 0}
                onClick={() => toggle("liftedChannel")}
                icon={<Unplug className="h-3.5 w-3.5" />}
                label="Electrode lift"
                detail={
                  faults.liftedChannel >= 0
                    ? MONTAGE_1020[faults.liftedChannel]!.label
                    : `on ${MONTAGE_1020[selected]!.label}`
                }
                disabled={!profile.available}
              />
              <FaultButton
                on={faults.motion}
                onClick={() => toggle("motion")}
                icon={<Activity className="h-3.5 w-3.5" />}
                label="Motion"
                detail="burst artefact"
                disabled={!profile.available}
              />
            </div>
          </Panel>
        </aside>
      </main>

      {/* ---------------------------------------------------------- status bar */}
      <footer className="grid gap-3 border-t border-[#16305e] bg-[#01071a] px-4 py-2.5 lg:grid-cols-[15rem_minmax(0,1fr)_auto]">
        <div className="font-mono text-[0.6rem] leading-relaxed tracking-[0.12em] text-[#5e719a]">
          <p className="text-[#7fd8ff]">HAL CONTRACT</p>
          <p>connect · read_chunk · health</p>
          <p>core/cognivance_core/abstraction</p>
        </div>
        <ContractLog stream={stream} tick={tick} />
        <div className="self-center font-mono text-[0.6rem] tracking-[0.12em] text-[#ffcf7a]">
          ALL VALUES SIMULATED IN THIS BROWSER
        </div>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Panel({
  title,
  meta,
  children,
  flush,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-[#16305e] bg-[#04102b]/70">
      <header className="flex items-center justify-between gap-3 border-b border-[#16305e] px-3 py-2">
        <h2 className="flex items-center gap-2 text-[0.78rem] font-semibold text-[#e6efff]">
          <span className="h-3 w-0.5 rounded bg-[#7fd8ff] shadow-[0_0_8px_#7fd8ff]" />
          {title}
        </h2>
        {meta ? (
          <span className="truncate font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[#5e719a]">
            {meta}
          </span>
        ) : null}
      </header>
      <div className={flush ? "" : "p-3"}>{children}</div>
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-[#16305e] bg-[#01071a] px-2.5 py-2">
      <p className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-[#5e719a]">{label}</p>
      <p className={`mt-0.5 font-mono text-[0.9rem] ${warn ? "text-[#ff8a98]" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: colour, boxShadow: `0 0 6px ${colour}` }}
      />
      {label}
    </span>
  );
}

function FaultButton({
  on,
  onClick,
  icon,
  label,
  detail,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
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
      className={`flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition disabled:opacity-40 ${
        on
          ? "border-[#ff4860]/70 bg-[#ff4860]/10 text-[#ff9aa6]"
          : "border-[#16305e] text-[#c8d6f0] hover:border-[#2a5aa8]"
      }`}
    >
      <span className="flex items-center gap-1.5 text-[0.72rem]">
        {icon}
        {label}
      </span>
      <span className="font-mono text-[0.58rem] text-[#5e719a]">{detail}</span>
    </button>
  );
}

function ContractLog({
  stream,
  tick,
}: {
  stream: React.RefObject<SimStream | null>;
  tick: number;
}) {
  const lines = stream.current?.log.slice(-4) ?? [];
  return (
    <div className="min-w-0 font-mono text-[0.62rem] leading-relaxed" data-tick={tick}>
      {lines.map((l, i) => (
        <p
          key={`${l.t}-${i}`}
          className={`truncate ${l.tone === "warn" ? "text-[#ff8a98]" : l.tone === "ok" ? "text-[#4ade80]" : "text-[#8095bf]"}`}
        >
          <span className="text-[#34507f]">[{l.t.toFixed(1).padStart(6, " ")}s]</span> {l.text}
        </p>
      ))}
    </div>
  );
}

/** Canvas helper: sized to its box at device resolution. */
function useCanvas(
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  animate: boolean,
  deps: unknown[],
) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let raf = 0;
    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext("2d");
      if (g) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        drawRef.current(g, w, h);
      }
      if (animate) raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function Traces({
  stream,
  faults,
  selected,
}: {
  stream: React.RefObject<SimStream | null>;
  faults: React.RefObject<Faults>;
  selected: React.RefObject<number>;
}) {
  const ref = useCanvas(
    (g, w, h) => {
      const s = stream.current;
      if (!s || !s.profile.available) return;
      const n = s.labels.length;
      const row = h / n;
      const span = Math.min(s.capacity, Math.round(5 * s.profile.sampleRate));
      const left = 34;
      const plotW = w - left - 8;
      g.font = "9px ui-monospace, monospace";
      for (let c = 0; c < n; c++) {
        const y0 = row * (c + 0.5);
        const lifted = faults.current.liftedChannel === c;
        const pick = selected.current === c;
        g.fillStyle = lifted ? "#ff8a98" : pick ? "#ffffff" : "#5e719a";
        g.fillText(s.labels[c]!, 6, y0 + 3);
        g.strokeStyle = lifted
          ? "rgba(255,72,96,0.9)"
          : pick
            ? "rgba(255,255,255,0.95)"
            : "rgba(127,216,255,0.55)";
        g.lineWidth = pick ? 1.2 : 0.8;
        g.beginPath();
        const buf = s.buffers[c]!;
        let pen = false;
        const step = Math.max(1, Math.floor(span / plotW));
        for (let i = 0; i < span; i += step) {
          const v = buf[(s.head - span + i + s.capacity) % s.capacity]!;
          const x = left + (i / span) * plotW;
          if (Number.isNaN(v)) {
            pen = false;
            continue;
          }
          const y = y0 - Math.max(-row * 0.9, Math.min(row * 0.9, (v / 60) * row * 0.5));
          if (pen) g.lineTo(x, y);
          else g.moveTo(x, y);
          pen = true;
        }
        g.stroke();
      }
    },
    true,
    [],
  );
  return <canvas ref={ref} className="block h-[19rem] w-full" />;
}

function LatencyHistogram({
  stream,
  tick,
}: {
  stream: React.RefObject<SimStream | null>;
  tick: number;
}) {
  const ref = useCanvas(
    (g, w, h) => {
      const s = stream.current;
      if (!s || !s.latencies.length) return;
      const lat = s.latencies;
      const max = Math.max(1, ...lat) * 1.1;
      const bins = 28;
      const counts = new Array<number>(bins).fill(0);
      for (const v of lat) counts[Math.min(bins - 1, Math.floor((v / max) * bins))]!++;
      const top = Math.max(...counts) || 1;
      const bw = w / bins;
      for (let i = 0; i < bins; i++) {
        const bh = (counts[i]! / top) * (h - 14);
        const grad = g.createLinearGradient(0, h - 12 - bh, 0, h - 12);
        grad.addColorStop(0, "#b8f0ff");
        grad.addColorStop(1, "#1e63c4");
        g.fillStyle = grad;
        g.fillRect(i * bw + 1, h - 12 - bh, bw - 2, bh);
      }
      g.fillStyle = "#5e719a";
      g.font = "9px ui-monospace, monospace";
      g.fillText("0", 0, h - 2);
      const label = `${max.toFixed(max < 5 ? 2 : 0)} ms`;
      g.fillText(label, w - g.measureText(label).width, h - 2);
    },
    false,
    [tick],
  );
  return <canvas ref={ref} className="mt-3 block h-20 w-full" />;
}

function SpectrumPlot({ spectrum }: { spectrum: ChannelSpectrum | null }) {
  const ref = useCanvas(
    (g, w, h) => {
      if (!spectrum) {
        g.fillStyle = "#5e719a";
        g.font = "10px ui-monospace, monospace";
        g.fillText("Collecting 2 s of signal…", 8, h / 2);
        return;
      }
      const { freqs, psd } = spectrum;
      const fMax = 60;
      let hi = 0;
      for (let i = 0; i < freqs.length; i++)
        if (freqs[i]! <= fMax && freqs[i]! >= 1) hi = Math.max(hi, psd[i]!);
      const logMax = Math.log10(hi || 1);
      const logMin = logMax - 3.2;
      const x = (f: number) => (f / fMax) * w;
      const y = (p: number) =>
        h - 12 - ((Math.log10(Math.max(p, 1e-9)) - logMin) / (logMax - logMin)) * (h - 18);
      for (const p of PLANTED) {
        g.strokeStyle = "rgba(255,207,122,0.35)";
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(x(p.freq), 4);
        g.lineTo(x(p.freq), h - 12);
        g.stroke();
      }
      g.setLineDash([]);
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(127,216,255,0.45)");
      grad.addColorStop(1, "rgba(30,99,196,0)");
      g.beginPath();
      g.moveTo(0, h - 12);
      for (let i = 0; i < freqs.length && freqs[i]! <= fMax; i++)
        g.lineTo(x(freqs[i]!), y(psd[i]!));
      g.lineTo(x(fMax), h - 12);
      g.fillStyle = grad;
      g.fill();
      g.beginPath();
      for (let i = 0; i < freqs.length && freqs[i]! <= fMax; i++) {
        if (i === 0) g.moveTo(x(freqs[i]!), y(psd[i]!));
        else g.lineTo(x(freqs[i]!), y(psd[i]!));
      }
      g.strokeStyle = "#b8f0ff";
      g.lineWidth = 1.2;
      g.stroke();
      g.fillStyle = "#5e719a";
      g.font = "9px ui-monospace, monospace";
      for (const f of [0, 10, 20, 30, 40, 50]) g.fillText(String(f), x(f) + 1, h - 1);
    },
    false,
    [spectrum],
  );
  return <canvas ref={ref} className="block h-32 w-full" />;
}
