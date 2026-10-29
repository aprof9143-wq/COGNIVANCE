import { Info } from "lucide-react";
import { GOVERNANCE, STATUS_CATEGORIES, STATUS_HEADINGS } from "@/lib/genome/governance";
import { clinicalModeAvailability } from "@/lib/genome/release";
import { NOT_FOR_CLINICAL_USE } from "@/lib/genome/status";

/**
 * The statement, in one quiet line at the top of each Vision page, with a link
 * to the full status. Plain anchor, so it renders anywhere (and in tests).
 */
export function StatusLine() {
  return (
    <p
      role="note"
      aria-label="Product status"
      className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-2 text-[12px] text-[var(--v-ink-2)]"
    >
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{NOT_FOR_CLINICAL_USE}</span>
      <a href="/vision#status" className="text-[var(--v-accent-ink)] underline underline-offset-2">
        What works today
      </a>
    </p>
  );
}

/**
 * What Genome v1 and the Vision pages do today, from the governance records
 * (config/genome/governance/product-status.json), and whether clinical use is
 * available (computed by the release gate, never a toggle).
 */
export function StatusPanel() {
  const items = GOVERNANCE.productStatus.items;
  const clinical = clinicalModeAvailability();
  return (
    <section id="status" aria-labelledby="status-title" className="scroll-mt-4">
      <h2 id="status-title" className="text-[19px] font-medium">
        Product status
      </h2>
      <p className="mt-1 text-[13px] font-medium text-[var(--v-ink)]">{NOT_FOR_CLINICAL_USE}</p>
      <p className="mt-0.5 text-[12px] text-[var(--v-ink-3)]">
        Clinical use is {clinical.available ? "available" : "unavailable"}:{" "}
        {clinical.available
          ? "every required record is in place."
          : `${clinical.unmet.length} required records do not exist yet. It cannot be switched on by a setting.`}
      </p>
      <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {STATUS_CATEGORIES.map((c) => {
          const group = items.filter((i) => i.category === c);
          if (!group.length) return null;
          return (
            <div key={c}>
              <h3 className="text-[12px] font-semibold text-[var(--v-ink-2)]">
                {STATUS_HEADINGS[c]}
              </h3>
              <ul className="mt-1.5 flex flex-col gap-2">
                {group.map((i) => (
                  <li key={i.id} className="text-[13px] leading-snug">
                    <span className="font-medium">{i.name}.</span>{" "}
                    <span className="text-[var(--v-ink-2)]">{i.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
