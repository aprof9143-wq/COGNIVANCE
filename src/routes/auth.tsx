import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { hasSession, returnTo, startDemo, type GatedPage } from "@/lib/session";
import { COMPANY, MODULES } from "@/lib/company";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { Logo } from "@/components/site/Logo";
import { ProgramStrip } from "@/components/site/ProgramStrip";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Cognivance" },
      { name: "description", content: "Sign in to the Cognivance workspace." },
    ],
  }),
  // ?redirect= names the gated page the visitor was trying to open.
  validateSearch: (search: Record<string, unknown>): { redirect?: GatedPage } => {
    const r = returnTo(search["redirect"]);
    return r ? { redirect: r } : {};
  },
  component: AuthPage,
});

/**
 * The one sign-in for the whole platform. Accounts are not switched on yet
 * (see lib/session.ts): the workspace opens as a read-only demo session, and
 * no credential is ever asked for.
 */
function AuthPage() {
  const navigate = useNavigate();
  const asked = Route.useSearch().redirect;
  const destination: GatedPage = asked ?? "/app";
  const target = MODULES.find((m) => m.to === asked);

  useEffect(() => {
    if (hasSession()) navigate({ to: destination, replace: true });
  }, [navigate, destination]);

  const enter = () => {
    startDemo();
    navigate({ to: destination });
  };

  return (
    <main className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* brand panel */}
      <section className="relative hidden overflow-hidden bg-[#00030b] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_0%,rgba(61,139,245,0.32),transparent_70%),radial-gradient(50%_50%_at_100%_100%,rgba(138,107,255,0.2),transparent_70%)]"
        />
        <img
          src="/cognivance-logo.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -right-24 top-1/2 w-[620px] max-w-none -translate-y-1/2 opacity-60"
        />
        <div className="relative">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-black ring-1 ring-white/15">
              <img src="/logo-mark.png" alt="" className="h-7 w-7 object-contain" />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Cognivance</span>
          </Link>
        </div>
        <div className="relative max-w-[30rem]">
          <h1 className="text-[clamp(2.2rem,3.6vw,3.2rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
            {COMPANY.tagline}
          </h1>
          <ul className="mt-8 space-y-2.5 text-[14px] text-white/70">
            {[
              "Genome to protein evidence, every value traced",
              "Gene therapy, from vector to visual cortex",
              "Brain simulation, imaging and EEG in one frame",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#63b0ff]" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[12px] text-white/45">{COMPANY.disclaimer}</p>
      </section>

      {/* sign-in */}
      <section className="flex min-h-screen flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[13px] text-ash transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Website
          </Link>
          <ThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-12">
          <div className="lg:hidden">
            <Logo />
          </div>
          <h2 className="mt-8 text-[1.9rem] font-semibold tracking-[-0.035em] lg:mt-0">
            Sign in to Cognivance
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ash">
            {target
              ? `Continue to ${target.name}, and every other tool in the workspace.`
              : "One sign-in opens every tool in the workspace."}
          </p>

          <button
            type="button"
            onClick={enter}
            className="mt-9 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3.5 text-[14.5px] font-medium text-background transition-opacity hover:opacity-85"
          >
            Continue to the demo workspace <ArrowRight className="h-4 w-4" aria-hidden />
          </button>

          <div className="mt-6 rounded-xl border border-border bg-card p-4">
            <p className="text-[13px] font-medium">How the demo works</p>
            <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-ash">
              <li>Read-only: nothing is created and nothing is saved.</li>
              <li>It ends when you close this tab.</li>
              <li>
                Accounts are not switched on yet, so no email or password is asked for.
                Design-partner accounts come with a managed identity provider.
              </li>
            </ul>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[400px] border-t border-border pt-6">
          <ProgramStrip label="Supported by" />
        </div>
      </section>
    </main>
  );
}
