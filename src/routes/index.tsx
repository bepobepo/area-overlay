import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { ShapeSwapMap } from "@/components/ShapeSwapMap";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <ClientOnly fallback={<div className="fixed inset-0 bg-background" />}>
      <ShapeSwapMap />
    </ClientOnly>
  );
}
