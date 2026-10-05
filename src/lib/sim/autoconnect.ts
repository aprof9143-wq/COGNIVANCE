/**
 * AutoConnector: implant topology → wired circuit, the way Proteus builds a
 * netlist from a schematic.
 *
 * Every required input port is matched to an output port of the same type on
 * another placed component. Power is a rail: one harvester output feeds every
 * power input. Then design rules run over the result, including the one that
 * matters most here — nothing that can write to tissue (an acoustic or payload
 * output) may exist without a gate input wired to PRISM.
 */

import { COMPONENTS, LAYER_ORDER, type ComponentSpec, type Port, type PortType } from "./specs";

export type Endpoint = { component: string; port: string };

export type Net = {
  id: string;
  type: PortType;
  from: Endpoint;
  to: Endpoint;
};

export type DrcSeverity = "error" | "warning";
export type DrcResult = {
  rule: string;
  severity: DrcSeverity;
  message: string;
  component?: string;
};

export type Topology = {
  /** Component ids placed on the implant. */
  components: string[];
};

export type Circuit = {
  components: ComponentSpec[];
  nets: Net[];
  drc: DrcResult[];
  /** Order the components are placed in, following the signal path. */
  assemblyOrder: string[];
  power: { drawMw: number; harvestMw: number; dutyLimit: number };
  ok: boolean;
};

const PRIORITY: Record<string, string[]> = {
  // Which producer a consumer prefers when several could serve it.
  gate: ["prism"],
  intent: ["prism"],
  drive: ["steerer"],
  prediction: ["synapse"],
  "neural-data": ["asic"],
  electrode: ["mesh"],
  power: ["harvester"],
};

export function autoConnect(topology: Topology): Circuit {
  const placed = topology.components
    .map((id) => COMPONENTS.find((c) => c.id === id))
    .filter((c): c is ComponentSpec => Boolean(c));

  const nets: Net[] = [];
  const drc: DrcResult[] = [];
  const used = new Map<string, number>(); // "comp.port" -> nets on an output

  const outputs = (type: PortType) =>
    placed.flatMap((c) =>
      c.ports.filter((p) => p.dir === "out" && p.type === type).map((p) => ({ c, p })),
    );

  for (const consumer of placed) {
    for (const inPort of consumer.ports.filter((p) => p.dir === "in")) {
      const candidates = outputs(inPort.type).filter(({ c }) => c.id !== consumer.id);
      const prefer = PRIORITY[inPort.type] ?? [];
      candidates.sort(
        (a, b) =>
          (prefer.indexOf(a.c.id) === -1 ? 99 : prefer.indexOf(a.c.id)) -
          (prefer.indexOf(b.c.id) === -1 ? 99 : prefer.indexOf(b.c.id)),
      );
      const pick = candidates.find(
        ({ c, p }) => (used.get(`${c.id}.${p.id}`) ?? 0) < (p.fanout ?? 1),
      );
      if (!pick) {
        if (inPort.required) {
          drc.push({
            rule: "ERC-UNCONNECTED",
            severity: "error",
            message: `${consumer.name}: required input "${inPort.label}" (${inPort.type}) has no driver.`,
            component: consumer.id,
          });
        }
        continue;
      }
      const key = `${pick.c.id}.${pick.p.id}`;
      used.set(key, (used.get(key) ?? 0) + 1);
      nets.push({
        id: `N${String(nets.length + 1).padStart(2, "0")}`,
        type: inPort.type,
        from: { component: pick.c.id, port: pick.p.id },
        to: { component: consumer.id, port: inPort.id },
      });
    }
  }

  // Required outputs nobody listens to (e.g. an array with no tissue path is fine;
  // an ASIC whose stream goes nowhere is not).
  for (const c of placed) {
    for (const p of c.ports.filter((x) => x.dir === "out" && x.required)) {
      if (p.type === "acoustic" || p.type === "payload") continue; // these drive tissue
      if (!nets.some((n) => n.from.component === c.id && n.from.port === p.id)) {
        drc.push({
          rule: "ERC-FLOATING",
          severity: "warning",
          message: `${c.name}: output "${p.label}" drives nothing.`,
          component: c.id,
        });
      }
    }
  }

  // The CIRCUIT safety rule, checked structurally: no tissue write path without PRISM.
  for (const c of placed) {
    const writes = c.ports.some(
      (p) => p.dir === "out" && (p.type === "acoustic" || p.type === "payload"),
    );
    if (!writes) continue;
    const gated = nets.some(
      (n) => n.to.component === c.id && n.type === "gate" && n.from.component === "prism",
    );
    if (!gated) {
      drc.push({
        rule: "SAFETY-GATE",
        severity: "error",
        message: `${c.name} can write to tissue but its gate is not wired to PRISM — the loop would allow unverified write-back.`,
        component: c.id,
      });
    }
  }

  const drawMw = placed.reduce((s, c) => s + Math.max(0, c.powerMw), 0);
  const harvestMw = placed.reduce((s, c) => s + Math.max(0, -c.powerMw), 0);
  if (harvestMw === 0 && drawMw > 0) {
    drc.push({ rule: "PWR-SOURCE", severity: "error", message: "No power source placed." });
  } else if (drawMw > harvestMw) {
    drc.push({
      rule: "PWR-BUDGET",
      severity: "warning",
      message: `Continuous draw ${drawMw.toFixed(1)} mW exceeds harvested ${harvestMw.toFixed(1)} mW — the array must duty-cycle to ${((harvestMw / drawMw) * 100).toFixed(0)} %.`,
    });
  }

  const assemblyOrder = [...placed]
    .sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer))
    .map((c) => c.id);

  return {
    components: placed,
    nets,
    drc,
    assemblyOrder,
    power: { drawMw, harvestMw, dutyLimit: drawMw > 0 ? Math.min(1, harvestMw / drawMw) : 1 },
    ok: !drc.some((d) => d.severity === "error"),
  };
}

/** The full NIMBLE implant: every component in the library. */
export const FULL_TOPOLOGY: Topology = { components: COMPONENTS.map((c) => c.id) };

export const portOf = (c: ComponentSpec, id: string): Port | undefined =>
  c.ports.find((p) => p.id === id);
