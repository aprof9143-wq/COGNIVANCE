import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";

type NavLink = { label: string; to: string; hash?: string };

const links: NavLink[] = [
  { label: "Home", to: "/" },
  { label: "Research", to: "/research" },
  { label: "Benchmarks", to: "/benchmarks" },
  { label: "Technology", to: "/", hash: "divisions" },
  { label: "Frontiers", to: "/", hash: "frontiers" },
  { label: "About", to: "/about" },
];

const SESSION_KEY = "cognivance_session";

export function SiteNav() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setSignedIn(Boolean(localStorage.getItem(SESSION_KEY)));
  }, [pathname]);

  const isActive = (l: NavLink) =>
    l.hash ? false : l.to === "/" ? pathname === "/" : pathname.startsWith(l.to);

  const signOut = () => {
    localStorage.removeItem(SESSION_KEY);
    setSignedIn(false);
    setOpen(false);
    navigate({ to: "/" });
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? "border-b border-foreground/10 bg-paper/75 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-[1500px] items-center gap-4 px-[clamp(1rem,3vw,2.5rem)] py-3">
        {/* ---- mark ---- */}
        <Link
          to="/"
          aria-label="Cognivance Labs — home"
          className="flex min-w-0 shrink-0 items-center gap-2.5"
        >
          <img
            src="/logo-mark.png"
            alt=""
            width={120}
            height={120}
            className="h-9 w-auto shrink-0 object-contain"
          />
          <span className="hidden text-[1.05rem] font-semibold tracking-[-0.03em] text-foreground sm:block">
            Cognivance
          </span>
        </Link>

        {/* ---- centre capsule ---- */}
        <div className="mx-auto hidden lg:block">
          <ul className="flex items-center gap-1 rounded-full border border-foreground/12 bg-foreground/[0.04] p-1.5 backdrop-blur-xl">
            {links.map((l) => {
              const active = isActive(l);
              return (
                <li key={l.label}>
                  <Link
                    to={l.to}
                    {...(l.hash ? { hash: l.hash } : {})}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-full px-4 py-2 text-[0.84rem] font-medium transition-colors duration-300 ${
                      active
                        ? "bg-foreground text-primary-foreground"
                        : "text-ash hover:bg-foreground/8 hover:text-foreground"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
            <li>
              <Link
                to="/"
                hash="waitlist"
                className="ml-1 block rounded-full bg-foreground px-5 py-2 text-[0.84rem] font-semibold text-primary-foreground transition-opacity duration-300 hover:opacity-85"
              >
                Get Started
              </Link>
            </li>
          </ul>
        </div>

        {/* ---- right cluster ---- */}
        <div className="ml-auto hidden shrink-0 items-center gap-4 lg:flex">
          <Link
            to="/auth"
            aria-label="Account"
            title="Account"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ash transition-colors hover:bg-foreground/8 hover:text-foreground"
          >
            <UserRound className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.6} />
          </Link>
          {signedIn ? (
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-2 text-[0.84rem] font-medium text-ash transition-colors hover:text-foreground"
            >
              <LogOut className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.6} />
              Logout
            </button>
          ) : (
            <Link
              to="/auth"
              className="flex items-center gap-2 text-[0.84rem] font-medium text-ash transition-colors hover:text-foreground"
            >
              <LogOut className="h-[1.05rem] w-[1.05rem] rotate-180" strokeWidth={1.6} />
              Sign in
            </Link>
          )}
        </div>

        {/* ---- mobile toggle ---- */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle menu"
          className="ml-auto flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-[5px] rounded-full border border-foreground/15 lg:hidden"
        >
          <span
            className={`h-px w-4 bg-foreground transition-transform duration-300 ${
              open ? "translate-y-[3px] rotate-45" : ""
            }`}
          />
          <span
            className={`h-px w-4 bg-foreground transition-transform duration-300 ${
              open ? "-translate-y-[3px] -rotate-45" : ""
            }`}
          />
        </button>
      </nav>

      {/* ---- mobile sheet ---- */}
      <div
        className={`overflow-hidden border-t border-foreground/10 bg-paper/95 backdrop-blur-xl transition-[max-height] duration-500 lg:hidden ${
          open ? "max-h-[34rem]" : "max-h-0 border-t-0"
        }`}
      >
        <ul className="px-[clamp(1.25rem,4vw,3.5rem)] py-4">
          {links.map((l) => (
            <li key={l.label} className="border-b border-foreground/8 last:border-0">
              <Link
                to={l.to}
                {...(l.hash ? { hash: l.hash } : {})}
                onClick={() => setOpen(false)}
                className={`block py-3.5 text-[1.05rem] font-medium ${
                  isActive(l) ? "text-foreground" : "text-ash"
                }`}
              >
                {l.label}
              </Link>
            </li>
          ))}
          <li className="pt-4">
            {signedIn ? (
              <button
                type="button"
                onClick={signOut}
                className="mb-3 block w-full rounded-full border border-foreground/15 px-5 py-3 text-center text-[0.9rem] font-semibold text-foreground"
              >
                Logout
              </button>
            ) : (
              <Link
                to="/auth"
                onClick={() => setOpen(false)}
                className="mb-3 block rounded-full border border-foreground/15 px-5 py-3 text-center text-[0.9rem] font-semibold text-foreground"
              >
                Sign in / Create account
              </Link>
            )}
          </li>
          <li>
            <Link
              to="/"
              hash="waitlist"
              onClick={() => setOpen(false)}
              className="block rounded-full bg-foreground px-5 py-3 text-center text-[0.9rem] font-semibold text-primary-foreground"
            >
              Get Started
            </Link>
          </li>
        </ul>
      </div>
    </header>
  );
}
