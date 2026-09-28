import { createFileRoute } from "@tanstack/react-router";
import { NimbleSimulator } from "@/components/nimble/NimbleSimulator";

const title = "NIMBLE Hardware Simulation — Cognivance Labs";
const description =
  "A live simulation of the NIMBLE acquisition layer: one contract for every signal origin, with link health, fault injection and a ground-truth self-test.";

export const Route = createFileRoute("/nimble")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: NimbleSimulator,
});
