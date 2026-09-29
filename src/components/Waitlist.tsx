import { useState } from "react";
import closing from "@/assets/closing.jpg";

export function Waitlist() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  return (
    <section id="waitlist" className="relative overflow-hidden">
      <div className="relative min-h-[92svh] flex flex-col justify-center overflow-hidden">
        <img
          src={closing}
          alt=""
          width={1920}
          height={1088}
          loading="lazy"
          className="drift-slow absolute inset-0 h-full w-full object-cover opacity-45"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-paper via-paper/60 to-paper" />
        <div className="absolute inset-0 bg-[radial-gradient(65%_55%_at_50%_35%,transparent_0%,color-mix(in_oklab,var(--paper)_88%,transparent)_100%)]" />

        <div className="relative px-[clamp(1.25rem,4vw,3.5rem)] pt-[clamp(5rem,12vw,9rem)]">
          <div className="mx-auto max-w-[760px] text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-foreground/15 bg-foreground/5 px-4 py-1.5 backdrop-blur-md">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-foreground" />
              <span className="t-marker text-foreground/80">Waitlist</span>
            </span>

            <h2 className="t-hero mt-7 text-foreground">Coming soon.</h2>

            <div className="glass mx-auto mt-10 rounded-3xl px-[clamp(1.25rem,4vw,3rem)] py-[clamp(1.75rem,4vw,2.75rem)]">
              <h3 className="font-semibold tracking-[-0.025em] text-foreground [font-size:clamp(1.35rem,2.4vw,1.85rem)]">
                Join our waitlist
              </h3>
              <p className="mx-auto mt-3 max-w-[42ch] text-[0.95rem] leading-relaxed text-ash">
                Sign up to receive research releases, instrument milestones and analytics from the
                lab, straight to your inbox.
              </p>

              {done ? (
                <p className="mt-7 text-[0.95rem] font-medium text-foreground">
                  You're on the list — we'll be in touch.
                </p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (email.trim()) setDone(true);
                  }}
                  className="mx-auto mt-7 flex w-full max-w-[440px] flex-col gap-3 sm:flex-row"
                >
                  <label htmlFor="waitlist-email" className="sr-only">
                    Email address
                  </label>
                  <input
                    id="waitlist-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter email"
                    className="min-w-0 flex-1 rounded-full border border-foreground/15 bg-foreground/5 px-5 py-3 text-[0.95rem] text-foreground placeholder:text-ash focus:border-foreground/40 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-full bg-foreground px-6 py-3 text-[0.9rem] font-semibold text-primary-foreground transition-opacity hover:opacity-85"
                  >
                    Join Waitlist
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        <div className="relative mt-auto select-none px-[clamp(0.5rem,2vw,1.5rem)] pt-[clamp(3rem,8vw,6rem)]">
          <p
            className="whitespace-nowrap bg-gradient-to-b from-foreground/22 via-foreground/8 to-transparent bg-clip-text text-center font-semibold leading-[0.74] tracking-[-0.05em] text-transparent"
            style={{ fontSize: "clamp(3rem, 15vw, 15rem)" }}
          >
            WAITLIST
          </p>
        </div>
      </div>
    </section>
  );
}
