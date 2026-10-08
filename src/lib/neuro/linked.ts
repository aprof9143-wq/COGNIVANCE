/**
 * The link between the imaging/EEG pages and Neurodegeneration Tracking.
 *
 * Whatever is loaded in the research console or the diagnostic viewer is
 * summarised here — descriptive metadata and computed numbers only, never
 * pixels, file names or patient identifiers — and the tracking dashboard
 * merges it into the open case as it changes. Summaries live in this browser
 * (localStorage) so the dashboard is current in any tab; nothing is sent
 * anywhere. In a demo session (src/lib/session.ts) they are kept in memory
 * only: nothing is read from or written to storage.
 *
 * Every distinct scan and recording is remembered, so loading a second scan
 * adds a second visit and the longitudinal charts fill in by themselves.
 * Merged items carry ids starting with `linked-` and are rebuilt on every
 * update, so the dashboard never shows a stale copy of what is loaded.
 */

import { useSyncExternalStore } from "react";
import { isDemo } from "../session";
import { region, ATLAS } from "./atlas";
import type { Biomarker, CaseFile, RegionalMeasurement, Visit } from "./schema";

export type LinkOrigin = "console" | "viewer";
/** What the data is. Only "subject" is a person's data. */
export type LinkKind = "subject" | "template" | "phantom";

export type LinkedMri = {
  origin: LinkOrigin;
  kind: LinkKind;
  /** Non-identifying description, e.g. "Uploaded NIfTI volume". */
  label: string;
  /** Content hash of the voxel data, so two scans with equal headers stay apart. */
  fingerprint: string;
  dims: [number, number, number];
  spacingMm: [number, number, number];
  /** YYYY-MM when the file records it (DICOM), else null. */
  acquisitionMonth: string | null;
  manufacturer: string | null;
  model: string | null;
  fieldStrength: number | null;
  sequence: string | null;
  linkedAt: string;
};

export type LinkedSegmentation = {
  origin: LinkOrigin;
  label: string;
  /** Label convention the IDs follow; only FreeSurfer maps to atlas regions. */
  convention: string | null;
  /** How the labels were produced, for the provenance record. */
  method: string;
  classes: { label: number; name: string; mm3: number }[];
  linkedAt: string;
};

export type LinkedEegMarker = { id: string; name: string; value: number | null; unit: string };

/**
 * Marker values as the dashboard should store them: percentages as
 * percentages, non-finite as missing (null), never zero.
 */
export function toLinkedMarkers(
  markers: { id: string; name: string; value: number; unit: string }[],
): LinkedEegMarker[] {
  return markers.map((m) => ({
    id: m.id,
    name: m.name,
    value: Number.isFinite(m.value) ? (m.unit.startsWith("%") ? m.value * 100 : m.value) : null,
    unit: m.unit,
  }));
}

export type LinkedEeg = {
  origin: LinkOrigin;
  kind: LinkKind;
  label: string;
  channels: number;
  mapped: number;
  sampleRate: number;
  analysedSeconds: number;
  markers: LinkedEegMarker[];
  linkedAt: string;
};

/** One scan and the label map that belongs to it. */
export type LinkedScan = {
  key: string;
  mri: LinkedMri;
  segmentation: LinkedSegmentation | null;
  /** Scan date entered by the user when the file carries none. */
  date: string | null;
};

export type LinkedRecording = { key: string; eeg: LinkedEeg };

export type LinkedState = {
  /** What is on screen right now. */
  mri: LinkedMri | null;
  segmentation: LinkedSegmentation | null;
  eeg: LinkedEeg | null;
  /** Every distinct scan and recording loaded in this browser, oldest first. */
  scans: LinkedScan[];
  recordings: LinkedRecording[];
};

const KEY = "cognivance_linked_v2";
const MAX_HISTORY = 12;
const EMPTY: LinkedState = { mri: null, segmentation: null, eeg: null, scans: [], recordings: [] };

let state: LinkedState = EMPTY;
/** Which store `state` was loaded for; a change of session reloads it. */
let hydratedFor: "demo" | "local" | null = null;
const listeners = new Set<() => void>();

const parse = (raw: string | null): LinkedState => {
  if (!raw) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<LinkedState>) };
  } catch {
    return EMPTY;
  }
};

function hydrate() {
  if (typeof window === "undefined") return;
  const mode = isDemo() ? "demo" : "local";
  if (hydratedFor === mode) return;
  hydratedFor = mode;
  if (mode === "demo") {
    // A demo starts empty and never sees what a signed-in session saved.
    state = EMPTY;
    return;
  }
  try {
    state = parse(localStorage.getItem(KEY));
  } catch {
    state = EMPTY;
  }
}

function commit(next: LinkedState) {
  state = next;
  if (!isDemo()) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked: the in-memory link still works in this tab.
    }
  }
  for (const l of listeners) l();
}

export function getLinked(): LinkedState {
  hydrate();
  return state;
}

export const scanKey = (m: LinkedMri) =>
  [m.kind, m.fingerprint, m.dims.join("x"), m.acquisitionMonth ?? ""].join("|");

export const recordingKey = (e: LinkedEeg) =>
  [
    e.kind,
    e.channels,
    Math.round(e.analysedSeconds),
    e.markers.map((m) => (m.value === null ? "-" : m.value.toFixed(4))).join(","),
  ].join("|");

const upsert = <T extends { key: string }>(list: T[], item: T): T[] =>
  [...list.filter((x) => x.key !== item.key), item].slice(-MAX_HISTORY);

/** Pure state transition; exported for tests. */
export function reduceLinked(s: LinkedState, patch: Partial<LinkedState>): LinkedState {
  let next: LinkedState = { ...s, ...patch };
  if (patch.mri) {
    const key = scanKey(patch.mri);
    const prev = s.scans.find((x) => x.key === key);
    next = {
      ...next,
      // A label map belongs to the scan it was made from: switching scans
      // brings back that scan's own label map, or none.
      segmentation:
        "segmentation" in patch ? (patch.segmentation ?? null) : (prev?.segmentation ?? null),
      scans: upsert(s.scans, {
        key,
        mri: patch.mri,
        segmentation: prev?.segmentation ?? null,
        date: prev?.date ?? null,
      }),
    };
  }
  if ("segmentation" in patch && next.mri) {
    const key = scanKey(next.mri);
    next = {
      ...next,
      scans: next.scans.map((x) =>
        x.key === key ? { ...x, segmentation: patch.segmentation ?? null } : x,
      ),
    };
  }
  if (patch.eeg) {
    next = {
      ...next,
      recordings: upsert(s.recordings, { key: recordingKey(patch.eeg), eeg: patch.eeg }),
    };
  }
  return next;
}

export function setLinked(patch: Partial<LinkedState>) {
  hydrate();
  commit(reduceLinked(state, patch));
}

/** Set the scan date for a scan whose file carries none. */
export function setScanDate(key: string, date: string | null) {
  hydrate();
  commit({ ...state, scans: state.scans.map((x) => (x.key === key ? { ...x, date } : x)) });
}

/** Forget scans and recordings that are no longer on screen. */
export function clearLinkedHistory() {
  hydrate();
  const keep = (k: string) => state.mri && scanKey(state.mri) === k;
  commit({
    ...state,
    scans: state.scans.filter((x) => keep(x.key)),
    recordings: state.recordings.filter((x) => state.eeg && recordingKey(state.eeg) === x.key),
  });
}

/**
 * Link an MRI or EEG summary unless it would replace a subject's data with a
 * template or phantom that merely opened by default. `force` is for an
 * explicit user action such as "reset to demo data".
 */
export function offerLinked<K extends "mri" | "eeg">(
  key: K,
  value: NonNullable<LinkedState[K]>,
  force = false,
) {
  const cur = getLinked()[key];
  if (!force && value.kind !== "subject" && cur?.kind === "subject") return;
  setLinked({ [key]: value } as Partial<LinkedState>);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY || isDemo()) return;
    state = parse(e.newValue);
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Live view of what the imaging pages have loaded. */
export function useLinked(): LinkedState {
  return useSyncExternalStore(subscribe, getLinked, () => EMPTY);
}

/** Fingerprint shared by every page that shows the bundled template. */
export const TEMPLATE_FINGERPRINT = "mni152-icbm2009a-1.5mm";

/** A cheap, stable content hash over a strided sample of voxel values. */
export function fingerprint(data: ArrayLike<number>): string {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(data.length / 65536));
  for (let i = 0; i < data.length; i += step) {
    h ^= Math.round(Number(data[i]) * 16) & 0xffff;
    h = Math.imul(h, 16777619);
  }
  return `${data.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/* ------------------------------------------------------------- merging */

export const LINKED_PREFIX = "linked-";

const KIND_NOTE: Record<LinkKind, string> = {
  subject: "",
  template: "Population-average template — not a subject; values describe the template.",
  phantom: "SYNTHETIC PHANTOM — not a recording of a person.",
};

const day = (iso: string) => iso.slice(0, 10);
const shortHash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

export const visitIdFor = (scan: LinkedScan) => `${LINKED_PREFIX}visit-${shortHash(scan.key)}`;

/** The date a scan's visit gets, and where it came from. */
export function scanDate(scan: LinkedScan): {
  date: string;
  source: "entered" | "file" | "loaded";
} {
  if (scan.date) return { date: scan.date, source: "entered" };
  if (scan.mri.acquisitionMonth) return { date: `${scan.mri.acquisitionMonth}-01`, source: "file" };
  return { date: day(scan.mri.linkedAt), source: "loaded" };
}

export type LinkPlan = {
  /** Scans merged into the case as visits. */
  included: LinkedScan[];
  /** Scans left out, with the reason. */
  excluded: { scan: LinkedScan; reason: string }[];
  recordings: LinkedRecording[];
};

/**
 * Which scans and recordings go into the case. Template and phantom data are
 * used only while no subject data has been loaded, so demo data never mixes
 * with a person's. Two visits cannot share a date, so a scan whose date
 * collides with another is left out until the user gives it one.
 */
export function planLinked(l: LinkedState, userVisitDates: string[] = []): LinkPlan {
  const subjectScans = l.scans.filter((s) => s.mri.kind === "subject");
  const scans = subjectScans.length ? subjectScans : l.scans.slice(-1);
  const taken = new Set(userVisitDates.map((d) => Date.parse(d)));
  const included: LinkedScan[] = [];
  const excluded: LinkPlan["excluded"] = [];
  for (const s of [...scans].sort((a, b) => a.mri.linkedAt.localeCompare(b.mri.linkedAt))) {
    const t = Date.parse(scanDate(s).date);
    if (taken.has(t)) {
      excluded.push({
        scan: s,
        reason: `Shares the date ${scanDate(s).date} with another visit — enter its scan date.`,
      });
      continue;
    }
    taken.add(t);
    included.push(s);
  }
  const subjectRec = l.recordings.filter((r) => r.eeg.kind === "subject");
  return {
    included,
    excluded,
    recordings: subjectRec.length ? subjectRec : l.recordings.slice(-1),
  };
}

export function isFreeSurfer(convention: string | null): boolean {
  return !!convention && /freesurfer/i.test(convention);
}

/**
 * Rebuild every `linked-*` item in the case from what has been loaded. User
 * entries are untouched. A QC decision made on a linked measurement is kept
 * while the linked value is unchanged, and so are age and ICV entered on a
 * linked visit.
 */
export function applyLinked(c: CaseFile, l: LinkedState): CaseFile {
  const isLinked = (x: { id: string }) => x.id.startsWith(LINKED_PREFIX);
  const prevMeasurements = new Map(c.measurements.filter(isLinked).map((m) => [m.id, m]));
  const prevVisits = new Map(c.visits.filter(isLinked).map((v) => [v.id, v]));

  const visits = c.visits.filter((v) => !isLinked(v));
  const measurements = c.measurements.filter((m) => !isLinked(m));
  const biomarkers = c.biomarkers.filter((b) => !isLinked(b));

  const plan = planLinked(
    l,
    visits.map((v) => v.date),
  );

  for (const scan of plan.included) {
    const m = scan.mri;
    const id = visitIdFor(scan);
    const { date, source } = scanDate(scan);
    const prev = prevVisits.get(id);
    const notes = [
      `Linked from the ${m.origin === "console" ? "research console" : "diagnostic viewer"}: ${m.label}.`,
      source === "file"
        ? "Dated to the acquisition month; day not retained (identifier minimisation)."
        : source === "loaded"
          ? "No acquisition date in the file — dated the day it was loaded; enter the scan date for longitudinal change."
          : "Scan date entered by the user.",
      KIND_NOTE[m.kind],
    ]
      .filter(Boolean)
      .join(" ");
    const visit: Visit = {
      id,
      date,
      scanner: {
        manufacturer: m.manufacturer,
        model: m.model,
        fieldStrength: m.fieldStrength,
      },
      sequence: m.sequence,
      voxelSize: m.spacingMm.map((s) => s.toFixed(2)).join(" × ") + " mm",
      icvMm3: prev?.icvMm3 ?? null,
      ageYears: prev?.ageYears ?? null,
      notes,
    };
    visits.push(visit);

    const seg = scan.segmentation;
    if (!seg || !isFreeSurfer(seg.convention)) continue;
    for (const k of seg.classes) {
      const r = region(k.label);
      if (!r) continue;
      const mid = `${LINKED_PREFIX}seg-${shortHash(scan.key)}-${k.label}`;
      const value = Math.round(k.mm3 * 10) / 10;
      const prevM = prevMeasurements.get(mid);
      const measurement: RegionalMeasurement = {
        id: mid,
        visitId: id,
        atlas: ATLAS,
        regionId: r.id,
        regionName: r.name,
        hemisphere: r.hemisphere,
        metric: "volume",
        value,
        unit: "mm3",
        status: "measured",
        evidence: "algorithm-derived",
        provenance: {
          software: "Cognivance (voxel count of linked label map)",
          version: "1",
          model: null,
          atlas: "FreeSurfer colour LUT label IDs",
          parameters: "voxel count × voxel volume on the label map's own grid",
          date: day(seg.linkedAt),
          source: `${seg.label} — ${seg.method}`,
        },
        qc:
          prevM && prevM.value === value
            ? prevM.qc
            : { status: "pending", reviewer: null, date: null, notes: "" },
      };
      measurements.push(measurement);
    }
  }

  for (const rec of plan.recordings) {
    const e = rec.eeg;
    for (const mk of e.markers) {
      const b: Biomarker = {
        id: `${LINKED_PREFIX}eeg-${shortHash(rec.key)}-${mk.id}`,
        modality: "EEG",
        category: "nonspecific",
        analyte: mk.name,
        value: mk.value !== null && Number.isFinite(mk.value) ? mk.value : null,
        unit: mk.unit,
        date: day(e.linkedAt),
        method: `Welch PSD (Hann, 50% overlap) over ${Math.round(e.analysedSeconds)} s, ${e.mapped} 10-20 channels at ${Math.round(e.sampleRate)} Hz`,
        tracerOrAssay: e.kind === "subject" ? e.label : `${e.label} — ${KIND_NOTE[e.kind]}`,
        referenceRegion: null,
        pipeline: `Linked from the ${e.origin === "console" ? "research console" : "diagnostic viewer"}`,
        cutoff: null,
        quality: "pending",
        uncertainty:
          "No validated cut-off; EEG slowing is nonspecific (medication, sleepiness, other encephalopathies).",
      };
      biomarkers.push(b);
    }
  }

  return { ...c, visits, measurements, biomarkers };
}
