"use client";

import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ApiBanner } from "@/components/api-banner";
import { ChartShell, ChartTooltip } from "@/components/charts";
import { KpiCard } from "@/components/kpi-card";
import { OrderFeed } from "@/components/live/order-feed";
import { PipelineStrip } from "@/components/live/pipeline-strip";
import { PageHeader } from "@/components/page-header";
import { Pill, StatusDot, type PillTone } from "@/components/pill";
import { EmptyState, Skeleton } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiMode } from "@/lib/api";
import { formatCompactINR, formatINR, formatNumber, formatPercent } from "@/lib/format";
import type { LiveSnapshot } from "@/lib/live-types";
import { useLiveStream } from "@/lib/use-live-stream";

function useAnimatedValue(target: number): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      valueRef.current = target;
      setValue(target);
      return;
    }

    const startValue = valueRef.current;
    const difference = target - startValue;
    const startedAt = performance.now();
    let frame = 0;

    const animate = (now: number) => {
      const progress = Math.min((now - startedAt) / 450, 1);
      const eased = 1 - (1 - progress) ** 3;
      const next = startValue + difference * eased;
      valueRef.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}

function AnimatedMetric({
  value,
  format,
}: {
  value: number;
  format: (value: number) => string;
}) {
  return <>{format(useAnimatedValue(value))}</>;
}

function streamTone(mode: ApiMode): PillTone {
  if (mode === "live") return "teal";
  if (mode === "stale" || mode === "demo") return "amber";
  return "neutral";
}

function streamLabel(mode: ApiMode): string {
  if (mode === "live") return "streaming";
  if (mode === "stale") return "reconnecting";
  if (mode === "demo") return "demo data";
  return "connecting";
}

function minuteLabel(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function LiveMetrics({ snapshot }: { snapshot: LiveSnapshot }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        label="Orders / min"
        value={
          <AnimatedMetric value={snapshot.orders_1m} format={(value) => formatNumber(Math.round(value))} />
        }
        hint={`${formatNumber(snapshot.orders_15m)} in the last 15m`}
      />
      <KpiCard
        label="GMV · 15 min"
        value={<AnimatedMetric value={snapshot.gmv_15m} format={formatCompactINR} />}
        hint={`${formatINR(snapshot.gmv_1m)} in the last minute`}
      />
      <KpiCard
        label="Active deliveries"
        value={
          <AnimatedMetric
            value={snapshot.active_deliveries}
            format={(value) => formatNumber(Math.round(value))}
          />
        }
        hint="currently in motion"
      />
      <KpiCard
        label="Payment failures"
        value={<AnimatedMetric value={snapshot.payment_failure_rate_15m} format={formatPercent} />}
        hint="last 15 minutes"
      />
    </div>
  );
}

function OrdersChart({ snapshot }: { snapshot: LiveSnapshot }) {
  if (snapshot.orders_per_minute.length === 0) {
    return (
      <EmptyState
        title="Waiting for minute buckets"
        hint="The rolling chart fills as order events arrive."
      />
    );
  }

  return (
    <ChartShell
      title="Orders per minute"
      note={`${snapshot.orders_per_minute.length} rolling buckets · event time`}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={snapshot.orders_per_minute}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="minute"
              tickFormatter={minuteLabel}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip
              labelFormatter={(label) => minuteLabel(String(label))}
              content={
                <ChartTooltip
                  format={(key, value) =>
                    key === "gmv" ? formatINR(value) : formatNumber(Math.round(value))
                  }
                />
              }
            />
            <Area
              type="monotone"
              dataKey="orders"
              name="orders"
              stroke="var(--chart-1)"
              fill="var(--chart-1)"
              fillOpacity={0.14}
              strokeWidth={1.75}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

function StatusMix({ snapshot }: { snapshot: LiveSnapshot }) {
  const data = Object.entries(snapshot.status_mix)
    .map(([status, count]) => ({ status: status.replaceAll("_", " ").toLowerCase(), count }))
    .sort((a, b) => b.count - a.count);

  if (data.length === 0) {
    return (
      <EmptyState title="No status mix yet" hint="Order states appear after the first events arrive." />
    );
  }

  return (
    <ChartShell title="Status mix" note={`${formatNumber(snapshot.orders_15m)} orders · last 15m`}>
      <div style={{ height: Math.max(190, data.length * 34) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="status"
              tickLine={false}
              axisLine={false}
              width={84}
            />
            <Tooltip
              content={
                <ChartTooltip format={(_key, value) => formatNumber(Math.round(value))} />
              }
              cursor={{ fill: "color-mix(in oklch, var(--foreground) 6%, transparent)" }}
            />
            <Bar
              dataKey="count"
              name="orders"
              fill="var(--chart-2)"
              fillOpacity={0.85}
              radius={[0, 3, 3, 0]}
              barSize={14}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartShell>
  );
}

function StoreGrid({ snapshot }: { snapshot: LiveSnapshot }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Store pulse</CardTitle>
        <span className="col-start-2 row-start-1 text-xs text-muted-foreground">
          last 15 minutes
        </span>
      </CardHeader>
      <CardContent>
        {snapshot.per_store.length === 0 ? (
          <EmptyState
            className="py-8"
            title="No store activity yet"
            hint="Per-store counters appear with incoming orders."
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {[...snapshot.per_store]
              .sort((a, b) => b.orders_1m - a.orders_1m || b.gmv_15m - a.gmv_15m)
              .map((store) => (
                <div key={store.store_id} className="rounded-lg border border-border bg-secondary/25 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">Store {store.store_id}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatNumber(store.orders_1m)}/min
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-lg font-semibold tabular-nums">
                        {formatNumber(store.orders_15m)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">orders · 15m</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold tabular-nums">
                        {formatCompactINR(store.gmv_15m)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">GMV · 15m</div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LiveDashboard() {
  const { snapshot, pipeline, mode, error } = useLiveStream();
  const tone = streamTone(mode);

  return (
    <>
      <PageHeader
        title="Live operations"
        description="Order velocity, fulfillment state, and pipeline health from the streaming path."
      >
        <Pill tone={tone}>
          <StatusDot tone={tone} />
          <span className={mode === "live" ? "live-dot" : undefined}>{streamLabel(mode)}</span>
        </Pill>
      </PageHeader>

      {mode === "stale" || mode === "demo" ? <ApiBanner mode={mode} error={error} /> : null}

      {!snapshot ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <LiveMetrics snapshot={snapshot} />
      )}

      <div className="mt-3">
        <PipelineStrip pipeline={pipeline} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-5">
        <div className="xl:col-span-3">
          {snapshot ? <OrdersChart snapshot={snapshot} /> : <Skeleton className="h-80 rounded-xl" />}
        </div>
        <div className="xl:col-span-2">
          <OrderFeed orders={snapshot?.recent_orders ?? []} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-5">
        <div className="xl:col-span-2">
          {snapshot ? <StatusMix snapshot={snapshot} /> : <Skeleton className="h-72 rounded-xl" />}
        </div>
        <div className="xl:col-span-3">
          {snapshot ? <StoreGrid snapshot={snapshot} /> : <Skeleton className="h-72 rounded-xl" />}
        </div>
      </div>

      {snapshot ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Snapshot generated {minuteLabel(snapshot.generated_at)} · Stream{" "}
          <code>/api/v1/live/stream</code> · Pipeline <code>/api/v1/live/pipeline</code>
        </p>
      ) : null}
    </>
  );
}
