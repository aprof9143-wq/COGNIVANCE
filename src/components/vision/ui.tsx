import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CircleDashed, Dna, Eye, FileText, RefreshCw } from "lucide-react";
import { EVIDENCE, type EvidenceKind } from "@/lib/vision/evidence";
import type { Verdict } from "@/lib/vision/reference";

export function Card({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-4 rounded-[28px] bg-[var(--v-card)] p-5 shadow-[0_1px_2px_rgba(22,21,29,0.04)] ${className}`}
    >
      {children}
    </section>
  );
}

const KIND_TINT: Record<EvidenceKind, string> = {
  measured: "bg-[#e3f4f1]",
  reference: "bg-[#e6eefc]",
  user: "bg-[#efeff3]",
  computed: "bg-[var(--v-accent-soft)]",
  inferred: "bg-[#fbf0dc]",
  hypothetical: "bg-[#fbe6ee]",
  validated: "bg-[#e3f4e6]",
};

export function EvidenceTag({ kind, label }: { kind: EvidenceKind; label?: string }) {
  return (
    <span
      title={EVIDENCE[kind].description}
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-[var(--v-ink)] ${KIND_TINT[kind]}`}
    >
      {label ?? EVIDENCE[kind].label}
    </span>
  );
}

export function Gap({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-2xl border border-dashed border-[var(--v-line)] bg-[var(--v-soft)] px-3 py-2.5 text-[13px] text-[var(--v-ink-2)]">
      <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--v-ink-2)]" role="status">
      <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/** Switch between the module's pages. */
export function VisionPages({ active }: { active: "evidence" | "therapy" | "eye" }) {
  const pages = [
    { key: "evidence", to: "/vision", label: "Gene & protein", icon: FileText },
    { key: "therapy", to: "/vision/therapy", label: "Gene therapy", icon: Dna },
    { key: "eye", to: "/vision/eye", label: "Eye simulation", icon: Eye },
  ] as const;
  return (
    <div className="mt-5 flex flex-col gap-1 rounded-3xl bg-[var(--v-soft)] p-1 text-[12px]">
      {pages.map(({ key, to, label, icon: Icon }) => (
        <Link
          key={key}
          to={to}
          aria-current={active === key ? "page" : undefined}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${
            active === key ? "bg-[var(--v-ink)] text-white" : "text-[var(--v-ink)] hover:bg-white"
          }`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  );
}

export function VerdictChip({ v }: { v: Verdict }) {
  const [label, cls] =
    v === "agrees"
      ? ["Agrees", "bg-[#e3f4f1]"]
      : v === "differs"
        ? ["Differs", "bg-[#fbf0dc]"]
        : ["Not comparable", "bg-[var(--v-soft)] text-[var(--v-ink-2)]"];
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}
