import { createFileRoute } from "@tanstack/react-router";
import { liveCheck, SYMBOL } from "@/lib/genomics/live";

/**
 * GET /api/genomics/live?symbol=ADNP: the live check behind "Check now" on a
 * gene page. It runs on the server, so no third-party response shape reaches
 * the browser; HGNC and Ensembl need no credentials. Never cached.
 */
export const Route = createFileRoute("/api/genomics/live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
        if (!SYMBOL.test(symbol))
          return Response.json(
            { error: "symbol must be an HGNC gene symbol" },
            { status: 400, headers: { "cache-control": "no-store" } },
          );
        return Response.json(await liveCheck(symbol), { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
