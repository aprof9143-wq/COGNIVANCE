import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { STATUS_LABEL, WORKFLOW, type FeatureStatus } from "@/lib/company";

const DOT: Record<FeatureStatus, string> = {
  working: "bg-[var(--ok)]",
  limited: "bg-primary",
  sample: "bg-foreground/35",
  planned: "border border-foreground/40 bg-transparent",
};

/** A feature's status, in words, with a dot that is never the only signal. */
export function StatusPill({
  status,
  className = "",
}: {
  status: FeatureStatus;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground/75 ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** The four statuses, explained once. */
export function StatusKey() {
  const words: Record<FeatureStatus, string> = {
    working: "runs on what it says, results labelled",
    limited: "real sources, stated limits",
    sample: "demo or simulated data only",
    planned: "designed, not built",
  };
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-ash">
      {(Object.keys(words) as FeatureStatus[]).map((s) => (
        <li key={s} className="flex items-center gap-2">
          <StatusPill status={s} />
          {words[s]}
        </li>
      ))}
    </ul>
  );
}

/**
 * When a captured data set was taken, read from its own manifest, so the date
 * shown is the data's, not a date typed into the page. null while unknown.
 */
export function useDataAsOf(manifest: string | undefined): string | null {
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    if (!manifest) return;
    let live = true;
    fetch(manifest)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { capturedAt?: unknown } | null) => {
        if (live && typeof m?.capturedAt === "string") setAt(m.capturedAt);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [manifest]);
  return at;
}

export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Data in → analysis → results → evidence → export, each step listing what exists and how far. */
export function WorkflowStrip() {
  return (
    <ol className="grid gap-px overflow-hidden rounded-[20px] border border-border bg-border md:grid-cols-5">
      {WORKFLOW.map((step, i) => (
        <li key={step.key} className="relative flex flex-col bg-card p-5">
          <span className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-[0.12em] text-ash">
            <span className="grid h-5 w-5 place-items-center rounded-full border border-border text-[10.5px] tracking-normal">
              {i + 1}
            </span>
            {step.title}
            {i < WORKFLOW.length - 1 && (
              <ArrowRight
                className="ml-auto hidden h-3.5 w-3.5 text-foreground/30 md:block"
                aria-hidden
              />
            )}
          </span>
          <ul className="mt-4 flex flex-col gap-4">
            {step.items.map((it) => {
              const [path = "", hash] = (it.to ?? "").split("#");
              const body = (
                <>
                  <span className="flex flex-col items-start gap-1.5">
                    <span className="text-[14px] font-semibold tracking-[-0.01em]">{it.name}</span>
                    <StatusPill status={it.status} />
                  </span>
                  <span className="mt-1.5 block text-[13px] leading-relaxed text-ash">
                    {it.detail}
                  </span>
                </>
              );
              return (
                <li key={it.name}>
                  {it.to ? (
                    <Link
                      to={path}
                      {...(hash ? { hash } : {})}
                      className="group block rounded-xl transition-colors hover:text-foreground focus-visible:outline-2"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
