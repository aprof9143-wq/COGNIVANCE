import { useCallback, useEffect, useState } from "react";
import { missing, type Sourced } from "@/lib/vision/evidence";
import { parsePdbBackbone, type Backbone } from "@/lib/vision/pdb";
import {
  loadSnapshot,
  type DisplayManifest,
  type Sequences,
  type VariantSet,
} from "@/lib/vision/snapshot";
import { fetchStructureText, loadVisionRecord, type VisionRecord } from "@/lib/vision/sources";

const fetcher = (u: string, i?: RequestInit) => fetch(u, i);

export type EvidenceMode = "snapshot" | "live";

export type Evidence = {
  status: "loading" | "done";
  mode: EvidenceMode;
  record: VisionRecord | null;
  variants: Sourced<VariantSet> | null;
  sequences: Sourced<Sequences> | null;
  manifest: DisplayManifest | null;
  /** The predicted model's coordinates, from wherever the record came from. */
  loadModelText: (() => Promise<string>) | null;
  /** Set when the snapshot could not be read and live data was used instead. */
  fallback?: string | undefined;
};

/**
 * The RPE65 evidence: the captured snapshot by default (works on any network,
 * reproducible), or the live databases on request. Variants and sequences
 * come from the snapshot in both modes; the live clients do not fetch them.
 */
export function useEvidence(symbol: string, taxonId: number) {
  const [mode, setMode] = useState<EvidenceMode>("snapshot");
  const [n, setN] = useState(0);
  const [ev, setEv] = useState<Evidence>({
    status: "loading",
    mode: "snapshot",
    record: null,
    variants: null,
    sequences: null,
    manifest: null,
    loadModelText: null,
  });

  useEffect(() => {
    const ac = new AbortController();
    let dead = false;
    setEv((e) => ({ ...e, status: "loading", mode }));
    (async () => {
      let snap: Awaited<ReturnType<typeof loadSnapshot>> | null = null;
      let fallback: string | undefined;
      try {
        snap = await loadSnapshot(fetcher);
      } catch (e) {
        fallback = `The snapshot could not be read (${(e as Error).message}); using the live databases.`;
      }
      if (dead) return;
      if (snap && mode === "snapshot") {
        setEv({
          status: "done",
          mode,
          record: { gene: snap.gene, protein: snap.protein, model: snap.model },
          variants: snap.variants,
          sequences: snap.sequences,
          manifest: snap.manifest,
          loadModelText: snap.structure,
        });
        return;
      }
      let record: VisionRecord;
      try {
        record = await loadVisionRecord(symbol, taxonId, fetcher, ac.signal);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const gap = missing<never>((e as Error).message);
        record = { gene: gap, protein: gap, model: gap };
      }
      if (dead) return;
      const model = record.model.state === "value" ? record.model.value : null;
      setEv({
        status: "done",
        mode: snap ? mode : "live",
        record,
        variants:
          snap?.variants ?? missing("Variants come from the snapshot, which could not be read."),
        sequences:
          snap?.sequences ?? missing("Sequences come from the snapshot, which could not be read."),
        manifest: snap?.manifest ?? null,
        loadModelText: model
          ? async () => {
              const r = await fetchStructureText(model.pdbUrl, fetcher, ac.signal);
              if (!r.ok) throw new Error(r.reason);
              return r.data;
            }
          : null,
        fallback,
      });
    })();
    return () => {
      dead = true;
      ac.abort();
    };
  }, [symbol, taxonId, mode, n]);

  return {
    ev,
    setMode,
    reload: useCallback(() => setN((x) => x + 1), []),
  };
}

export type StructureState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "gap"; reason: string }
  | { status: "ready"; backbone: Backbone; text: string; retrievedAt: string };

/** Load coordinates with `load`; `key` changes when the source does. */
export function useStructure(key: string | null, load: (() => Promise<string>) | null) {
  const [state, setState] = useState<StructureState>({ status: "idle" });
  useEffect(() => {
    if (!key || !load) {
      setState({ status: "idle" });
      return;
    }
    let dead = false;
    setState({ status: "loading" });
    load()
      .then((text) => {
        if (dead) return;
        const backbone = parsePdbBackbone(text);
        if (!backbone.residues.length)
          return setState({
            status: "gap",
            reason:
              "The file contained no alpha-carbon records. Very large entries are published only as mmCIF, which this viewer does not read yet.",
          });
        setState({ status: "ready", backbone, text, retrievedAt: new Date().toISOString() });
      })
      .catch((e: Error) => {
        if (!dead && e.name !== "AbortError") setState({ status: "gap", reason: e.message });
      });
    return () => {
      dead = true;
    };
    // `load` changes identity with each render; `key` names the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
