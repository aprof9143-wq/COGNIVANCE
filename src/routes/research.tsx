import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hasSession } from "@/lib/session";
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
  component: Research,
});

function Research() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasSession()) navigate({ to: "/auth" });
    else setReady(true);
  }, [navigate]);

  if (!ready) return <div className="min-h-screen bg-[#020405]" />;
  return <ResearchConsole />;
}
