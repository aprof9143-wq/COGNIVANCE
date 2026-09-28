import { Plus, Trash2 } from "lucide-react";
import {
  INSTRUMENTS,
  SymptomDomain,
  type CaseFile,
  type CognitiveAssessment,
  type Symptom,
} from "@/lib/neuro/schema";
import { DOMAIN_LABEL } from "@/lib/neuro/symptomMap";
import { Panel } from "@/components/workstation/ui";
import { DateInput, Field, Num, Select, Text } from "./forms";
import { newId } from "@/lib/neuro/ids";

type Props = { c: CaseFile; set: (f: (c: CaseFile) => CaseFile) => void };

/**
 * Symptoms and cognitive assessments. Subjective reports, clinician
 * observations and test scores are recorded as different evidence types and
 * never merged. No cut-off is applied to any score: interpretation depends on
 * age, education, language, culture and sensory limitations, and on each
 * instrument's own norms.
 */
export function ClinicalTab({ c, set }: Props) {
  const upSym = (id: string, patch: Partial<Symptom>) =>
    set((x) => ({ ...x, symptoms: x.symptoms.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const upAss = (id: string, patch: Partial<CognitiveAssessment>) =>
    set((x) => ({
      ...x,
      assessments: x.assessments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Subject" tag="entered" note="pseudonymous — never enter a name">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Study code">
            <Text value={c.subjectCode} onChange={(v) => set((x) => ({ ...x, subjectCode: v }))} />
          </Field>
          <Field label="Sex (for sex-specific norms only)">
            <Select
              value={c.sex}
              onChange={(v) => set((x) => ({ ...x, sex: v }))}
              options={["unknown", "female", "male"] as const}
            />
          </Field>
          <Field label="Education (years)">
            <Num
              value={c.educationYears}
              onChange={(v) => set((x) => ({ ...x, educationYears: v }))}
            />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Symptoms"
        tag="entered"
        note="patient / informant reports and clinician observations are separate evidence"
        actions={
          <button
            type="button"
            className="chip"
            onClick={() =>
              set((x) => ({
                ...x,
                symptoms: [
                  ...x.symptoms,
                  {
                    id: newId("s"),
                    domain: "episodic-memory",
                    present: true,
                    laterality: "n/a",
                    severity: null,
                    onset: null,
                    progression: "unknown",
                    confidence: "medium",
                    source: "informant",
                    notes: "",
                  },
                ],
              }))
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add symptom
          </button>
        }
      >
        {!c.symptoms.length ? (
          <p className="text-[13px] text-[#aab6c8]">No symptoms recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-[12px]">
              <thead className="text-left text-[#8a97ab]">
                <tr>
                  {[
                    "Domain",
                    "Present",
                    "Source (evidence type)",
                    "Laterality",
                    "Severity",
                    "Onset",
                    "Progression",
                    "Confidence",
                    "Notes",
                    "",
                  ].map((h) => (
                    <th key={h} className="px-1 pb-1 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.symptoms.map((s) => (
                  <tr key={s.id} className="border-t border-[#222b38] align-top">
                    <td className="p-1">
                      <Select
                        value={s.domain}
                        onChange={(v) => upSym(s.id, { domain: v })}
                        options={SymptomDomain.options.map(
                          (d) => [d, DOMAIN_LABEL[d]] as [typeof d, string],
                        )}
                      />
                    </td>
                    <td className="p-1">
                      <Select
                        value={s.present === null ? "unknown" : s.present ? "yes" : "no"}
                        onChange={(v) =>
                          upSym(s.id, { present: v === "unknown" ? null : v === "yes" })
                        }
                        options={["yes", "no", "unknown"] as const}
                      />
                    </td>
                    <td className="p-1">
                      <Select
                        value={s.source}
                        onChange={(v) => upSym(s.id, { source: v })}
                        options={
                          [
                            ["patient", "Patient report (subjective)"],
                            ["informant", "Informant report (subjective)"],
                            ["clinician", "Clinician observation"],
                          ] as const
                        }
                      />
                    </td>
                    <td className="p-1">
                      <Select
                        value={s.laterality}
                        onChange={(v) => upSym(s.id, { laterality: v })}
                        options={["n/a", "left", "right", "bilateral"] as const}
                      />
                    </td>
                    <td className="p-1">
                      <Select
                        value={s.severity ?? "unrated"}
                        onChange={(v) => upSym(s.id, { severity: v === "unrated" ? null : v })}
                        options={["unrated", "mild", "moderate", "severe"] as const}
                      />
                    </td>
                    <td className="p-1">
                      <DateInput
                        value={s.onset}
                        onChange={(v) => upSym(s.id, { onset: v || null })}
                      />
                    </td>
                    <td className="p-1">
                      <Select
                        value={s.progression}
                        onChange={(v) => upSym(s.id, { progression: v })}
                        options={
                          ["unknown", "stable", "progressive", "fluctuating", "improving"] as const
                        }
                      />
                    </td>
                    <td className="p-1">
                      <Select
                        value={s.confidence}
                        onChange={(v) => upSym(s.id, { confidence: v })}
                        options={["low", "medium", "high"] as const}
                      />
                    </td>
                    <td className="p-1">
                      <Text value={s.notes} onChange={(v) => upSym(s.id, { notes: v })} />
                    </td>
                    <td className="p-1">
                      <button
                        type="button"
                        aria-label="Remove symptom"
                        onClick={() =>
                          set((x) => ({ ...x, symptoms: x.symptoms.filter((y) => y.id !== s.id) }))
                        }
                      >
                        <Trash2 className="h-4 w-4 text-[#8a97ab] hover:text-[#f2a7a7]" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Cognitive assessments"
        tag="entered"
        note="no cut-offs applied; scores are not converted between instruments"
        actions={
          <button
            type="button"
            className="chip"
            onClick={() =>
              set((x) => ({
                ...x,
                assessments: [
                  ...x.assessments,
                  {
                    id: newId("a"),
                    instrument: "MoCA",
                    version: "",
                    rawScore: null,
                    adjustedScore: null,
                    adjustment: "",
                    maxScore: null,
                    higherIsBetter: null,
                    date: new Date().toISOString().slice(0, 10),
                    language: "",
                    examiner: "",
                    normativeReference: null,
                    notes: "",
                  },
                ],
              }))
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add assessment
          </button>
        }
      >
        {!c.assessments.length ? (
          <p className="text-[13px] text-[#aab6c8]">No assessments recorded.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {c.assessments.map((a) => (
              <div
                key={a.id}
                className="grid gap-2 rounded border border-[#222b38] p-2 sm:grid-cols-4 lg:grid-cols-6"
              >
                <Field label="Instrument">
                  <Select
                    value={a.instrument}
                    onChange={(v) => upAss(a.id, { instrument: v })}
                    options={INSTRUMENTS}
                  />
                </Field>
                <Field label="Version (required)">
                  <Text
                    value={a.version}
                    onChange={(v) => upAss(a.id, { version: v })}
                    placeholder="e.g. 8.1, ADAS-Cog-13"
                  />
                </Field>
                <Field label="Raw score">
                  <Num value={a.rawScore} onChange={(v) => upAss(a.id, { rawScore: v })} />
                </Field>
                <Field label="Adjusted score">
                  <Num
                    value={a.adjustedScore}
                    onChange={(v) => upAss(a.id, { adjustedScore: v })}
                  />
                </Field>
                <Field label="Maximum (this version)">
                  <Num value={a.maxScore} onChange={(v) => upAss(a.id, { maxScore: v })} />
                </Field>
                <Field label="Higher is">
                  <Select
                    value={
                      a.higherIsBetter === null
                        ? "unspecified"
                        : a.higherIsBetter
                          ? "better"
                          : "worse"
                    }
                    onChange={(v) =>
                      upAss(a.id, { higherIsBetter: v === "unspecified" ? null : v === "better" })
                    }
                    options={["unspecified", "better", "worse"] as const}
                  />
                </Field>
                <Field label="Date">
                  <DateInput value={a.date} onChange={(v) => upAss(a.id, { date: v })} />
                </Field>
                <Field label="Language">
                  <Text value={a.language} onChange={(v) => upAss(a.id, { language: v })} />
                </Field>
                <Field label="Examiner">
                  <Text
                    value={a.examiner}
                    onChange={(v) => upAss(a.id, { examiner: v })}
                    placeholder="role or code"
                  />
                </Field>
                <Field label="Adjustment applied">
                  <Text
                    value={a.adjustment}
                    onChange={(v) => upAss(a.id, { adjustment: v })}
                    placeholder="per the instrument, if any"
                  />
                </Field>
                <Field label="Normative reference">
                  <Text
                    value={a.normativeReference ?? ""}
                    onChange={(v) => upAss(a.id, { normativeReference: v || null })}
                    placeholder="source of norms used"
                  />
                </Field>
                <div className="flex items-end justify-between gap-2">
                  <Field label="Notes">
                    <Text value={a.notes} onChange={(v) => upAss(a.id, { notes: v })} />
                  </Field>
                  <button
                    type="button"
                    aria-label="Remove assessment"
                    className="pb-2"
                    onClick={() =>
                      set((x) => ({
                        ...x,
                        assessments: x.assessments.filter((y) => y.id !== a.id),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-[#8a97ab] hover:text-[#f2a7a7]" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[12px] text-[#8a97ab]">
          Interpretation must account for age, education, language, culture and sensory limitations,
          using the instrument's own norms. This module applies no universal cut-off.
        </p>
      </Panel>
    </div>
  );
}
