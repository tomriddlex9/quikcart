import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { StepFlow } from "@/components/learn/blocks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FLOWS, GOLD_MARTS } from "@/lib/learn/lineage";

export const metadata: Metadata = { title: "Data lineage" };

export default function LineagePage() {
  return (
    <>
      <PageHeader
        title="Data lineage"
        description="Five paths with the tables and commands that actually exist. An approved restock is the only path back into PostgreSQL."
      />

      <Tabs defaultValue={FLOWS[0]?.id} className="gap-4">
        <TabsList>
          {FLOWS.map((flow) => (
            <TabsTrigger key={flow.id} value={flow.id}>
              {flow.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {FLOWS.map((flow) => (
          <TabsContent key={flow.id} value={flow.id}>
            <StepFlow title={flow.title} summary={flow.summary} steps={flow.steps} />
          </TabsContent>
        ))}
      </Tabs>

      <Card size="sm" className="mt-6">
        <CardHeader>
          <CardTitle className="text-sm">Gold tables</CardTitle>
          <CardDescription className="text-xs">
            The pipeline builds the first five; the models append the last three. Feature tables
            named in kit/01 live in <code>src/quickcart/ml/features.py</code> instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {GOLD_MARTS.map((name) => (
              <li
                key={name}
                className="rounded-lg border border-border px-2.5 py-1.5 font-mono text-xs"
              >
                {name}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
