/**
 * The eye in time: the pupil follows the light, the lens follows the target.
 *
 * Steady state of the pupil: Moon & Spencer's formula as given by Watson &
 * Yellott (2012), D = 4.9 − 3·tanh(0.4·log10 L), L in cd/m². It ignores age,
 * field size and the other eye, which the unified formula adds.
 *
 * Time course: a delay, then a first-order approach, faster when the pupil
 * closes than when it opens. The lens works the same way. The delays and time
 * constants are typical textbook magnitudes chosen for a plausible shape; they
 * are not fitted to any data and individual eyes vary widely.
 */

export type Dyn = { value: number; unit: string; what: string };

export const DYNAMICS = {
  pupilLatency: {
    value: 0.25,
    unit: "s",
    what: "Delay before the pupil starts to respond to light.",
  },
  pupilConstrictTau: { value: 0.35, unit: "s", what: "Time constant of the pupil closing." },
  pupilDilateTau: { value: 1.6, unit: "s", what: "Time constant of the pupil opening; slower." },
  focusLatency: { value: 0.35, unit: "s", what: "Delay before the lens starts to refocus." },
  focusTau: { value: 0.3, unit: "s", what: "Time constant of the lens reaching its new shape." },
} satisfies Record<string, Dyn>;

/** Steady-state pupil diameter (mm) for a scene luminance in cd/m². */
export function pupilForLuminance(cdm2: number): number {
  const L = Math.max(1e-6, cdm2);
  return 4.9 - 3 * Math.tanh(0.4 * Math.log10(L));
}

/** Retinal illuminance in trolands: luminance × pupil area. */
export const trolands = (cdm2: number, pupilMm: number) => cdm2 * Math.PI * (pupilMm / 2) ** 2;

export const LIGHT_LEVELS = [
  { cdm2: 0.001, label: "Starlight" },
  { cdm2: 0.1, label: "Moonlight" },
  { cdm2: 10, label: "Dim room" },
  { cdm2: 100, label: "Office" },
  { cdm2: 3000, label: "Overcast day" },
  { cdm2: 30000, label: "Sunlight" },
] as const;

/**
 * Something that follows a target after a delay with a first-order lag.
 * `tauUp` applies while the value rises, `tauDown` while it falls.
 */
export class Responder {
  value: number;
  private changes: { t: number; target: number }[];
  constructor(
    initial: number,
    private latency: number,
    private tauUp: number,
    private tauDown: number,
  ) {
    this.value = initial;
    this.changes = [{ t: -Infinity, target: initial }];
  }

  /** Jump straight to v, forgetting pending changes (for manual control). */
  reset(v: number) {
    this.value = v;
    this.changes = [{ t: -Infinity, target: v }];
  }

  /** Ask for a new target at time t (s). */
  aim(t: number, target: number) {
    const last = this.changes[this.changes.length - 1]!;
    if (last.target !== target) this.changes.push({ t, target });
  }

  /** The target the system is acting on at time t, i.e. the one asked for `latency` ago. */
  effective(t: number): number {
    let target = this.changes[0]!.target;
    let keep = 0;
    for (let i = 0; i < this.changes.length; i++) {
      if (this.changes[i]!.t <= t - this.latency) {
        target = this.changes[i]!.target;
        keep = i;
      }
    }
    if (keep > 0) this.changes.splice(0, keep);
    return target;
  }

  /** Advance to time t by dt seconds. */
  step(t: number, dt: number): number {
    const target = this.effective(t);
    const tau = target > this.value ? this.tauUp : this.tauDown;
    this.value += (target - this.value) * (1 - Math.exp(-dt / tau));
    return this.value;
  }

  /** Whether the value has reached the latest target. */
  settled(eps: number): boolean {
    const latest = this.changes[this.changes.length - 1]!.target;
    return Math.abs(latest - this.value) < eps;
  }
}

export const pupilResponder = (initial: number) =>
  new Responder(
    initial,
    DYNAMICS.pupilLatency.value,
    DYNAMICS.pupilDilateTau.value,
    DYNAMICS.pupilConstrictTau.value,
  );

export const focusResponder = (initial: number) =>
  new Responder(
    initial,
    DYNAMICS.focusLatency.value,
    DYNAMICS.focusTau.value,
    DYNAMICS.focusTau.value,
  );

/** A scripted sequence: at each time (s), the object distance (mm) and light (cd/m²). */
export type Scenario = {
  key: string;
  title: string;
  what: string;
  frames: { t: number; distance: number; cdm2: number; note: string }[];
};

export const SCENARIOS: Scenario[] = [
  {
    key: "phone",
    title: "Look up from a phone",
    what: "Reading at 33 cm, then looking across the room, then back.",
    frames: [
      { t: 0, distance: 330, cdm2: 100, note: "Reading a phone at 33 cm" },
      { t: 2.5, distance: Infinity, cdm2: 100, note: "Looking up across the room" },
      { t: 5.5, distance: 330, cdm2: 100, note: "Back to the phone" },
      { t: 8, distance: 330, cdm2: 100, note: "" },
    ],
  },
  {
    key: "sunlight",
    title: "Step out into sunlight",
    what: "From an office into bright sunlight, and back inside.",
    frames: [
      { t: 0, distance: Infinity, cdm2: 100, note: "Indoors" },
      { t: 1.5, distance: Infinity, cdm2: 30000, note: "Out into sunlight: the pupil snaps shut" },
      { t: 5, distance: Infinity, cdm2: 100, note: "Back inside: the pupil reopens, slowly" },
      { t: 10, distance: Infinity, cdm2: 100, note: "" },
    ],
  },
  {
    key: "night",
    title: "Night drive",
    what: "Dark road, oncoming headlights, then the dashboard.",
    frames: [
      { t: 0, distance: Infinity, cdm2: 0.1, note: "Dark road" },
      { t: 1.5, distance: Infinity, cdm2: 300, note: "Oncoming headlights" },
      { t: 3, distance: Infinity, cdm2: 0.1, note: "Dark again" },
      { t: 6, distance: 600, cdm2: 1, note: "Glance at the dashboard" },
      { t: 8, distance: Infinity, cdm2: 0.1, note: "Eyes back on the road" },
      { t: 11, distance: Infinity, cdm2: 0.1, note: "" },
    ],
  },
];

/** The frame in force at time t. */
export function frameAt(s: Scenario, t: number) {
  let f = s.frames[0]!;
  for (const x of s.frames) if (x.t <= t) f = x;
  return f;
}

export const scenarioLength = (s: Scenario) => s.frames[s.frames.length - 1]!.t;
