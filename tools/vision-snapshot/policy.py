"""Source policy for the Python tools: may a source be fetched or stored?

Reads the same fields of config/genome/licences.json as src/lib/genome/policy.ts
and applies the same rules, fail closed: an action is permitted only when the
inventory records "allowed" for it. Unknown items, missing permissions,
"pending-review", "unknown", "denied" and a blocked app use all refuse. In
commercial-pilot mode the item must also be commercialPilot: approved.
Clinical use is not a mode these tools offer.

Standard library only. A decision records what the inventory says; it is not a
legal conclusion.
"""

from __future__ import annotations

MODES = ("research", "commercial-pilot")
ACTIONS = ("fetch", "store", "display", "redistribute")


def permitted(licences: dict, licence_id: str, action: str, mode: str = "research") -> tuple[bool, str]:
    """(permitted, reason). The reason is empty when permitted."""
    if action not in ACTIONS:
        return False, f"Unknown action {action!r}."
    if mode not in MODES:
        return False, f"Unknown mode {mode!r}."
    item = next((i for i in licences.get("items", []) if i.get("id") == licence_id), None)
    if item is None:
        return False, f"{licence_id} is not in the licence inventory."
    name = item.get("name", licence_id)
    perms = item.get("permissions") if item.get("kind") == "data-source" and item.get("used") else None
    if not perms:
        return False, f"{name} has no recorded data permissions."
    if item.get("appUse") == "blocked":
        return False, item.get("appUseCondition") or f"{name} is blocked for the app."
    recorded = perms.get("research", {}).get(action)
    if recorded != "allowed":
        return False, f"{name}: {action} is {recorded or 'not recorded'}, so it is not permitted."
    if mode == "commercial-pilot" and item.get("commercialPilot") != "approved":
        return False, f"{name} is not approved for commercial-pilot use (review status: {item.get('reviewStatus')})."
    return True, ""
