/**
 * A real screenshot of the platform in a quiet window frame, with the light or
 * dark capture shown to match the current theme.
 */
export function ProductShot({
  light,
  dark,
  alt,
  path,
  className = "",
  priority = false,
}: {
  light: string;
  dark: string;
  alt: string;
  path: string;
  className?: string;
  priority?: boolean;
}) {
  const img = "block h-auto w-full";
  return (
    <figure
      className={`overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-lift)] ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <i className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <i className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <i className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        </span>
        <span className="t-num ml-2 truncate text-[11px] text-ash">cognivance{path}</span>
      </div>
      <img
        src={light}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        className={`${img} dark:hidden`}
      />
      <img
        src={dark}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        className={`${img} hidden dark:block`}
      />
    </figure>
  );
}
