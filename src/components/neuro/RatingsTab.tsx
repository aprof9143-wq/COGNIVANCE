import { Plus, Trash2 } from "lucide-react";
import {
  BiomarkerCategory,
  VISUAL_SCALES,
  type Biomarker,
  type CaseFile,
  type VisualRating,
  type VisualScale,
} from "@/lib/neuro/schema";
import { CITATIONS } from "@/lib/neuro/symptomMap";
import { disagreements } from "@/lib/neuro/ratings";
import { newId } from "@/lib/neuro/ids";
import { Panel, Pill } from "@/components/workstation/ui";
import { DateInput, Field, Missing, Num, Select, Text } from "./forms";

type Props = { c: CaseFile; set: (f: (c: CaseFile) => CaseFile) => void };

const SCALE_CITE: Record<VisualScale, string> = {
  MTA: "scheltens1992",
  PA: "koedam2011",
  GCA: "pasquier1996",
  "Fazekas-PV": "fazekas1987",
  "Fazekas-DWM": "fazekas1987",
};

export function RatingsTab({ c, set }: Props) {
  const upR = (id: string, p: Partial<VisualRating>) =>
    set((x) => ({ ...x, ratings: x.ratings.map((r) => (r.id === id ? { ...r, ...p } : r)) }));
  const upB = (id: string, p: Partial<Biomarker>) =>
    set((x) => ({ ...x, biomarkers: x.biomarkers.map((b) => (b.id === id ? { ...b, ...p } : b)) }));
  const dis = disagreements(c.ratings);
  const visitOpts = c.visits.map((v) => [v.id, v.date] as [string, string]);

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Visual rating scales"
        tag="entered"
        note="clinician ratings are final; automated suggestions are kept separate"
        actions={
          <button
            type="button"
            className="chip"
            disabled={!c.visits.length}
            onClick={() =>
              set((x) => ({
                ...x,
                ratings: [
                  ...x.ratings,
                  {
                    id: newId("r"),
                    visitId: x.visits[0]?.id ?? "",
                    scale: "MTA",
                    hemisphere: "left",
                    score: 0,
                    rater: "",
                    date: new Date().toISOString().slice(0, 10),
                    confidence: "medium",
                    kind: "clinician",
                    method: "",
                    notes: "",
                  },
                ],
              }))
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add rating
          </button>
        }
      >
        {!c.visits.length ? (
          <p className="text-[13px] text-[#aab6c8]">Add a visit (Imaging tab) before rating.</p>
        ) : null}
        {c.ratings.length ? (
          <table className="w-full text-[12px]">
            <thead className="text-left text-[#8a97ab]">
              <tr>
                {[
                  "Visit",
                  "Scale",
                  "Side",
                  "Score",
                  "Rater",
                  "Date",
                  "Confidence",
                  "Kind",
                  "Notes",
                  "",
                ].map((h) => (
                  <th key={h} className="px-1 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.ratings.map((r) => {
                const s = VISUAL_SCALES[r.scale];
                const out = r.score < s.min || r.score > s.max;
                return (
                  <tr
                    key={r.id}
                    className={`border-t border-[#222b38] ${r.kind === "automated-suggestion" ? "opacity-70" : ""}`}
                  >
                    <td className="p-1">
                      <Select
                        value={r.visitId}
                        onChange={(v) => upR(r.id, { visitId: v })}
                        options={visitOpts}
                      />
                    </td>
                    <td className="p-1">
                      <Select
                        value={r.scale}
                        onChange={(v) =>
                          upR(r.id, {
                            scale: v,
                            hemisphere: VISUAL_SCALES[v].perHemisphere ? "left" : "n/a",
                          })
                        }
                        options={Object.keys(VISUAL_SCALES).map(
                          (k) => [k, VISUAL_SCALES[k as VisualScale].name] as [VisualScale, string],
                        )}
                      />
                    </td>
                    <td className="p-1">
                      <Select
                        value={r.hemisphere}
                        onChange={(v) => upR(r.id, { hemisphere: v })}
                        options={
                          s.perHemisphere ? (["left", "right"] as const) : (["n/a"] as const)
                        }
                      />
                    </td>
                    <td className="p-1">
                      <input
                        className={`field w-16 ${out ? "border-[#d03b3b]" : ""}`}
                        type="number"
                        min={s.min}
                        max={s.max}
                        step={1}
                        value={r.score}
                        onChange={(e) => upR(r.id, { score: Math.round(Number(e.target.value)) })}
                      />
                      <span className="ml-1 text-[11px] text-[#8a97ab]">
                        {s.min}–{s.max}
                      </span>
                    </td>
                    <td className="p-1">
                      <Text
                        value={r.rater}
                        onChange={(v) => upR(r.id, { rater: v })}
                        placeholder="rater code"
                      />
                    </td>
                    <td className="p-1">
                      <DateInput value={r.date} onChange={(v) => upR(r.id, { date: v })} />
                    </td>
                    <td className="p-1">
                      <Select
                        value={r.confidence}
                        onChange={(v) => upR(r.id, { confidence: v })}
                        options={["low", "medium", "high"] as const}
                      />
                    </td>
                    <td className="p-1">
                      <Select
                        value={r.kind}
                        onChange={(v) => upR(r.id, { kind: v })}
                        options={
                          [
                            ["clinician", "Clinician (final)"],
                            ["automated-suggestion", "Automated suggestion"],
                          ] as const
                        }
                      />
                    </td>
                    <td className="p-1">
                      <Text value={r.notes} onChange={(v) => upR(r.id, { notes: v })} />
                    </td>
                    <td className="p-1">
                      <button
                        type="button"
                        aria-label="Remove rating"
                        onClick={() =>
                          set((x) => ({ ...x, ratings: x.ratings.filter((y) => y.id !== r.id) }))
                        }
                      >
                        <Trash2 className="h-4 w-4 text-[#8a97ab]" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-[13px] text-[#aab6c8]">No ratings.</p>
        )}
        {dis.length ? (
          <p className="mt-2">
            <Pill tone="warn">Rater disagreement: {dis.join(" · ")}</Pill>
          </p>
        ) : null}
        <p className="mt-2 text-[12px] text-[#8a97ab]">
          No automated rating model is bundled, so no suggestions are generated. Atrophy and
          white-matter changes rise with age and are not disease-specific; interpret against
          age-specific references. No score is converted into a diagnosis. Reference images are not
          bundled (licensing). Sources:{" "}
          {Object.values(SCALE_CITE)
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((id) => CITATIONS.find((x) => x.id === id)!.text)
            .join(" · ")}
        </p>
      </Panel>

      <Panel
        title="Multimodal biomarkers"
        tag="entered"
        note="entered or imported with assay metadata — never inferred from MRI"
        actions={
          <button
            type="button"
            className="chip"
            onClick={() =>
              set((x) => ({
                ...x,
                biomarkers: [
                  ...x.biomarkers,
                  {
                    id: newId("b"),
                    modality: "plasma",
                    category: "tau",
                    analyte: "",
                    value: null,
                    unit: "",
                    date: new Date().toISOString().slice(0, 10),
                    method: "",
                    tracerOrAssay: "",
                    referenceRegion: null,
                    pipeline: null,
                    cutoff: null,
                    quality: "pending",
                    uncertainty: null,
                  },
                ],
              }))
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add biomarker
          </button>
        }
      >
        {!c.biomarkers.length ? (
          <p className="text-[13px] text-[#aab6c8]">
            No PET, CSF, blood, diffusion, perfusion or EEG biomarkers recorded. None is inferred.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {BiomarkerCategory.options.map((cat) => {
              const list = c.biomarkers.filter((b) => b.category === cat);
              if (!list.length) return null;
              return (
                <div key={cat} className="rounded border border-[#222b38] p-2">
                  <p className="mb-2 text-[13px] font-semibold capitalize text-[#e8eef8]">{cat}</p>
                  {list.map((b) => (
                    <div
                      key={b.id}
                      className="mb-2 grid gap-2 border-b border-[#222b38] pb-2 sm:grid-cols-3"
                    >
                      <Field label="Modality">
                        <Select
                          value={b.modality}
                          onChange={(v) => upB(b.id, { modality: v })}
                          options={
                            [
                              "amyloid-PET",
                              "tau-PET",
                              "FDG-PET",
                              "CSF",
                              "plasma",
                              "diffusion-MRI",
                              "perfusion",
                              "EEG",
                            ] as const
                          }
                        />
                      </Field>
                      <Field label="Category">
                        <Select
                          value={b.category}
                          onChange={(v) => upB(b.id, { category: v })}
                          options={BiomarkerCategory.options}
                        />
                      </Field>
                      <Field label="Analyte / measure">
                        <Text
                          value={b.analyte}
                          onChange={(v) => upB(b.id, { analyte: v })}
                          placeholder="e.g. p-tau217, Centiloid"
                        />
                      </Field>
                      <Field label="Value">
                        <Num value={b.value} onChange={(v) => upB(b.id, { value: v })} />
                      </Field>
                      <Field label="Unit">
                        <Text value={b.unit} onChange={(v) => upB(b.id, { unit: v })} />
                      </Field>
                      <Field label="Date">
                        <DateInput value={b.date} onChange={(v) => upB(b.id, { date: v })} />
                      </Field>
                      <Field label="Tracer / assay">
                        <Text
                          value={b.tracerOrAssay}
                          onChange={(v) => upB(b.id, { tracerOrAssay: v })}
                        />
                      </Field>
                      <Field label="Method / pipeline">
                        <Text value={b.method} onChange={(v) => upB(b.id, { method: v })} />
                      </Field>
                      <Field label="Reference region">
                        <Text
                          value={b.referenceRegion ?? ""}
                          onChange={(v) => upB(b.id, { referenceRegion: v || null })}
                        />
                      </Field>
                      <Field label="Cut-off (validated, modality-specific)">
                        <Num
                          value={b.cutoff?.value ?? null}
                          onChange={(v) =>
                            upB(b.id, {
                              cutoff:
                                v === null
                                  ? null
                                  : {
                                      value: v,
                                      direction: b.cutoff?.direction ?? "above",
                                      source: b.cutoff?.source ?? "",
                                    },
                            })
                          }
                        />
                      </Field>
                      <Field label="Cut-off source (required)">
                        <Text
                          value={b.cutoff?.source ?? ""}
                          onChange={(v) =>
                            b.cutoff && upB(b.id, { cutoff: { ...b.cutoff, source: v } })
                          }
                        />
                      </Field>
                      <Field label="Quality">
                        <Select
                          value={b.quality}
                          onChange={(v) => upB(b.id, { quality: v })}
                          options={["pending", "pass", "fail"] as const}
                        />
                      </Field>
                      <Field label="Uncertainty" wide>
                        <Text
                          value={b.uncertainty ?? ""}
                          onChange={(v) => upB(b.id, { uncertainty: v || null })}
                          placeholder="e.g. CV %, test–retest"
                        />
                      </Field>
                      <div className="flex items-end justify-between sm:col-span-3">
                        <span className="text-[12px] text-[#aab6c8]">
                          {b.quality === "fail" ? (
                            <Missing>Failed quality control</Missing>
                          ) : b.value === null ? (
                            <Missing>Not measured</Missing>
                          ) : b.cutoff && b.cutoff.source ? (
                            (
                              b.cutoff.direction === "above"
                                ? b.value >= b.cutoff.value
                                : b.value <= b.cutoff.value
                            ) ? (
                              `Value on the ${b.cutoff.direction === "above" ? "high" : "low"} side of the cut-off from ${b.cutoff.source}. Clinical correlation required.`
                            ) : (
                              `Value not beyond the cut-off from ${b.cutoff.source}.`
                            )
                          ) : (
                            "No validated cut-off entered — no comparison made."
                          )}
                        </span>
                        <button
                          type="button"
                          aria-label="Remove biomarker"
                          onClick={() =>
                            set((x) => ({
                              ...x,
                              biomarkers: x.biomarkers.filter((y) => y.id !== b.id),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4 text-[#8a97ab]" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[12px] text-[#8a97ab]">
          Amyloid, tau, neurodegeneration and vascular findings are shown separately and are never
          combined into an Alzheimer's score (framework:{" "}
          {CITATIONS.find((x) => x.id === "jack2018")!.text}).
        </p>
      </Panel>
    </div>
  );
}
