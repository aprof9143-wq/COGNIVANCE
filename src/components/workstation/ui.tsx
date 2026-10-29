/**
 * Small shared UI pieces for the workstation. Restrained on purpose: neutral
 * surfaces, readable 12–15 px text, saturated colour reserved for overlays and
 * status.
 */

export function Panel({
  title,
  tag,
  note,
  children,
  flush,
  actions,
}: {
  title: string;
  /** Evidence type: measured, interpolated, inferred, derived, literature, … */
  tag?: string | undefined;
  note?: string | undefined;
  children: React.ReactNode;
  flush?: boolean | undefined;
  actions?: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-md border border-[color:var(--k-16305e)] bg-[color:var(--k-04102b)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[color:var(--k-16305e)] px-3 py-2">
        <h3 className="text-[13px] font-semibold text-[color:var(--k-e6efff)]">{title}</h3>
        {tag ? <Tag kind={tag} /> : null}
        {note ? (
          <span className="ml-auto text-[12px] text-[color:var(--k-8095bf)]">{note}</span>
        ) : null}
        {actions ? <div className={note ? "" : "ml-auto"}>{actions}</div> : null}
      </header>
      <div className={flush ? "" : "p-3"}>{children}</div>
    </section>
  );
}

const TAG_STYLE: Record<string, string> = {
  measured: "border-[color:var(--k-3d6b4f)] text-[color:var(--k-9fd4b0)]",
  interpolated: "border-[color:var(--k-5b5a3a)] text-[color:var(--k-d9d49a)]",
  inferred: "border-[color:var(--k-6b4f3d)] text-[color:var(--k-e0b89a)]",
  derived: "border-[color:var(--k-3d5a7a)] text-[color:var(--k-a7c4e6)]",
  literature: "border-[color:var(--k-5a4a7a)] text-[color:var(--k-c8b6ea)]",
  entered: "border-[color:var(--k-2a4a80)] text-[color:var(--k-c4d2ee)]",
  "research only": "border-[color:var(--k-7a3d3d)] text-[color:var(--k-eaa7a7)]",
};

export function Tag({ kind }: { kind: string }) {
  return (
    <span
      className={`rounded border px-1.5 py-px text-[11px] uppercase tracking-wide ${TAG_STYLE[kind] ?? "border-[color:var(--k-2a4a80)] text-[color:var(--k-c4d2ee)]"}`}
    >
      {kind}
    </span>
  );
}

export function Pill({
  tone,
  children,
}: {
  tone: "warn" | "error" | "ok" | "info";
  children: React.ReactNode;
}) {
  const style = {
    warn: "border-[color:var(--k-7a6320)] bg-[color:var(--k-221c0a)] text-[color:var(--k-f0d68a)]",
    error: "border-[color:var(--k-7a2d2d)] bg-[color:var(--k-220d0d)] text-[color:var(--k-f2a7a7)]",
    ok: "border-[color:var(--k-2d6a45)] bg-[color:var(--k-0c1f14)] text-[color:var(--k-9fdcb4)]",
    info: "border-[color:var(--k-2f4a6e)] bg-[color:var(--k-0d1726)] text-[color:var(--k-a9c6ea)]",
  }[tone];
  return <span className={`rounded border px-2 py-0.5 text-[12px] ${style}`}>{children}</span>;
}

export const DISCLAIMER =
  "For research/educational use unless separately validated and cleared for clinical use.";
