import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
import { ComparePage } from "@/components/genomics/ComparePage";

export const Route = createFileRoute("/genomics_/compare")({
  head: () => ({
    meta: [
      { title: "Cross-Species Comparison — Cognivance Labs" },
      {
        name: "description",
        content:
          "Orthologues of library genes across species from Ensembl Compara, against a stated baseline, with the evidence behind every cell. Research software; not a medical device.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Gated path="/genomics/compare">
      <ComparePage />
    </Gated>
  );
}
