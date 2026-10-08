import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { hasSession, startDemo } from "@/lib/session";

function NeuralField() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(55,220,245,.14),transparent_28%),radial-gradient(circle_at_25%_80%,rgba(160,100,255,.08),transparent_25%),linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px)] bg-[length:auto,auto,32px_32px,32px_32px]" />
      <svg
        viewBox="0 0 700 700"
        className="absolute left-1/2 top-[45%] h-[76%] w-[88%] -translate-x-1/2 -translate-y-1/2 opacity-90"
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="core">
            <stop stopColor="#71efff" stopOpacity=".28" />
            <stop offset="1" stopColor="#71efff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="350" cy="350" rx="250" ry="205" fill="url(#core)" />
        <g fill="none" stroke="#63e8ff" strokeOpacity=".25" strokeWidth="1">
          {Array.from({ length: 18 }, (_, i) => (
            <ellipse
              key={i}
              cx="350"
              cy="350"
              rx={125 + i * 8}
              ry={95 + i * 6}
              transform={`rotate(${i * 10} 350 350)`}
            />
          ))}
        </g>
        <g filter="url(#glow)" stroke="#a66cff" strokeOpacity=".4" fill="none">
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            return (
              <path
                key={i}
                d={`M350 350 C ${350 + Math.cos(a) * 70} ${350 + Math.sin(a) * 55}, ${350 + Math.cos(a + 0.7) * 170} ${350 + Math.sin(a + 0.7) * 120}, ${350 + Math.cos(a) * 255} ${350 + Math.sin(a) * 190}`}
              />
            );
          })}
        </g>
        <g fill="#7beeff">
          {Array.from({ length: 42 }, (_, i) => {
            const a = i * 2.399;
            const rr = 65 + (i % 7) * 25;
            return (
              <circle
                key={i}
                cx={350 + Math.cos(a) * rr * 1.45}
                cy={350 + Math.sin(a) * rr}
                r={i % 5 === 0 ? 3 : 1.5}
                opacity={0.35 + (i % 4) * 0.15}
              />
            );
          })}
        </g>
      </svg>
      <div className="absolute bottom-7 left-7 right-7 flex items-end justify-between font-mono text-[7px] tracking-[.25em] text-white/25">
        <span>NEURAL FIELD / 3D PROJECTION</span>
        <span>LOCAL SESSION</span>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/auth")({ component: AuthPage });
function AuthPage() {
  const navigate = useNavigate();
  useEffect(() => {
    if (hasSession()) navigate({ to: "/research" });
  }, [navigate]);
  const enterDemo = () => {
    startDemo();
    navigate({ to: "/research" });
  };
  return (
    <main className="min-h-screen bg-[#020406] px-4 py-4 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1240px] items-stretch overflow-hidden rounded-2xl border border-white/10 bg-[#070a0d] shadow-2xl">
        <section className="relative hidden min-h-[720px] flex-1 overflow-hidden border-r border-white/10 lg:block">
          <NeuralField />
          <div className="relative z-10 flex h-full flex-col justify-between p-10">
            <div>
              <div className="font-mono text-[8px] tracking-[.45em] text-cyan-300/55">
                COGNIVANCE LABS / NIMBLE
              </div>
              <h1 className="mt-8 max-w-[9ch] text-6xl font-medium leading-[.92] tracking-[-.07em]">
                Enter the neural field.
              </h1>
              <p className="mt-6 max-w-[39ch] text-sm leading-7 text-white/38">
                A research workspace for turning raw neuroimaging and electrophysiology into
                interactive spatial models.
              </p>
            </div>
            <div className="grid max-w-[560px] grid-cols-3 gap-2">
              <div className="rounded-xl border border-cyan-300/15 bg-black/25 p-4">
                <div className="font-mono text-[6px] text-cyan-200/45">VOLUME</div>
                <div className="mt-2 text-xs text-white/60">3D NIfTI</div>
              </div>
              <div className="rounded-xl border border-emerald-300/15 bg-black/25 p-4">
                <div className="font-mono text-[6px] text-emerald-200/45">SIGNAL</div>
                <div className="mt-2 text-xs text-white/60">EEG fusion</div>
              </div>
              <div className="rounded-xl border border-violet-300/15 bg-black/25 p-4">
                <div className="font-mono text-[6px] text-violet-200/45">PATHWAYS</div>
                <div className="mt-2 text-xs text-white/60">Tractography</div>
              </div>
            </div>
          </div>
        </section>
        <section className="w-full p-7 sm:p-10 lg:w-[460px] lg:p-12">
          <Link
            to="/"
            className="font-mono text-[7px] tracking-[.25em] text-white/30 hover:text-white/65"
          >
            ← COGNIVANCE LABS
          </Link>
          <div className="mt-14">
            {/* AUTH: bypassed for demo — connect managed identity provider before collecting real credentials. */}
            {/* The local sign-in form is kept in components/auth/LoginForm.tsx, not rendered. */}
            <div>
              <div className="font-mono text-[7px] tracking-[.3em] text-cyan-200/45">
                RESEARCH ACCESS / DEMO
              </div>
              <h2 className="mt-3 text-3xl font-medium tracking-[-.05em]">Open the demo.</h2>
              <p className="mt-3 text-sm leading-6 text-white/35">
                A read-only session: no account, nothing saved, and it ends when you close this tab.
                It opens on the MNI152 template and a synthetic 10-20 EEG recording.
              </p>
            </div>
            <button
              type="button"
              onClick={enterDemo}
              className="mt-9 w-full rounded-lg bg-white px-5 py-3.5 text-sm font-semibold text-black transition hover:bg-cyan-100"
            >
              Enter Demo
            </button>
            <div className="mt-8 border-t border-white/8 pt-5">
              <div className="flex justify-between font-mono text-[6px] tracking-[.16em] text-white/22">
                <span>READ-ONLY SESSION</span>
                <span>LOCAL DEMO</span>
              </div>
              <p className="mt-3 text-[9px] leading-5 text-white/22">
                Sign-in is switched off for the demo. Connect a managed identity provider before
                collecting real user credentials.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
