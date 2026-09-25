import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PERFORMANCE, SECURITY, type Note } from "@/lib/learn/trust";

export const metadata: Metadata = { title: "Trust and performance" };

const SEVERITY_CLASS: Record<Note["severity"], string> = {
  "local-ok": "bg-chart-2/12 text-chart-2",
  watch: "bg-chart-3/12 text-chart-3",
  later: "bg-secondary text-secondary-foreground",
};

function Notes({ notes }: { notes: Note[] }) {
  return (
    <Accordion className="border-t border-border">
      {notes.map((note) => (
        <AccordionItem key={note.title} value={note.title}>
          <AccordionTrigger className="gap-3 hover:no-underline">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{note.title}</span>
              <Badge
                variant="secondary"
                className={`ml-auto shrink-0 font-normal ${SEVERITY_CLASS[note.severity]}`}
              >
                {note.severity}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground">{note.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export default function TrustPage() {
  return (
    <>
      <PageHeader
        title="Trust and performance"
        description="What the code enforces, what is acceptable only because every port is on loopback, and which speedups are unmeasured candidates. Not a production audit."
      />

      <Tabs defaultValue="security" className="gap-4">
        <TabsList>
          <TabsTrigger value="security">Security ({SECURITY.length})</TabsTrigger>
          <TabsTrigger value="performance">Performance ({PERFORMANCE.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="security">
          <Notes notes={SECURITY} />
        </TabsContent>

        <TabsContent value="performance">
          <p className="mb-3 max-w-[70ch] text-sm text-muted-foreground">
            None of these have been changed — the repository rule is to measure on this machine
            before claiming a speedup. Shuffle partitions stay at Spark&apos;s default of 200
            outside tests.
          </p>
          <Notes notes={PERFORMANCE} />
        </TabsContent>
      </Tabs>
    </>
  );
}
