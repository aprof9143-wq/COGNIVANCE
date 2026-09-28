import { Link } from "@tanstack/react-router";

const menu = [
  { label: "Technology", to: "/", hash: "divisions" },
  { label: "Frontiers", to: "/", hash: "frontiers" },
  { label: "Analytics", to: "/", hash: "analytics" },
  { label: "Research demo", to: "/research", hash: undefined as string | undefined },
  { label: "About us", to: "/about", hash: undefined as string | undefined },
];

const resources = ["Research index", "Instrument notes", "Publications", "Press"];
const partners = ["Germany", "Switzerland", "Norway", "Sweden", "United Kingdom"];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-foreground/12 bg-paper">
      <div className="relative mx-auto max-w-[1500px] px-[clamp(1.25rem,4vw,3.5rem)] pt-[clamp(3rem,7vw,5.5rem)]">
        <div className="grid gap-10 border-b border-foreground/10 pb-[clamp(2rem,4vw,3rem)] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="flex min-w-0 items-start gap-5">
            <img
              src="/logo-mark.png"
              alt=""
              width={120}
              height={120}
              loading="lazy"
              className="h-14 w-auto shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="t-marker text-ash">Institute of neuronanotechnology</p>
              <p className="mt-3 max-w-[38ch] text-[0.95rem] leading-relaxed text-foreground/75">
                Mapping the brain inside-out — nanorobotic systems and computational neuroscience in
                one engine.
              </p>
            </div>
          </div>
          <Link
            to="/"
            hash="waitlist"
            className="group inline-flex w-fit items-center gap-3 rounded-full border border-foreground/20 px-6 py-3 text-[0.9rem] font-medium text-foreground transition-colors hover:bg-foreground hover:text-primary-foreground"
          >
            Join the waitlist
            <span
              aria-hidden
              className="transition-transform duration-300 group-hover:translate-x-1"
            >
              →
            </span>
          </Link>
        </div>

        <div className="grid gap-x-10 gap-y-10 py-[clamp(2rem,4vw,3rem)] sm:grid-cols-2 lg:grid-cols-4">
          <FooterColumn title="Menu">
            {menu.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  {...(item.hash ? { hash: item.hash } : {})}
                  className="rule-link text-foreground/75 transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </FooterColumn>
          <FooterColumn title="Resources">
            {resources.map((r) => (
              <li key={r} className="text-foreground/60">
                {r}
              </li>
            ))}
          </FooterColumn>
          <FooterColumn title="Partnerships">
            {partners.map((p) => (
              <li key={p} className="text-foreground/60">
                {p}
              </li>
            ))}
          </FooterColumn>
          <FooterColumn title="Contact">
            <li>
              <a
                href="mailto:contact@cognivancelabs.com"
                className="rule-link text-foreground/75 hover:text-foreground"
              >
                contact@cognivancelabs.com
              </a>
            </li>
            <li className="text-foreground/60">Europe</li>
          </FooterColumn>
        </div>
      </div>

      <div className="relative select-none px-[clamp(0.5rem,2vw,1.5rem)]">
        <p
          className="whitespace-nowrap bg-gradient-to-b from-foreground/28 via-foreground/8 to-transparent bg-clip-text text-center font-semibold leading-[0.76] tracking-[-0.05em] text-transparent"
          style={{ fontSize: "clamp(2rem, 11.8vw, 12rem)" }}
        >
          COGNIVANCE
        </p>
      </div>

      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 border-t border-foreground/10 px-[clamp(1.25rem,4vw,3.5rem)] py-5 text-[0.78rem] text-ash">
        <span className="font-semibold text-foreground">Cognivance Labs</span>
        <span>Neuronanotechnology · Europe</span>
        <span>© {new Date().getFullYear()}</span>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="t-marker text-ash">{title}</h3>
      <ul className="mt-5 space-y-3 text-[0.92rem]">{children}</ul>
    </div>
  );
}
