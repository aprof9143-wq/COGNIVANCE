import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, FileUp, ScanLine } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportCaseFile,
  exportMeasurementsTsv,
  exportProvenanceJson,
  parseCaseFile,
} from "@/lib/neuro/io";
import { applyLinked, useLinked, type LinkedState } from "@/lib/neuro/linked";
import { regionRows } from "@/lib/neuro/results";
import { emptyCase, type CaseFile } from "@/lib/neuro/schema";
import { DEFAULT_ASSOCIATIONS, DOMAIN_LABEL, type Association } from "@/lib/neuro/symptomMap";
import { DISCLAIMER, Panel, Pill } from "@/components/workstation/ui";
import { ClinicalTab } from "./ClinicalTab";
import { EvidenceTab } from "./EvidenceTab";
import { ImagingTab } from "./ImagingTab";
import { LongitudinalTab } from "./LongitudinalTab";
import { MapTab } from "./MapTab";
import { MatrixTab } from "./MatrixTab";
import { RatingsTab } from "./RatingsTab";

export const SAFETY_STATEMENT =
  "Research/educational decision-support tool. Imaging patterns and cognitive symptoms are not specific to Alzheimer’s disease. Results require review by qualified clinicians and must be interpreted alongside history, examination, laboratory biomarkers, and differential diagnosis.";

const TABS = [
  ["summary", "Clinical summary"],
  ["imaging", "Regional imaging"],
  ["matrix", "Symptom–region matrix"],
  ["longitudinal", "Longitudinal"],
  ["ratings", "Ratings & biomarkers"],
  ["map", "3D map"],
  ["evidence", "Evidence"],
] as const;
type TabId = (typeof TABS)[number][0];

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Neurodegeneration Tracking (structural change tracking). The case lives in
 * this browser tab only: nothing is sent anywhere, and it is not saved unless
 * exported. Case files are pseudonymous by design.
 */
export function NeuroDashboard() {
  const [c, setC] = useState<CaseFile>(emptyCase);
  const [tab, setTab] = useState<TabId>("summary");
  const [associations, setAssociations] = useState<Association[]>(DEFAULT_ASSOCIATIONS);
  const [normalisation, setNormalisation] = useState<"raw" | "icv-ratio">("raw");
  const [zLimit, setZLimit] = useState(2);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const caseInput = useRef<HTMLInputElement>(null);

  // Whatever the console or viewer has loaded is merged in as it changes.
  const linked = useLinked();
  useEffect(() => {
    setC((x) => applyLinked(x, linked));
  }, [linked]);

  const set = (f: (c: CaseFile) => CaseFile) => setC((x) => f(x));
  const rows = useMemo(() => {
    try {
      return regionRows(c, normalisation);
    } catch {
      return [];
    }
  }, [c, normalisation]);

  const stamp = `${c.subjectCode.replace(/[^\w-]/g, "_")}-${new Date().toISOString().slice(0, 10)}`;

  return (
    <div className="ws min-h-screen bg-[#00030b] text-[#e6efff]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#16305e] bg-[#01071a] px-4 py-2.5">
        <Link to="/research" className="btn">
          <ArrowLeft className="h-4 w-4" /> Research console
        </Link>
        <Link to="/viewer" className="btn">
          <ScanLine className="h-4 w-4" /> Diagnostic viewer
        </Link>
        <div className="leading-tight">
          <h1 className="text-[15px] font-semibold">Neurodegeneration tracking</h1>
          <p className="text-[12px] text-[#8095bf]">
            Structural change tracking · symptom–network research map · no diagnosis or probability
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={() => caseInput.current?.click()}>
            <FileUp className="h-4 w-4" /> Import case (JSON)
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => download(`${stamp}.case.json`, exportCaseFile(c), "application/json")}
          >
            <Download className="h-4 w-4" /> Case JSON
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              download(
                `${stamp}_desc-regional_measurements.tsv`,
                exportMeasurementsTsv(c),
                "text/tab-separated-values",
              );
              download(
                `${stamp}_dataset_description.json`,
                exportProvenanceJson(c),
                "application/json",
              );
            }}
          >
            <Download className="h-4 w-4" /> Measurements TSV + provenance
          </button>
          <input
            ref={caseInput}
            type="file"
            accept=".json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                setC(applyLinked(parseCaseFile(await f.text()), linked));
                setMsg({ tone: "ok", text: `Loaded ${f.name}.` });
              } catch (err) {
                setMsg({ tone: "error", text: err instanceof Error ? err.message : String(err) });
              }
            }}
          />
        </div>
      </header>

      <div role="note" className="border-b border-[#5a4a1c] bg-[#1b160a] px-4 py-3">
        <p className="max-w-5xl text-[14px] leading-relaxed text-[#f0dfae]">{SAFETY_STATEMENT}</p>
        <p className="mt-1 text-[12px] text-[#c9b886]">
          {DISCLAIMER} This module computes no Alzheimer’s diagnosis, probability, severity or
          “neuron degeneration” score. Regional volume loss is structural change, not a neuron
          count. The case stays in this browser tab and is not saved unless exported; what the
          research console and viewer have loaded is linked in automatically (summaries only, kept
          in this browser).
        </p>
      </div>

      <nav
        className="flex flex-wrap gap-1 border-b border-[#16305e] bg-[#01071a] px-4 py-2"
        role="tablist"
      >
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`tool ${tab === id ? "tool-on" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        {msg ? (
          <span className="ml-auto">
            <Pill tone={msg.tone}>{msg.text}</Pill>
          </span>
        ) : null}
      </nav>

      <main className="p-3">
        {tab === "summary" ? (
          <div className="flex flex-col gap-3">
            <LinkedSources linked={linked} c={c} />
            <Summary c={c} />
            <ClinicalTab c={c} set={set} />
          </div>
        ) : null}
        {tab === "imaging" ? (
          <ImagingTab
            c={c}
            set={set}
            normalisation={normalisation}
            setNormalisation={setNormalisation}
          />
        ) : null}
        {tab === "matrix" ? (
          <MatrixTab
            c={c}
            rows={rows}
            associations={associations}
            setAssociations={setAssociations}
            zLimit={zLimit}
            setZLimit={setZLimit}
          />
        ) : null}
        {tab === "longitudinal" ? <LongitudinalTab c={c} set={set} /> : null}
        {tab === "ratings" ? <RatingsTab c={c} set={set} /> : null}
        {tab === "map" ? <MapTab rows={rows} /> : null}
        {tab === "evidence" ? <EvidenceTab c={c} rows={rows} set={set} /> : null}
      </main>
    </div>
  );
}

/** Domain-level summary: what is recorded, by evidence type, with no score. */
function Summary({ c }: { c: CaseFile }) {
  const present = c.symptoms.filter((s) => s.present);
  const latestByInstrument = new Map<string, CaseFile["assessments"][number]>();
  for (const a of [...c.assessments].sort((x, y) => x.date.localeCompare(y.date)))
    latestByInstrument.set(`${a.instrument} ${a.version}`, a);
  return (
    <Panel
      title="Clinical summary"
      tag="entered"
      note="transparent domain summary — no composite score"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-[12px] font-semibold text-[#c4d2ee]">Symptoms (by domain)</p>
          {present.length ? (
            <ul className="mt-1 text-[13px]">
              {present.map((s) => (
                <li key={s.id}>
                  {DOMAIN_LABEL[s.domain]} — {s.severity ?? "severity unrated"}, {s.progression}
                  {s.onset ? `, since ${s.onset}` : ""}{" "}
                  <span className="text-[12px] text-[#8095bf]">
                    ({s.source === "clinician" ? "clinician observation" : `${s.source} report`})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] text-[#a9bbdc]">None recorded.</p>
          )}
        </div>
        <div>
          <p className="text-[12px] font-semibold text-[#c4d2ee]">Functional impact</p>
          <p className="mt-1 text-[13px]">
            {c.symptoms.some((s) => s.domain === "adl" && s.present)
              ? "Impaired activities of daily living recorded."
              : "Not recorded."}
          </p>
        </div>
        <div>
          <p className="text-[12px] font-semibold text-[#c4d2ee]">Latest cognitive scores</p>
          {latestByInstrument.size ? (
            <ul className="mt-1 text-[13px]">
              {[...latestByInstrument.values()].map((a) => (
                <li key={a.id}>
                  {a.instrument} {a.version}: {a.rawScore ?? "—"}
                  {a.maxScore !== null ? `/${a.maxScore}` : ""}
                  {a.adjustedScore !== null ? ` (adjusted ${a.adjustedScore})` : ""} · {a.date}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] text-[#a9bbdc]">None recorded.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** What the imaging pages have loaded, and what it put into this case. */
function LinkedSources({ linked, c }: { linked: LinkedState; c: CaseFile }) {
  const { mri, segmentation: seg, eeg } = linked;
  const nMeasurements = c.measurements.filter((m) => m.id.startsWith("linked-")).length;
  const nMarkers = c.biomarkers.filter((b) => b.id.startsWith("linked-")).length;
  const when = (iso: string) => new Date(iso).toLocaleTimeString();
  const from = (o: "console" | "viewer") =>
    o === "console" ? "research console" : "diagnostic viewer";
  const kindPill = (k: "subject" | "template" | "phantom") =>
    k === "subject" ? (
      <Pill tone="ok">subject</Pill>
    ) : k === "template" ? (
      <Pill tone="info">template — not a subject</Pill>
    ) : (
      <Pill tone="warn">synthetic phantom</Pill>
    );
  return (
    <Panel
      title="Linked imaging & EEG"
      tag="derived"
      note="updates live from the console and viewer"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[#c4d2ee]">MRI</p>
          {mri ? (
            <div className="mt-1 flex flex-col gap-1 text-[13px]">
              <span className="flex flex-wrap items-center gap-2">
                {mri.label} {kindPill(mri.kind)}
              </span>
              <span className="font-mono text-[12px] text-[#a9bbdc]">
                {mri.dims.join(" × ")} · {mri.spacingMm.map((x) => x.toFixed(2)).join(" × ")} mm
              </span>
              <span className="text-[12px] text-[#8095bf]">
                From the {from(mri.origin)} · {when(mri.linkedAt)} · added as visit “linked-visit”
              </span>
            </div>
          ) : (
            <p className="mt-1 text-[13px] text-[#a9bbdc]">
              No MRI loaded. Open the research console or diagnostic viewer.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[#c4d2ee]">Segmentation</p>
          {seg ? (
            <div className="mt-1 flex flex-col gap-1 text-[13px]">
              <span>
                {seg.label} · {seg.classes.length} labels
              </span>
              <span className="text-[12px] text-[#a9bbdc]">
                {nMeasurements
                  ? `${nMeasurements} regional volumes added (QC pending) — see Regional imaging.`
                  : "Label IDs do not follow the FreeSurfer convention, so no atlas regions were added."}
              </span>
              <span className="text-[12px] text-[#8095bf]">
                From the {from(seg.origin)} · {when(seg.linkedAt)}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-[13px] text-[#a9bbdc]">
              No label map loaded. Load a FreeSurfer aseg/aparc label map in the console or viewer
              to get hippocampal, ventricular and cortical volumes — or import aseg.stats under
              Regional imaging.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[#c4d2ee]">EEG</p>
          {eeg ? (
            <div className="mt-1 flex flex-col gap-1 text-[13px]">
              <span className="flex flex-wrap items-center gap-2">
                {eeg.label} {kindPill(eeg.kind)}
              </span>
              <ul className="font-mono text-[12px] text-[#e6efff]">
                {eeg.markers.map((m) => (
                  <li key={m.id}>
                    {m.name}:{" "}
                    {m.value === null
                      ? "—"
                      : m.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                    <span className="text-[#8095bf]">{m.unit}</span>
                  </li>
                ))}
              </ul>
              <span className="text-[12px] text-[#8095bf]">
                {nMarkers} EEG measures added under Ratings &amp; biomarkers · from the{" "}
                {from(eeg.origin)} · {when(eeg.linkedAt)}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-[13px] text-[#a9bbdc]">No EEG loaded.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
