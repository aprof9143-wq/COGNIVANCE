import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, FileUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  exportCaseFile,
  exportMeasurementsTsv,
  exportProvenanceJson,
  parseCaseFile,
} from "@/lib/neuro/io";
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
    <div className="ws min-h-screen bg-[#0a0d12] text-[#e8eef8]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#2a3444] bg-[#0d1118] px-4 py-2.5">
        <Link to="/research" className="btn">
          <ArrowLeft className="h-4 w-4" /> Imaging viewer
        </Link>
        <div className="leading-tight">
          <h1 className="text-[15px] font-semibold">Neurodegeneration tracking</h1>
          <p className="text-[12px] text-[#8a97ab]">
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
                setC(parseCaseFile(await f.text()));
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
          count. The case stays in this browser tab and is not saved unless exported.
        </p>
      </div>

      <nav
        className="flex flex-wrap gap-1 border-b border-[#2a3444] bg-[#0d1118] px-4 py-2"
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
          <p className="text-[12px] font-semibold text-[#c3cbd6]">Symptoms (by domain)</p>
          {present.length ? (
            <ul className="mt-1 text-[13px]">
              {present.map((s) => (
                <li key={s.id}>
                  {DOMAIN_LABEL[s.domain]} — {s.severity ?? "severity unrated"}, {s.progression}
                  {s.onset ? `, since ${s.onset}` : ""}{" "}
                  <span className="text-[12px] text-[#8a97ab]">
                    ({s.source === "clinician" ? "clinician observation" : `${s.source} report`})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] text-[#aab6c8]">None recorded.</p>
          )}
        </div>
        <div>
          <p className="text-[12px] font-semibold text-[#c3cbd6]">Functional impact</p>
          <p className="mt-1 text-[13px]">
            {c.symptoms.some((s) => s.domain === "adl" && s.present)
              ? "Impaired activities of daily living recorded."
              : "Not recorded."}
          </p>
        </div>
        <div>
          <p className="text-[12px] font-semibold text-[#c3cbd6]">Latest cognitive scores</p>
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
            <p className="mt-1 text-[13px] text-[#aab6c8]">None recorded.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
