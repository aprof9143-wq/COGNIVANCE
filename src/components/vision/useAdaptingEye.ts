import { useEffect, useRef, useState } from "react";
import { focusResponder, pupilResponder, type Responder } from "@/lib/vision/dynamics";

export type TraceSample = {
  t: number;
  pupil: number;
  pupilTarget: number;
  acc: number;
  accTarget: number;
};

/** Seconds of history kept for the live trace. */
export const TRACE_SECONDS = 10;

const now = () => performance.now() / 1000;

/**
 * Live pupil diameter and focusing effort, following their targets with the
 * delays and lags in lib/vision/dynamics. React state changes only when a
 * value moves visibly (so the optics and 3D lens are recomputed at most ~20
 * times a second, and not at all once settled); the full-rate history is kept
 * in a ref for the trace to draw.
 */
export function useAdaptingEye(
  accTarget: number,
  pupilTarget: number,
  manual: { acc: boolean; pupil: boolean },
) {
  const sys = useRef<{ acc: Responder; pupil: Responder; trace: TraceSample[] } | null>(null);
  sys.current ??= {
    acc: focusResponder(accTarget),
    pupil: pupilResponder(pupilTarget),
    trace: [],
  };
  const [live, setLive] = useState({ acc: accTarget, pupil: pupilTarget });
  const targets = useRef({ accTarget, pupilTarget });
  targets.current = { accTarget, pupilTarget };

  useEffect(() => {
    const s = sys.current!;
    if (manual.acc) s.acc.reset(accTarget);
    else s.acc.aim(now(), accTarget);
  }, [accTarget, manual.acc]);
  useEffect(() => {
    const s = sys.current!;
    if (manual.pupil) s.pupil.reset(pupilTarget);
    else s.pupil.aim(now(), pupilTarget);
  }, [pupilTarget, manual.pupil]);

  useEffect(() => {
    const s = sys.current!;
    let raf = 0;
    let last = now();
    let lastSample = 0;
    let shown = { acc: s.acc.value, pupil: s.pupil.value };
    const tick = () => {
      const t = now();
      const dt = Math.min(0.1, t - last);
      last = t;
      const acc = s.acc.step(t, dt);
      const pupil = s.pupil.step(t, dt);
      if (t - lastSample > 1 / 20) {
        lastSample = t;
        s.trace.push({ t, acc, pupil, ...targets.current });
        while (s.trace.length && s.trace[0]!.t < t - TRACE_SECONDS) s.trace.shift();
        // Quantised so a settled eye causes no re-renders.
        if (Math.abs(acc - shown.acc) > 0.004 || Math.abs(pupil - shown.pupil) > 0.02) {
          shown = { acc, pupil };
          setLive(shown);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return {
    live,
    trace: () => sys.current!.trace,
    adapting: Math.abs(live.acc - accTarget) > 0.01 || Math.abs(live.pupil - pupilTarget) > 0.05,
  };
}
