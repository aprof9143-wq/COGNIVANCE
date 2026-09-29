import { useState } from "react";
import { Reveal } from "@/components/Reveal";

const layers = [
  {
    id: 1,
    name: "Biocompatible enclosure",
    short: "Hermetically sealed titanium and Parylene-C casing.",
    spec: "Parylene-C over Ti-6Al-4V · 180 µm wall",
  },
  {
    id: 2,
    name: "Ultrasonic transducer array",
    short: "Custom MEMS transducers for acoustic nanorobot navigation.",
    spec: "64-element PMUT ring · 1.1–2.4 MHz steering",
  },
  {
    id: 3,
    name: "Neural signal ASIC",
    short: "Low-power neural signal processing and stimulation management SoC.",
    spec: "1,024 ch · 18-bit · 3.1 µW/ch",
  },
  {
    id: 4,
    name: "High-density interconnect",
    short: "Flexible biocompatible interposer for high-bandwidth data and power transmission.",
    spec: "Polyimide 8-layer · 12 µm pitch",
  },
  {
    id: 5,
    name: "Power management module",
    short: "Ultra-low power management with energy harvesting capabilities.",
    spec: "Acoustic harvesting · 6.2 Mb/s uplink",
  },
  {
    id: 6,
    name: "Neural interface",
    short: "High-density microelectrode array for neural signal acquisition and stimulation.",
    spec: "Graphene-carbon mesh · 4 µm electrodes",
  },
];

const metrics = [
  {
    value: "1,024",
    label: "Neural channels",
  },
  {
    value: "2.41 mm",
    label: "Device thickness",
  },
  {
    value: "3.4 ms",
    label: "System latency",
  },
];

const details = [
  {
    number: "01",
    title: "Hermetically sealed enclosure",
    description:
      "Compact protective architecture designed around biological integration and long-term device stability.",
  },
  {
    number: "02",
    title: "Neural signal ASIC",
    description:
      "Dedicated low-power electronics for high-density neural signal acquisition and processing.",
  },
  {
    number: "03",
    title: "Flexible interconnect",
    description:
      "Ultra-thin routing transitions from rigid electronics into the neural interface architecture.",
  },
  {
    number: "04",
    title: "Neural interface mesh",
    description:
      "Distributed microelectrode architecture designed for high-density neural interfacing.",
  },
];

function TechnicalVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[#080909]">
        <div className="absolute left-1/2 top-1/2 h-28 w-48 -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/25 bg-white/[0.025]">
          <div className="absolute inset-3 rounded-[22px] border border-white/10" />
          <div className="absolute left-4 top-4 h-1.5 w-1.5 rounded-full border border-white/30" />
          <div className="absolute right-4 top-4 h-1.5 w-1.5 rounded-full border border-white/30" />
          <div className="absolute bottom-4 left-4 h-1.5 w-1.5 rounded-full border border-white/30" />
          <div className="absolute bottom-4 right-4 h-1.5 w-1.5 rounded-full border border-white/30" />
        </div>

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,.06),transparent_60%)]" />
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[#080909]">
        <div className="absolute left-1/2 top-1/2 h-24 w-40 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#b08a46]/45 bg-[#111313]">
          <div className="absolute inset-3 rounded-lg border border-white/[0.08]" />
          <div className="absolute left-1/2 top-1/2 h-11 w-16 -translate-x-1/2 -translate-y-1/2 rounded-md bg-[#090a0b] ring-1 ring-white/10" />

          <div className="absolute -left-2 top-5 bottom-5 flex flex-col justify-between">
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className="h-px w-2 bg-[#b08a46]/60" />
            ))}
          </div>

          <div className="absolute -right-2 top-5 bottom-5 flex flex-col justify-between">
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className="h-px w-2 bg-[#b08a46]/60" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[#080909]">
        <div className="absolute left-1/2 top-1/2 h-24 w-40 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#b08a46]/40 bg-[#111313] p-3">
          <div className="h-full rounded-md border border-white/10 bg-[#080909]" />
          <div className="absolute left-1/2 top-1/2 h-10 w-14 -translate-x-1/2 -translate-y-1/2 rounded bg-[#111313] ring-1 ring-white/10" />
        </div>

        <div className="absolute left-[22%] right-[22%] top-1/2 h-px bg-gradient-to-r from-transparent via-[#b08a46]/60 to-transparent" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#080909]">
      <div className="absolute left-1/2 top-1/2 grid h-24 w-32 -translate-x-1/2 -translate-y-1/2 grid-cols-8 gap-1.5 opacity-70">
        {Array.from({ length: 64 }).map((_, i) => (
          <span key={i} className="h-1.5 w-1.5 rounded-full bg-[#b08a46]" />
        ))}
      </div>

      {Array.from({ length: 14 }).map((_, i) => (
        <span
          key={i}
          className="absolute h-px w-20 origin-left bg-gradient-to-r from-[#b08a46]/60 to-transparent"
          style={{
            left: `${18 + (i % 6) * 12}%`,
            top: `${35 + (i % 5) * 9}%`,
            transform: `rotate(${i % 2 === 0 ? -22 : 22}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export function NimbleSection() {
  const [active, setActive] = useState(3);

  const selectedLayer = layers.find((layer) => layer.id === active) ?? layers[2]!;

  return (
    <section
      id="nimble"
      className="relative overflow-hidden border-t border-white/[0.08] bg-[#050505] text-white"
    >
      {/* =========================================================
          BACKGROUND
      ========================================================== */}

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[15%] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-blue-500/[0.025] blur-[160px]" />

        <div
          className="absolute inset-0 opacity-[0.018]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-[1480px] px-6 py-24 sm:px-8 md:px-10 lg:py-32">
        {/* =========================================================
            HEADER
        ========================================================== */}

        <Reveal>
          <div className="max-w-6xl">
            <div className="mb-7 flex items-center gap-4">
              <span className="font-mono text-[9px] uppercase tracking-[0.34em] text-white/30">
                Instrument Programme
              </span>

              <span className="h-px w-12 bg-white/15" />

              <span className="font-mono text-[9px] tracking-[0.26em] text-blue-400/75">
                PROJECT / NIMBLE
              </span>
            </div>

            <h2 className="max-w-6xl text-[clamp(3rem,6.2vw,6.5rem)] font-medium leading-[0.9] tracking-[-0.055em]">
              NIMBLE — a
              <br />
              neuro-nanorobotic
              <br />
              interface that
              <br />
              <span className="text-white/30">disappears into the body.</span>
            </h2>

            <div className="mt-9 flex max-w-4xl flex-col gap-6 md:flex-row md:items-start">
              <p className="max-w-2xl text-[14px] leading-7 text-white/40">
                Six engineered layers form a compact neural interface for acoustic navigation,
                neural signal acquisition and high-density bidirectional communication.
              </p>

              <div className="hidden h-px w-14 bg-white/15 md:mt-3 md:block" />

              <p className="max-w-[190px] font-mono text-[8px] uppercase leading-5 tracking-[0.2em] text-white/20">
                Cognivance Labs
                <br />
                Neuronanotechnology
                <br />
                Instrumentation
              </p>
            </div>
          </div>
        </Reveal>

        {/* =========================================================
            PRODUCT + ARCHITECTURE
        ========================================================== */}

        <div className="mt-16 grid items-start gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,.7fr)] xl:gap-10">
          {/* =======================================================
              PRODUCT PLATE
          ======================================================== */}

          <Reveal delay={100}>
            <div className="relative overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#050505]">
              {/* exact native image ratio: 3:2 */}

              <div className="relative aspect-[3/2] w-full">
                <img
                  src="/PROJECT-NIMBLE.png"
                  alt="PROJECT NIMBLE neuro-nanorobotic interface — Cognivance Labs"
                  className="
                    absolute
                    inset-0
                    h-full
                    w-full
                    object-cover
                    object-center
                  "
                />

                {/* very subtle edge treatment */}
                <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/[0.05]" />

                {/* engineering status */}

                <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 backdrop-blur-md">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,.8)]" />

                  <span className="font-mono text-[7px] uppercase tracking-[0.2em] text-white/45">
                    Engineering plate
                  </span>
                </div>

                {/* bottom metadata */}

                <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between">
                  <div>
                    <p className="font-mono text-[7px] uppercase tracking-[0.25em] text-white/35">
                      PROJECT-NIMBLE
                    </p>

                    <p className="mt-1 text-[10px] text-white/35">Neuro-nanorobotic interface</p>
                  </div>

                  <p className="font-mono text-[7px] tracking-[0.18em] text-white/25">REV.04</p>
                </div>
              </div>
            </div>
          </Reveal>

          {/* =======================================================
              ARCHITECTURE PANEL
          ======================================================== */}

          <Reveal delay={140}>
            <div className="rounded-[22px] border border-white/[0.08] bg-[#080909]">
              {/* panel heading */}

              <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
                <span className="font-mono text-[8px] uppercase tracking-[0.28em] text-white/30">
                  Architecture
                </span>

                <span className="font-mono text-[8px] tracking-[0.18em] text-white/20">
                  06 / LAYERS
                </span>
              </div>

              {/* layers */}

              <div className="divide-y divide-white/[0.07]">
                {layers.map((layer) => {
                  const isActive = active === layer.id;

                  return (
                    <button
                      key={layer.id}
                      type="button"
                      onMouseEnter={() => setActive(layer.id)}
                      onFocus={() => setActive(layer.id)}
                      onClick={() => setActive(layer.id)}
                      className="group block w-full px-5 py-4 text-left outline-none"
                    >
                      <div className="flex gap-3">
                        <span
                          className={`
                            pt-0.5
                            font-mono
                            text-[8px]
                            transition-colors
                            ${isActive ? "text-blue-400" : "text-white/20"}
                          `}
                        >
                          0{layer.id}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <span
                              className={`
                                text-[12px]
                                font-medium
                                transition-colors
                                ${
                                  isActive
                                    ? "text-white"
                                    : "text-white/45 group-hover:text-white/70"
                                }
                              `}
                            >
                              {layer.name}
                            </span>

                            <span
                              className={`
                                h-1.5
                                w-1.5
                                shrink-0
                                rounded-full
                                transition-all
                                ${
                                  isActive
                                    ? "bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,.8)]"
                                    : "bg-white/10"
                                }
                              `}
                            />
                          </div>

                          <div
                            className="grid transition-all duration-400"
                            style={{
                              gridTemplateRows: isActive ? "1fr" : "0fr",
                            }}
                          >
                            <div className="overflow-hidden">
                              <p className="mt-2 text-[10px] leading-[1.65] text-white/30">
                                {layer.short}
                              </p>

                              <p className="mt-2 font-mono text-[7px] leading-4 tracking-[0.04em] text-blue-300/55">
                                {layer.spec}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* selected component */}

              <div className="border-t border-white/[0.08] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[7px] uppercase tracking-[0.25em] text-white/20">
                    Selected layer
                  </span>

                  <span className="font-mono text-[8px] text-blue-400/65">
                    0{selectedLayer.id} / 06
                  </span>
                </div>

                <div className="flex items-start justify-between gap-5">
                  <div>
                    <p className="text-[12px] font-medium text-white/70">{selectedLayer.name}</p>

                    <p className="mt-1 max-w-[260px] text-[9px] leading-4 text-white/25">
                      {selectedLayer.short}
                    </p>
                  </div>

                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,.8)]" />
                </div>

                <div className="mt-4 border-t border-white/[0.06] pt-3">
                  <p className="font-mono text-[7px] uppercase tracking-[0.2em] text-white/15">
                    Specification
                  </p>

                  <p className="mt-1 font-mono text-[8px] text-white/35">{selectedLayer.spec}</p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        {/* =========================================================
            METRICS
        ========================================================== */}

        <Reveal delay={200}>
          <div className="mt-8 grid overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#080909] sm:grid-cols-3">
            {metrics.map((metric, index) => (
              <div
                key={metric.label}
                className={`
                  px-6
                  py-6
                  ${
                    index !== metrics.length - 1
                      ? "border-b border-white/[0.07] sm:border-b-0 sm:border-r"
                      : ""
                  }
                `}
              >
                <p className="text-[clamp(1.5rem,2.3vw,2.1rem)] font-medium tracking-[-0.04em]">
                  {metric.value}
                </p>

                <p className="mt-1.5 font-mono text-[7px] uppercase tracking-[0.22em] text-white/20">
                  {metric.label}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* =========================================================
            ENGINEERING DETAILS
        ========================================================== */}

        <Reveal delay={260}>
          <div className="mt-14">
            <div className="mb-5 flex items-center justify-between">
              <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-white/25">
                Engineering details
              </span>

              <span className="font-mono text-[7px] tracking-[0.2em] text-white/15">
                NMBL / MACRO STUDY
              </span>
            </div>

            <div className="grid gap-px overflow-hidden rounded-[18px] border border-white/[0.08] bg-white/[0.08] md:grid-cols-2 xl:grid-cols-4">
              {details.map((detail, index) => (
                <div
                  key={detail.number}
                  className="group relative min-h-[220px] overflow-hidden bg-[#080909]"
                >
                  <div className="absolute inset-x-0 top-0 h-[135px]">
                    <TechnicalVisual index={index} />
                  </div>

                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#080909]" />

                  <div className="absolute inset-x-5 bottom-5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-[7px] tracking-[0.2em] text-blue-400/65">
                        DETAIL {detail.number}
                      </span>

                      <span className="h-px w-7 bg-white/10 transition-all duration-500 group-hover:w-12 group-hover:bg-blue-400/40" />
                    </div>

                    <h3 className="text-[11px] font-medium text-white/70">{detail.title}</h3>

                    <p className="mt-1 max-w-[250px] text-[9px] leading-4 text-white/25">
                      {detail.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* =========================================================
            FOOTER STATEMENT
        ========================================================== */}

        <Reveal delay={320}>
          <div className="mt-14 flex flex-col justify-between gap-8 border-t border-white/[0.08] pt-7 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-blue-400/25 bg-blue-400/[0.03]">
                  <svg viewBox="0 0 40 40" className="h-4 w-4" fill="none">
                    <path
                      d="M20 5C13 2 7 7 9 14C3 18 6 27 14 27C17 36 27 36 30 28C38 27 39 17 32 13C33 6 25 3 20 5Z"
                      stroke="currentColor"
                      className="text-blue-400"
                      strokeWidth="1.5"
                    />

                    <path
                      d="M12 16C17 20 23 20 28 15M13 24C18 20 23 21 29 25"
                      stroke="currentColor"
                      className="text-blue-400"
                      strokeWidth="1"
                    />
                  </svg>
                </div>

                <span className="font-mono text-[7px] uppercase tracking-[0.25em] text-white/20">
                  System principle
                </span>
              </div>

              <p className="text-[12px] leading-6 text-white/30">
                NIMBLE is designed around a simple premise: the neural interface should become part
                of the biological environment rather than forcing the environment to adapt to the
                device.
              </p>
            </div>

            <div className="md:text-right">
              <p className="font-mono text-[8px] uppercase tracking-[0.38em] text-white/25">
                Cognivance Labs
              </p>

              <p className="mt-2 font-mono text-[7px] uppercase tracking-[0.24em] text-blue-400/55">
                Neuronanotechnology instrumentation
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
