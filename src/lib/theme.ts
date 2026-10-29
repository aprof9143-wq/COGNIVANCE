/**
 * Light / dark theme. The choice is a class on <html> ("dark" or none), set
 * before first paint by THEME_SCRIPT so the page never flashes the wrong
 * theme. "system" follows the operating system and is the default.
 */

import { useCallback, useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_KEY = "cognivance-theme";

/** Runs in <head> before the body renders. Keep it dependency-free. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export function readPref(): ThemePref {
  try {
    const p = localStorage.getItem(THEME_KEY);
    return p === "light" || p === "dark" ? p : "system";
  } catch {
    return "system";
  }
}

const systemDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export const resolve = (pref: ThemePref): Theme =>
  pref === "system" ? (systemDark() ? "dark" : "light") : pref;

export function applyTheme(pref: ThemePref) {
  document.documentElement.classList.toggle("dark", resolve(pref) === "dark");
}

/** The current preference and resolved theme, kept in sync across tabs and with the OS. */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const p = readPref();
    setPrefState(p);
    setTheme(resolve(p));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (readPref() === "system") {
        applyTheme("system");
        setTheme(resolve("system"));
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const next = readPref();
      applyTheme(next);
      setPrefState(next);
      setTheme(resolve(next));
    };
    mq.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    try {
      if (p === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, p);
    } catch {
      // Storage blocked: the class still changes for this page.
    }
    applyTheme(p);
    setPrefState(p);
    setTheme(resolve(p));
  }, []);

  const toggle = useCallback(() => setPref(theme === "dark" ? "light" : "dark"), [theme, setPref]);

  return { pref, theme, setPref, toggle };
}
