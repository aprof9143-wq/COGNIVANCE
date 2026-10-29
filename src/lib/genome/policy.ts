/**
 * Source governance: may this source be fetched, stored, displayed or
 * redistributed, for which purpose? One function answers every question, so
 * the capture tool, the display builder, the loaders and the UI ask the same
 * thing and get the same answer (tools/vision-snapshot/policy.py reads the
 * same fields of config/genome/licences.json).
 *
 * Fail closed. An action is allowed only when the inventory records "allowed"
 * for it. Unknown sources, missing entries, "pending-review", "unknown",
 * "denied" and a blocked app use all deny.
 *
 * Purposes are kept apart:
 *   research          research and demo use, on the permissions recorded
 *   commercial-pilot  also needs commercialPilot: approved (none is)
 *   clinical          also needs clinicalUse: approved and the release gate
 *                     (release.ts); nothing meets either, so it always denies
 *
 * A decision is a record of what the inventory says. It is not a legal
 * conclusion.
 */

import { LICENCES, type LicenceItem, type Licences, type Permission } from "./config";
import { clinicalModeAvailability, RELEASE_GATE, type ReleaseGate } from "./release";

export const DATA_ACTIONS = ["fetch", "store", "display", "redistribute"] as const;
export type DataAction = (typeof DATA_ACTIONS)[number];
export const PURPOSES = ["research", "commercial-pilot", "clinical"] as const;
export type Purpose = (typeof PURPOSES)[number];

export type Decision = {
  sourceId: string;
  action: DataAction;
  purpose: Purpose;
  allowed: boolean;
  /** The recorded permission for research use, or why there is none. */
  recorded: Permission | "not-a-data-source" | "not-in-inventory";
  /** Plain language, safe to show to a user. */
  reason: string;
};

type Ctx = { licences?: Licences; gate?: ReleaseGate };

function find(id: string, licences: Licences): LicenceItem | undefined {
  return licences.items.find((i) => i.id === id);
}

/** Decide one action on one source for one purpose. */
export function decide(
  sourceId: string,
  action: DataAction,
  purpose: Purpose = "research",
  { licences = LICENCES, gate = RELEASE_GATE }: Ctx = {},
): Decision {
  const base = { sourceId, action, purpose };
  const item = find(sourceId, licences);
  if (!item)
    return {
      ...base,
      allowed: false,
      recorded: "not-in-inventory",
      reason: `${sourceId} is not in the licence inventory, so nothing may be done with it.`,
    };
  const perms = item.kind === "data-source" && item.used ? item.permissions : undefined;
  if (!perms)
    return {
      ...base,
      allowed: false,
      recorded: "not-a-data-source",
      reason: `${item.name} has no recorded data permissions, so it may not be ${action === "fetch" ? "fetched" : action === "store" ? "stored" : action === "display" ? "displayed" : "redistributed"}.`,
    };
  const recorded = perms.research[action];
  const deny = (reason: string): Decision => ({ ...base, allowed: false, recorded, reason });

  if (item.appUse === "blocked")
    return deny(item.appUseCondition ?? `${item.name} is blocked for this app.`);
  if (recorded !== "allowed")
    return deny(
      recorded === "pending-review"
        ? `${item.name}: ${action} is pending review, so it is not permitted yet.`
        : `${item.name}: ${action} is ${recorded === "denied" ? "not permitted" : "not decided"}.`,
    );
  if (purpose === "commercial-pilot" && item.commercialPilot !== "approved")
    return deny(
      `${item.name} is not approved for commercial-pilot use (review status: ${item.reviewStatus}).`,
    );
  if (purpose === "clinical") {
    if (item.clinicalUse !== "approved")
      return deny(`${item.name} is not approved for any clinical use.`);
    if (!clinicalModeAvailability(gate).available)
      return deny("Clinical mode is unavailable: the release gate's evidence is not in place.");
  }
  return {
    ...base,
    allowed: true,
    recorded,
    reason: `${item.name}: ${action} permitted for ${purpose} use.`,
  };
}

export const allowed = (
  sourceId: string,
  action: DataAction,
  purpose: Purpose = "research",
  ctx: Ctx = {},
) => decide(sourceId, action, purpose, ctx).allowed;

/** Throw unless permitted: for code paths that must not continue. */
export function assertAllowed(
  sourceId: string,
  action: DataAction,
  purpose: Purpose = "research",
  ctx: Ctx = {},
): void {
  const d = decide(sourceId, action, purpose, ctx);
  if (!d.allowed) throw new PolicyError(d);
}

export class PolicyError extends Error {
  constructor(readonly decision: Decision) {
    super(decision.reason);
    this.name = "PolicyError";
  }
}

/** Every decision for one source, for status displays and the docs. */
export function decisionMatrix(sourceId: string, ctx: Ctx = {}) {
  return PURPOSES.map((purpose) => ({
    purpose,
    actions: DATA_ACTIONS.map((action) => decide(sourceId, action, purpose, ctx)),
  }));
}

/** The data sources whose content is withheld from display for research use, with why. */
export function withheldSources({ licences = LICENCES }: Ctx = {}) {
  return licences.items
    .filter((i) => i.kind === "data-source" && i.used)
    .map((i) => decide(i.id, "display", "research", { licences }))
    .filter((d) => !d.allowed)
    .map((d) => ({ id: d.sourceId, name: find(d.sourceId, licences)!.name, reason: d.reason }));
}
