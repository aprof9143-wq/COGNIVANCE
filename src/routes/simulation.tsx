import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hasSession } from "@/lib/session";
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
  component: Simulation,
});

function Simulation() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasSession()) navigate({ to: "/auth" });
    else setReady(true);
  }, [navigate]);

  if (!ready) return <div className="min-h-screen bg-[#01040d]" />;
  return <SimulationWindow />;
}
