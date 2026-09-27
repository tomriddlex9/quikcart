import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import {
  StackedTabs,
  StackedTabsContent,
  StackedTabsList,
  StackedTabsTrigger,
} from "@/components/ui/stacked-tabs";
import { ArchitectureLineage } from "@/components/architecture/architecture-lineage";
import { FlowDiagram } from "@/components/architecture/flow-diagram";
import { MermaidView } from "@/components/architecture/mermaid-view";
import { TrustCallout } from "@/components/architecture/trust-callout";

export const metadata: Metadata = { title: "Architecture" };

export default function ArchitecturePage() {
  return (
    <>
      <PageHeader
        title="Architecture"
        description="Simulator → Postgres → batch + CDC → Bronze → Silver (+ quarantine) → Gold → ML/RAG/Agent → FastAPI → Streamlit + Next.js. Click a node for details."
      />

      <StackedTabs defaultValue="diagram">
        <StackedTabsList className="print:hidden" aria-label="Architecture view">
          <StackedTabsTrigger value="diagram">Diagram</StackedTabsTrigger>
          <StackedTabsTrigger value="mermaid">Mermaid</StackedTabsTrigger>
          <StackedTabsTrigger value="lineage">Lineage</StackedTabsTrigger>
        </StackedTabsList>
        <StackedTabsContent value="diagram">
          <FlowDiagram />
        </StackedTabsContent>
        <StackedTabsContent value="mermaid">
          <MermaidView />
        </StackedTabsContent>
        <StackedTabsContent value="lineage">
          <ArchitectureLineage />
        </StackedTabsContent>
      </StackedTabs>

      <div className="mt-6">
        <TrustCallout />
      </div>
    </>
  );
}
