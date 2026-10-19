/**
 * Geometric optics of a schematic human eye, computed in the meridional plane.
 *
 * Model: Le Grand full theoretical eye (Le Grand & El Hage, Physiological
 * Optics, 1980; as tabulated in Atchison & Smith, Optics of the Human Eye,
 * 2000), relaxed and fully accommodated. It is a population-average model with
 * spherical surfaces and uniform refractive indices: not any person's eye.
 *
 * Units: millimetres along the optical axis from the front of the cornea (z),
 * millimetres from the axis (y), dioptres for power and vergence.
 *
 * Assumptions this file adds, each named where used:
 *  - accommodation between the relaxed and accommodated eyes is a linear blend
 *    of surface positions, curvatures and indices;
 *  - the retina is a sphere of radius 12 mm through the axial-length point;
 *  - changing axial length moves only the retina (axial refractive error).
 */

export type Surface = { name: string; z: number; R: number; n1: number; n2: number };

export const LE_GRAND_RELAXED: Surface[] = [
  { name: "Cornea, front", z: 0, R: 7.8, n1: 1, n2: 1.3771 },
  { name: "Cornea, back", z: 0.55, R: 6.5, n1: 1.3771, n2: 1.3374 },
  { name: "Lens, front", z: 3.6, R: 10.2, n1: 1.3374, n2: 1.42 },
  { name: "Lens, back", z: 7.6, R: -6.0, n1: 1.42, n2: 1.336 },
];

export const LE_GRAND_ACCOMMODATED: Surface[] = [
  { name: "Cornea, front", z: 0, R: 7.8, n1: 1, n2: 1.3771 },
  { name: "Cornea, back", z: 0.55, R: 6.5, n1: 1.3771, n2: 1.3374 },
  { name: "Lens, front", z: 3.2, R: 6.0, n1: 1.3374, n2: 1.427 },
  { name: "Lens, back", z: 7.7, R: -5.5, n1: 1.427, n2: 1.336 },
];

/** Cornea to retina, mm: the length at which the relaxed model focuses distant light. */
export const EMMETROPIC_LENGTH = 24.197;
/** Assumption: retina as a sphere of this radius (concave towards the light). */
export const RETINA_RADIUS = -12;
/** Semi-apertures beyond which a ray misses a surface, mm. */
const SEMI_APERTURE = [5.8, 5.3, 4.4, 4.4];
/** Middle of the visible spectrum, mm. */
export const WAVELENGTH_MM = 555e-6;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Surfaces at an accommodation fraction 0 (relaxed) … 1 (fully accommodated). */
export function surfacesAt(accommodation: number): Surface[] {
  const t = Math.min(1, Math.max(0, accommodation));
  return LE_GRAND_RELAXED.map((r, i) => {
    const a = LE_GRAND_ACCOMMODATED[i]!;
    return {
      name: r.name,
      z: lerp(r.z, a.z, t),
      R: 1 / lerp(1 / r.R, 1 / a.R, t),
      n1: lerp(r.n1, a.n1, t),
      n2: lerp(r.n2, a.n2, t),
    };
  });
}

// ---------------------------------------------------------------- paraxial

/** y–nu system matrix from just before the first surface to just after the last. */
function systemMatrix(s: Surface[]) {
  const run = (y0: number, nu0: number) => {
    let y = y0;
    let nu = nu0;
    let z = s[0]!.z;
    let n = s[0]!.n1;
    for (const f of s) {
      y += ((f.z - z) * nu) / n;
      nu -= (y * (f.n2 - f.n1)) / f.R;
      z = f.z;
      n = f.n2;
    }
    return [y, nu] as const;
  };
  const [A, C] = run(1, 0);
  const [B, D] = run(0, 1);
  return { A, B, C, D, zLast: s[s.length - 1]!.z, nOut: s[s.length - 1]!.n2 };
}

/** Equivalent power, dioptres. */
export function power(s: Surface[]): number {
  return -systemMatrix(s).C * 1000;
}

/**
 * Where the paraxial image of an object with vergence V (dioptres, at the
 * cornea; 0 for a distant object, -1000/d for one d mm away) forms, as z in mm.
 */
export function imageZ(s: Surface[], V: number): number {
  const { A, B, C, D, zLast, nOut } = systemMatrix(s);
  const nu0 = -V / 1000;
  const y = A + B * nu0;
  const nu = C + D * nu0;
  return Math.abs(nu) < 1e-12 ? Infinity : zLast - (y * nOut) / nu;
}

/** The object vergence (D) whose paraxial image lands exactly on a retina at z = L. */
export function vergenceForRetina(s: Surface[], L: number): number {
  const { A, B, C, D, zLast, nOut } = systemMatrix(s);
  const t = L - zLast;
  const nu0 = -(A * nOut + t * C) / (B * nOut + t * D);
  return -nu0 * 1000;
}

// ---------------------------------------------------------------- exact trace

export type Vec = [number, number];

export type Eye = {
  surfaces: Surface[];
  /** The iris sits at the front of the lens in this model. */
  stopZ: number;
  pupilRadius: number;
  axialLength: number;
};

export function makeEye(accommodation: number, pupilDiameter: number, axialLength: number): Eye {
  const surfaces = surfacesAt(accommodation);
  return { surfaces, stopZ: surfaces[2]!.z, pupilRadius: pupilDiameter / 2, axialLength };
}

export type RayPath = {
  points: Vec[];
  status: "retina" | "blocked" | "missed";
  /** Height where the ray crossed the pupil plane. */
  pupilY?: number | undefined;
  /** Height where it reached the retina. */
  retinaY?: number | undefined;
};

const norm = (v: Vec): Vec => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
};

/** Distance along d from p to a sphere with vertex zv and radius R, on the cap nearest the vertex. */
function hitSphere(p: Vec, d: Vec, zv: number, R: number): number | null {
  const c = zv + R;
  const oz = p[0] - c;
  const oy = p[1];
  const b = oz * d[0] + oy * d[1];
  const disc = b * b - (oz * oz + oy * oy - R * R);
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let best: number | null = null;
  for (const t of [-b - s, -b + s]) {
    if (t <= 1e-9) continue;
    const z = p[0] + t * d[0];
    if (best === null || Math.abs(z - zv) < Math.abs(p[0] + best * d[0] - zv)) best = t;
  }
  return best;
}

/** Snell's law in vector form; null on total internal reflection. */
export function refract(d: Vec, normal: Vec, n1: number, n2: number): Vec | null {
  let N = norm(normal);
  let cosi = -(d[0] * N[0] + d[1] * N[1]);
  if (cosi < 0) {
    N = [-N[0], -N[1]];
    cosi = -cosi;
  }
  const eta = n1 / n2;
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const f = eta * cosi - Math.sqrt(k);
  return norm([eta * d[0] + f * N[0], eta * d[1] + f * N[1]]);
}

export function traceRay(eye: Eye, start: Vec, direction: Vec): RayPath {
  let p: Vec = start;
  let d = norm(direction);
  const points: Vec[] = [p];
  let pupilY: number | undefined;

  for (let i = 0; i < eye.surfaces.length; i++) {
    const s = eye.surfaces[i]!;
    if (i === 2) {
      // The iris: a stop in the plane of the front of the lens.
      const t = (eye.stopZ - p[0]) / d[0];
      const y = p[1] + t * d[1];
      pupilY = y;
      if (Math.abs(y) > eye.pupilRadius) {
        points.push([eye.stopZ, y]);
        return { points, status: "blocked", pupilY };
      }
    }
    const t = hitSphere(p, d, s.z, s.R);
    if (t === null) return { points, status: "missed", pupilY };
    p = [p[0] + t * d[0], p[1] + t * d[1]];
    points.push(p);
    if (Math.abs(p[1]) > SEMI_APERTURE[i]!) return { points, status: "missed", pupilY };
    const nd = refract(d, [(p[0] - (s.z + s.R)) / s.R, p[1] / s.R], s.n1, s.n2);
    if (!nd) return { points, status: "missed", pupilY };
    d = nd;
  }

  const t = hitSphere(p, d, eye.axialLength, RETINA_RADIUS);
  if (t === null) return { points, status: "missed", pupilY };
  p = [p[0] + t * d[0], p[1] + t * d[1]];
  points.push(p);
  return { points, status: "retina", pupilY, retinaY: p[1] };
}

/** An object point: distance in front of the cornea (mm, Infinity allowed) and height off-axis. */
export type ObjectPoint =
  { distance: number; height: number } | { distance: typeof Infinity; angleDeg: number };

/**
 * A fan of rays from an object point across the pupil, in the meridional
 * plane. Candidates are aimed across the cornea; only those that clear the
 * iris are kept, then `count` are taken evenly by pupil height.
 */
export function rayFan(eye: Eye, obj: ObjectPoint, count: number, candidates = 401): RayPath[] {
  const span = eye.pupilRadius * 1.5 + 0.5;
  const all: RayPath[] = [];
  for (let i = 0; i < candidates; i++) {
    const yc = -span + (2 * span * i) / (candidates - 1);
    let start: Vec;
    let dir: Vec;
    if ("angleDeg" in obj) {
      const a = (obj.angleDeg * Math.PI) / 180;
      dir = [Math.cos(a), -Math.sin(a)];
      start = [-6, yc + 6 * Math.tan(a)];
    } else {
      start = [-obj.distance, obj.height];
      dir = [obj.distance, yc - obj.height];
    }
    all.push(traceRay(eye, start, dir));
  }
  const passed = all.filter((r) => r.status === "retina");
  if (passed.length <= count) return passed;
  return Array.from(
    { length: count },
    (_, i) => passed[Math.round((i * (passed.length - 1)) / (count - 1))]!,
  );
}

/**
 * RMS spot diameter on the retina for an on-axis point, mm. Each meridional
 * ray stands for an annulus of the pupil, so it is weighted by its pupil height.
 */
export function rmsSpotDiameter(eye: Eye, distance: number): number | null {
  const obj: ObjectPoint = Number.isFinite(distance)
    ? { distance, height: 0 }
    : { distance: Infinity, angleDeg: 0 };
  const rays = rayFan(eye, obj, Infinity, 801);
  let sw = 0;
  let swy = 0;
  for (const r of rays) {
    const w = Math.abs(r.pupilY ?? 0);
    sw += w;
    swy += w * (r.retinaY ?? 0) ** 2;
  }
  return sw > 0 ? 2 * Math.sqrt(swy / sw) : null;
}

// ---------------------------------------------------------------- one call

export type EyeSettings = {
  /** mm in front of the cornea; Infinity for a distant object. */
  distance: number;
  pupilDiameter: number;
  axialLength: number;
  /** 0–1, or "auto" to focus as well as the model can on the object. */
  accommodation: number | "auto";
};

export type EyeResult = {
  eye: Eye;
  accommodation: number;
  powerD: number;
  objectVergenceD: number;
  /** Vergence this eye, as focused, brings to a point on its retina. */
  focusedVergenceD: number;
  /** Positive: image forms in front of the retina. */
  focusErrorD: number;
  imageZ: number;
  /** Relaxed eye: farthest distance in sharp focus (mm); Infinity if none is closer. */
  farPointMm: number;
  /** Fully accommodated: nearest distance in sharp focus (mm). */
  nearPointMm: number;
  rmsBlurUm: number | null;
  /** Diameter of the diffraction (Airy) disc on the retina, µm. */
  airyUm: number;
  /** Retinal distance per degree of visual angle near the axis, mm. */
  mmPerDegree: number;
};

export const vergenceOf = (distance: number) => (Number.isFinite(distance) ? -1000 / distance : 0);

export function simulateEye(st: EyeSettings): EyeResult {
  const L = st.axialLength;
  const V = vergenceOf(st.distance);
  const needed = (a: number) => vergenceForRetina(surfacesAt(a), L);

  let acc: number;
  if (st.accommodation !== "auto") acc = Math.min(1, Math.max(0, st.accommodation));
  else if (V >= needed(0)) acc = 0;
  else if (V <= needed(1)) acc = 1;
  else {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (needed(mid) > V) lo = mid;
      else hi = mid;
    }
    acc = (lo + hi) / 2;
  }

  const eye = makeEye(acc, st.pupilDiameter, L);
  const P = power(eye.surfaces);
  const focused = needed(acc);
  const far = needed(0);
  const near = needed(1);
  const fAnterior = 1000 / P;
  return {
    eye,
    accommodation: acc,
    powerD: P,
    objectVergenceD: V,
    focusedVergenceD: focused,
    focusErrorD: V - focused,
    imageZ: imageZ(eye.surfaces, V),
    // Within 0.01 D of zero counts as distant: the published axial length is
    // rounded to 1 µm, which alone leaves ~0.001 D.
    farPointMm: far < -0.01 ? -1000 / far : Infinity,
    nearPointMm: near < -0.01 ? -1000 / near : Infinity,
    rmsBlurUm: ((d) => (d === null ? null : d * 1000))(rmsSpotDiameter(eye, st.distance)),
    airyUm: ((2.44 * WAVELENGTH_MM) / st.pupilDiameter) * fAnterior * 1000,
    mmPerDegree: fAnterior * Math.tan(Math.PI / 180),
  };
}
