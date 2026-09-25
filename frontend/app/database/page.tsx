import type { Metadata } from "next";
import { DatabaseExplorer } from "@/components/database/database-explorer";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Database",
};

export default function DatabasePage() {
  return (
    <>
      <PageHeader
        title="Database"
        description="Inspect source tables and each lakehouse layer, from schema to live row previews."
      />
      <DatabaseExplorer />
    </>
  );
}
