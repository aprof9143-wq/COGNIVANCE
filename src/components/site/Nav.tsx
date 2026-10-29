import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { hasSession } from "@/lib/session";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { Logo } from "./Logo";

const LINKS = [
  { label: "Platform", to: "/", hash: "platform" },
  { label: "How it works", to: "/", hash: "how" },
  { label: "Why now", to: "/", hash: "why-now" },
  { label: "Team", to: "/", hash: "team" },
  { label: "About", to: "/about" },
] as const;

/** The public site's top bar: quiet until scrolled, then a hairline and a blur. */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(hasSession());
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const cta = signedIn ? (
    <Link
      to="/app"
      className="rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-85"
    >
      Open workspace
    </Link>
  ) : (
    <Link
      to="/auth"
      className="rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-85"
    >
      Sign in
    </Link>
  );

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background,border-color,backdrop-filter] duration-300 ${
        scrolled || open
          ? "border-b border-border bg-background/80 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <nav
        className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-6 px-5 sm:px-8"
        aria-label="Main"
      >
        <Logo />
        <ul className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <li key={l.label}>
              <Link
                to={l.to}
                {...("hash" in l ? { hash: l.hash } : {})}
                className="text-[13.5px] text-foreground/70 transition-colors hover:text-foreground"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          <span className="hidden sm:block">{cta}</span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid h-9 w-9 place-items-center rounded-full border border-border md:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </nav>
      {open && (
        <div className="border-t border-border px-5 pb-6 pt-2 md:hidden">
          <ul className="flex flex-col">
            {LINKS.map((l) => (
              <li key={l.label}>
                <Link
                  to={l.to}
                  {...("hash" in l ? { hash: l.hash } : {})}
                  onClick={() => setOpen(false)}
                  className="block border-b border-border py-3 text-[15px] text-foreground"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-5">{cta}</div>
        </div>
      )}
    </header>
  );
}
