import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { QueryWorkbench } from "@/components/query/query-workbench";

export const metadata: Metadata = {
  title: "Query",
};

export default function QueryPage() {
  return (
    <>
      <PageHeader
        title="Query"
        description="Ask a question in plain English or start from a template, review the SQL it produces, then run it read-only against PostgreSQL or the lakehouse. Nothing runs without your review."
      />
      <QueryWorkbench />
    </>
  );
}
