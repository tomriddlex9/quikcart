"use client";

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
import { useApiData } from "@/lib/use-api";
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

  const countdown = useCountdown(kpis.lastUpdated);
  const demoMode = kpis.mode !== "live" || trend.mode !== "live" || stores.mode !== "live";

  return (
    <>
      <PageHeader
        title="Operations overview"
        description="Headline health of the QuickCart business, served from the Gold marts through the FastAPI boundary. Refreshes every 30 seconds while the API is reachable."
      >
        <RefreshIndicator mode={kpis.mode} lastUpdated={kpis.lastUpdated} countdown={countdown} />
      </PageHeader>

      {demoMode ? <ApiBanner mode="demo" error={kpis.error ?? trend.error ?? stores.error} /> : null}

      {!kpis.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-xs border border-line-soft" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Gross merchandise value" value={formatCompactINR(kpis.data.gmv)} hint={formatINR(kpis.data.gmv)} />
          <KpiCard label="Orders placed" value={formatNumber(kpis.data.orders_placed)} />
          <KpiCard
            label="Cancellation rate"
            value={formatPercent(kpis.data.cancellation_rate)}
            hint="share of placed orders cancelled"
          />
          <KpiCard
            label="Late delivery rate"
            value={formatPercent(kpis.data.late_delivery_rate)}
            hint="deliveries past promise"
          />
          <KpiCard
            label="SKUs below reorder point"
            value={formatNumber(kpis.data.products_below_reorder)}
            hint="across all stores"
          />
          <KpiCard label="Active customers" value={formatNumber(kpis.data.active_customers)} hint="ordered in period" />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          {!trend.data ? (
            <Skeleton className="h-[340px] rounded-xs border border-line-soft" />
          ) : trend.data.length === 0 ? (
            <EmptyState
              title="No order trend rows yet"
              hint="Run the lakehouse pipeline (Silver→Gold) so gold_store_hourly_metrics and gold_revenue_daily have data, then refresh."
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
                    <XAxis dataKey="day" tickFormatter={formatDate} tickLine={false} axisLine={false} minTickGap={48} />
                    <YAxis yAxisId="orders" tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${Math.round(v / 100) / 10}k`} />
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
                      stroke="#5cc0b0"
                      fill="#5cc0b0"
                      fillOpacity={0.14}
                      strokeWidth={1.5}
                    />
                    <Line
                      yAxisId="gmv"
                      type="monotone"
                      dataKey="gmv"
                      name="gmv"
                      stroke="#f2a93b"
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
            <Skeleton className="h-[340px] rounded-xs border border-line-soft" />
          ) : stores.data.length === 0 ? (
            <EmptyState
              title="No store rows yet"
              hint="Store comparison is computed in the Gold layer; run the pipeline first."
            />
          ) : (
            <ChartShell title="GMV by store" note={`${stores.data.length} stores · dark-fleet network`}>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[...stores.data].sort((a, b) => b.gmv - a.gmv)}
                    layout="vertical"
                    margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => `₹${Math.round(v / 100000)}L`} />
                    <YAxis
                      type="category"
                      dataKey="store_id"
                      tickLine={false}
                      axisLine={false}
                      width={58}
                      tickFormatter={(v: number | string) => `store ${v}`}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip format={(_key, value) => formatINR(value)} />
                      }
                      cursor={{ fill: "rgba(233,226,210,0.04)" }}
                    />
                    <Bar dataKey="gmv" name="gmv" fill="#e9e2d2" fillOpacity={0.82} radius={[0, 2, 2, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartShell>
          )}
        </div>
      </div>

      <p className="mt-4 text-[10.5px] text-faint">
        Sources: <code>gold_store_hourly_metrics</code>, <code>gold_revenue_daily</code>,{" "}
        <code>gold_inventory_health</code> via <code>GET /api/v1/overview/kpis</code>,{" "}
        <code>/api/v1/trends/orders</code>, <code>/api/v1/stores</code>.
      </p>
    </>
  );
}
