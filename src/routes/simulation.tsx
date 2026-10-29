import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
import { SimulationWindow } from "@/components/sim/SimulationWindow";

export const Route = createFileRoute("/simulation")({
  head: () => ({
    meta: [
      { title: "CIRCUIT Simulation Window — Cognivance Labs" },
      {
        name: "description",
        content:
          "Closed-loop neural implant simulation: auto-assembled components, focused-ultrasound physics and a PRISM-gated loop on MNI152 anatomy.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Gated path="/simulation">
      <SimulationWindow />
    </Gated>
  );
}
