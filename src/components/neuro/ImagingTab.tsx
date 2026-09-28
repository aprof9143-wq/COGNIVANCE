import { FileUp, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import {
  STATE_LABEL,
  pipelineChangeWarnings,
  scannerChangeWarnings,
  type NormResult,
  type Value,
} from "@/lib/neuro/calc";
import { parseAparcStats, parseAsegStats, parseMeasurementTable } from "@/lib/neuro/io";
import { regionRows, type RegionRow, type SideResult } from "@/lib/neuro/results";
import {
  NormativeReference,
  type CaseFile,
  type RegionalMeasurement,
  type Visit,
} from "@/lib/neuro/schema";
import { Panel, Pill } from "@/components/workstation/ui";
import { DateInput, Field, Missing, Num, Text } from "./forms";
import { newId } from "@/lib/neuro/ids";

type Props = {
  c: CaseFile;
  set: (f: (c: CaseFile) => CaseFile) => void;
  normalisation: "raw" | "icv-ratio";
  setNormalisation: (n: "raw" | "icv-ratio") => void;
};

const fmtValue = (v: Value, digits = 1) =>
  v.state === "value" ? v.value.toLocaleString(undefined, { maximumFractionDigits: digits }) : null;

export function ValueCell({
  v,
  digits = 1,
  suffix = "",
}: {
  v: Value;
  digits?: number;
  suffix?: string;
}) {
  if (v.state === "value")
    return (
      <span className="font-mono">
        {fmtValue(v, digits)}
        {suffix}
      </span>
    );
  return <Missing>{STATE_LABEL[v.state]}</Missing>;
}

export function NormCell({ n }: { n: NormResult }) {
  if (n.state === "value") {
    return (
      <span
        className="font-mono"
        title={`${n.reference} · ${n.bin} · percentile assumes a normal distribution within the bin`}
      >
        z {n.z.toFixed(2)} · {n.percentile.toFixed(0)}th
      </span>
    );
  }
  return (
    <span title={n.reasons.join("\n")}>
      <Missing>No compatible norm</Missing>
    </span>
  );
}

export function ChangeCell({ s }: { s: SideResult | null }) {
  if (!s) return <Missing>Not measured</Missing>;
  const c = s.change;
  if (c.state !== "value")
    return (
      <span title={c.reason}>
        <Missing>{STATE_LABEL[c.state]}</Missing>
      </span>
    );
  return (
    <span className="font-mono" title={`${c.n} time points; least-squares slope`}>
      {(c.percentPerYear ?? Number.NaN).toFixed(2)} %/yr
    </span>
  );
}

/**
 * Visits, imports, the regional imaging table and manual QC. Measurements
 * come from segmentation software; this module never segments. A QC failure
 * removes a value from every calculation, and a manual correction records who
 * changed what, and why.
 */
export function ImagingTab({ c, set, normalisation, setNormalisation }: Props) {
  const [visitId, setVisitId] = useState<string>(c.visits[0]?.id ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(
    null,
  );
  const [reviewer, setReviewer] = useState("");
  const statsInput = useRef<HTMLInputElement>(null);
  const normInput = useRef<HTMLInputElement>(null);

  const upVisit = (id: string, patch: Partial<Visit>) =>
    set((x) => ({ ...x, visits: x.visits.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  const upMeas = (id: string, patch: Partial<RegionalMeasurement>) =>
    set((x) => ({
      ...x,
      measurements: x.measurements.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));

  let rows: RegionRow[] = [];
  let warnings: string[] = [];
  let orderError: string | null = null;
  try {
    rows = regionRows(c, normalisation);
    warnings = [
      ...scannerChangeWarnings(c.visits),
      ...pipelineChangeWarnings(c.measurements, c.visits),
    ];
  } catch (e) {
    orderError = e instanceof Error ? e.message : String(e);
  }

  const importStats = async (files: File[]) => {
    if (!visitId) {
      setMessage({
        tone: "error",
        text: "Add or select a visit first; measurements belong to a visit.",
      });
      return;
    }
    for (const f of files) {
      try {
        const text = await f.text();
        const r = /aseg\.stats$/i.test(f.name)
          ? parseAsegStats(text, visitId)
          : /aparc.*\.stats$/i.test(f.name)
            ? parseAparcStats(text, visitId)
            : parseMeasurementTable(text);
        set((x) => ({
          ...x,
          measurements: [
            ...x.measurements.filter(
              (m) =>
                !(
                  m.visitId === visitId &&
                  r.measurements.some((n) => n.regionId === m.regionId && n.metric === m.metric)
                ),
            ),
            ...r.measurements,
          ],
          visits:
            r.icvMm3 !== null
              ? x.visits.map((v) => (v.id === visitId ? { ...v, icvMm3: r.icvMm3 } : v))
              : x.visits,
        }));
        setMessage({
          tone: "ok",
          text: `${f.name}: ${r.measurements.length} values imported${r.icvMm3 !== null ? `, eTIV ${Math.round(r.icvMm3).toLocaleString()} mm³` : ""}${r.skipped.length ? `; ${r.skipped.length} rows outside the atlas skipped` : ""}. QC status: pending review.`,
        });
      } catch (e) {
        setMessage({
          tone: "error",
          text: `${f.name}: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  };

  const importNorm = async (f: File) => {
    try {
      const ref = NormativeReference.parse(JSON.parse(await f.text()));
      set((x) => ({ ...x, norms: [...x.norms.filter((n) => n.id !== ref.id), ref] }));
      setMessage({
        tone: "ok",
        text: `Normative reference "${ref.name}" loaded (${ref.entries.length} entries). Compatibility is checked per value.`,
      });
    } catch (e) {
      setMessage({
        tone: "error",
        text: `${f.name}: not a valid normative reference (${e instanceof Error ? e.message.slice(0, 160) : ""}).`,
      });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Visits"
        tag="entered"
        note="acquisition details drive comparability warnings"
        actions={
          <button
            type="button"
            className="chip"
            onClick={() => {
              const id = newId("v");
              set((x) => ({
                ...x,
                visits: [
                  ...x.visits,
                  {
                    id,
                    date: new Date().toISOString().slice(0, 10),
                    scanner: { manufacturer: null, model: null, fieldStrength: null },
                    sequence: null,
                    voxelSize: null,
                    icvMm3: null,
                    ageYears: null,
                    notes: "",
                  },
                ],
              }));
              setVisitId(id);
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add visit
          </button>
        }
      >
        {!c.visits.length ? (
          <p className="text-[13px] text-[#aab6c8]">
            No visits. Add a visit, then import its measurements.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {c.visits.map((v) => (
              <div
                key={v.id}
                className={`grid gap-2 rounded border p-2 sm:grid-cols-4 lg:grid-cols-8 ${v.id === visitId ? "border-[#c9a227]" : "border-[#222b38]"}`}
              >
                <Field label="Date">
                  <DateInput value={v.date} onChange={(d) => upVisit(v.id, { date: d })} />
                </Field>
                <Field label="Age (years)">
                  <Num value={v.ageYears} onChange={(n) => upVisit(v.id, { ageYears: n })} />
                </Field>
                <Field label="Manufacturer">
                  <Text
                    value={v.scanner.manufacturer ?? ""}
                    onChange={(t) =>
                      upVisit(v.id, { scanner: { ...v.scanner, manufacturer: t || null } })
                    }
                  />
                </Field>
                <Field label="Model">
                  <Text
                    value={v.scanner.model ?? ""}
                    onChange={(t) => upVisit(v.id, { scanner: { ...v.scanner, model: t || null } })}
                  />
                </Field>
                <Field label="Field (T)">
                  <Num
                    value={v.scanner.fieldStrength}
                    onChange={(n) => upVisit(v.id, { scanner: { ...v.scanner, fieldStrength: n } })}
                  />
                </Field>
                <Field label="Sequence">
                  <Text
                    value={v.sequence ?? ""}
                    onChange={(t) => upVisit(v.id, { sequence: t || null })}
                  />
                </Field>
                <Field label="Voxel size">
                  <Text
                    value={v.voxelSize ?? ""}
                    onChange={(t) => upVisit(v.id, { voxelSize: t || null })}
                  />
                </Field>
                <Field label="ICV / eTIV (mm³)">
                  <Num value={v.icvMm3} onChange={(n) => upVisit(v.id, { icvMm3: n })} />
                </Field>
                <div className="flex gap-2 sm:col-span-4 lg:col-span-8">
                  <button
                    type="button"
                    className={`chip ${v.id === visitId ? "chip-on" : ""}`}
                    onClick={() => setVisitId(v.id)}
                  >
                    {v.id === visitId ? "Import target" : "Import into this visit"}
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() =>
                      set((x) => ({
                        ...x,
                        visits: x.visits.filter((y) => y.id !== v.id),
                        measurements: x.measurements.filter((m) => m.visitId !== v.id),
                      }))
                    }
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove visit and its measurements
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Import measurements" tag="derived" note="no segmentation is performed here">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={() => statsInput.current?.click()}>
            <FileUp className="h-4 w-4" /> aseg.stats / ?h.aparc.stats / CSV
          </button>
          <button type="button" className="btn" onClick={() => normInput.current?.click()}>
            <FileUp className="h-4 w-4" /> Normative reference (JSON)
          </button>
          <input
            ref={statsInput}
            type="file"
            multiple
            accept=".stats,.csv,.tsv,.txt"
            className="hidden"
            onChange={(e) => {
              void importStats([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <input
            ref={normInput}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importNorm(f);
              e.target.value = "";
            }}
          />
          {message ? <Pill tone={message.tone}>{message.text}</Pill> : null}
        </div>
        <p className="mt-2 text-[12px] text-[#8a97ab]">
          Accepted: FreeSurfer aseg.stats (volumes, eTIV) and lh/rh.aparc.stats (thickness, grey
          volume), or a table with visit_id, region_id, metric, value, unit, software,
          software_version, qc_status. Blank values import as "Not measured". Imported values start
          with QC pending.
        </p>
        <p className="mt-1 text-[12px] text-[#8a97ab]">
          Normative references:{" "}
          {c.norms.length
            ? c.norms.map((n) => `${n.name} (${n.cohort}; ${n.software}; ${n.atlas})`).join(" · ")
            : "none loaded — every norm cell will read “No compatible norm”."}
        </p>
      </Panel>

      {orderError ? <Pill tone="error">{orderError}</Pill> : null}
      {warnings.length ? (
        <div className="rounded border border-[#7a6320] bg-[#221c0a] px-3 py-2 text-[12px] text-[#f0d68a]">
          <p className="font-semibold">Comparability warnings</p>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Panel
        title="Regional imaging table"
        tag="derived"
        note={rows[0] ? `latest visit ${rows[0].visit.date}` : undefined}
        actions={
          <label className="flex items-center gap-2 text-[12px] text-[#aab6c8]">
            Norm comparison on
            <select
              className="field"
              value={normalisation}
              onChange={(e) => setNormalisation(e.target.value as "raw" | "icv-ratio")}
            >
              <option value="raw">raw volume</option>
              <option value="icv-ratio">% of ICV</option>
            </select>
          </label>
        }
      >
        {!rows.length ? (
          <p className="text-[13px] text-[#aab6c8]">
            No regional measurements. Import FreeSurfer or equivalent outputs above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-[12px]">
              <thead className="text-left text-[#8a97ab]">
                <tr>
                  <th className="px-1 font-normal">Region</th>
                  <th className="px-1 font-normal">Metric</th>
                  <th className="px-1 font-normal">Left</th>
                  <th className="px-1 font-normal">Right</th>
                  <th className="px-1 font-normal">% ICV (L / R)</th>
                  <th className="px-1 font-normal">Asymmetry</th>
                  <th className="px-1 font-normal">Norm L</th>
                  <th className="px-1 font-normal">Norm R</th>
                  <th className="px-1 font-normal">Change L</th>
                  <th className="px-1 font-normal">Change R</th>
                  <th className="px-1 font-normal">QC</th>
                  <th className="px-1 font-normal">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const L = r.left ?? r.single;
                  const R = r.right;
                  const ms = [L?.measurement, R?.measurement].filter(
                    Boolean,
                  ) as RegionalMeasurement[];
                  return (
                    <tr
                      key={`${r.key}-${r.metric}`}
                      className="border-t border-[#222b38] align-top text-[#e8eef8]"
                    >
                      <td className="p-1">
                        {r.name}
                        {r.single ? " (midline)" : ""}
                      </td>
                      <td className="p-1 text-[#aab6c8]">
                        {r.metric} ({r.unit})
                      </td>
                      <td className="p-1">
                        {L ? <ValueCell v={L.value} /> : <Missing>Not measured</Missing>}
                      </td>
                      <td className="p-1">
                        {R ? (
                          <ValueCell v={R.value} />
                        ) : r.single ? (
                          "—"
                        ) : (
                          <Missing>Not measured</Missing>
                        )}
                      </td>
                      <td className="p-1">
                        {L ? <ValueCell v={L.icv} digits={3} /> : "—"}{" "}
                        {R ? (
                          <>
                            {" "}
                            / <ValueCell v={R.icv} digits={3} />
                          </>
                        ) : null}
                      </td>
                      <td className="p-1">
                        {r.asymmetry ? <ValueCell v={r.asymmetry} digits={1} suffix=" %" /> : "—"}
                      </td>
                      <td className="p-1">{L ? <NormCell n={L.norm} /> : "—"}</td>
                      <td className="p-1">{R ? <NormCell n={R.norm} /> : "—"}</td>
                      <td className="p-1">
                        <ChangeCell s={L} />
                      </td>
                      <td className="p-1">{R ? <ChangeCell s={R} /> : "—"}</td>
                      <td className="p-1">
                        {ms.map((m) => (
                          <QcControl
                            key={m.id}
                            m={m}
                            reviewer={reviewer}
                            onChange={(patch) => upMeas(m.id, patch)}
                          />
                        ))}
                      </td>
                      <td className="p-1 text-[#aab6c8]">
                        {ms[0] ? `${ms[0].provenance.software} ${ms[0].provenance.version}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[#aab6c8]">
          <label className="flex items-center gap-2">
            Reviewer (for QC decisions)
            <input
              className="field"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder="role or code"
            />
          </label>
        </div>
        <p className="mt-2 text-[12px] text-[#8a97ab]">
          Asymmetry = (L − R) / mean(L, R) × 100. Change is the least-squares slope over usable
          visits, as % of the fitted baseline per year. Regional volume loss is structural change,
          not a neuron count. A single measurement is never labelled normal or abnormal; outside a
          compatible reference it reads “No compatible norm”.
        </p>
      </Panel>
    </div>
  );
}

function QcControl({
  m,
  reviewer,
  onChange,
}: {
  m: RegionalMeasurement;
  reviewer: string;
  onChange: (p: Partial<RegionalMeasurement>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | null>(m.value);
  const [reason, setReason] = useState("");
  const stamp = () => ({ reviewer: reviewer || null, date: new Date().toISOString().slice(0, 10) });
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-[#8a97ab]">{m.hemisphere[0]!.toUpperCase()}</span>
      <select
        className="field py-0 text-[11px]"
        value={m.qc.status}
        onChange={(e) => {
          const status = e.target.value as "pass" | "fail" | "pending";
          onChange({
            qc: { ...m.qc, status, ...stamp() },
            status: status === "fail" ? "failed-qc" : m.value === null ? m.status : "measured",
          });
        }}
        aria-label={`QC for ${m.regionName} ${m.hemisphere}`}
      >
        <option value="pending">pending</option>
        <option value="pass">pass</option>
        <option value="fail">fail</option>
      </select>
      <button
        type="button"
        className="text-[11px] text-[#a9c6ea] underline"
        onClick={() => setEditing((x) => !x)}
      >
        correct
      </button>
      {editing ? (
        <span className="flex items-center gap-1">
          <input
            className="field w-20 py-0 text-[11px]"
            type="number"
            value={value ?? ""}
            onChange={(e) => setValue(e.target.value === "" ? null : Number(e.target.value))}
          />
          <input
            className="field w-32 py-0 text-[11px]"
            placeholder="reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="chip py-0 text-[11px]"
            disabled={!reason.trim()}
            onClick={() => {
              onChange({
                value,
                status: value === null ? "not-measured" : "measured",
                evidence: "imaging-measured",
                qc: {
                  ...m.qc,
                  ...stamp(),
                  status: "pass",
                  notes: `${m.qc.notes ? `${m.qc.notes}; ` : ""}manual correction ${m.value ?? "∅"} → ${value ?? "∅"}: ${reason}`,
                },
              });
              setEditing(false);
            }}
          >
            save
          </button>
        </span>
      ) : null}
      {m.qc.notes ? <span className="w-full text-[11px] text-[#8a97ab]">{m.qc.notes}</span> : null}
    </div>
  );
}
