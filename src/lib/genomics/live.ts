/**
 * A live check of one gene against its sources, run on the server (the
 * route src/routes/api.genomics.live.ts) so no key or third-party response
 * shape reaches the browser. It re-reads HGNC and Ensembl Compara now and reports, per source,
 * what came back, failed or was withheld by the source policy. The result is
 * shown beside the snapshot, never written into it.
 */
import libraryCfg from "../../../config/genome/library.json";
import { z } from "zod";
import type { Licences } from "@/lib/genome/config";
import { decide } from "@/lib/genome/policy";
import { HgncRecord, Orthologue } from "./schema";

export const HGNC_URL = "https://rest.genenames.org";
export const ENSEMBL_URL = "https://rest.ensembl.org";
export const SYMBOL = /^[A-Z0-9][A-Za-z0-9-]{0,29}$/;

export type LiveSource = {
  id: "hgnc-rest" | "ensembl-compara";
  status: "ok" | "failed" | "withheld" | "skipped";
  url: string | null;
  checkedAt: string;
  detail?: string;
};

export type LiveCheck = {
  mode: "live";
  symbol: string;
  checkedAt: string;
  sources: LiveSource[];
  hgnc: HgncRecord | null;
  /** null when Ensembl was not read; [] when it reported none. */
  orthologues: Orthologue[] | null;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type LiveOptions = {
  fetcher?: Fetcher;
  /** The licence inventory to decide with; the committed one by default. */
  licences?: Licences;
  now?: () => Date;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
};

class SourceFailure extends Error {}

/** GET with a timeout, retrying network errors, 429 and 5xx; a definite 4xx is not retried. */
export async function getJson(
  url: string,
  o: Required<Pick<LiveOptions, "fetcher" | "timeoutMs" | "retries" | "sleep">>,
): Promise<unknown> {
  let last = "";
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs);
    try {
      const res = await o.fetcher(url, {
        headers: { Accept: "application/json" },
        signal: ctl.signal,
      });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;
      const wait = Number(res.headers.get("Retry-After"));
      if (attempt < o.retries)
        await o.sleep(
          Math.min(Number.isFinite(wait) && wait > 0 ? wait * 1000 : 500 * 2 ** attempt, 2000),
        );
    } catch (e) {
      last = ctl.signal.aborted ? `no answer within ${o.timeoutMs / 1000} s` : (e as Error).message;
      if (attempt < o.retries) await o.sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SourceFailure(last || "no answer");
}

const HgncResponse = z.object({
  response: z.object({
    docs: z.array(
      z.object({
        symbol: z.string().optional(),
        name: z.string().optional(),
        status: z.string().optional(),
        hgnc_id: z.string().optional(),
        entrez_id: z.union([z.string(), z.number()]).optional(),
        ensembl_gene_id: z.string().optional(),
        uniprot_ids: z.array(z.string()).optional(),
        locus_group: z.string().optional(),
        location: z.string().optional(),
      }),
    ),
  }),
});

export function hgncFromResponse(raw: unknown): HgncRecord | null {
  const r = HgncResponse.safeParse(raw);
  if (!r.success || r.data.response.docs.length !== 1) return null;
  const d = r.data.response.docs[0]!;
  return {
    symbol: d.symbol || null,
    name: d.name || null,
    status: d.status || null,
    hgncId: d.hgnc_id || null,
    ncbiGeneId: d.entrez_id ? String(d.entrez_id) : null,
    ensemblGeneId: d.ensembl_gene_id || null,
    uniprotIds: [...(d.uniprot_ids ?? [])].sort(),
    locusGroup: d.locus_group || null,
    location: d.location || null,
  };
}

const n = z.number().nullish();
const Side = z.object({
  id: z.string().nullish(),
  species: z.string().nullish(),
  taxon_id: n,
  protein_id: z.string().nullish(),
  perc_id: n,
  perc_pos: n,
});
const HomologyResponse = z.object({
  data: z.array(
    z.object({
      homologies: z
        .array(
          z.object({
            type: z.string().nullish(),
            taxonomy_level: z.string().nullish(),
            method_link_type: z.string().nullish(),
            dn_ds: n,
            source: Side.nullish(),
            target: Side.nullish(),
          }),
        )
        .nullish(),
    }),
  ),
});

const round = (v: number | null | undefined) =>
  typeof v === "number" ? Math.round(v * 100) / 100 : null;

/** The same reduction as tools/genome-library/capture_library.py parse_homology. */
export function orthologuesFromResponse(raw: unknown): Orthologue[] {
  const wanted = new Set(
    libraryCfg.species.filter((s) => s.role === "comparison").map((s) => s.ensembl),
  );
  const r = HomologyResponse.safeParse(raw);
  if (!r.success) throw new SourceFailure("Ensembl returned an unexpected homology response.");
  const out: Orthologue[] = [];
  for (const e of r.data.data)
    for (const h of e.homologies ?? []) {
      const t = h.target ?? {};
      if (!(h.type ?? "").startsWith("ortholog") || !t.species || !wanted.has(t.species)) continue;
      out.push({
        species: t.species,
        taxonId: t.taxon_id ?? null,
        type: h.type!,
        geneId: t.id ?? null,
        proteinId: t.protein_id ?? null,
        percId: round(t.perc_id),
        percPos: round(t.perc_pos),
        sourcePercId: round(h.source?.perc_id),
        taxonomyLevel: h.taxonomy_level ?? null,
        dnDs: round(h.dn_ds),
        method: h.method_link_type ?? null,
      });
    }
  return out.sort(
    (a, b) => a.species.localeCompare(b.species) || (a.geneId ?? "").localeCompare(b.geneId ?? ""),
  );
}

function refused(id: LiveSource["id"], licences?: Licences): string {
  for (const a of ["fetch", "display"] as const) {
    const d = decide(id, a, "research", licences ? { licences } : {});
    if (!d.allowed) return d.reason;
  }
  return "";
}

export async function liveCheck(symbol: string, opts: LiveOptions = {}): Promise<LiveCheck> {
  if (!SYMBOL.test(symbol)) throw new Error(`"${symbol}" is not a valid HGNC gene symbol.`);
  const o = {
    fetcher: opts.fetcher ?? ((u: string, i?: RequestInit) => fetch(u, i)),
    timeoutMs: opts.timeoutMs ?? 8000,
    retries: opts.retries ?? 2,
    sleep: opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  };
  const now = opts.now ?? (() => new Date());
  const at = () => now().toISOString();
  const sources: LiveSource[] = [];

  let hgnc: HgncRecord | null = null;
  const hgncUrl = `${HGNC_URL}/fetch/symbol/${encodeURIComponent(symbol)}`;
  const hgncRefused = refused("hgnc-rest", opts.licences);
  if (hgncRefused) {
    sources.push({
      id: "hgnc-rest",
      status: "withheld",
      url: null,
      checkedAt: at(),
      detail: hgncRefused,
    });
  } else {
    try {
      hgnc = hgncFromResponse(await getJson(hgncUrl, o));
      sources.push(
        hgnc
          ? { id: "hgnc-rest", status: "ok", url: hgncUrl, checkedAt: at() }
          : {
              id: "hgnc-rest",
              status: "failed",
              url: hgncUrl,
              checkedAt: at(),
              detail: "No single HGNC record for this symbol.",
            },
      );
    } catch (e) {
      sources.push({
        id: "hgnc-rest",
        status: "failed",
        url: hgncUrl,
        checkedAt: at(),
        detail: (e as Error).message,
      });
    }
  }

  let orthologues: Orthologue[] | null = null;
  const ensRefused = refused("ensembl-compara", opts.licences);
  if (ensRefused) {
    sources.push({
      id: "ensembl-compara",
      status: "withheld",
      url: null,
      checkedAt: at(),
      detail: ensRefused,
    });
  } else if (!hgnc?.ensemblGeneId) {
    sources.push({
      id: "ensembl-compara",
      status: "skipped",
      url: null,
      checkedAt: at(),
      detail: "Needs the Ensembl gene ID from HGNC, which was not available.",
    });
  } else {
    const targets = libraryCfg.species
      .filter((s) => s.role === "comparison")
      .map((s) => `target_species=${s.ensembl}`)
      .join(";");
    const url = `${ENSEMBL_URL}/homology/id/human/${encodeURIComponent(hgnc.ensemblGeneId)}?content-type=application/json;type=orthologues;sequence=none;format=full;${targets}`;
    try {
      orthologues = orthologuesFromResponse(await getJson(url, o));
      sources.push({ id: "ensembl-compara", status: "ok", url, checkedAt: at() });
    } catch (e) {
      sources.push({
        id: "ensembl-compara",
        status: "failed",
        url,
        checkedAt: at(),
        detail: (e as Error).message,
      });
    }
  }
  return { mode: "live", symbol, checkedAt: at(), sources, hgnc, orthologues };
}

// ------------------------------------------------------------ browser side

export const LIVE_ENDPOINT = "/api/genomics/live";

const LiveCheckSchema = z.object({
  mode: z.literal("live"),
  symbol: z.string(),
  checkedAt: z.string(),
  sources: z.array(
    z.object({
      id: z.enum(["hgnc-rest", "ensembl-compara"]),
      status: z.enum(["ok", "failed", "withheld", "skipped"]),
      url: z.string().nullable(),
      checkedAt: z.string(),
      detail: z.string().optional(),
    }),
  ),
  hgnc: HgncRecord.nullable(),
  orthologues: z.array(Orthologue).nullable(),
});

/** Ask the server for a live check; the answer is validated before it is shown. */
export async function requestLiveCheck(
  symbol: string,
  fetcher: (url: string) => Promise<Response> = (u) => fetch(u),
): Promise<LiveCheck> {
  const res = await fetcher(`${LIVE_ENDPOINT}?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`the server answered HTTP ${res.status}`);
  return LiveCheckSchema.parse(await res.json()) as LiveCheck;
}
