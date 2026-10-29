import { Link } from "@tanstack/react-router";

/**
 * The brain mark (transparent) and the wordmark, set in Unbounded.
 * `to` makes it a link home (or to the app).
 */
export function Logo({ to = "/", compact = false }: { to?: string; compact?: boolean }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-2" aria-label="Cognivance home">
      <img
        src="/logo-mark.png"
        alt=""
        width={214}
        height={210}
        className="h-8 w-8 shrink-0 object-contain"
      />
      {!compact && (
        <span className="font-[family-name:var(--font-brand)] text-[15.5px] font-medium tracking-[-0.01em] text-foreground">
          Cognivance
        </span>
      )}
    </Link>
  );
}
