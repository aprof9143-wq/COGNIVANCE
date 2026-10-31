import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
import { LibraryPage } from "@/components/genomics/LibraryPage";

export const Route = createFileRoute("/genomics")({
  head: () => ({
    meta: [
      { title: "Gene Library — Cognivance Labs" },
      {
        name: "description",
        content:
          "A research library of genes with ClinGen gene–disease validity curations for autism spectrum disorder and Alzheimer disease, with identifiers, orthologues and provenance. Research software; not a medical device.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Gated path="/genomics">
      <LibraryPage />
    </Gated>
  );
}
