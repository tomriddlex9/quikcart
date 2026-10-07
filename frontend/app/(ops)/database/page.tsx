import type { Metadata } from "next";
import { Suspense } from "react";
import { DatabaseWorkbench } from "@/components/database/database-workbench";
import { PageHeader } from "@/components/page-header";
import { Loading } from "@/components/states";

export const metadata: Metadata = {
  title: "Database",
};

export default function DatabasePage() {
  return (
    <>
      <PageHeader
        title="Database"
        description="Medallion catalog: schema, live previews, and the cleaning / mart SQL that produces each bronze, silver, quarantine, and gold table."
      />
      <Suspense fallback={<Loading label="Loading catalog…" />}>
        <DatabaseWorkbench />
      </Suspense>
    </>
  );
}
