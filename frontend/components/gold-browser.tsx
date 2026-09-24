"use client";

import { ChevronRight } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Pill, StatusDot } from "@/components/pill";
import { Skeleton } from "@/components/states";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEMO_SYSTEM_STATUS } from "@/lib/demo";
import { GOLD_MARTS, type GoldMart } from "@/lib/gold-marts";
import { useApiData } from "@/lib/use-api";
import type { SystemStatus } from "@/lib/types";

function tablePresence(value: unknown): { label: string; state: "present" | "absent" | "unknown" } {
  if (typeof value === "boolean")
    return { label: value ? "on disk" : "not built", state: value ? "present" : "absent" };
  if (typeof value === "number")
    return {
      label: value > 0 ? `${value} rows` : "empty",
      state: value > 0 ? "present" : "absent",
    };
  return { label: "not probed", state: "unknown" };
}

const LAYERS = [
  { name: "Bronze", sub: "raw payloads + ingestion metadata" },
  { name: "Silver", sub: "validated, conformed entities" },
  { name: "Gold", sub: "analysis-ready marts" },
];

function Medallion() {
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      {LAYERS.map((l, i) => (
        <div key={l.name} className="flex flex-1 items-center gap-2">
          <div className="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <div className="font-mono text-xs tracking-widest">{l.name.toUpperCase()}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{l.sub}</div>
          </div>
          {i < LAYERS.length - 1 ? (
            <ChevronRight
              className="size-4 shrink-0 rotate-90 text-muted-foreground sm:rotate-0"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MartRow({ mart, presenceValue }: { mart: GoldMart; presenceValue: unknown }) {
  const presence = tablePresence(presenceValue);
  const tone =
    presence.state === "present" ? "teal" : presence.state === "absent" ? "neutral" : "amber";
  return (
    <AccordionItem value={mart.name}>
      <AccordionTrigger className="gap-3 hover:no-underline">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <code className="text-sm">{mart.name}</code>
          <Pill tone={mart.family === "ml" ? "amber" : "neutral"}>
            {mart.family === "ml" ? "ML write-back" : "pipeline"}
          </Pill>
          <Pill tone={tone}>
            <StatusDot tone={tone} />
            {presence.label}
          </Pill>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">grain</dt>
          <dd>{mart.grain}</dd>
          <dt className="text-muted-foreground">key columns</dt>
          <dd className="flex flex-wrap gap-1">
            {mart.keyColumns.map((c) => (
              <code key={c} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {c}
              </code>
            ))}
          </dd>
          <dt className="text-muted-foreground">columns</dt>
          <dd className="text-muted-foreground">{mart.columnsNote}</dd>
          <dt className="text-muted-foreground">how it&apos;s built</dt>
          <dd className="text-muted-foreground">{mart.howBuilt}</dd>
          <dt className="text-muted-foreground">built by</dt>
          <dd className="text-muted-foreground">{mart.builtBy}</dd>
          <dt className="text-muted-foreground">consumed by</dt>
          <dd className="flex flex-wrap gap-x-3 gap-y-0.5">
            {mart.consumers.map((c) => (
              <code key={c} className="text-xs text-muted-foreground">
                {c}
              </code>
            ))}
          </dd>
        </dl>
        {presence.state === "absent" ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {mart.family === "ml"
              ? "Not built yet — run the matching Phase 11 model; it overwrites this table per run."
              : "Not built yet — run the Silver→Gold job (make gold, or the Airflow DAG)."}
          </p>
        ) : null}
      </AccordionContent>
    </AccordionItem>
  );
}

export function GoldBrowser() {
  const status = useApiData<SystemStatus>("/api/v1/system/status", DEMO_SYSTEM_STATUS, 30_000);
  const demo = status.mode !== "live";
  const tables = status.data?.data_root_tables ?? {};

  const pipeline = GOLD_MARTS.filter((m) => m.family === "pipeline");
  const ml = GOLD_MARTS.filter((m) => m.family === "ml");

  if (status.data === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[92px] rounded-xl" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    );
  }

  return (
    <>
      {demo ? <ApiBanner mode={status.mode} error={status.error} /> : null}

      <div className="space-y-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Medallion layers</CardTitle>
            <CardDescription className="text-xs">
              Bad rows are quarantined with structured error codes, never dropped.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Medallion />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Gold marts</CardTitle>
            <CardDescription className="text-xs">
              Presence probed at <code>data/gold/*</code> every 30s. Expand a table for its grain
              and build path.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="pipeline" className="gap-3">
              <TabsList>
                <TabsTrigger value="pipeline">Pipeline ({pipeline.length})</TabsTrigger>
                <TabsTrigger value="ml">ML write-back ({ml.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="pipeline">
                <Accordion className="border-t border-border">
                  {pipeline.map((mart) => (
                    <MartRow key={mart.name} mart={mart} presenceValue={tables[mart.name]} />
                  ))}
                </Accordion>
              </TabsContent>
              <TabsContent value="ml">
                <Accordion className="border-t border-border">
                  {ml.map((mart) => (
                    <MartRow key={mart.name} mart={mart} presenceValue={tables[mart.name]} />
                  ))}
                </Accordion>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          To read the rows themselves, use the Streamlit Pipeline page or query{" "}
          <code>data/gold/*</code> directly with Spark SQL.
        </p>
      </div>
    </>
  );
}
