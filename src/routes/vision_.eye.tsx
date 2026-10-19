import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hasSession } from "@/lib/session";
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
  component: Eye,
});

function Eye() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!hasSession()) navigate({ to: "/auth" });
    else setReady(true);
  }, [navigate]);
  if (!ready) return <div className="min-h-screen bg-[#eceef4]" />;
  return <EyeSimulation />;
}
