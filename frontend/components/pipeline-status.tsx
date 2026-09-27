"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { ActivityLog, presentActivityLog } from "@/components/home/activity-log";
import { PipelineStrip } from "@/components/live/pipeline-strip";
import { KpiCard } from "@/components/kpi-card";
import { Pill, StatusDot } from "@/components/pill";
import { RefreshIndicator } from "@/components/refresh-indicator";
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
import {
  StackedTabs,
  StackedTabsContent,
  StackedTabsList,
  StackedTabsTrigger,
} from "@/components/ui/stacked-tabs";
import { buildActivityLog } from "@/lib/activity-log";
import {
  DEMO_ACTIVITY_LOG,
  DEMO_ANOMALIES,
  DEMO_KPIS,
  DEMO_PIPELINE_LAG_SECONDS,
  DEMO_PROPOSALS,
  DEMO_QUALITY_SCORE,
  DEMO_SYSTEM_STATUS,
} from "@/lib/demo";
import { formatNumber } from "@/lib/format";
import type { ApiMode } from "@/lib/api";
import {
  computeQualityScore,
  countGoldTablesPresent,
  formatPipelineLag,
  tablePresent,
} from "@/lib/status-metrics";
import { useApiData } from "@/lib/use-api";
import { useLiveStream } from "@/lib/use-live-stream";
import type { AnomalyRow, Kpis, Proposal, SystemStatus } from "@/lib/types";

const REFRESH_MS = 30_000;

function statusTone(status: string): "green" | "amber" | "neutral" | "red" {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("done") || s === "up") return "green";
  if (s.includes("progress") || s.includes("partial")) return "amber";
  if (s.includes("fail") || s.includes("error")) return "red";
  return "neutral";
}

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
  const names = Object.keys(services).sort();
  return names.map((name) => {
    const up = (services[name] ?? "down").toLowerCase() === "up";
    return { name, up, blurb: SERVICE_BLURB[name] ?? "service" };
  });
}

function useCountdown(lastUpdated: Date | null): number | null {
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!lastUpdated) return null;
  const elapsed = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
  return Math.max(0, Math.ceil(REFRESH_MS / 1000) - elapsed);
}

function resolvePageMode(modes: ApiMode[], liveMode: ApiMode): ApiMode {
  const all = [...modes, liveMode];
  if (all.includes("demo")) return "demo";
  if (all.includes("stale")) return "stale";
  if (all.includes("offline")) return "offline";
  return "live";
}

export function PipelineStatus() {
  const status = useApiData<SystemStatus>("/api/v1/system/status", DEMO_SYSTEM_STATUS, REFRESH_MS);
  const kpis = useApiData<Kpis>("/api/v1/overview/kpis", DEMO_KPIS, REFRESH_MS);
  const anomalies = useApiData<AnomalyRow[]>("/api/v1/anomalies", DEMO_ANOMALIES, REFRESH_MS);
  const proposals = useApiData<Proposal[]>("/api/v1/proposals", DEMO_PROPOSALS, REFRESH_MS);
  const live = useLiveStream();

  const [copied, setCopied] = useState(false);
  const countdown = useCountdown(status.lastUpdated);

  const data = status.data;
  const kpiData = kpis.data;

  if (data === null) {
    return <Loading label="Waiting for /api/v1/system/status…" />;
  }

  const pageMode = resolvePageMode(
    [status.mode, kpis.mode, anomalies.mode, proposals.mode],
    live.mode,
  );
  const demo = pageMode === "demo" || pageMode === "stale";

  const goldCounts = countGoldTablesPresent(data);
  const pipelineLag =
    live.pipeline?.end_to_end_lag_seconds ??
    (live.mode === "live" || live.mode === "stale" ? null : DEMO_PIPELINE_LAG_SECONDS);
  const qualityScore = computeQualityScore(
    data,
    live.pipeline,
    DEMO_QUALITY_SCORE,
  );
  const ordersValue =
    kpiData?.orders_placed != null
      ? formatNumber(kpiData.orders_placed)
      : live.snapshot && live.snapshot.generated_at !== new Date(0).toISOString()
        ? formatNumber(live.snapshot.orders_60m)
        : formatNumber(DEMO_KPIS.orders_placed);

  const liveLogEntries = buildActivityLog(
    live.mode === "demo" ? null : live.snapshot,
    live.mode === "demo" ? null : live.pipeline,
    anomalies.mode === "live" || anomalies.mode === "stale" ? anomalies.data : null,
    proposals.mode === "live" || proposals.mode === "stale" ? proposals.data : null,
  );
  const activity = presentActivityLog(pageMode, live.mode, liveLogEntries, DEMO_ACTIVITY_LOG);
  const logLoading =
    live.snapshot === null &&
    anomalies.data === null &&
    proposals.data === null &&
    live.pipeline === null;

  const goldTables = Object.entries(data.data_root_tables ?? {});
  const phases = data.phases ?? [];
  const phasesComplete = phases.filter((p) => statusTone(p.status) === "green").length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <RefreshIndicator mode={pageMode} lastUpdated={status.lastUpdated} countdown={countdown} />
      </div>

      {demo ? <ApiBanner mode={pageMode} error={status.error ?? live.error} /> : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Orders placed"
          value={ordersValue}
          hint={kpiData ? "Gold mart total" : "from live or demo KPIs"}
        />
        <KpiCard
          label="Pipeline lag"
          value={formatPipelineLag(pipelineLag)}
          hint={
            pipelineLag != null && pipelineLag > 120
              ? "end-to-end · elevated"
              : "end-to-end · live/pipeline"
          }
        />
        <KpiCard
          label="Gold tables"
          value={`${goldCounts.present}/${goldCounts.total}`}
          hint="present on disk"
        />
        <KpiCard
          label="Quality score"
          value={`${qualityScore}`}
          hint="gold + stages − quarantine"
        />
      </div>

      <StackedTabs defaultValue="events" className="min-w-0">
        <StackedTabsList aria-label="Status section">
          <StackedTabsTrigger value="gold">
            Gold ({goldCounts.present}/{goldCounts.total})
          </StackedTabsTrigger>
          <StackedTabsTrigger value="phases">
            Phases ({phasesComplete}/{phases.length || "—"})
          </StackedTabsTrigger>
          <StackedTabsTrigger value="quality">Quality</StackedTabsTrigger>
          <StackedTabsTrigger value="events">Events</StackedTabsTrigger>
        </StackedTabsList>

        <StackedTabsContent value="events">
          <ActivityLog
            entries={activity.entries}
            loading={logLoading}
            source={activity.source}
            listClassName="h-[min(480px,55vh)]"
          />
          <div className="mt-4">
            <PipelineStrip pipeline={live.pipeline} />
          </div>
        </StackedTabsContent>

        <StackedTabsContent value="gold">
            {goldTables.length === 0 ? (
              <EmptyState
                title="No gold tables reported"
                hint="Run the lakehouse pipeline so the data root has Gold marts."
              />
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {goldTables.map(([name, value]) => {
                  const t = tablePresent(value);
                  const tone = t.present === true ? "green" : t.present === false ? "neutral" : "amber";
                  return (
                    <div
                      key={name}
                      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
                    >
                      <StatusDot tone={tone} />
                      <code className="min-w-0 flex-1 truncate text-xs">{name}</code>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {t.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </StackedTabsContent>

        <StackedTabsContent value="phases">
          {phases.length === 0 ? (
            <EmptyState title="No phase data" hint="The API could not parse kit/TASKS.md." />
          ) : (
            <div className="space-y-3">
              <PipelineStrip pipeline={live.pipeline} />
              <p className="text-xs text-muted-foreground">
                Parsed from <code>kit/TASKS.md</code> at API startup ·{" "}
                <span className="tabular-nums">{phasesComplete}</span> complete
              </p>
              <ol className="divide-y divide-border rounded-lg border border-border">
                {phases.map((p) => (
                  <li
                    key={String(p.phase)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm"
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
            </div>
          )}
        </StackedTabsContent>

        <StackedTabsContent value="quality">
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Services &amp; quarantine</CardTitle>
                <CardDescription className="text-xs">
                  Failed rows land in quarantine with structured error codes — never dropped.
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
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Quarantine rows</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {formatNumber(
                      Object.values(live.pipeline?.counts.quarantine ?? {}).reduce(
                        (sum, n) => sum + n,
                        0,
                      ),
                    )}
                  </span>
                  <span>· score {qualityScore}/100</span>
                </div>
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
        </StackedTabsContent>
      </StackedTabs>
    </>
  );
}
