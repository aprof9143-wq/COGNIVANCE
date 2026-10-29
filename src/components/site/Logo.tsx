import { Link } from "@tanstack/react-router";

/** The brain mark and wordmark. `to` makes it a link home (or to the app). */
export function Logo({ to = "/", compact = false }: { to?: string; compact?: boolean }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-2.5" aria-label="Cognivance home">
      <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-[9px] bg-[#00030b] ring-1 ring-black/5 dark:ring-white/10">
        <img
          src="/logo-mark.png"
          alt=""
          width={214}
          height={210}
          className="h-7 w-7 object-contain"
        />
      </span>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
          Cognivance
        </span>
      )}
    </Link>
  );
}
