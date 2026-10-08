/**
 * The local sign-in / sign-up form that /auth showed before the demo.
 *
 * Not rendered: the demo has no accounts (see src/lib/session.ts). It is kept,
 * unchanged, for when a managed identity provider is connected. As written it
 * stores accounts, passwords included, in this browser's localStorage, so it
 * must not be shown again until it signs in through that provider instead.
 */

// AUTH: bypassed for demo — connect managed identity provider before collecting real credentials.

import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { SESSION_KEY } from "@/lib/session";

type StoredUser = { name: string; email: string; password: string };
const USERS_KEY = "cognivance_users";
function readUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function LoginForm() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    <>
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
    </>
  );
}
