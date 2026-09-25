"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Pill, StatusDot } from "@/components/pill";
import { EmptyState, Loading } from "@/components/states";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEMO_SYSTEM_STATUS } from "@/lib/demo";
import { useApiData } from "@/lib/use-api";
import type { SystemStatus } from "@/lib/types";

function statusTone(status: string): "green" | "amber" | "neutral" | "red" {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("done") || s === "up") return "green";
  if (s.includes("progress") || s.includes("partial")) return "amber";
  if (s.includes("fail") || s.includes("error")) return "red";
  return "neutral";
}

function tablePresent(value: unknown): { label: string; present: boolean | null } {
  if (typeof value === "boolean") return { label: String(value), present: value };
  if (typeof value === "number") return { label: `${value} rows`, present: value > 0 };
  if (value === null || value === undefined) return { label: "unknown", present: null };
  return { label: String(value), present: Boolean(value) };
}

const KNOWN_SERVICES = ["postgres", "redpanda", "qdrant", "mlflow"] as const;
const SERVICE_BLURB: Record<string, string> = {
  postgres: "operational source",
  redpanda: "event broker",
  qdrant: "vector retrieval",
  mlflow: "experiment tracking",
  debezium: "change data capture",
  airflow: "batch orchestration",
  seaweedfs: "S3 object store",
};

function serviceChips(services: Record<string, string>) {
  const names = [
    ...KNOWN_SERVICES.filter((s) => s in services),
    ...Object.keys(services).filter((s) => !(KNOWN_SERVICES as readonly string[]).includes(s)),
  ];
  return names.map((name) => {
    const up = (services[name] ?? "down").toLowerCase() === "up";
    return { name, up, blurb: SERVICE_BLURB[name] ?? "service" };
  });
}

export function PipelineStatus() {
  const status = useApiData<SystemStatus>("/api/v1/system/status", DEMO_SYSTEM_STATUS, 30_000);
  const [copied, setCopied] = useState(false);
  const demo = status.mode !== "live";
  const data = status.data;

  if (data === null) {
    return <Loading label="Waiting for /api/v1/system/status…" />;
  }

  const goldTables = Object.entries(data.data_root_tables ?? {});

  return (
    <>
      {demo ? <ApiBanner mode={status.mode} error={status.error} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {KNOWN_SERVICES.map((svc) => {
          const up = (data.services?.[svc] ?? "down").toLowerCase() === "up";
          return (
            <Card key={svc} size="sm" className="gap-1">
              <CardHeader>
                <CardTitle className="text-sm">{svc}</CardTitle>
                <CardDescription className="text-xs">{SERVICE_BLURB[svc]}</CardDescription>
                <CardAction>
                  <Pill tone={up ? "green" : "red"}>
                    <StatusDot tone={up ? "green" : "red"} />
                    {up ? "up" : "down"}
                  </Pill>
                </CardAction>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="gold" className="mt-4 gap-3">
        <TabsList>
          <TabsTrigger value="gold">Gold tables</TabsTrigger>
          <TabsTrigger value="phases">Phases</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
        </TabsList>

        <TabsContent value="gold">
          {goldTables.length === 0 ? (
            <EmptyState
              title="No gold tables reported"
              hint="Run the lakehouse pipeline so the data root has Gold marts."
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {goldTables.map(([name, value]) => {
                const t = tablePresent(value);
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <code className="truncate text-xs">{name}</code>
                    <span
                      className={`shrink-0 text-xs ${
                        t.present === true ? "text-chart-2" : "text-muted-foreground"
                      }`}
                    >
                      {t.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="phases">
          {(data.phases ?? []).length === 0 ? (
            <EmptyState title="No phase data" hint="The API could not parse kit/TASKS.md." />
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                Parsed from <code>kit/TASKS.md</code> at API startup.
              </p>
              <ol className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                {data.phases.map((p) => (
                  <li
                    key={String(p.phase)}
                    className="flex items-center gap-2.5 border-b border-border py-2 text-sm last:border-0"
                  >
                    <StatusDot tone={statusTone(p.status)} />
                    <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                      {String(p.phase).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.status}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </TabsContent>

        <TabsContent value="quality">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Services &amp; quarantine</CardTitle>
              <CardDescription className="text-xs">
                Failed rows are quarantined with structured error codes, never dropped.
              </CardDescription>
              <CardAction>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(JSON.stringify(data, null, 2))
                      .then(() => setCopied(true))
                      .catch(() => setCopied(false));
                  }}
                >
                  {copied ? (
                    <Check className="text-chart-2" strokeWidth={1.75} />
                  ) : (
                    <Copy strokeWidth={1.75} />
                  )}
                  {copied ? "copied" : "health JSON"}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {serviceChips(data.services ?? {}).map(({ name, up, blurb }) => (
                  <Pill key={name} tone={up ? "green" : "red"}>
                    <StatusDot tone={up ? "green" : "red"} />
                    {name}
                    <span className="text-muted-foreground">· {blurb}</span>
                  </Pill>
                ))}
              </div>

              <Accordion className="mt-3 border-t border-border">
                <AccordionItem value="quarantine">
                  <AccordionTrigger className="text-xs">
                    What the quarantine summary records
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground">
                    After each run, <code>data/quarantine/quality_summary</code> records the rule
                    that fired, the source batch, row counts per check, and a pointer to the full
                    rejected rows — enough to tell a real data problem from schema drift.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="streamlit">
                  <AccordionTrigger className="text-xs">Where to look next</AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground">
                    The Streamlit Pipeline page (:8501) lists run timings, per-check pass/fail and
                    the same quarantine summary.
                    <div className="mt-2">
                      <Button variant="outline" size="xs" render={<Link href="/streamlit" />}>
                        Open Streamlit
                        <ExternalLink strokeWidth={1.75} />
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
