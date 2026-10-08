import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hasSession } from "@/lib/session";
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
  component: Neuro,
});

function Neuro() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!hasSession()) navigate({ to: "/auth" });
    else setReady(true);
  }, [navigate]);
  if (!ready) return <div className="min-h-screen bg-[#0a0d12]" />;
  return <NeuroDashboard />;
}
