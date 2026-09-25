import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DRIFTS, PHASES } from "@/lib/learn/roadmap";

export const metadata: Metadata = { title: "Roadmap" };

const STATE_LABEL = {
  done: "complete",
  "code-without-boxes": "built, boxes open",
  partial: "partial",
} as const;

const STATE_CLASS = {
  done: "bg-chart-2/12 text-chart-2",
  "code-without-boxes": "bg-chart-3/12 text-chart-3",
  partial: "bg-chart-3/12 text-chart-3",
} as const;

export default function RoadmapPage() {
  return (
    <>
      <PageHeader
        title="What is working"
        description="Phase status as the repository stands. The checkboxes in kit/TASKS.md are the tracker the API parses."
      />

      <Tabs defaultValue="phases" className="gap-4">
        <TabsList>
          <TabsTrigger value="phases">Phases ({PHASES.length})</TabsTrigger>
          <TabsTrigger value="drift">Doc drift ({DRIFTS.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="phases">
          <Accordion className="border-t border-border">
            {PHASES.map((phase) => (
              <AccordionItem key={phase.phase} value={phase.phase}>
                <AccordionTrigger className="gap-3 hover:no-underline">
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                      {phase.phase.padStart(2, "0")}
                    </span>
                    <span className="truncate">{phase.name}</span>
                    <Badge
                      variant="secondary"
                      className={`ml-auto shrink-0 font-normal ${STATE_CLASS[phase.state]}`}
                    >
                      {STATE_LABEL[phase.state]}
                    </Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-sm">
                  <p>{phase.working}</p>
                  {phase.open ? <p className="text-muted-foreground">{phase.open}</p> : null}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </TabsContent>

        <TabsContent value="drift">
          <div className="grid gap-3 md:grid-cols-3">
            {DRIFTS.map((drift) => (
              <Card key={drift.title} size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">{drift.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-xs">{drift.body}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
