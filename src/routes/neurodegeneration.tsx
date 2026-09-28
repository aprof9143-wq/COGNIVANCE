import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/neurodegeneration")({
  component: () => (
    <div className="min-h-screen bg-[#0a0d12] p-8 text-[#e8eef8]">Neurodegeneration tracking</div>
  ),
});
