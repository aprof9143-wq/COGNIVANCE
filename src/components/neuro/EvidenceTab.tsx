import { STATE_LABEL } from "@/lib/neuro/calc";
import type { RegionRow } from "@/lib/neuro/results";
import type { CaseFile } from "@/lib/neuro/schema";
import { ALTERNATIVE_EXPLANATIONS } from "@/lib/neuro/symptomMap";
import { Panel, Tag } from "@/components/workstation/ui";

/**
 * Every derived number with what it rests on: the original measurement, the
 * method and version, the normative cohort, uncertainty, and reviewer approval.
 */
export function EvidenceTab({
  c,
  rows,
  set,
}: {
  c: CaseFile;
  rows: RegionRow[];
  set: (f: (c: CaseFile) => CaseFile) => void;
}) {
  const sides = rows.flatMap((r) =>
    (["left", "right", "single"] as const)
      .map((k) => ({ r, k, s: r[k] }))
      .filter((x) => x.s?.measurement),
  );
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Evidence" tag="derived" note="one row per measured value at the latest visit">
        {!sides.length ? (
          <p className="text-[13px] text-[#aab6c8]">No measurements.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-[12px]">
              <thead className="text-left text-[#8a97ab]">
                <tr>
                  {[
                    "Region",
                    "Original measurement",
                    "Evidence type",
                    "Method",
                    "Normative cohort",
                    "Uncertainty",
                    "QC",
                  ].map((h) => (
                    <th key={h} className="px-1 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sides.map(({ r, k, s }) => {
                  const m = s!.measurement!;
                  return (
                    <tr key={m.id} className="border-t border-[#222b38] align-top text-[#e8eef8]">
                      <td className="p-1">
                        {r.name} {k === "single" ? "" : `(${k})`} · {r.metric}
                        <span className="block text-[11px] text-[#8a97ab]">
                          atlas ID {m.regionId}
                        </span>
                      </td>
                      <td className="p-1 font-mono">
                        {m.value === null
                          ? STATE_LABEL[
                              m.status === "measured"
                                ? "unavailable"
                                : (m.status as "not-measured" | "unavailable" | "failed-qc")
                            ]
                          : `${m.value} ${m.unit === "mm" ? "mm" : "mm³"}`}
                      </td>
                      <td className="p-1">
                        <Tag kind={m.evidence === "imaging-measured" ? "measured" : "derived"} />
                      </td>
                      <td className="p-1 text-[#aab6c8]">
                        {m.provenance.software} {m.provenance.version} · {m.atlas}
                        {m.provenance.parameters ? ` · ${m.provenance.parameters}` : ""}
                      </td>
                      <td className="p-1 text-[#aab6c8]">
                        {s!.norm.state === "value"
                          ? `${s!.norm.reference} (${s!.norm.bin})`
                          : `No compatible norm: ${s!.norm.reasons.join("; ")}`}
                      </td>
                      <td className="p-1 text-[#aab6c8]">
                        Not supplied (no test–retest data loaded)
                      </td>
                      <td className="p-1 text-[#aab6c8]">
                        {m.qc.status}
                        {m.qc.reviewer ? ` · ${m.qc.reviewer}` : ""}
                        {m.qc.date ? ` · ${m.qc.date}` : ""}
                        {m.qc.notes ? (
                          <span className="block text-[11px]">{m.qc.notes}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Interpretation" tag="literature">
        <p className="text-[13px] text-[#e8eef8]">
          No composite Alzheimer's probability, severity or “neurodegeneration” score is computed.
          No validated model with a locked specification, compatible population, calibration
          analysis and external validation has been supplied. Findings are summarised by domain
          above; each is nonspecific on its own.
        </p>
        <p className="mt-2 text-[12px] text-[#aab6c8]">
          Alternative explanations to consider: {ALTERNATIVE_EXPLANATIONS.join(", ")}.
        </p>
      </Panel>

      <Panel title="Reviewer approval" tag="entered">
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <input
            className="field"
            placeholder="reviewer (role or code)"
            value={c.reviewer?.name ?? ""}
            onChange={(e) =>
              set((x) => ({
                ...x,
                reviewer: { name: e.target.value, approved: false, date: null },
              }))
            }
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(c.reviewer?.approved)}
              disabled={!c.reviewer?.name}
              onChange={(e) =>
                set((x) => ({
                  ...x,
                  reviewer: {
                    name: x.reviewer?.name ?? "",
                    approved: e.target.checked,
                    date: e.target.checked ? new Date().toISOString().slice(0, 10) : null,
                  },
                }))
              }
            />
            Reviewed by a qualified clinician
          </label>
          {c.reviewer?.approved ? (
            <span className="text-[12px] text-[#9fdcb4]">Approved {c.reviewer.date}</span>
          ) : (
            <span className="text-[12px] text-[#8a97ab]">Not yet reviewed</span>
          )}
        </div>
      </Panel>
    </div>
  );
}
