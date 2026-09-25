import { ArrowRight, Database, Radio, ShieldCheck, Sparkles, Table2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill, StatusDot, type PillTone } from "@/components/pill";
import { Skeleton } from "@/components/states";
import { formatNumber } from "@/lib/format";
import type { LivePipeline, StageHeartbeat } from "@/lib/live-types";

const LAYERS = [
  { key: "postgres", label: "Postgres", icon: Database },
  { key: "redpanda", label: "Redpanda", icon: Radio },
  { key: "bronze", label: "Bronze", icon: Table2 },
  { key: "silver", label: "Silver", icon: ShieldCheck },
  { key: "gold", label: "Gold", icon: Sparkles },
] as const;

function countRows(values: Record<string, number>): number {
  return Object.values(values).reduce((total, count) => total + count, 0);
}

function formatLag(seconds?: number | null): string {
  if (seconds == null) return "lag unknown";
  if (seconds < 60) return `${Math.round(seconds)}s lag`;
  return `${(seconds / 60).toFixed(1)}m lag`;
}

function heartbeatTone(heartbeat: StageHeartbeat): PillTone {
  if (heartbeat.error) return "red";
  if (heartbeat.lag_seconds != null && heartbeat.lag_seconds > 60) return "amber";
  return "teal";
}

export function PipelineStrip({ pipeline }: { pipeline: LivePipeline | null }) {
  if (!pipeline) return <Skeleton className="h-44 rounded-xl" />;

  const failures = pipeline.heartbeats.filter((heartbeat) => heartbeat.error);

  return (
    <Card size="sm">
      <CardHeader className="items-center">
        <CardTitle className="text-sm">Live pipeline</CardTitle>
        <div className="col-start-2 row-start-1 flex items-center gap-2">
          <Pill tone={failures.length > 0 ? "red" : "teal"}>
            <StatusDot tone={failures.length > 0 ? "red" : "teal"} />
            {failures.length > 0 ? `${failures.length} stage errors` : "flowing"}
          </Pill>
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
            {formatLag(pipeline.end_to_end_lag_seconds)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex min-w-max items-center overflow-x-auto pb-2">
          {LAYERS.map(({ key, label, icon: Icon }, index) => (
            <div key={key} className="contents">
              {index > 0 ? (
                <ArrowRight
                  className="mx-2 size-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden
                />
              ) : null}
              <div className="flex min-w-28 items-center gap-2 rounded-lg border border-border bg-secondary/35 px-3 py-2">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div>
                  <div className="text-xs font-medium">{label}</div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {formatNumber(countRows(pipeline.counts[key]))} rows
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {pipeline.heartbeats.length > 0 ? (
          <div className="mt-2 flex gap-1.5 overflow-x-auto border-t border-border pt-2">
            {pipeline.heartbeats.map((heartbeat) => {
              const tone = heartbeatTone(heartbeat);
              return (
                <Pill key={heartbeat.stage} tone={tone} className="shrink-0">
                  <StatusDot tone={tone} />
                  {heartbeat.stage.replaceAll("_", " ")}
                  {heartbeat.error ? " · error" : ` · ${formatLag(heartbeat.lag_seconds)}`}
                </Pill>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
            No worker heartbeats have arrived yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
