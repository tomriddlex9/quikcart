"use client";

import {
  Area,
  AreaChart,
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
import { ChartShell, ChartTooltip } from "@/components/charts";
import { EmptyState, Skeleton } from "@/components/states";
import { formatDate, formatINR, formatNumber, formatPercent } from "@/lib/format";
import type { LiveMinuteBucket } from "@/lib/live-types";
import type { InventoryRiskRow, OrderTrendRow, StoreRow } from "@/lib/types";

function ChartSlot({
  loading,
  empty,
  emptyTitle,
  emptyHint,
  children,
}: {
  loading: boolean;
  empty: boolean;
  emptyTitle: string;
  emptyHint?: string;
  children: React.ReactNode;
}) {
  if (loading) return <Skeleton className="h-[300px] rounded-xl" />;
  if (empty) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return <>{children}</>;
}

export function OrdersGmvTrendChart({
  data,
  loading,
}: {
  data: OrderTrendRow[] | null;
  loading: boolean;
}) {
  return (
    <ChartSlot
      loading={loading}
      empty={(data ?? []).length === 0}
      emptyTitle="No order trend rows yet"
      emptyHint="Run Silver→Gold so gold_store_hourly_metrics and gold_revenue_daily have data."
    >
      <ChartShell
        title="Orders + GMV trend"
        note={`last ${(data ?? []).length} days · area = orders, line = GMV (right axis)`}
      >
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
    </ChartSlot>
  );
}

export function StoreGmvChart({ data, loading }: { data: StoreRow[] | null; loading: boolean }) {
  const sorted = [...(data ?? [])].sort((a, b) => b.gmv - a.gmv);
  return (
    <ChartSlot
      loading={loading}
      empty={sorted.length === 0}
      emptyTitle="No store rows yet"
      emptyHint="Store comparison is computed in the Gold layer; run the pipeline first."
    >
      <ChartShell title="GMV by store" note={`${sorted.length} stores`}>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
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
    </ChartSlot>
  );
}

export function CancelLateDualLineChart({
  data,
  loading,
}: {
  data: StoreRow[] | null;
  loading: boolean;
}) {
  const sorted = [...(data ?? [])].sort((a, b) => a.store_id - b.store_id);
  return (
    <ChartSlot
      loading={loading}
      empty={sorted.length === 0}
      emptyTitle="No store rows yet"
      emptyHint="Cancellation and late-delivery rates are computed per store in the Gold layer."
    >
      <ChartShell title="Cancel vs late, by store" note="two lines · one axis, both as %">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sorted} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="store_id"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number | string) => `#${v}`}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              />
              <Tooltip content={<ChartTooltip format={(_key, value) => formatPercent(value)} />} />
              <Line
                type="monotone"
                dataKey="cancel_rate"
                name="cancel rate"
                stroke="var(--chart-4)"
                strokeWidth={1.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="late_rate"
                name="late rate"
                stroke="var(--chart-3)"
                strokeWidth={1.5}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartShell>
    </ChartSlot>
  );
}

export function LiveOrdersAreaChart({
  data,
  loading,
}: {
  data: LiveMinuteBucket[] | null;
  loading: boolean;
}) {
  return (
    <ChartSlot
      loading={loading}
      empty={(data ?? []).length === 0}
      emptyTitle="No live minutes yet"
      emptyHint="The live writer emits a per-minute bucket once orders start flowing through Postgres."
    >
      <ChartShell title="Live orders · last 15m" note="per-minute buckets from the live stream">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="minute"
                tickLine={false}
                axisLine={false}
                minTickGap={32}
                tickFormatter={(v: string) => v.slice(-5)}
              />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <Tooltip content={<ChartTooltip format={(_key, value) => formatNumber(value)} />} />
              <Area
                type="monotone"
                dataKey="orders"
                name="orders"
                stroke="var(--chart-2)"
                fill="var(--chart-2)"
                fillOpacity={0.18}
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartShell>
    </ChartSlot>
  );
}

export function InventoryRiskChart({
  data,
  loading,
}: {
  data: InventoryRiskRow[] | null;
  loading: boolean;
}) {
  const rows = [...(data ?? [])]
    .filter((r) => r.is_below_reorder_point)
    .sort((a, b) => a.stock_cover_hours - b.stock_cover_hours)
    .slice(0, 8);
  return (
    <ChartSlot
      loading={loading}
      empty={rows.length === 0}
      emptyTitle="No inventory risk rows"
      emptyHint="gold_inventory_health has no SKUs below reorder point right now."
    >
      <ChartShell title="Stockout risk" note="lowest stock-cover hours, below reorder point">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v}h`}
              />
              <YAxis
                type="category"
                dataKey="sku"
                tickLine={false}
                axisLine={false}
                width={96}
                tickFormatter={(v: string) => v}
              />
              <Tooltip
                content={
                  <ChartTooltip format={(_key, value) => `${value.toFixed(1)}h cover`} />
                }
                cursor={{ fill: "color-mix(in oklch, var(--foreground) 6%, transparent)" }}
              />
              <Bar
                dataKey="stock_cover_hours"
                name="stock cover"
                fill="var(--chart-4)"
                fillOpacity={0.85}
                radius={[0, 3, 3, 0]}
                barSize={12}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartShell>
    </ChartSlot>
  );
}
