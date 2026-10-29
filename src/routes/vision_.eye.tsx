import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
import { EyeSimulation } from "@/components/vision/EyeSimulation";

export const Route = createFileRoute("/vision_/eye")({
  head: () => ({
    meta: [
      { title: "Eye Simulation — Cognivance Labs" },
      {
        name: "description",
        content:
          "A labelled, real-time cutaway of a schematic human eye: light paths, focusing, the image on the retina, and where RPE65 works. Research software; not a medical device.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Gated path="/vision/eye">
      <EyeSimulation />
    </Gated>
  );
}
