import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hasSession } from "@/lib/session";
import { VisionModule } from "@/components/vision/VisionModule";

export const Route = createFileRoute("/vision")({
  head: () => ({
    meta: [
      { title: "Vision Evidence — Cognivance Labs" },
      {
        name: "description",
        content:
          "Evidence-linked gene, protein and 3D structure records for RPE65, from public reference databases with provenance. Research software; not a medical device.",
      },
    ],
  }),
  component: Vision,
});

function Vision() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!hasSession()) navigate({ to: "/auth", search: { redirect: "/vision" } });
    else setReady(true);
  }, [navigate]);
  if (!ready) return <div className="min-h-screen bg-[#eceef4]" />;
  return <VisionModule />;
}
