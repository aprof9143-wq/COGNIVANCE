import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
import { VisionModule } from "@/components/vision/VisionModule";

export const Route = createFileRoute("/vision")({
  head: () => ({
    meta: [
      { title: "Vision Evidence — Cognivance Labs" },
      {
        name: "description",
        content:
          "Evidence-linked gene, protein and 3D structure records for RPE65, from public reference databases with provenance. Research software; not a medical device.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Gated path="/vision">
      <VisionModule />
    </Gated>
  );
}
