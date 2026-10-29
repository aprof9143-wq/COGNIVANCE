import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
import { NeuroDashboard } from "@/components/neuro/NeuroDashboard";

export const Route = createFileRoute("/neurodegeneration")({
  head: () => ({
    meta: [
      { title: "Neurodegeneration Tracking — Cognivance Labs" },
      {
        name: "description",
        content:
          "Research tool for structural change tracking and symptom–network research maps. Not a diagnostic device; no Alzheimer's probability is computed.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Gated path="/neurodegeneration">
      <NeuroDashboard />
    </Gated>
  );
}
