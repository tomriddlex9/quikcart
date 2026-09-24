import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PipelineStatus } from "@/components/pipeline-status";

export const metadata: Metadata = {
  title: "Pipeline & logs",
};

export default function LogsPage() {
  return (
    <>
      <PageHeader
        title="Pipeline & logs"
        description="Service health, gold-table presence and the phase checklist, straight from the API's honest startup probe — plus where to look when data quality pushes back."
      />
      <PipelineStatus />
    </>
  );
}
