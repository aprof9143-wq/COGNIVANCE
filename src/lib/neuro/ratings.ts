import type { VisualRating } from "./schema";

/** Two clinician ratings of the same scale, visit and side that differ. */
export function disagreements(ratings: VisualRating[]): string[] {
  const groups = new Map<string, VisualRating[]>();
  for (const r of ratings.filter((x) => x.kind === "clinician")) {
    const k = `${r.visitId}|${r.scale}|${r.hemisphere}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: string[] = [];
  for (const list of groups.values()) {
    const scores = new Set(list.map((r) => r.score));
    if (scores.size > 1)
      out.push(
        `${list[0]!.scale} ${list[0]!.hemisphere}: ${list.map((r) => `${r.rater || "?"} ${r.score}`).join(" vs ")}`,
      );
  }
  return out;
}
