import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SystemMap } from "@/components/system-map";

export const metadata: Metadata = {
  title: "System map",
};

export default function SystemPage() {
  return (
    <>
      <PageHeader
        title="System map"
        description="Every component of the QuickCart platform and how data actually moves between them — CDC from the Postgres WAL, streaming through Redpanda, batch through PySpark into Delta Lake, then serving ML, RAG, the bounded agent and these UIs."
      />
      <SystemMap />
    </>
  );
}
