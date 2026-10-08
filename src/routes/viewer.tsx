import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { hasSession } from "@/lib/session";
import { Workstation } from "@/components/workstation/Workstation";

export const Route = createFileRoute("/viewer")({
  head: () => ({
    meta: [
      { title: "Diagnostic Imaging Viewer — Cognivance Labs" },
      {
        name: "description",
        content:
          "Research viewer for DICOM/NIfTI MRI with synchronised multiplanar views, segmentation, tractography and EEG. For research/educational use.",
      },
    ],
  }),
  component: Viewer,
});

function Viewer() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasSession()) navigate({ to: "/auth" });
    else setReady(true);
  }, [navigate]);

  if (!ready) return <div className="min-h-screen bg-[#020405]" />;
  return <Workstation />;
}
