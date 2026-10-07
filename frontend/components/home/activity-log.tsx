"use client";

import { ChartShell } from "@/components/charts";
import { Pill, type PillTone } from "@/components/pill";
import { EmptyState, Skeleton } from "@/components/states";
import { formatDateTime } from "@/lib/format";
import type { ActivityLogEntry, ActivityLogLevel } from "@/lib/types";

const LEVEL_GLYPH: Record<ActivityLogLevel, string> = {
  info: "·",
  warn: "!",
  error: "✕",
};

export type ActivityLogSource = "live" | "empty" | "demo";

const SOURCE_PILL: Record<ActivityLogSource, { tone: PillTone; label: string }> = {
  live: { tone: "teal", label: "live" },
  empty: { tone: "neutral", label: "empty" },
  demo: { tone: "neutral", label: "demo" },
};

/** Merged live events, or an empty log when nothing has arrived yet. */
export function presentActivityLog(
  liveEntries: ActivityLogEntry[],
): { entries: ActivityLogEntry[]; source: ActivityLogSource } {
  if (liveEntries.length > 0) {
    return { entries: liveEntries, source: "live" };
  }
  return { entries: [], source: "empty" };
}

export function ActivityLog({
  entries,
  loading,
  source,
  listClassName = "h-[280px]",
}: {
  entries: ActivityLogEntry[];
  loading: boolean;
  source: ActivityLogSource;
  listClassName?: string;
}) {
  const pill = SOURCE_PILL[source];
  return (
    <ChartShell
      title="Activity log"
      note="live snapshot · pipeline stages · anomalies · proposals — merged, newest first"
      right={
        <Pill tone={loading ? "neutral" : pill.tone}>{loading ? "loading" : pill.label}</Pill>
      }
    >
      {loading ? (
        <Skeleton className={`${listClassName} rounded-lg`} />
      ) : entries.length === 0 ? (
        <EmptyState className={listClassName} title="No recent activity" />
      ) : (
        <div
          className={`${listClassName} overflow-y-auto rounded-lg border border-border/60 bg-muted/20 px-3 py-2 font-mono text-[11px] leading-relaxed`}
        >
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
