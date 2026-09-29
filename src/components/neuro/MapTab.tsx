import { FileUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagingClient, readFiles } from "@/lib/imaging/client";
import {
  add,
  dot,
  PLANE_AXES,
  scale,
  sliceGeometry,
  throughPoint,
  volumeCentre,
  type Plane,
  type ViewState,
} from "@/lib/imaging/geometry";
import { NO_ENHANCEMENT } from "@/lib/imaging/display";
import type { ImageVolume, SegmentationVolume, Vec3, VoiWindow } from "@/lib/imaging/types";
import { defaultWindow, histogram } from "@/lib/imaging/voi";
import { region } from "@/lib/neuro/atlas";
import type { RegionRow } from "@/lib/neuro/results";
import { diverging, toCss } from "@/components/workstation/colormaps";
import { MprViewport } from "@/components/workstation/MprViewport";
import { Volume3D } from "@/components/workstation/Volume3D";
import { Panel, Pill, Tag } from "@/components/workstation/ui";

type Metric = "z" | "change";

/**
 * Regional values painted onto a subject's own parcellation. Nothing here is
 * computed from the image: colours come from the regional table, and a region
 * with no usable value is simply not coloured.
 */
export function MapTab({ rows }: { rows: RegionRow[] }) {
  const client = useRef<ImagingClient | null>(null);
  const [t1, setT1] = useState<ImageVolume | null>(null);
  const [parc, setParc] = useState<SegmentationVolume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("z");
  const [threshold, setThreshold] = useState(1);
  const [opacity, setOpacity] = useState(0.55);
  const [wmh, setWmh] = useState(false);
  const [win, setWin] = useState<VoiWindow | null>(null);
  const [views, setViews] = useState<Record<Plane, ViewState> | null>(null);
  const [cross, setCross] = useState<Vec3>([0, 0, 0]);
  const [focus, setFocus] = useState<Plane>("axial");
  const [fit, setFit] = useState(0);
  const t1Input = useRef<HTMLInputElement>(null);
  const parcInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    client.current = new ImagingClient();
    return () => client.current?.dispose();
  }, []);

  const loadT1 = async (files: File[]) => {
    if (!client.current) return;
    setBusy("Decoding image…");
    setError(null);
    try {
      const { nifti, series, failures } = await client.current.load(await readFiles(files));
      const vol = nifti ?? (series[0] ? await client.current.build(series[0].uid) : null);
      if (!vol) throw new Error(failures[0]?.message ?? "No image found.");
      setT1(vol);
      setWin(defaultWindow(vol, histogram(vol)));
      const c = volumeCentre(vol.ijkToLps, vol.dims);
      setViews({
        axial: { plane: "axial", focal: c, mmPerPixel: 1, pan: [0, 0] },
        coronal: { plane: "coronal", focal: c, mmPerPixel: 1, pan: [0, 0] },
        sagittal: { plane: "sagittal", focal: c, mmPerPixel: 1, pan: [0, 0] },
      });
      setCross(c);
      setFit((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const loadParc = async (f: File) => {
    if (!client.current) return;
    setBusy("Reading parcellation…");
    setError(null);
    try {
      setParc(
        await client.current.segmentation(
          { name: f.name, buffer: await f.arrayBuffer() },
          undefined,
          "FreeSurfer LUT",
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Value per atlas ID from the regional table.
  const values = useMemo(() => {
    const out = new Map<number, number>();
    for (const r of rows) {
      if (metric === "z" && r.metric !== "volume" && r.metric !== "thickness") continue;
      for (const s of [r.left, r.right, r.single]) {
        const m = s?.measurement;
        if (!m || !s) continue;
        if (metric === "z" && s.norm.state === "value") out.set(m.regionId, s.norm.z);
        if (
          metric === "change" &&
          s.change.state === "value" &&
          Number.isFinite(s.change.percentPerYear)
        )
          out.set(m.regionId, s.change.percentPerYear!);
      }
    }
    return out;
  }, [rows, metric]);

  const range = metric === "z" ? 3 : Math.max(1, ...[...values.values()].map(Math.abs));

  const { overlay, hiddenSet } = useMemo(() => {
    const hidden = new Set<number>();
    if (!parc) return { overlay: null as SegmentationVolume | null, hiddenSet: hidden };
    const classes = parc.classes.map((cl) => {
      if (cl.label === 77) {
        if (!wmh) hidden.add(cl.label);
        return {
          ...cl,
          name: "White-matter hypointensities (label)",
          colour: [240, 228, 66] as [number, number, number],
        };
      }
      const v = values.get(cl.label);
      if (v === undefined || Math.abs(v) < threshold) hidden.add(cl.label);
      const [r, g, b] = diverging((v ?? 0) / range);
      return {
        ...cl,
        name: region(cl.label)?.name ?? `Label ${cl.label}`,
        colour: [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)] as [
          number,
          number,
          number,
        ],
      };
    });
    return { overlay: { ...parc, classes }, hiddenSet: hidden };
  }, [parc, values, threshold, range, wmh]);

  const move = useCallback((p: Vec3) => {
    setCross(p);
    setViews((v) =>
      v
        ? {
            axial: throughPoint(v.axial, p),
            coronal: throughPoint(v.coronal, p),
            sagittal: throughPoint(v.sagittal, p),
          }
        : v,
    );
  }, []);

  const scroll = (p: Plane, steps: number) => {
    if (!t1) return;
    const n = PLANE_AXES[p].normal;
    const g = sliceGeometry(t1.ijkToLps, t1.dims, n);
    const t = Math.min(g.hi, Math.max(g.lo, dot(cross, n) + steps * g.step));
    move(add(cross, scale(n, t - dot(cross, n))));
  };

  const latest = rows[0]?.visit;
  const qc = rows
    .flatMap((r) => [r.left, r.right, r.single])
    .map((s) => s?.measurement?.qc.status)
    .filter(Boolean);
  const pending = qc.filter((q) => q === "pending").length;

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="3D neurodegeneration map"
        tag="derived"
        note="regional values on the subject's own parcellation"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={() => t1Input.current?.click()}>
            <FileUp className="h-4 w-4" /> T1 image (NIfTI / DICOM)
          </button>
          <button type="button" className="btn" onClick={() => parcInput.current?.click()}>
            <FileUp className="h-4 w-4" /> Parcellation (aparc+aseg NIfTI)
          </button>
          <input
            ref={t1Input}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void loadT1([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <input
            ref={parcInput}
            type="file"
            accept=".nii,.gz"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadParc(f);
              e.target.value = "";
            }}
          />
          {busy ? <Pill tone="info">{busy}</Pill> : null}
          {error ? <Pill tone="error">{error}</Pill> : null}
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-2 text-[12px] text-[#a9bbdc]">
            <p className="font-semibold text-[#c4d2ee]">Layers</p>
            <label className="flex items-center gap-2">
              <input type="radio" checked={metric === "z"} onChange={() => setMetric("z")} />{" "}
              Atrophy vs reference (z) <Tag kind="derived" />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={metric === "change"}
                onChange={() => setMetric("change")}
              />{" "}
              Longitudinal change (%/yr) <Tag kind="derived" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={wmh} onChange={(e) => setWmh(e.target.checked)} /> WMH
              label (77) from the parcellation <Tag kind="derived" />
            </label>
            {["Amyloid PET", "Tau PET", "FDG-PET", "EEG", "Segmentation uncertainty"].map((l) => (
              <label key={l} className="flex items-center gap-2 opacity-60">
                <input type="checkbox" disabled /> {l} — Unavailable (no registered data loaded)
              </label>
            ))}
            <label className="mt-2 flex flex-col gap-1">
              Show |{metric === "z" ? "z" : "%/yr"}| ≥ {threshold.toFixed(1)}
              <input
                type="range"
                min={0}
                max={metric === "z" ? 3 : range}
                step={0.1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              Opacity
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </label>
            <div className="mt-2">
              <div
                className="h-3 rounded"
                style={{
                  background: `linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1].map((x) => toCss(diverging(x))).join(",")})`,
                }}
              />
              <div className="mt-1 flex justify-between font-mono text-[11px]">
                <span>−{range.toFixed(1)}</span>
                <span>0</span>
                <span>+{range.toFixed(1)}</span>
              </div>
              <p className="mt-1">
                {metric === "z"
                  ? "z-score against a compatible reference (blue: smaller than reference)"
                  : "Annualised change, % per year (blue: loss)"}
                . Visit {latest?.date ?? "—"}. {values.size} regions with a usable value; others
                uncoloured.
                {pending ? ` ${pending} values await QC review.` : ""}
              </p>
            </div>
          </div>
          <div>
            {!t1 || !views || !win ? (
              <p className="grid h-80 place-items-center rounded border border-[#16305e] bg-black text-[13px] text-[#a9bbdc]">
                Load the subject's T1 and its parcellation (e.g. FreeSurfer aparc+aseg in the same
                space).
              </p>
            ) : (
              <div className="grid h-[34rem] grid-cols-2 grid-rows-2 gap-1 bg-[#16305e] p-px">
                {(["axial", "coronal", "sagittal"] as Plane[]).map((p) => (
                  <MprViewport
                    key={p}
                    plane={p}
                    volume={t1}
                    view={views[p]}
                    onView={(v) => setViews((cur) => (cur ? { ...cur, [p]: v } : cur))}
                    crosshair={cross}
                    onCrosshair={move}
                    showCrosshair
                    win={win}
                    onWindow={(w) => setWin({ ...w, source: "user", label: "User" })}
                    interpolation="linear"
                    enhancement={NO_ENHANCEMENT}
                    original
                    split={null}
                    overlay={
                      overlay
                        ? {
                            seg: overlay,
                            visible: true,
                            opacity,
                            outline: false,
                            hidden: hiddenSet,
                          }
                        : null
                    }
                    tool="navigate"
                    annotations={[]}
                    onAnnotate={() => {}}
                    onHover={() => {}}
                    focused={focus === p}
                    onFocus={() => setFocus(p)}
                    onScroll={(n) => scroll(p, n)}
                    fitNonce={fit}
                  />
                ))}
                <Volume3D
                  volume={t1}
                  win={win}
                  mode="composite"
                  opacity={0.35}
                  threshold={0.15}
                  clip={{ min: [-1e9, -1e9, -1e9], max: [1e9, 1e9, 1e9] }}
                  preset={{ name: "left", nonce: 0 }}
                  layers={{
                    segmentation: overlay
                      ? {
                          seg: overlay,
                          visible: true,
                          opacity: Math.min(1, opacity + 0.3),
                          hidden: hiddenSet,
                        }
                      : null,
                    tracts: null,
                    electrodes: null,
                    connections: null,
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-[#8095bf]">
          Regions are matched by FreeSurfer label ID. The parcellation must be in the T1's space;
          values come from the regional table (method, version and QC in the Evidence tab). Colour
          shows a regional measurement relative to the selected reference or over time — not
          disease. Finding is nonspecific; clinical correlation required.
        </p>
      </Panel>
    </div>
  );
}
