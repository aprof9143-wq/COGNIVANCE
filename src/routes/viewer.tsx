import { createFileRoute } from "@tanstack/react-router";
import { Gated } from "@/components/app/Gated";
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
  component: Page,
});

function Page() {
  return (
    <Gated path="/viewer">
      <Workstation />
    </Gated>
  );
}
