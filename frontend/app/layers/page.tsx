import type { Metadata } from "next";
import { LayersWorkbench } from "@/components/layers/layers-workbench";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Layers",
};

export default function LayersPage() {
  return (
    <>
      <PageHeader
        title="Layers"
        description="Every operation that moves a row through the medallion — raw, bronze, silver, quarantine, gold — with the code, the impact, and a before/after sample."
      />
      <LayersWorkbench />
    </>
  );
}
