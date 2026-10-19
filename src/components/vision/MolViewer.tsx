import { useEffect, useRef, useState } from "react";
import type { PluginContext } from "molstar/lib/mol-plugin/context";

/**
 * Mol* (molstar.org, MIT) showing one structure file. The file is the one the
 * evidence record fetched, handed over as text, so what is drawn and what is
 * cited are the same bytes.
 *
 * Mol* is imported only in the browser, inside the effect: it stays out of
 * the server bundle and loads only when a structure is shown.
 */

export type MolStyle = "cartoon" | "surface" | "atoms";
export type MolColour = "plddt" | "chain";

export type HoverInfo = { name: string; seq: number; chain: string; b: number };

type Props = {
  pdbText: string;
  label: string;
  style: MolStyle;
  colourBy: MolColour;
  spin: boolean;
  /** Bump to return the camera to its starting view. */
  resetKey: number;
  onHover: (h: HoverInfo | null) => void;
};

const REPR: Record<MolStyle, string> = {
  cartoon: "cartoon",
  surface: "gaussian-surface",
  atoms: "ball-and-stick",
};

export function MolViewer({ pdbText, label, style, colourBy, spin, resetKey, onHover }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [plugin, setPlugin] = useState<PluginContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;

  // The viewer itself: once.
  useEffect(() => {
    let disposed = false;
    let ctx: PluginContext | undefined;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        const [
          { PluginContext },
          { DefaultPluginSpec },
          { Color },
          S,
          { PostprocessingParams },
          { PluginConfig },
          theme,
        ] = await Promise.all([
          import("molstar/lib/mol-plugin/context"),
          import("molstar/lib/mol-plugin/spec"),
          import("molstar/lib/mol-util/color"),
          import("molstar/lib/mol-model/structure"),
          import("molstar/lib/mol-canvas3d/passes/postprocessing"),
          import("molstar/lib/mol-plugin/config"),
          import("./molPlddtTheme"),
        ]);
        if (disposed) return;
        const spec = DefaultPluginSpec();
        // Draw with software rendering too (no GPU, many VMs and remote
        // desktops): slower, but better than an empty panel.
        spec.config = [
          ...(spec.config ?? []),
          [PluginConfig.General.AllowMajorPerformanceCaveat, true],
        ];
        ctx = new PluginContext(spec);
        await ctx.init();
        const ok = await ctx.initViewerAsync(canvas.current!, host.current!);
        if (!ok || !ctx.canvas3d) throw new Error("WebGL is not available in this browser.");
        if (disposed) return ctx.dispose();

        ctx.representation.structure.themes.colorThemeRegistry.add(theme.PlddtBandsThemeProvider);
        // Soft shading and outlines, close to the reference renders.
        ctx.canvas3d.setProps({
          transparentBackground: true,
          renderer: { ...ctx.canvas3d.props.renderer, backgroundColor: Color(0xffffff) },
          postprocessing: {
            ...ctx.canvas3d.props.postprocessing,
            occlusion: {
              name: "on",
              params: PostprocessingParams.occlusion.map("on").defaultValue,
            },
            outline: {
              name: "on",
              params: {
                ...PostprocessingParams.outline.map("on").defaultValue,
                scale: 1,
                color: Color(0x16151d),
              },
            },
          },
        });

        const sub = ctx.behaviors.interaction.hover.subscribe((e) => {
          const loci = e.current.loci;
          if (!S.StructureElement.Loci.is(loci) || S.StructureElement.Loci.isEmpty(loci)) {
            hoverRef.current(null);
            return;
          }
          const loc = S.StructureElement.Loci.getFirstLocation(loci);
          if (!loc) return hoverRef.current(null);
          const P = S.StructureProperties;
          hoverRef.current({
            name: P.atom.label_comp_id(loc),
            seq: P.residue.auth_seq_id(loc),
            chain: P.chain.auth_asym_id(loc),
            b: P.atom.B_iso_or_equiv(loc),
          });
        });
        // Without Mol*'s own UI nothing tells the viewer its box changed size.
        const ro = new ResizeObserver(() => ctx?.canvas3d?.handleResize());
        ro.observe(host.current!);
        ctx.canvas3d.handleResize();
        unsubscribe = () => {
          sub.unsubscribe();
          ro.disconnect();
        };
        setPlugin(ctx);
      } catch (e) {
        if (!disposed) setError((e as Error).message || "The 3D viewer could not start.");
      }
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
      ctx?.dispose();
      setPlugin(null);
    };
  }, []);

  // Mol* state changes run one at a time: a slow surface build must not
  // overlap the next change.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = (task: () => Promise<void>) => {
    queue.current = queue.current.then(task).catch((e: Error) => setError(e.message));
  };
  const structureRef = useRef<string | null>(null);
  const reprRef = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(0);

  // The structure: loaded once per file.
  useEffect(() => {
    if (!plugin) return;
    run(async () => {
      await plugin.clear();
      reprRef.current = null;
      const data = await plugin.builders.data.rawData({ data: pdbText, label });
      const traj = await plugin.builders.structure.parseTrajectory(data, "pdb");
      const model = await plugin.builders.structure.createModel(traj);
      const structure = await plugin.builders.structure.createStructure(model);
      structureRef.current = structure.ref;
      setError(null);
      setLoaded((n) => n + 1);
    });
  }, [plugin, pdbText, label]);

  // Its drawing: swapped when the style or colouring changes.
  useEffect(() => {
    if (!plugin || !loaded) return;
    run(async () => {
      const structure = structureRef.current;
      if (!structure) return;
      if (reprRef.current) await plugin.build().delete(reprRef.current).commit();
      const repr = await plugin.builders.structure.representation.addRepresentation(structure, {
        type: REPR[style],
        color: colourBy === "plddt" ? "cognivance-plddt" : "chain-id",
      } as never);
      const first = reprRef.current === null;
      reprRef.current = repr.ref;
      if (first) plugin.managers.camera.reset();
    });
  }, [plugin, loaded, style, colourBy]);

  useEffect(() => {
    if (!plugin?.canvas3d) return;
    const trackball = plugin.canvas3d.props.trackball;
    plugin.canvas3d.setProps({
      trackball: {
        ...trackball,
        animate: spin
          ? { name: "spin", params: { speed: 0.25, axis: [0, 1, 0] as never } }
          : { name: "off", params: {} },
      },
    });
  }, [plugin, spin]);

  useEffect(() => {
    if (plugin && resetKey) plugin.managers.camera.reset();
  }, [plugin, resetKey]);

  return (
    <div ref={host} className="absolute inset-0" role="img" aria-label={`3D structure: ${label}`}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {error && (
        <p className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-[var(--v-ink-2)]">
          {error}
        </p>
      )}
    </div>
  );
}
