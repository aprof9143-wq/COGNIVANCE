import { Plus, Trash2 } from "lucide-react";
import { region } from "@/lib/neuro/atlas";
import { outsideRange, type RegionRow } from "@/lib/neuro/results";
import { SymptomDomain, type CaseFile } from "@/lib/neuro/schema";
import {
  ALTERNATIVE_EXPLANATIONS,
  CITATIONS,
  DOMAIN_LABEL,
  associationRegionIds,
  type Association,
  type Strength,
} from "@/lib/neuro/symptomMap";
import { Panel, Tag } from "@/components/workstation/ui";
import { Select, Text } from "./forms";
import { newId } from "@/lib/neuro/ids";

/** Single-hue sequential shading for literature strength (never a status colour). */
const STRENGTH_BG: Record<Strength, string> = {
  strong: "#256abf",
  moderate: "#1c4f8a",
  supporting: "#16324f",
};

type Props = {
  c: CaseFile;
  rows: RegionRow[];
  associations: Association[];
  setAssociations: (a: Association[]) => void;
  zLimit: number;
  setZLimit: (z: number) => void;
};

/**
 * Rows: symptom domains. Columns: networks. A cell shows the strength of the
 * literature association (network-level, probabilistic). A separate marker
 * shows whether any of this subject's measurements in that network fall
 * outside the selected reference range — only where a compatible reference
 * exists. The two are never merged, and neither explains a symptom.
 */
export function MatrixTab({ c, rows, associations, setAssociations, zLimit, setZLimit }: Props) {
  const networks = [...new Set(associations.map((a) => a.network))];
  const recorded = new Set(c.symptoms.filter((s) => s.present).map((s) => s.domain));
  const cite = (id: string) => CITATIONS.find((x) => x.id === id)?.text ?? id;

  const flagged = (a: Association) => {
    const ids = new Set(associationRegionIds(a));
    const hits = rows.filter(
      (r) =>
        [r.left, r.right, r.single].some(
          (s) => s?.measurement && ids.has(s.measurement.regionId),
        ) && outsideRange(r, zLimit),
    );
    const measured = rows.some((r) =>
      [r.left, r.right, r.single].some((s) => s?.measurement && ids.has(s.measurement.regionId)),
    );
    return { hits, measured };
  };

  const update = (id: string, patch: Partial<Association>) =>
    setAssociations(associations.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Symptom–network research matrix"
        tag="literature"
        note="associations, not localisations"
      >
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[12px] text-[#aab6c8]">
          <label className="flex items-center gap-2">
            Selected reference range: |z| ≥
            <input
              className="field w-20"
              type="number"
              step={0.5}
              min={1}
              max={4}
              value={zLimit}
              onChange={(e) => setZLimit(Number(e.target.value) || 2)}
            />
          </label>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: STRENGTH_BG.strong }}
            />{" "}
            strong
            <span
              className="ml-2 inline-block h-3 w-3 rounded-sm"
              style={{ background: STRENGTH_BG.moderate }}
            />{" "}
            moderate
            <span
              className="ml-2 inline-block h-3 w-3 rounded-sm"
              style={{ background: STRENGTH_BG.supporting }}
            />{" "}
            supporting
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded border border-[#e8eef8] px-1 text-[11px]">
              ◆ outside range
            </span>{" "}
            subject measurement outside the selected reference range in that network (compatible
            norm only)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-separate border-spacing-0.5 text-[12px]">
            <thead>
              <tr>
                <th className="w-44 text-left font-normal text-[#8a97ab]">Domain ↓ · Network →</th>
                {networks.map((n) => (
                  <th
                    key={n}
                    className="max-w-[9rem] px-1 text-left align-bottom font-normal text-[#aab6c8]"
                  >
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SymptomDomain.options.map((d) => (
                <tr key={d}>
                  <th
                    className={`pr-2 text-left font-normal ${recorded.has(d) ? "text-[#ffe59a]" : "text-[#e8eef8]"}`}
                  >
                    {DOMAIN_LABEL[d]}
                    {recorded.has(d) ? (
                      <span className="block text-[11px] text-[#c9a227]">recorded symptom</span>
                    ) : null}
                  </th>
                  {networks.map((n) => {
                    const a = associations.find((x) => x.domain === d && x.network === n);
                    if (!a) return <td key={n} className="rounded bg-[#10151d]" />;
                    const f = flagged(a);
                    const tip = [
                      `${DOMAIN_LABEL[d]} ↔ ${n}`,
                      `Literature association: ${a.strength} (confidence ${a.confidence})`,
                      ...a.citations.map(cite),
                      `Caveat: ${a.caveat}`,
                      f.hits.length
                        ? `Subject: outside |z| ≥ ${zLimit} in ${f.hits.map((h) => h.name).join(", ")}. Finding is nonspecific; clinical correlation required.`
                        : f.measured
                          ? "Subject: no measurement in this network outside the selected range (or no compatible norm)."
                          : "Subject: insufficient data — no measurements in this network.",
                      `Alternative explanations: ${ALTERNATIVE_EXPLANATIONS.join(", ")}.`,
                    ].join("\n");
                    return (
                      <td
                        key={n}
                        title={tip}
                        className="h-11 rounded px-1.5 align-middle text-[#e8eef8]"
                        style={{ background: STRENGTH_BG[a.strength] }}
                      >
                        <span className="text-[11px]">{a.strength}</span>
                        {f.hits.length ? (
                          <span className="ml-1 rounded border border-[#e8eef8] px-1 text-[11px]">
                            ◆
                          </span>
                        ) : null}
                        {!f.measured ? (
                          <span className="block text-[10.5px] text-[#aab6c8]">no data</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-[#8a97ab]">
          Activities of daily living reflect overall severity and have no specific localisation.
          Highlighting a network does not mean it explains a symptom; atypical presentations and
          mixed pathologies produce different patterns. Hover a cell for its sources, uncertainty
          and alternative explanations.
        </p>
      </Panel>

      <Panel
        title="Evidence and provenance table"
        tag="literature"
        note={`atlas: FreeSurfer IDs; ${associations.length} associations`}
        actions={
          <button
            type="button"
            className="chip"
            onClick={() =>
              setAssociations([
                ...associations,
                {
                  id: newId("assoc"),
                  domain: "episodic-memory",
                  network: "New network",
                  regionKeys: [],
                  laterality: "bilateral",
                  strength: "supporting",
                  confidence: "low",
                  citations: [],
                  caveat: "Added locally — cite a source.",
                },
              ])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add association
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-[12px]">
            <thead className="text-left text-[#8a97ab]">
              <tr>
                {[
                  "Domain",
                  "Network",
                  "Atlas labels (ID · hemisphere)",
                  "Laterality",
                  "Strength",
                  "Confidence",
                  "Source",
                  "",
                ].map((h) => (
                  <th key={h} className="px-1 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {associations.map((a) => (
                <tr key={a.id} className="border-t border-[#222b38] align-top text-[#e8eef8]">
                  <td className="p-1">{DOMAIN_LABEL[a.domain]}</td>
                  <td className="p-1">
                    <Text value={a.network} onChange={(v) => update(a.id, { network: v })} />
                  </td>
                  <td className="p-1 text-[11px] text-[#aab6c8]">
                    {associationRegionIds(a)
                      .map(
                        (id) =>
                          `${region(id)?.name ?? "?"} ${id}·${region(id)?.hemisphere[0]?.toUpperCase()}`,
                      )
                      .join(", ") || "none"}
                  </td>
                  <td className="p-1">
                    <Select
                      value={a.laterality}
                      onChange={(v) => update(a.id, { laterality: v })}
                      options={["bilateral", "left", "right"] as const}
                    />
                  </td>
                  <td className="p-1">
                    <Select
                      value={a.strength}
                      onChange={(v) => update(a.id, { strength: v })}
                      options={["strong", "moderate", "supporting"] as const}
                    />
                  </td>
                  <td className="p-1">
                    <Select
                      value={a.confidence}
                      onChange={(v) => update(a.id, { confidence: v })}
                      options={["low", "medium", "high"] as const}
                    />
                  </td>
                  <td className="p-1 text-[11px] text-[#aab6c8]">
                    {a.citations.length ? (
                      a.citations.map(cite).join(" · ")
                    ) : (
                      <Tag kind="research only" />
                    )}
                  </td>
                  <td className="p-1">
                    <button
                      type="button"
                      aria-label="Remove association"
                      onClick={() => setAssociations(associations.filter((x) => x.id !== a.id))}
                    >
                      <Trash2 className="h-4 w-4 text-[#8a97ab] hover:text-[#f2a7a7]" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
