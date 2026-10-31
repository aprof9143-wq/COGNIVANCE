/**
 * Who is using the app.
 *
 * The demo has no accounts. "Enter Demo" on /auth starts a read-only session:
 * nothing is created, nothing is saved (the imaging-to-tracking summaries in
 * neuro/linked.ts stay in memory), and it lasts only as long as this tab
 * (sessionStorage). The pages behind the gate accept it.
 *
 * Before the demo, a local sign-up form kept accounts, passwords included, in
 * localStorage. That form is gone and its keys are no longer honoured; they are
 * erased whenever a session starts or ends, so no password stays behind.
 */

// AUTH: bypassed for demo — connect managed identity provider before collecting real credentials.

/** Keys the removed local sign-up form wrote: its session and its account list. */
export const LEGACY_KEYS = ["cognivance_session", "cognivance_users"] as const;
/** The demo session; sessionStorage, so it ends with the tab. */
export const DEMO_KEY = "cognivance_demo";

// Kept in memory as well, so the demo still works where storage is blocked.
let demo: boolean | null = null;

export function isDemo(): boolean {
  if (demo !== null) return demo;
  try {
    demo = sessionStorage.getItem(DEMO_KEY) !== null;
  } catch {
    demo = false;
  }
  return demo;
}

/** Erase what the removed local sign-up form left in this browser. */
function clearLegacyAccounts() {
  for (const k of LEGACY_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      // Nothing stored.
    }
  }
}

/** Start a demo session: no account, nothing persisted beyond this tab. */
export function startDemo() {
  demo = true;
  clearLegacyAccounts();
  try {
    sessionStorage.setItem(DEMO_KEY, JSON.stringify({ startedAt: Date.now() }));
  } catch {
    // Storage blocked: the in-memory flag carries the session in this tab.
  }
}

/**
 * Every feature of the platform sits behind this one gate (components/app/Gated).
 * /auth returns you to the page you asked for, or to the workspace home.
 */
export const GATED_PAGES = [
  "/app",
  "/research",
  "/viewer",
  "/simulation",
  "/neurodegeneration",
  "/vision",
  "/vision/eye",
  "/vision/therapy",
  "/genomics",
  "/genomics/compare",
  "/nimble",
  "/benchmarks",
] as const;
export type GatedPage = (typeof GATED_PAGES)[number];

/**
 * Where /auth may send you after Enter Demo. Only a known gated page counts,
 * so the parameter cannot be used to send visitors anywhere else.
 */
export function returnTo(value: unknown): GatedPage | undefined {
  return GATED_PAGES.find((p) => p === value);
}

/** Whether the gated pages may open: only a demo session does. */
export function hasSession(): boolean {
  return isDemo();
}

/** Sign out of whichever session is open. */
export function endSession() {
  demo = false;
  try {
    sessionStorage.removeItem(DEMO_KEY);
  } catch {
    // Nothing stored.
  }
  clearLegacyAccounts();
}
