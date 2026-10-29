import { PROGRAMS } from "@/lib/company";

/**
 * The programs the company is part of, shown monochrome so the strip reads as
 * one quiet line (full colour on hover). Logos are the programs' own marks.
 */
export function ProgramStrip({ label = "Supported by" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-10">
      <p className="t-marker shrink-0 text-ash">{label}</p>
      <ul className="flex flex-wrap items-center gap-x-10 gap-y-6">
        {PROGRAMS.map((p) => (
          <li key={p.name} title={`${p.name} · ${p.detail}`}>
            <img
              src={p.src}
              alt={`${p.name} — ${p.detail}`}
              width={p.w}
              height={p.h}
              loading="lazy"
              className={`w-auto object-contain opacity-70 grayscale transition duration-300 hover:opacity-100 hover:grayscale-0 dark:opacity-80 dark:invert dark:hover:invert-0 ${
                p.name === "NVIDIA Inception" ? "h-11" : "h-6 sm:h-7"
              }`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
