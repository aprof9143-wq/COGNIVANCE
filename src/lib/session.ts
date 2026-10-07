/**
 * Who is using the app.
 *
 * The demo has no accounts. "Enter Demo" on /auth starts a read-only session:
 * nothing is created, nothing is saved (the imaging-to-tracking summaries in
 * neuro/linked.ts stay in memory), and it lasts only as long as this tab
 * (sessionStorage). The pages behind the gate accept it.
 *
 * A local account signed in before the demo existed (SESSION_KEY in
 * localStorage, written by the hidden LoginForm) is still honoured.
 */

// AUTH: bypassed for demo — connect managed identity provider before collecting real credentials.

/** Local-account session written by components/auth/LoginForm.tsx (hidden). */
export const SESSION_KEY = "cognivance_session";
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

/** Start a demo session: no account, nothing persisted beyond this tab. */
export function startDemo() {
  demo = true;
  try {
    sessionStorage.setItem(DEMO_KEY, JSON.stringify({ startedAt: Date.now() }));
  } catch {
    // Storage blocked: the in-memory flag carries the session in this tab.
  }
}

/** Whether the gated pages may open: a demo session or a local account. */
export function hasSession(): boolean {
  if (isDemo()) return true;
  try {
    return localStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

/** Sign out of whichever session is open. */
export function endSession() {
  demo = false;
  try {
    sessionStorage.removeItem(DEMO_KEY);
  } catch {
    // Nothing stored.
  }
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored.
  }
}
