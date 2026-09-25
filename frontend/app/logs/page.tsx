import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PipelineStatus } from "@/components/pipeline-status";

export const metadata: Metadata = {
  title: "Pipeline status",
};

export default function LogsPage() {
  return (
    <>
      <PageHeader
        title="Pipeline status"
        description="Service health, Gold-table presence and the phase checklist, from the API's startup probe."
      />
      <PipelineStatus />
    </>
  );
}
