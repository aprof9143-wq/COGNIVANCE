import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  alphaNpM,
  beamField,
  DEFAULT_ARRAY,
  heatStep,
  wavelengthM,
  type ArrayDesign,
  type Vec3,
} from "./acoustics";
import {
  attachRegionMeasures,
  nearestVertex,
  parseAnatomy,
  parseRegionLabels,
  placeArray,
  regionMeasures,
  targetPoint,
  type AnatomyMesh,
  type Placement,
} from "./anatomy";
import { autoConnect, FULL_TOPOLOGY } from "./autoconnect";
import { runCohort, virtualPatient } from "./benchmark";
import { addressableFoci, evaluateDesign, designSpace, pickBest } from "./design";
import { DISEASES, diseaseByKey, patientParams } from "./diseases";
import { CircuitSim, computeBeams, deliverable } from "./loop";
import { createNetwork, healthyParams, Recorder, REGION_INDEX as R, REGIONS, step } from "./neural";
import { NOT_MODELLED, planTarget } from "./plan";
import { verify, type GateInputs } from "./prism";
import {
  allRegionDepths,
  AMYGDALA_SCALP_RANGE_MM,
  ANATOMY_ONLY,
  GATED_REGIONS,
  isGated,
  isSimulated,
  regionDepth,
  STANDS_FOR,
  type AnyRegionKey,
} from "./regions";
import { COMPONENTS, SAFETY_LIMITS, thermalNoiseUv } from "./specs";

/** A placement `depth` mm straight down from the origin. */
const straight = (depth: number): Placement => ({
  centre: [0, 0, 0],
  normal: [0, 0, -1],
  target: [0, 0, -depth],
  depthMm: depth,
});

describe("component library and auto-connection", () => {
  it("wires the full implant with no design-rule errors", () => {
    const c = autoConnect(FULL_TOPOLOGY);
    expect(c.drc.filter((d) => d.severity === "error")).toEqual([]);
    expect(c.ok).toBe(true);
    // Every required input is driven.
    for (const comp of c.components)
      for (const p of comp.ports.filter((x) => x.dir === "in" && x.required))
        expect(c.nets.some((n) => n.to.component === comp.id && n.to.port === p.id)).toBe(true);
    // Signal path order: sense before verify before stimulate.
    const o = c.assemblyOrder;
    expect(o.indexOf("asic")).toBeLessThan(o.indexOf("prism"));
    expect(o.indexOf("prism")).toBeLessThan(o.indexOf("array"));
  });

  it("refuses a tissue-write path without PRISM — the closed-loop guarantee, structurally", () => {
    const c = autoConnect({
      components: COMPONENTS.map((x) => x.id).filter((id) => id !== "prism"),
    });
    expect(c.ok).toBe(false);
    expect(c.drc.map((d) => d.rule)).toContain("SAFETY-GATE");
  });

  it("flags a missing power source and an over-budget design", () => {
    expect(autoConnect({ components: ["mesh", "asic"] }).drc.map((d) => d.rule)).toContain(
      "PWR-SOURCE",
    );
    const full = autoConnect(FULL_TOPOLOGY);
    expect(full.power.drawMw).toBeGreaterThan(full.power.harvestMw);
    expect(full.drc.map((d) => d.rule)).toContain("PWR-BUDGET");
    expect(full.power.dutyLimit).toBeCloseTo(full.power.harvestMw / full.power.drawMw, 6);
  });

  it("computes contact thermal noise from first principles (√4kTRB)", () => {
    // 10 kΩ, 7.5 kHz, 310 K → 1.13 µV rms.
    expect(thermalNoiseUv()).toBeCloseTo(1.13, 2);
  });
});

describe("acoustics", () => {
  const design: ArrayDesign = { ...DEFAULT_ARRAY, frequencyHz: 5e6, pitchM: 2 * wavelengthM(5e6) };

  it("puts the focus where it was asked, with a diffraction-limited width", () => {
    const { metrics } = beamField(design, [0, 0, 0], [0, 0, -1], [0, 0, -0.012]);
    expect(metrics.focalErrorMm).toBeLessThan(metrics.axialFwhmMm);
    // Lateral FWHM ≈ λ·F# for a square aperture (within a factor of 1.5).
    const fnum = 12 / metrics.apertureMm;
    expect(metrics.lateralFwhmMm).toBeGreaterThan(0.5 * metrics.wavelengthMm * fnum);
    expect(metrics.lateralFwhmMm).toBeLessThan(1.5 * metrics.wavelengthMm * fnum);
  });

  it("attenuates at 0.6 dB/cm/MHz: 15 MHz loses 9 dB per cm", () => {
    expect((alphaNpM(15e6) * 0.01 * 8.686).toFixed(2)).toBe("9.00");
    const { metrics } = beamField(DEFAULT_ARRAY, [0, 0, 0], [0, 0, -1], [0, 0, -0.02]);
    expect(metrics.pathLossDb).toBeCloseTo(18, 5);
  });

  it("reports MI = p/√f and I_SPPA = p²/2ρc consistently", () => {
    const { metrics } = beamField(design, [0, 0, 0], [0, 0, -1], [0, 0, -0.01]);
    expect(metrics.mechanicalIndex).toBeCloseTo(metrics.peakMpa / Math.sqrt(5), 6);
    expect(metrics.isppaWcm2).toBeCloseTo(
      (metrics.focusMpa * 1e6) ** 2 / (2 * 1040 * 1540) / 1e4,
      6,
    );
  });

  it("heats toward 2αIτ/(ρC) and cools back", () => {
    let t = 0;
    for (let i = 0; i < 2000; i++) t = heatStep(t, 1, 5e6, 1, 0.01);
    const kappa = 1.4e-7;
    const tau = 1e-3 ** 2 / (4 * kappa);
    const steady = ((2 * alphaNpM(5e6) * 1e4) / (1040 * 3600)) * tau;
    expect(t).toBeCloseTo(steady, 4);
    expect(heatStep(t, 0, 5e6, 1, 100)).toBeLessThan(1e-6);
  });

  it("shows the 15 MHz spec cannot focus deep: off-target pressure exceeds −6 dB at 18 mm", () => {
    const [b] = computeBeams(DEFAULT_ARRAY, [{ region: "hippocampus", placement: straight(18) }]);
    expect(b!.metrics.offTargetFraction).toBeGreaterThan(SAFETY_LIMITS.offTargetFraction);
  });
});

describe("neural model", () => {
  const run = (
    p: ReturnType<typeof healthyParams>,
    stim: { region: number; u: number; sign: 1 | -1 }[] = [],
  ) => {
    const net = createNetwork(p, 5);
    const rec = new Recorder(REGIONS.length, 4096);
    step(net, 500);
    step(net, 3000, stim, undefined, rec.push);
    return rec;
  };

  it("reproduces each disease's biomarker direction and lets stimulation move it back", () => {
    const h = run(healthyParams());
    const pd = patientParams(diseaseByKey("parkinsons"), 1);
    const off = run(pd);
    const on = run(pd, [{ region: R.stn, u: 0.7, sign: -1 }]);
    expect(off.power(R.stn, 3000)).toBeGreaterThan(2 * h.power(R.stn, 3000));
    expect(on.power(R.stn, 3000)).toBeLessThan(0.7 * off.power(R.stn, 3000));

    const vis = patientParams(diseaseByKey("vision"), 1);
    expect(run(vis).power(R.v1, 3000)).toBeLessThan(0.8 * h.power(R.v1, 3000));
    expect(run(vis, [{ region: R.v1, u: 0.7, sign: 1 }]).power(R.v1, 3000)).toBeGreaterThan(
      run(vis).power(R.v1, 3000),
    );

    const ad = patientParams(diseaseByKey("alzheimers"), 1);
    expect(run(ad).coherence(R.hippocampus, R.vmpfc, 3000)).toBeLessThan(
      h.coherence(R.hippocampus, R.vmpfc, 3000),
    );
  });

  it("is stable: the same parameters give similar biomarkers across noise seeds", () => {
    const p = healthyParams();
    const vals = [1, 2, 3].map((seed) => {
      const net = createNetwork(p, seed);
      const rec = new Recorder(REGIONS.length, 8192);
      step(net, 500);
      step(net, 6000, [], undefined, rec.push);
      return rec.power(R.stn, 6000);
    });
    const mean = vals.reduce((a, b) => a + b) / vals.length;
    for (const v of vals) expect(Math.abs(v - mean) / mean).toBeLessThan(0.35);
  });
});

describe("PRISM gate", () => {
  const ok: GateInputs = {
    intent: {
      regions: [{ region: "stn", gain: 0.6, u: 0.3 }],
      sign: -1,
      predictedBenefit: 5,
      confidence: 0.2,
      predictedPlasticity: 1.1,
    },
    allowedRegions: ["stn"],
    perRegion: [
      {
        region: "stn",
        mechanicalIndex: 0.3,
        isptaMwCm2: 300,
        predictedTempC: 0.2,
        offTargetFraction: 0.3,
        doseS: 1,
        focalGainOk: true,
      },
    ],
    aggregateDoseS: 1,
    minConfidence: 0.02,
  };

  it("verifies an intent that satisfies every rule", () => {
    const v = verify(ok);
    expect(v.verified).toBe(true);
    expect(v.rules.every((r) => r.pass)).toBe(true);
  });

  it.each([
    ["P1", { intent: { ...ok.intent, regions: [{ region: "v1" as const, gain: 1, u: 1 }] } }],
    ["P2", { intent: { ...ok.intent, confidence: 0 } }],
    ["P3", { intent: { ...ok.intent, predictedBenefit: -1 } }],
    ["S1", { perRegion: [{ ...ok.perRegion[0]!, mechanicalIndex: 2 }] }],
    ["S2", { perRegion: [{ ...ok.perRegion[0]!, isptaMwCm2: 800 }] }],
    ["S3", { perRegion: [{ ...ok.perRegion[0]!, predictedTempC: 2.5 }] }],
    ["S4", { perRegion: [{ ...ok.perRegion[0]!, offTargetFraction: 0.9 }] }],
    ["S5", { perRegion: [{ ...ok.perRegion[0]!, doseS: 121 }] }],
    ["S6", { aggregateDoseS: 241 }],
    ["S7", { intent: { ...ok.intent, predictedPlasticity: 1.7 } }],
  ] as const)("halts on %s", (id, patch) => {
    const v = verify({ ...ok, ...patch } as GateInputs);
    expect(v.verified).toBe(false);
    expect(v.reason).toMatch(new RegExp(`^${id} `));
  });
});

describe("CIRCUIT loop", () => {
  const pd = diseaseByKey("parkinsons");
  const good: ArrayDesign = {
    ...DEFAULT_ARRAY,
    frequencyHz: 7.5e6,
    pitchM: 2 * wavelengthM(7.5e6),
  };

  it("never delivers a write-back PRISM did not verify", () => {
    for (const design of [DEFAULT_ARRAY, good]) {
      const beams = computeBeams(design, [{ region: "stn", placement: straight(14) }]);
      const sim = new CircuitSim({
        disease: pd,
        severity: 1,
        beams,
        seed: 3,
        dutyLimit: 0.78,
        gated: true,
        design,
      });
      for (let i = 0; i < 40; i++) {
        const ev = sim.iterate();
        if (ev.delivered.length) expect(ev.verification?.verified).toBe(true);
        if (ev.halted) {
          expect(ev.delivered).toEqual([]);
          expect(ev.verification?.reason).toBeTruthy();
        }
      }
    }
  });

  it("halts at the 15 MHz spec for a 14 mm target and delivers with a redesigned array", () => {
    const spec = new CircuitSim({
      disease: pd,
      severity: 1,
      beams: computeBeams(DEFAULT_ARRAY, [{ region: "stn", placement: straight(14) }]),
      seed: 3,
      dutyLimit: 0.78,
      gated: true,
    });
    const evs = Array.from({ length: 20 }, () => spec.iterate());
    expect(evs.every((e) => e.halted)).toBe(true);
    expect(evs.some((e) => e.verification?.reason?.startsWith("S4"))).toBe(true);

    const fixed = new CircuitSim({
      disease: pd,
      severity: 1,
      beams: computeBeams(good, [{ region: "stn", placement: straight(14) }]),
      seed: 3,
      dutyLimit: 0.78,
      gated: true,
      design: good,
    });
    const delivered = Array.from({ length: 20 }, () => fixed.iterate()).filter(
      (e) => e.delivered.length,
    );
    expect(delivered.length).toBeGreaterThan(10);
  });

  it("reports latency with provenance: spec budgets plus measured compute", () => {
    const sim = new CircuitSim({
      disease: pd,
      severity: 1,
      beams: computeBeams(good, [{ region: "stn", placement: straight(14) }]),
      seed: 3,
      dutyLimit: 0.78,
      gated: true,
      design: good,
    });
    const ev = sim.iterate();
    expect(ev.stages.find((s) => s.stage === "SENSE")).toMatchObject({ ms: 10, source: "spec" });
    expect(ev.stages.find((s) => s.stage === "VERIFY")!.ms).toBeGreaterThanOrEqual(5);
    expect(ev.stages.find((s) => s.stage === "PREDICT")!.source).toBe("measured");
    expect(ev.latencyMs).toBeGreaterThanOrEqual(15);
  });
});

describe("design search and benchmark", () => {
  it("auto-design finds a mm-scale design that reaches a 14 mm target", () => {
    const placements = [{ region: "stn" as const, placement: straight(14) }];
    const best = pickBest(designSpace().map((d) => evaluateDesign(d, placements)));
    expect(best).not.toBeNull();
    expect(best!.ok).toBe(true);
    expect(best!.beams[0]!.metrics.lateralFwhmMm).toBeLessThanOrEqual(1.5);
  });

  it("steerable foci follow the grating-lobe limit: none beyond a λ pitch", () => {
    const sparse: ArrayDesign = {
      ...DEFAULT_ARRAY,
      frequencyHz: 5e6,
      pitchM: 2 * wavelengthM(5e6),
    };
    expect(addressableFoci(sparse, 15, 0.7)).toBe(0);
    const dense: ArrayDesign = {
      ...DEFAULT_ARRAY,
      frequencyHz: 5e6,
      pitchM: 0.5 * wavelengthM(5e6),
    };
    expect(addressableFoci(dense, 15, 0.7)).toBeGreaterThan(0);
  });

  it("is reproducible and never counts an unverified write-back in the closed arm", async () => {
    const d = diseaseByKey("parkinsons");
    const design: ArrayDesign = {
      ...DEFAULT_ARRAY,
      frequencyHz: 7.5e6,
      pitchM: 2 * wavelengthM(7.5e6),
    };
    const beams = computeBeams(design, [{ region: "stn", placement: straight(14) }]);
    const a = await runCohort({
      disease: d,
      design,
      beams,
      dutyLimit: 0.78,
      patients: 3,
      loops: 30,
    });
    const b = await runCohort({
      disease: d,
      design,
      beams,
      dutyLimit: 0.78,
      patients: 3,
      loops: 30,
    });
    expect(a.closed.endpoint.mean).toBe(b.closed.endpoint.mean);
    expect(a.closed.unverifiedDeliveries).toBe(0);
    expect(a.closed.safetyBreaches).toBe(0);
    expect(a.verificationRate).toBe(1);
    expect(virtualPatient(d, 1).severity).toBe(virtualPatient(d, 1).severity);
  });

  it("marks paralysis as not assessable by this model", async () => {
    const d = diseaseByKey("paralysis");
    const beams = computeBeams(DEFAULT_ARRAY, [{ region: "motor", placement: straight(10) }]);
    const r = await runCohort({
      disease: d,
      design: DEFAULT_ARRAY,
      beams,
      dutyLimit: 0.78,
      patients: 1,
      loops: 5,
    });
    expect(r.verdict).toBe("not-assessed");
  });
});

const readGz = (path: string) => {
  const buf = gunzipSync(readFileSync(path));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

/** The shipped anatomy, with region measures computed from the label map. */
const shippedAnatomy = () => {
  const an = parseAnatomy(readGz("public/sim/anatomy.bin.gz"));
  attachRegionMeasures(an, parseRegionLabels(readGz("public/sim/regions.nii.gz")));
  return an;
};

describe("region measures", () => {
  it("computes volume and per-hemisphere centroids from a label map", () => {
    // 4 × 2 × 1 voxels of 2 mm, x = 2i − 3 (so columns 0–1 are left, 2–3 right).
    const affine = new Float64Array([2, 0, 0, -3, 0, 2, 0, 10, 0, 0, 2, -4, 0, 0, 0, 1]);
    const labels = new Uint8Array([1, 1, 1, 0, 2, 0, 0, 0]);
    const m = regionMeasures(labels, [4, 2, 1], affine);
    const one = m.get(1)!;
    expect(one.voxels).toBe(3);
    expect(one.volumeMm3).toBe(24);
    expect(one.sides.left).toEqual([-2, 10, -4]); // voxels (0,0) and (1,0)
    expect(one.sides.right).toEqual([1, 10, -4]); // voxel (2,0)
    expect(one.centroid[0]).toBeCloseTo(-1, 9);
    const two = m.get(2)!;
    expect(two.sides.right).toBeUndefined();
    expect(two.centroid).toEqual([-3, 12, -4]); // voxel (0,1)
  });

  it("refuses a mesh whose label has no voxels", () => {
    const an = parseAnatomy(readGz("public/sim/anatomy.bin.gz"));
    expect(() => attachRegionMeasures(an, new Map())).toThrow(/no voxels/);
  });
});

describe("anatomy asset", () => {
  it("defines the network model's regions and the anatomy-only ones, none from Harvard-Oxford", () => {
    const spec = JSON.parse(readFileSync("tools/demo-assets/sim_regions.json", "utf8")) as {
      regions: { key: string; atlas: string; simulated?: boolean }[];
    };
    const simulated = spec.regions.filter((r) => r.simulated !== false).map((r) => r.key);
    const shown = spec.regions.filter((r) => r.simulated === false).map((r) => r.key);
    expect(simulated.sort()).toEqual(REGIONS.map((r) => r.key).sort());
    expect(shown.sort()).toEqual([...ANATOMY_ONLY].sort());
    const an = parseAnatomy(readGz("public/sim/anatomy.bin.gz"));
    const labels = new Set<number>();
    for (const [i, r] of spec.regions.entries()) {
      const mesh = an.meshes.get(r.key)!;
      expect(mesh.source).toBe(r.atlas);
      expect(["aseg", "massp", "schaefer2018"]).toContain(mesh.source);
      // Label values follow the list, so adding regions never renumbers one.
      expect(mesh.label).toBe(i + 1);
      labels.add(mesh.label!);
      // Nothing positional is stored in the asset: it is computed at load.
      expect(mesh.centroid).toBeUndefined();
    }
    expect(labels.size).toBe(spec.regions.length);
    expect(spec.regions.length).toBe(18);
  });

  it("keeps anatomy-only regions out of the network and out of every programme", () => {
    for (const k of ANATOMY_ONLY) {
      expect(isSimulated(k)).toBe(false);
      expect((R as Record<string, number>)[k]).toBeUndefined();
    }
    for (const d of DISEASES) for (const t of d.targets) expect(isSimulated(t)).toBe(true);
    // Every broader stand-in region is anatomy-only and cortical.
    for (const k of Object.keys(STANDS_FOR) as AnyRegionKey[]) {
      expect(isSimulated(k)).toBe(false);
      expect(isGated(k)).toBe(false);
    }
  });

  it("computes every region's centroids from the label map", () => {
    const an = shippedAnatomy();
    for (const key of [...REGIONS.map((r) => r.key), ...ANATOMY_ONLY]) {
      const mesh = an.meshes.get(key)!;
      expect(mesh.volumeMm3!).toBeGreaterThan(100);
      expect(mesh.sides!.left![0]).toBeLessThan(0);
      expect(mesh.sides!.right![0]).toBeGreaterThan(0);
    }
    // V1 is calcarine cortex: medial and occipital.
    const v1 = targetPoint(an.meshes.get("v1")!, "left");
    expect(v1[0]).toBeGreaterThan(-20);
    expect(v1[1]).toBeLessThan(-70);
    // The extrastriate regions sit above and below it.
    expect(targetPoint(an.meshes.get("vis_dorsal")!, "left")[2]).toBeGreaterThan(v1[2] + 10);
    expect(targetPoint(an.meshes.get("vis_ventral")!, "left")[2]).toBeLessThan(v1[2]);
    // The LGN lies lateral to and below the thalamus centroid.
    const lgn = targetPoint(an.meshes.get("lgn")!, "left");
    const th = targetPoint(an.meshes.get("thalamus")!, "left");
    expect(lgn[0]).toBeLessThan(th[0]);
    expect(lgn[2]).toBeLessThan(th[2]);
  });

  it("parses the shipped atlas meshes in MNI space and places arrays on the outer surface", () => {
    const an = shippedAnatomy();
    for (const k of ["cortex", "outer", "hippocampus", "amygdala", "stn", "v1", "motor"])
      expect(an.meshes.has(k)).toBe(true);
    const hip = an.meshes.get("hippocampus")!;
    const left: Vec3 = targetPoint(hip, "left");
    expect(left[0]).toBeLessThan(0); // RAS: left is negative x
    expect(hip.volumeMm3!).toBeGreaterThan(3000);
    const pl = placeArray(an.meshes.get("outer")!, left);
    expect(pl.depthMm).toBeGreaterThan(5);
    expect(pl.depthMm).toBeLessThan(30);
    const n = Math.hypot(...pl.normal);
    expect(n).toBeCloseTo(1, 6);
  });
});

describe("gated regions and depth", () => {
  it("finds the nearest vertex of a point set", () => {
    const pts: AnatomyMesh = {
      key: "p",
      name: "p",
      colour: "#000",
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 3, 4]),
      indices: new Uint32Array(0),
    };
    const n = nearestVertex(pts, [0, 6, 8]);
    expect(n.point).toEqual([0, 3, 4]);
    expect(n.distMm).toBeCloseTo(5, 9);
  });

  it("ships the scalp as a point set that the scene does not draw as a region", () => {
    const scalp = shippedAnatomy().meshes.get("scalp")!;
    expect(scalp.positions.length / 3).toBeGreaterThan(10_000);
    expect(scalp.indices.length).toBe(0);
    expect(scalp.label).toBeUndefined();
  });

  it("covers the whole head, so deep targets measure to the side of the head", () => {
    const an = shippedAnatomy();
    const scalp = an.meshes.get("scalp")!;
    let minZ = Infinity;
    for (let i = 2; i < scalp.positions.length; i += 3) minZ = Math.min(minZ, scalp.positions[i]!);
    // Down to the bottom of the image, not just the top of the head.
    expect(minZ).toBeLessThan(-60);
    // The amygdala's nearest skin is lateral (temple), not the airway or the cut.
    const amy = targetPoint(an.meshes.get("amygdala")!, "left");
    const near = nearestVertex(scalp, amy).point;
    expect(near[0]).toBeLessThan(-60);
    expect(Math.abs(near[2] - amy[2])).toBeLessThan(15);
  });

  it("gates exactly the subcortical regions", () => {
    const an = shippedAnatomy();
    expect(GATED_REGIONS.filter(isSimulated).sort()).toEqual([
      "amygdala",
      "hippocampus",
      "stn",
      "thalamus",
    ]);
    let n = 0;
    for (const mesh of an.meshes.values()) {
      if (mesh.label === undefined) continue;
      n++;
      expect(isGated(mesh.key as AnyRegionKey)).toBe(mesh.source !== "schaefer2018");
    }
    expect(n).toBe(18);
  });

  it("measures depth below the scalp and below the brain surface on the template", () => {
    const an = shippedAnatomy();
    const depths = allRegionDepths(an);
    expect(depths.map((d) => d.region)).toEqual([
      ...REGIONS.map((r) => r.key).sort(
        (a, b) => an.meshes.get(a)!.label! - an.meshes.get(b)!.label!,
      ),
      ...ANATOMY_ONLY,
    ]);
    for (const d of depths) {
      expect(d.mni).toEqual(targetPoint(an.meshes.get(d.region)!, "left"));
      expect(d.belowBrainMm).toBeGreaterThan(0);
      expect(d.belowScalpMm).toBeGreaterThan(d.belowBrainMm);
    }
    // The computed amygdala depth falls inside the published 5–7 cm range.
    const amy = depths.find((d) => d.region === "amygdala")!;
    expect(amy.belowScalpMm).toBeGreaterThanOrEqual(AMYGDALA_SCALP_RANGE_MM[0]);
    expect(amy.belowScalpMm).toBeLessThanOrEqual(AMYGDALA_SCALP_RANGE_MM[1]);
    // Among the network's regions, every gated one lies deeper below the
    // scalp than every cortical one.
    const net = depths.filter((d) => isSimulated(d.region));
    const gated = net.filter((d) => isGated(d.region)).map((d) => d.belowScalpMm);
    const cortical = net.filter((d) => !isGated(d.region)).map((d) => d.belowScalpMm);
    expect(Math.min(...gated)).toBeGreaterThan(Math.max(...cortical));
    // Not so for all cortex: the ventral visual region is on the basal surface,
    // above the cerebellum, and sits about as deep as the putamen.
    const at = (k: AnyRegionKey) => depths.find((d) => d.region === k)!.belowScalpMm;
    expect(at("vis_ventral")).toBeGreaterThan(at("smg") + 20);
  });

  it("returns nothing until the anatomy has region measures", () => {
    const an = parseAnatomy(readGz("public/sim/anatomy.bin.gz"));
    expect(regionDepth(an, "amygdala")).toBeNull();
  });
});

describe("placement and plan", () => {
  const pd = diseaseByKey("parkinsons");
  const design: ArrayDesign = {
    ...DEFAULT_ARRAY,
    frequencyHz: 7.5e6,
    pitchM: 2 * wavelengthM(7.5e6),
  };

  it("uses the same acoustic quantities the PRISM gate checks", () => {
    const beams = computeBeams(design, [{ region: "stn", placement: straight(14) }]);
    const plan = planTarget(beams[0]!, design, 0.78);
    const sim = new CircuitSim({
      disease: pd,
      severity: 0.8,
      design,
      beams,
      seed: 1,
      dutyLimit: 0.78,
      gated: true,
    });
    const gate = sim.acoustics([1])[0]!;
    const by = (k: string) => plan.margins.find((m) => m.key === k)!;
    expect(by("mi").value).toBeCloseTo(gate.mechanicalIndex, 12);
    expect(by("ispta").value).toBeCloseTo(gate.isptaMwCm2, 9);
    expect(by("offTarget").value).toBe(gate.offTargetFraction);
    // ΔT is the steady state the gate's burst-by-burst heating converges to.
    let t = 0;
    for (let i = 0; i < 2000; i++)
      t = heatStep(
        t,
        beams[0]!.metrics.isppaWcm2 * 0.1,
        design.frequencyHz,
        beams[0]!.metrics.lateralFwhmMm,
        0.0156,
      );
    expect(by("deltaT").value).toBeCloseTo(t, 9);
    expect(by("deltaT").value).toBeGreaterThanOrEqual(gate.predictedTempC);
    expect(plan.centre).toEqual([0, 0, 0]);
    expect(plan.depthMm).toBe(14);
  });

  it("passes a deliverable target and fails one the array cannot focus on", () => {
    const ok = computeBeams(design, [{ region: "stn", placement: straight(14) }])[0]!;
    expect(deliverable(ok)).toBe(true);
    expect(planTarget(ok, design, 0.78).pass).toBe(true);
    const deep = computeBeams(DEFAULT_ARRAY, [{ region: "stn", placement: straight(30) }])[0]!;
    expect(deliverable(deep)).toBe(false);
    const plan = planTarget(deep, DEFAULT_ARRAY, 0.78);
    expect(plan.pass).toBe(false);
    const failed = plan.margins.filter((m) => !m.pass).map((m) => m.key);
    expect(failed.some((k) => k === "offTarget" || k === "focus")).toBe(true);
    for (const m of plan.margins) expect(m.pass).toBe(m.value <= m.limit);
  });

  it("lists what it does not model without giving it a number", () => {
    expect(NOT_MODELLED.map((n) => n.label)).toEqual([
      "RF SAR",
      "Stimulation charge density",
      "Distance to major vessels",
    ]);
    for (const n of NOT_MODELLED) expect(n.reason).not.toMatch(/\d/);
  });
});
