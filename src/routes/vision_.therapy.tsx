import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
import { TherapySimulator } from "@/components/vision/TherapySimulator";

export const Route = createFileRoute("/vision_/therapy")({
  head: () => ({
    meta: [
      { title: "Gene Therapy Simulator — Cognivance Labs" },
      {
        name: "description",
        content:
          "A labelled, hypothetical simulation of RPE65 gene augmentation, from the patient's genotype to the visual cortex. Research software; not a medical device.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Gated path="/vision/therapy">
      <TherapySimulator />
    </Gated>
  );
}
