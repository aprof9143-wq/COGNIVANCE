import { Link } from "@tanstack/react-router";
import { COMPANY } from "@/lib/company";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-[38ch] text-[13.5px] leading-relaxed text-ash">
            {COMPANY.tagline}
          </p>
        </div>
        <div>
          <p className="t-marker text-ash">Company</p>
          <ul className="mt-4 space-y-2.5 text-[13.5px]">
            <li>
              <Link to="/about" className="text-foreground/75 hover:text-foreground">
                About
              </Link>
            </li>
            <li>
              <Link to="/" hash="team" className="text-foreground/75 hover:text-foreground">
                Team
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="t-marker text-ash">Platform</p>
          <ul className="mt-4 space-y-2.5 text-[13.5px]">
            <li>
              <Link to="/auth" className="text-foreground/75 hover:text-foreground">
                Sign in
              </Link>
            </li>
            <li>
              <Link to="/" hash="platform" className="text-foreground/75 hover:text-foreground">
                What's inside
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-2 px-5 py-6 text-[12px] text-ash sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>
            © {COMPANY.year} {COMPANY.legal}
          </p>
          <p className="max-w-[70ch] sm:text-right">{COMPANY.disclaimer}</p>
        </div>
      </div>
    </footer>
  );
}
