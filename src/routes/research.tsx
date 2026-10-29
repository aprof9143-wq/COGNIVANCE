import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
import { ResearchConsole } from "@/components/research/ResearchConsole";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "NIMBLE Research OS — Cognivance Labs" },
      {
        name: "description",
        content:
          "GPU volume rendering of MRI fused with EEG spectral analysis, in one coordinate frame.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Gated path="/research">
      <ResearchConsole />
    </Gated>
  );
}
