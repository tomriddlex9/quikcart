"use client";

import Link from "next/link";
import { ArrowUpRight, Radio } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useState } from "react";
import { ApiBanner } from "@/components/api-banner";
import { ChartShell, ChartTooltip } from "@/components/charts";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { RefreshIndicator } from "@/components/refresh-indicator";
import { EmptyState, Skeleton } from "@/components/states";
import { DEMO_KPIS, DEMO_STORES, DEMO_TREND } from "@/lib/demo";
import { formatCompactINR, formatDate, formatINR, formatNumber, formatPercent } from "@/lib/format";
import type { ApiMode } from "@/lib/api";
import { useApiData } from "@/lib/use-api";
import { useLiveStream } from "@/lib/use-live-stream";
import type { Kpis, OrderTrendRow, StoreRow } from "@/lib/types";

const REFRESH_MS = 30_000;

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

export function OverviewClient() {
  const kpis = useApiData<Kpis>("/api/v1/overview/kpis", DEMO_KPIS, REFRESH_MS);
  const trend = useApiData<OrderTrendRow[]>("/api/v1/trends/orders", DEMO_TREND, REFRESH_MS);
  const stores = useApiData<StoreRow[]>("/api/v1/stores", DEMO_STORES, REFRESH_MS);
  const live = useLiveStream();

  const countdown = useCountdown(kpis.lastUpdated);
  const modes: ApiMode[] = [kpis.mode, trend.mode, stores.mode];
  const pageMode: ApiMode = modes.includes("demo")
    ? "demo"
    : modes.includes("stale")
      ? "stale"
      : modes.includes("offline")
        ? "offline"
        : "live";

  return (
    <>
      <PageHeader
        title="Overview"
        description="Business health from the Gold marts, through the FastAPI boundary. Refreshes every 30s."
      >
        <RefreshIndicator mode={kpis.mode} lastUpdated={kpis.lastUpdated} countdown={countdown} />
      </PageHeader>

      <Link
        href="/live"
        className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-3.5 py-3 transition-colors hover:border-foreground/20"
      >
        <div className="flex min-w-32 items-center gap-2">
          <Radio className="size-4 text-chart-2" strokeWidth={1.75} />
          <div>
            <div className="text-sm font-medium">Live operations</div>
            <div className="text-[11px] text-muted-foreground">
              {live.mode === "live"
                ? "Streaming now"
                : live.mode === "stale"
                  ? "Showing last live data"
                  : live.mode === "demo"
                    ? "Demo data"
                    : "Connecting"}
            </div>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-4 text-xs">
          <div>
            <div className="font-medium tabular-nums">
              {formatNumber(live.snapshot?.orders_1m ?? 0)}
            </div>
            <div className="text-[11px] text-muted-foreground">orders/min</div>
          </div>
          <div>
            <div className="font-medium tabular-nums">
              {formatCompactINR(live.snapshot?.gmv_15m ?? 0)}
            </div>
            <div className="text-[11px] text-muted-foreground">GMV · 15m</div>
          </div>
          <div>
            <div className="font-medium tabular-nums">
              {formatNumber(live.snapshot?.active_deliveries ?? 0)}
            </div>
            <div className="text-[11px] text-muted-foreground">active deliveries</div>
          </div>
        </div>
        <ArrowUpRight className="ml-auto size-4 text-muted-foreground" strokeWidth={1.75} />
      </Link>

      {pageMode === "demo" || pageMode === "stale" ? (
        <ApiBanner mode={pageMode} error={kpis.error ?? trend.error ?? stores.error} />
      ) : null}

      {!kpis.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="GMV"
            value={formatCompactINR(kpis.data.gmv)}
            hint={formatINR(kpis.data.gmv)}
          />
          <KpiCard label="Orders" value={formatNumber(kpis.data.orders_placed)} />
          <KpiCard
            label="Cancellations"
            value={formatPercent(kpis.data.cancellation_rate)}
            hint="of placed orders"
          />
          <KpiCard
            label="Late deliveries"
            value={formatPercent(kpis.data.late_delivery_rate)}
            hint="past promise"
          />
          <KpiCard
            label="Below reorder"
            value={formatNumber(kpis.data.products_below_reorder)}
            hint="SKUs, all stores"
          />
          <KpiCard
            label="Active customers"
            value={formatNumber(kpis.data.active_customers)}
            hint="ordered in period"
          />
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-5">
        <div className="xl:col-span-3">
          {!trend.data ? (
            <Skeleton className="h-[340px] rounded-xl" />
          ) : trend.data.length === 0 ? (
            <EmptyState
              title="No order trend rows yet"
              hint="Run Silver→Gold so gold_store_hourly_metrics and gold_revenue_daily have data."
            />
          ) : (
            <ChartShell
              title="Orders per day"
              note={`last ${trend.data.length} days · area = orders, line = GMV (right axis)`}
            >
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="day"
                      tickFormatter={formatDate}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={48}
                    />
                    <YAxis
                      yAxisId="orders"
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      tickFormatter={(v: number) => `${Math.round(v / 100) / 10}k`}
                    />
                    <YAxis
                      yAxisId="gmv"
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tickFormatter={(v: number) => `₹${Math.round(v / 100000)}L`}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          format={(key, value) =>
                            key === "gmv" ? formatINR(value) : formatNumber(Math.round(value))
                          }
                        />
                      }
                    />
                    <Area
                      yAxisId="orders"
                      type="monotone"
                      dataKey="orders"
                      name="orders"
                      stroke="var(--chart-1)"
                      fill="var(--chart-1)"
                      fillOpacity={0.14}
                      strokeWidth={1.5}
                    />
                    <Line
                      yAxisId="gmv"
                      type="monotone"
                      dataKey="gmv"
                      name="gmv"
                      stroke="var(--chart-2)"
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartShell>
          )}
        </div>

        <div className="xl:col-span-2">
          {!stores.data ? (
            <Skeleton className="h-[340px] rounded-xl" />
          ) : stores.data.length === 0 ? (
            <EmptyState
              title="No store rows yet"
              hint="Store comparison is computed in the Gold layer; run the pipeline first."
            />
          ) : (
            <ChartShell title="GMV by store" note={`${stores.data.length} stores`}>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[...stores.data].sort((a, b) => b.gmv - a.gmv)}
                    layout="vertical"
                    margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis
                      type="number"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `₹${Math.round(v / 100000)}L`}
                    />
                    <YAxis
                      type="category"
                      dataKey="store_id"
                      tickLine={false}
                      axisLine={false}
                      width={58}
                      tickFormatter={(v: number | string) => `store ${v}`}
                    />
                    <Tooltip
                      content={<ChartTooltip format={(_key, value) => formatINR(value)} />}
                      cursor={{ fill: "color-mix(in oklch, var(--foreground) 6%, transparent)" }}
                    />
                    <Bar
                      dataKey="gmv"
                      name="gmv"
                      fill="var(--chart-1)"
                      fillOpacity={0.85}
                      radius={[0, 3, 3, 0]}
                      barSize={14}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartShell>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Sources: <code>gold_store_hourly_metrics</code>, <code>gold_revenue_daily</code>,{" "}
        <code>gold_inventory_health</code> via <code>/api/v1/overview/kpis</code>,{" "}
        <code>/api/v1/trends/orders</code>, <code>/api/v1/stores</code>.
      </p>
    </>
  );
}
