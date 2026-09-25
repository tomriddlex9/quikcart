"use client";

import { ChartShell } from "@/components/charts";
import { Pill } from "@/components/pill";
import { Skeleton } from "@/components/states";
import { formatDateTime } from "@/lib/format";
import type { ActivityLogEntry, ActivityLogLevel } from "@/lib/types";

const LEVEL_GLYPH: Record<ActivityLogLevel, string> = {
  info: "·",
  warn: "!",
  error: "✕",
};

export function ActivityLog({
  entries,
  loading,
  live,
}: {
  entries: ActivityLogEntry[];
  loading: boolean;
  live: boolean;
}) {
  return (
    <ChartShell
      title="Activity log"
      note="live snapshot · pipeline stages · anomalies · proposals — merged, newest first"
      right={<Pill tone={live ? "teal" : "amber"}>{live ? "live" : "demo data"}</Pill>}
    >
      {loading ? (
        <Skeleton className="h-[280px] rounded-lg" />
      ) : entries.length === 0 ? (
        <div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
          No activity recorded yet.
        </div>
      ) : (
        <div className="h-[280px] overflow-y-auto rounded-lg border border-border/60 bg-muted/20 px-3 py-2 font-mono text-[11px] leading-relaxed">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 py-0.5">
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatDateTime(entry.ts)}
              </span>
              <span
                className={
                  entry.level === "error"
                    ? "shrink-0 text-destructive"
                    : entry.level === "warn"
                      ? "shrink-0 text-chart-3"
                      : "shrink-0 text-muted-foreground"
                }
              >
                {LEVEL_GLYPH[entry.level]}
              </span>
              <span className="shrink-0 text-muted-foreground">[{entry.source}]</span>
              <span className="min-w-0 break-words text-foreground/90">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </ChartShell>
  );
}
