import type { Metadata } from "next";
import { Suspense } from "react";
import { LayersWorkbench } from "@/components/layers/layers-workbench";
import { PageHeader } from "@/components/page-header";
import { Loading } from "@/components/states";

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
      <Suspense fallback={<Loading label="Loading layer operations…" />}>
        <LayersWorkbench />
      </Suspense>
    </>
  );
}
