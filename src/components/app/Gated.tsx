import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { hasSession, type GatedPage } from "@/lib/session";
import { AppShell } from "./AppShell";

/**
 * The single login gate. Every feature route renders through this: without a
 * session it sends the visitor to /auth (which brings them back here after
 * sign-in); with one it shows the feature inside the app shell.
 */
export function Gated({ path, children }: { path: GatedPage; children: ReactNode }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!hasSession()) navigate({ to: "/auth", search: { redirect: path }, replace: true });
    else setReady(true);
  }, [navigate, path]);
  if (!ready) return <div className="min-h-screen bg-background" />;
  return <AppShell>{children}</AppShell>;
}
