import { Plus, Trash2 } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { region } from "@/lib/neuro/atlas";
import { orderVisits, usable } from "@/lib/neuro/calc";
import type { CaseFile, RegionalMeasurement } from "@/lib/neuro/schema";
import { SERIES } from "@/components/workstation/colormaps";
import { Panel } from "@/components/workstation/ui";
import { DateInput, Select, Text } from "./forms";
import { newId } from "@/lib/neuro/ids";

type Props = { c: CaseFile; set: (f: (c: CaseFile) => CaseFile) => void };

const INK = {
  primary: "#e6efff",
  secondary: "#a9bbdc",
  muted: "#8095bf",
  grid: "#0e2247",
  axis: "#16305e",
  surface: "#04102b",
};

const t = (d: string) => Date.parse(d);
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * One measure per chart — never two y-scales. Left is always blue and right
 * always orange. Acquisition dates and recorded events are drawn as vertical
 * markers; points that failed QC or were not measured are gaps, not zeros.
 */
export function LongitudinalTab({ c, set }: Props) {
  let visits: CaseFile["visits"] = [];
  try {
    visits = orderVisits(c.visits);
  } catch {
    visits = [];
  }

  const series = (key: string, metric: RegionalMeasurement["metric"]) =>
    visits.map((v) => {
      const row: Record<string, number | null> = { t: t(v.date) };
      for (const side of ["left", "right"] as const) {
        const m = c.measurements.find(
          (x) =>
            x.visitId === v.id &&
            x.metric === metric &&
            region(x.regionId)?.key === key &&
            region(x.regionId)?.hemisphere === side,
        );
        const u = usable(m);
        row[side] = u.state === "value" ? u.value : null;
      }
      return row;
    });

  const charts: {
    title: string;
    key: string;
    metric: RegionalMeasurement["metric"];
    unit: string;
  }[] = [
    { title: "Hippocampal volume", key: "hippocampus", metric: "volume", unit: "mm³" },
    { title: "Entorhinal cortical thickness", key: "entorhinal", metric: "thickness", unit: "mm" },
    {
      title: "Lateral ventricular volume",
      key: "lateral-ventricle",
      metric: "volume",
      unit: "mm³",
    },
    { title: "Precuneus cortical thickness", key: "precuneus", metric: "thickness", unit: "mm" },
  ];

  const instruments = [...new Set(c.assessments.map((a) => `${a.instrument} ${a.version}`.trim()))];
  const markers = [
    ...visits.map((v) => ({ x: t(v.date), label: "MRI", colour: INK.axis })),
    ...c.events.map((e) => ({
      x: t(e.date),
      label: e.label,
      colour: e.kind === "treatment" ? SERIES.third : "#5e719a",
    })),
  ];

  const chart = (
    title: string,
    data: Record<string, number | null>[],
    lines: { key: string; name: string; colour: string }[],
    unit: string,
  ) => {
    const has = data.some((d) => lines.some((l) => d[l.key] !== null && d[l.key] !== undefined));
    return (
      <Panel key={title} title={title} tag={lines.length > 1 ? "derived" : "entered"} note={unit}>
        {!has ? (
          <p className="py-6 text-center text-[13px] text-[#a9bbdc]">
            Insufficient data — no usable values.
          </p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 24, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin - 2592000000", "dataMax + 2592000000"]}
                  tickFormatter={fmtDate}
                  stroke={INK.axis}
                  tick={{ fill: INK.muted, fontSize: 11 }}
                />
                <YAxis
                  stroke={INK.axis}
                  tick={{ fill: INK.muted, fontSize: 11 }}
                  width={56}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={{
                    background: INK.surface,
                    border: "1px solid #1e3a6e",
                    fontSize: 12,
                  }}
                  labelStyle={{ color: INK.secondary }}
                  itemStyle={{ color: INK.primary }}
                  labelFormatter={(v) => fmtDate(Number(v))}
                  formatter={(v: number, name: string) => [
                    `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`,
                    name,
                  ]}
                />
                {markers.map((m, i) => (
                  <ReferenceLine
                    key={i}
                    x={m.x}
                    stroke={m.colour}
                    strokeDasharray="3 3"
                    label={{ value: m.label, position: "top", fill: INK.muted, fontSize: 10 }}
                  />
                ))}
                {lines.map((l) => (
                  <Line
                    key={l.key}
                    dataKey={l.key}
                    name={l.name}
                    stroke={l.colour}
                    strokeWidth={2}
                    connectNulls={false}
                    dot={{ r: 4, fill: l.colour, stroke: INK.surface, strokeWidth: 2 }}
                    activeDot={{ r: 5, stroke: INK.surface, strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                ))}
                {lines.length > 1 ? (
                  <Legend wrapperStyle={{ fontSize: 12, color: INK.secondary }} />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 xl:grid-cols-2">
        {charts.map((ch) =>
          chart(
            ch.title,
            series(ch.key, ch.metric),
            [
              { key: "left", name: "Left", colour: SERIES.left },
              { key: "right", name: "Right", colour: SERIES.right },
            ],
            ch.unit,
          ),
        )}
        {instruments.map((ins) => {
          const data = c.assessments
            .filter((a) => `${a.instrument} ${a.version}`.trim() === ins)
            .sort((a, b) => t(a.date) - t(b.date))
            .map((a) => ({ t: t(a.date), score: a.adjustedScore ?? a.rawScore }));
          return chart(
            `${ins} (cognitive score)`,
            data,
            [{ key: "score", name: ins, colour: SERIES.third }],
            "points",
          );
        })}
      </div>
      <p className="text-[12px] text-[#8095bf]">
        Longitudinal structural change. Whole-brain and other regional series appear when those
        measurements are imported. Changes across scanner or protocol changes (see the Imaging tab
        warnings) may not be biological.
      </p>

      <Panel
        title="Events"
        tag="entered"
        note="treatments and other events shown on every chart"
        actions={
          <button
            type="button"
            className="chip"
            onClick={() =>
              set((x) => ({
                ...x,
                events: [
                  ...x.events,
                  {
                    id: newId("e"),
                    date: new Date().toISOString().slice(0, 10),
                    label: "",
                    kind: "treatment",
                  },
                ],
              }))
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add event
          </button>
        }
      >
        {!c.events.length ? (
          <p className="text-[13px] text-[#a9bbdc]">No events.</p>
        ) : (
          c.events.map((e) => (
            <div
              key={e.id}
              className="mb-1 grid grid-cols-[10rem_10rem_minmax(0,1fr)_auto] items-center gap-2"
            >
              <DateInput
                value={e.date}
                onChange={(v) =>
                  set((x) => ({
                    ...x,
                    events: x.events.map((y) => (y.id === e.id ? { ...y, date: v } : y)),
                  }))
                }
              />
              <Select
                value={e.kind}
                onChange={(v) =>
                  set((x) => ({
                    ...x,
                    events: x.events.map((y) => (y.id === e.id ? { ...y, kind: v } : y)),
                  }))
                }
                options={["treatment", "event", "scanner-change", "other"] as const}
              />
              <Text
                value={e.label}
                onChange={(v) =>
                  set((x) => ({
                    ...x,
                    events: x.events.map((y) => (y.id === e.id ? { ...y, label: v } : y)),
                  }))
                }
                placeholder="label"
              />
              <button
                type="button"
                aria-label="Remove event"
                onClick={() =>
                  set((x) => ({ ...x, events: x.events.filter((y) => y.id !== e.id) }))
                }
              >
                <Trash2 className="h-4 w-4 text-[#8095bf]" />
              </button>
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}
