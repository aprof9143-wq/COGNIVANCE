import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hasSession } from "@/lib/session";
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
  component: Therapy,
});

function Therapy() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!hasSession()) navigate({ to: "/auth", search: { redirect: "/vision/therapy" } });
    else setReady(true);
  }, [navigate]);
  if (!ready) return <div className="min-h-screen bg-[#eceef4]" />;
  return <TherapySimulator />;
}
