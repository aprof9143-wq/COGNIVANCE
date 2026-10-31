import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
import { GenePage } from "@/components/genomics/GenePage";

export const Route = createFileRoute("/genomics_/$symbol")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.symbol} — Gene Library — Cognivance Labs` },
      {
        name: "description",
        content: `Curations, identifiers, orthologues and phenotypes recorded for ${params.symbol}, with their sources. Research software; not a medical device.`,
      },
    ],
  }),
  component: Page,
});

function Page() {
  const { symbol } = Route.useParams();
  return (
    <Gated path="/genomics">
      <GenePage symbol={symbol} />
    </Gated>
  );
}
