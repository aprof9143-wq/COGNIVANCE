import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useState } from "react";

type StoredUser = { name: string; email: string; password: string };
const USERS_KEY = "cognivance_users";
const SESSION_KEY = "cognivance_session";
function readUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
  } catch {
    return [];
  }
}

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
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(SESSION_KEY)) navigate({ to: "/research" });
  }, [navigate]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    await new Promise((r) => setTimeout(r, 350));
    const em = email.trim().toLowerCase();
    const users = readUsers();
    if (!em || !password) {
      setError("Enter your email and password.");
      setBusy(false);
      return;
    }
    if (mode === "signup") {
      if (!name.trim()) {
        setError("Enter your name.");
        setBusy(false);
        return;
      }
      if (password.length < 8) {
        setError("Use at least 8 characters.");
        setBusy(false);
        return;
      }
      if (users.some((u) => u.email === em)) {
        setError("An account with this email already exists.");
        setBusy(false);
        return;
      }
      const u = { name: name.trim(), email: em, password };
      localStorage.setItem(USERS_KEY, JSON.stringify([...users, u]));
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ name: u.name, email: u.email, signedInAt: Date.now() }),
      );
      navigate({ to: "/research" });
    } else {
      const u = users.find((x) => x.email === em && x.password === password);
      if (!u) {
        setError("Email or password is incorrect.");
        setBusy(false);
        return;
      }
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ name: u.name, email: u.email, signedInAt: Date.now() }),
      );
      navigate({ to: "/research" });
    }
    setBusy(false);
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
            <div className="flex rounded-full border border-white/10 bg-black/30 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
                className={`flex-1 rounded-full px-4 py-2 text-sm transition ${mode === "login" ? "bg-white text-black" : "text-white/45 hover:text-white"}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
                className={`flex-1 rounded-full px-4 py-2 text-sm transition ${mode === "signup" ? "bg-white text-black" : "text-white/45 hover:text-white"}`}
              >
                Create account
              </button>
            </div>
            <div className="mt-10">
              <div className="font-mono text-[7px] tracking-[.3em] text-cyan-200/45">
                RESEARCH ACCESS / 01
              </div>
              <h2 className="mt-3 text-3xl font-medium tracking-[-.05em]">
                {mode === "login" ? "Welcome back." : "Open your console."}
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/35">
                {mode === "login"
                  ? "Resume your NIMBLE research session."
                  : "Create a local demo account for the research environment."}
              </p>
            </div>
            <form onSubmit={submit} className="mt-9 space-y-4">
              {mode === "signup" && (
                <label className="block">
                  <span className="mb-2 block font-mono text-[7px] tracking-[.2em] text-white/30">
                    NAME
                  </span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3.5 text-sm outline-none focus:border-cyan-300/45"
                    placeholder="Your name"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-2 block font-mono text-[7px] tracking-[.2em] text-white/30">
                  EMAIL
                </span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  autoComplete="email"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3.5 text-sm outline-none focus:border-cyan-300/45"
                  placeholder="you@company.com"
                />
              </label>
              <label className="block">
                <span className="mb-2 block font-mono text-[7px] tracking-[.2em] text-white/30">
                  PASSWORD
                </span>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3.5 text-sm outline-none focus:border-cyan-300/45"
                  placeholder="••••••••"
                />
              </label>
              {error && (
                <div className="rounded-lg border border-red-300/20 bg-red-300/[.05] px-3 py-2 text-xs text-red-200/75">
                  {error}
                </div>
              )}
              <button
                disabled={busy}
                className="w-full rounded-lg bg-white px-5 py-3.5 text-sm font-semibold text-black transition hover:bg-cyan-100 disabled:opacity-50"
              >
                {busy
                  ? "Opening field…"
                  : mode === "login"
                    ? "Enter research console"
                    : "Create research account"}
              </button>
            </form>
            <div className="mt-8 border-t border-white/8 pt-5">
              <div className="flex justify-between font-mono text-[6px] tracking-[.16em] text-white/22">
                <span>ENCRYPTED SESSION</span>
                <span>LOCAL DEMO</span>
              </div>
              <p className="mt-3 text-[9px] leading-5 text-white/22">
                Demo authentication stores credentials locally in the browser. Connect a managed
                identity provider before collecting real user credentials.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
