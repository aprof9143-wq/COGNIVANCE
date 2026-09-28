import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Workstation } from "@/components/workstation/Workstation";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "Research Imaging Viewer — Cognivance Labs" },
      {
        name: "description",
        content:
          "Research viewer for DICOM/NIfTI MRI with synchronised multiplanar views, segmentation, tractography and EEG. For research/educational use.",
      },
    ],
  }),
  component: Research,
});

function Research() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("cognivance_session")) navigate({ to: "/auth" });
    else setReady(true);
  }, [navigate]);

  if (!ready) return <div className="min-h-screen bg-[#020405]" />;
  return <Workstation />;
}
