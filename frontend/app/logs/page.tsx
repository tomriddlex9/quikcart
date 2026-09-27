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
        description="Live KPIs, medallion health, phase checklist, and a merged event stream from the API, SSE live feed, and pipeline heartbeats."
      />
      <PipelineStatus />
    </>
  );
}
