/**
 * The link between the imaging/EEG pages and Neurodegeneration Tracking.
 *
 * Whatever is loaded in the research console or the diagnostic viewer is
 * summarised here — descriptive metadata and computed numbers only, never
 * pixels, file names or patient identifiers — and the tracking dashboard
 * merges it into the open case as it changes. Summaries live in this browser
 * (localStorage) so the dashboard is current in any tab; nothing is sent
 * anywhere.
 *
 * Merged items carry ids starting with `linked-` and are replaced on every
 * update, so the dashboard never shows a stale copy of what is loaded.
 */

import { useSyncExternalStore } from "react";
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
  /** Label convention the IDs follow; only "FreeSurfer" maps to atlas regions. */
  convention: string | null;
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

export type LinkedState = {
  mri: LinkedMri | null;
  segmentation: LinkedSegmentation | null;
  eeg: LinkedEeg | null;
};

const KEY = "cognivance_linked_v1";
const EMPTY: LinkedState = { mri: null, segmentation: null, eeg: null };

let state: LinkedState = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...EMPTY, ...(JSON.parse(raw) as Partial<LinkedState>) };
  } catch {
    state = EMPTY;
  }
}

function emit() {
  for (const l of listeners) l();
}

export function getLinked(): LinkedState {
  hydrate();
  return state;
}

export function setLinked(patch: Partial<LinkedState>) {
  hydrate();
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the in-memory link still works in this tab.
  }
  emit();
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
    if (e.key !== KEY) return;
    try {
      state = e.newValue
        ? { ...EMPTY, ...(JSON.parse(e.newValue) as Partial<LinkedState>) }
        : EMPTY;
    } catch {
      state = EMPTY;
    }
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

/* ------------------------------------------------------------- merging */

export const LINKED_PREFIX = "linked-";
export const LINKED_VISIT = "linked-visit";

const KIND_NOTE: Record<LinkKind, string> = {
  subject: "",
  template: "Population-average template — not a subject; values describe the template.",
  phantom: "SYNTHETIC PHANTOM — not a recording of a person.",
};

const day = (iso: string) => iso.slice(0, 10);

/**
 * Replace every `linked-*` item in the case with what is loaded now. User
 * entries are untouched. A QC decision made on a linked measurement is kept
 * while the linked value is unchanged.
 */
export function applyLinked(c: CaseFile, l: LinkedState): CaseFile {
  const isLinked = (x: { id: string }) => x.id.startsWith(LINKED_PREFIX);
  const prevMeasurements = new Map(c.measurements.filter(isLinked).map((m) => [m.id, m]));

  const visits = c.visits.filter((v) => !isLinked(v));
  const measurements = c.measurements.filter((m) => !isLinked(m));
  const biomarkers = c.biomarkers.filter((b) => !isLinked(b));

  const segClasses =
    l.segmentation && isFreeSurfer(l.segmentation.convention)
      ? l.segmentation.classes.filter((k) => region(k.label))
      : [];

  if (l.mri || segClasses.length) {
    const m = l.mri;
    const date = m?.acquisitionMonth
      ? `${m.acquisitionMonth}-01`
      : day(m?.linkedAt ?? l.segmentation!.linkedAt);
    const notes = [
      m
        ? `Linked from the ${m.origin === "console" ? "research console" : "diagnostic viewer"}: ${m.label}.`
        : "",
      m?.acquisitionMonth
        ? "Day of month not retained (identifier minimisation)."
        : "No acquisition date in the file — dated the day it was loaded.",
      m ? KIND_NOTE[m.kind] : "",
    ]
      .filter(Boolean)
      .join(" ");
    const visit: Visit = {
      id: LINKED_VISIT,
      date,
      scanner: {
        manufacturer: m?.manufacturer ?? null,
        model: m?.model ?? null,
        fieldStrength: m?.fieldStrength ?? null,
      },
      sequence: m?.sequence ?? null,
      voxelSize: m ? m.spacingMm.map((s) => s.toFixed(2)).join(" × ") + " mm" : null,
      icvMm3: null,
      ageYears: null,
      notes,
    };
    visits.push(visit);
  }

  for (const k of segClasses) {
    const r = region(k.label)!;
    const id = `${LINKED_PREFIX}seg-${k.label}`;
    const value = Math.round(k.mm3 * 10) / 10;
    const prev = prevMeasurements.get(id);
    const m: RegionalMeasurement = {
      id,
      visitId: LINKED_VISIT,
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
        software: "Cognivance viewer (voxel count of loaded label map)",
        version: "1",
        model: null,
        atlas: "FreeSurfer colour LUT label IDs",
        parameters: "voxel count × voxel volume on the label map's native grid",
        date: day(l.segmentation!.linkedAt),
        source: l.segmentation!.label,
      },
      qc:
        prev && prev.value === value
          ? prev.qc
          : { status: "pending", reviewer: null, date: null, notes: "" },
    };
    measurements.push(m);
  }

  if (l.eeg) {
    const e = l.eeg;
    for (const mk of e.markers) {
      const b: Biomarker = {
        id: `${LINKED_PREFIX}eeg-${mk.id}`,
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

export function isFreeSurfer(convention: string | null): boolean {
  return !!convention && /freesurfer/i.test(convention);
}
