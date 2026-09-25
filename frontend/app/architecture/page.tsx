import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

      <Tabs defaultValue="diagram">
        <TabsList className="print:hidden">
          <TabsTrigger value="diagram">Diagram</TabsTrigger>
          <TabsTrigger value="mermaid">Mermaid</TabsTrigger>
          <TabsTrigger value="lineage">Lineage</TabsTrigger>
        </TabsList>
        <TabsContent value="diagram" className="mt-4">
          <FlowDiagram />
        </TabsContent>
        <TabsContent value="mermaid" className="mt-4">
          <MermaidView />
        </TabsContent>
        <TabsContent value="lineage" className="mt-4">
          <ArchitectureLineage />
        </TabsContent>
      </Tabs>

      <div className="mt-6">
        <TrustCallout />
      </div>
    </>
  );
}
