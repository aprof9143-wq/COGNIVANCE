import type { Plane } from "@/lib/imaging/geometry";
import type { Vec3 } from "@/lib/imaging/types";

export type Tool = "navigate" | "wl" | "pan" | "zoom" | "length" | "ellipse" | "probe" | "magnify";

/** A user annotation, stored in patient space so it survives zoom and pan. */
export type Annotation = {
  id: string;
  plane: Plane;
  kind: "length" | "ellipse" | "probe";
  points: Vec3[];
  /** Position of the slice it was drawn on, along the plane normal (mm). */
  slice: number;
};

export const TOOL_LABELS: Record<Tool, string> = {
  navigate: "Crosshair",
  wl: "Window/level",
  pan: "Pan",
  zoom: "Zoom",
  length: "Length",
  ellipse: "Ellipse ROI",
  probe: "Probe",
  magnify: "Magnify",
};
