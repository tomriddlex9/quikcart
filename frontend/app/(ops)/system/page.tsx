import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SystemJourney } from "@/components/system-journey";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "System map",
};

export default function SystemPage() {
  return (
    <>
      <PageHeader
        title="System map"
        description="Every component and how data moves between them: CDC from the Postgres WAL, streaming through Redpanda, batch into Delta, then ML, RAG, the agent and these UIs."
      >
        <Button variant="outline" size="sm" render={<Link href="/architecture" />}>
          Read the architecture
        </Button>
      </PageHeader>
      <SystemJourney />
    </>
  );
}
