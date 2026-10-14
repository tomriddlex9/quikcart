"use client";

import { useState } from "react";
import {
  Bars,
  BarList,
  DataTable,
  EmptyPanel,
  Kpi,
  KpiGrid,
  MetricKpi,
  Panel,
  StatusBadge,
  TrendChart,
} from "@/components/solution/widgets";
import type { MetricValue, TrendPoint } from "@/lib/business/types";
import {
  BIZ,
  SALES_BY_CITY,
  STORE_MANAGER_STORE_ID,
  bizStoreDetail,
  count,
  hourLabel,
  inr,
  pct,
  shortDate,
} from "@/lib/solution-data";
import { cn } from "@/lib/utils";

// In the dummy data sales move in step with orders, so one series is shown (sales).
function SalesTrend({ data, xFormat, height }: { data: TrendPoint[]; xFormat: (v: string) => string; height?: number }) {
  return (
    <TrendChart
      data={data as unknown as Record<string, unknown>[]}
      xKey="at"
      xFormat={xFormat}
      series={[{ key: "sales", name: "Sales", kind: "area", axis: "left", color: "var(--chart-1)" }]}
      leftFormat={inr}
      valueFormat={(_, v) => inr(v)}
      height={height}
    />
  );
}

function metric(list: MetricValue[], key: string): MetricValue | undefined {
  return list.find((m) => m.key === key);
}

// ── Leadership ─────────────────────────────────────────────────────────────

export function LeadershipPage() {
  const { today, money, targets } = BIZ;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{today.summary}</p>

      <KpiGrid cols={4}>
        {today.headline.map((m) => (
          <MetricKpi key={m.key} metric={m} />
        ))}
      </KpiGrid>
      <KpiGrid cols={5}>
        {today.more.map((m) => (
          <MetricKpi key={m.key} metric={m} />
        ))}
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Sales, last 14 days" note="All stores">
          <SalesTrend data={money.daily_trend} xFormat={shortDate} />
        </Panel>
        <Panel title="Monthly target" note={targets.period_label}>
          <div className="space-y-4">
            {targets.items.map((t) => (
              <div key={`${t.scope_value}-${t.metric_key}`} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {t.metric_label} · {t.scope_label}
                  </span>
                  <StatusBadge status={t.status} />
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.min(t.pace_pct ?? 0, 100)}%` }} />
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {t.actual_display ?? "—"} of {t.target_display} · {t.pace_pct ?? "—"}% of target
                </div>
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
              <div>
                <div className="text-xs text-muted-foreground">Net sales</div>
                <div className="text-sm font-semibold tabular-nums">{money.net_sales_display}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Discounts</div>
                <div className="text-sm font-semibold tabular-nums">{money.discounts_display}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Refunds</div>
                <div className="text-sm font-semibold tabular-nums">{money.refunds_display}</div>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Needs attention" note={`${today.attention.length} items across the stores`}>
          <ul className="space-y-2">
            {today.attention.map((a) => (
              <li key={a.id} className="flex items-start gap-3 rounded-lg border border-border/60 px-3 py-2">
                <StatusBadge status={a.severity} />
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <EmptyPanel
          title="Demand forecast"
          note="Next days, all stores"
          what="The business dummy data has no forecast. It fills in when the demand model runs on the pipeline."
        />
      </div>
    </div>
  );
}

// ── Business & Revenue Manager ─────────────────────────────────────────────

export function RevenuePage() {
  const { scorecards, money, customers, bestsellers } = BIZ;
  const stores = [...scorecards.stores].sort(
    (a, b) => (b.metrics.sales_gmv?.value ?? 0) - (a.metrics.sales_gmv?.value ?? 0),
  );
  const [selected, setSelected] = useState(0);
  const store = stores[selected];
  const detail = store ? bizStoreDetail(store.store_id) : null;

  return (
    <div className="space-y-4">
      <KpiGrid cols={4}>
        <MetricKpi metric={money.sales} />
        <MetricKpi metric={money.average_basket} />
        <MetricKpi metric={metric(customers.metrics, "active_customers")} />
        <MetricKpi metric={metric(customers.metrics, "repeat_rate")} />
      </KpiGrid>

      <Panel title="Store scorecard" note={`${stores.length} stores, highest sales first · click a store for its trend`}>
        <DataTable
          minWidth={820}
          head={[
            { label: "Store" },
            { label: "City" },
            { label: "Status" },
            { label: "Sales", align: "right" },
            { label: "vs last week", align: "right" },
            { label: "Orders", align: "right" },
            { label: "On time", align: "right" },
            { label: "Cancelled", align: "right" },
            { label: "Avg delivery", align: "right" },
            { label: "Low stock", align: "right" },
          ]}
          rows={stores.map((s) => {
            const m = s.metrics;
            const d = m.sales_gmv?.delta_pct;
            return [
              <span key="n" className="font-medium">{s.store_name}</span>,
              s.city ?? "—",
              <StatusBadge key="s" status={s.status} />,
              m.sales_gmv?.display ?? "—",
              <span key="d" className={d != null && d < 0 ? "text-destructive" : "text-chart-2"}>
                {d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(1)}%`}
              </span>,
              m.orders?.display ?? "—",
              m.on_time_rate?.display ?? "—",
              m.cancel_rate?.display ?? "—",
              m.avg_delivery_minutes?.display ?? "—",
              m.stockout_risk_count?.display ?? "—",
            ];
          })}
          onRowClick={setSelected}
          selectedIndex={selected}
        />
      </Panel>

      {store && detail ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title={`${store.store_name}: sales by hour today`} note={`${store.city} · hours with data so far`}>
            <SalesTrend data={detail.hourly_trend} xFormat={hourLabel} height={220} />
          </Panel>
          <Panel title={`${store.store_name}: sales, last 14 days`} note={store.attention.join(" ") || "Holding steady."}>
            <SalesTrend data={detail.daily_trend} xFormat={shortDate} height={220} />
          </Panel>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Sales by store">
          <BarList
            rows={stores.map((s) => ({
              label: s.store_name,
              value: s.metrics.sales_gmv?.value ?? 0,
              tone: s.status === "bad" ? "bad" : s.status === "watch" ? "watch" : undefined,
            }))}
            format={inr}
          />
        </Panel>
        <Panel title="Sales by city">
          <BarList rows={SALES_BY_CITY.map((c) => ({ label: c.city, value: c.sales }))} format={inr} />
        </Panel>
        <Panel title="Sales by category" note={`Discounts ${pct(money.discount_share_pct)} of sales`}>
          <BarList rows={money.by_category.map((c) => ({ label: c.category, value: c.sales }))} format={inr} />
        </Panel>
      </div>

      {/* Slow movers are not shown: in the dummy data they repeat the bestseller products. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={bestsellers.title} note={bestsellers.description}>
          <ProductTable rows={bestsellers.items} />
        </Panel>
        <Panel title="Customers" note="Top customers by spend today">
          <div className="mb-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {[
              ["Total", count(customers.total_customers)],
              ["New today", count(customers.new_customers)],
              ["Active", metric(customers.metrics, "active_customers")?.display ?? "—"],
              ["Repeat rate", metric(customers.metrics, "repeat_rate")?.display ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/40 px-2 py-2">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-base font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <DataTable
            minWidth={360}
            head={[{ label: "Customer" }, { label: "Orders", align: "right" }, { label: "Spend", align: "right" }]}
            rows={customers.top_customers.map((c) => [c.customer_code, c.orders, c.spend_display])}
          />
        </Panel>
      </div>
    </div>
  );
}

function ProductTable({ rows }: { rows: (typeof BIZ.bestsellers.items)[number][] }) {
  return (
    <DataTable
      minWidth={460}
      head={[
        { label: "Product" },
        { label: "Store" },
        { label: "Units sold", align: "right" },
        { label: "Revenue", align: "right" },
      ]}
      rows={rows.map((p) => [p.name, p.store_name ?? "—", count(p.units_sold), p.revenue_display ?? "—"])}
    />
  );
}

// ── Store Manager ──────────────────────────────────────────────────────────
// Every store is available. All per-store figures come from the company-wide dummy
// data so that each store is shown the same way.

const STATUS_ORDER: Record<string, number> = { bad: 0, watch: 1, good: 2, unknown: 3 };

export function StorePage() {
  const { scorecards, delivery, runningLow } = BIZ;
  const stores = [...scorecards.stores].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.store_name.localeCompare(b.store_name),
  );
  const [storeId, setStoreId] = useState(STORE_MANAGER_STORE_ID);
  const card = stores.find((s) => s.store_id === storeId) ?? stores[0];
  const detail = bizStoreDetail(card.store_id);
  const m = card.metrics;
  const lowItems = [...runningLow.items].sort(
    (a, b) => Number(b.store_id === card.store_id) - Number(a.store_id === card.store_id),
  );

  return (
    <div className="space-y-4">
      <nav aria-label="Store" className="flex flex-wrap gap-1.5">
        {stores.map((s) => (
          <button
            key={s.store_id}
            type="button"
            onClick={() => setStoreId(s.store_id)}
            aria-pressed={s.store_id === card.store_id}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              s.store_id === card.store_id
                ? "bg-foreground text-background ring-foreground"
                : "bg-card ring-foreground/10 hover:bg-muted",
            )}
          >
            <span className={cn("size-2 rounded-full", STATUS_DOT[s.status] ?? STATUS_DOT.unknown)} />
            {s.store_name}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          {card.store_name}, {card.city}
        </span>
        <StatusBadge status={card.status} />
        {card.attention.map((a) => (
          <span key={a} className="text-muted-foreground">
            · {a}
          </span>
        ))}
      </div>

      <KpiGrid cols={4}>
        <MetricKpi metric={m.sales_gmv} />
        <MetricKpi metric={m.orders} />
        <MetricKpi metric={m.average_basket} />
        <MetricKpi metric={m.on_time_rate} />
      </KpiGrid>
      <KpiGrid cols={3}>
        <MetricKpi metric={m.cancel_rate} />
        <MetricKpi metric={m.avg_delivery_minutes} />
        <MetricKpi metric={m.stockout_risk_count} />
      </KpiGrid>

      {detail ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Sales by hour today" note="Hours with data so far">
            <SalesTrend data={detail.hourly_trend} xFormat={hourLabel} height={220} />
          </Panel>
          <Panel title="Sales, last 14 days">
            <SalesTrend data={detail.daily_trend} xFormat={shortDate} height={220} />
          </Panel>
        </div>
      ) : null}

      <Panel title="All stores at a glance" note="Click a store to open it">
        <DataTable
          minWidth={680}
          head={[
            { label: "Store" },
            { label: "Status" },
            { label: "Sales", align: "right" },
            { label: "Orders", align: "right" },
            { label: "On time", align: "right" },
            { label: "Cancelled", align: "right" },
            { label: "Avg delivery", align: "right" },
            { label: "Low stock", align: "right" },
          ]}
          rows={stores.map((s) => [
            <span key="n" className="font-medium">{s.store_name}</span>,
            <StatusBadge key="s" status={s.status} />,
            s.metrics.sales_gmv?.display ?? "—",
            s.metrics.orders?.display ?? "—",
            s.metrics.on_time_rate?.display ?? "—",
            s.metrics.cancel_rate?.display ?? "—",
            s.metrics.avg_delivery_minutes?.display ?? "—",
            s.metrics.stockout_risk_count?.display ?? "—",
          ])}
          onRowClick={(i) => setStoreId(stores[i].store_id)}
          selectedIndex={stores.findIndex((s) => s.store_id === card.store_id)}
        />
      </Panel>

      <Panel title={`${runningLow.title}: all stores`} note={`${runningLow.description} ${card.store_name} first.`}>
        <DataTable
          minWidth={680}
          head={[
            { label: "Product" },
            { label: "Store" },
            { label: "Category" },
            { label: "On hand", align: "right" },
            { label: "Reorder point", align: "right" },
            { label: "Stock left", align: "right" },
            { label: "Status" },
          ]}
          rows={lowItems.map((p) => [
            <span key="p" className={cn(p.store_id === card.store_id && "font-medium")}>{p.name}</span>,
            p.store_name ?? "—",
            p.category,
            count(p.on_hand_qty),
            count(p.reorder_point),
            p.stock_cover_hours == null ? "—" : `${p.stock_cover_hours} h`,
            <StatusBadge key="s" status={p.status} />,
          ])}
          selectedIndex={lowItems.some((p) => p.store_id === card.store_id) ? 0 : undefined}
        />
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Orders in progress" note="All stores, right now">
          <BarList rows={Object.entries(delivery.in_progress).map(([label, value]) => ({ label, value }))} format={count} />
        </Panel>
        <Panel title="Riders" note="All stores, right now">
          <BarList rows={Object.entries(delivery.riders).map(([label, value]) => ({ label, value }))} format={count} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <EmptyPanel
          title="Orders likely to be late"
          note={`Late-delivery prediction for ${card.store_name}`}
          what="The business dummy data has no per-order predictions. They fill in when the late-delivery model runs."
        />
        <EmptyPanel
          title={`Demand forecast for ${card.store_name}`}
          what="The business dummy data has no forecast. It fills in when the demand model runs on the pipeline."
        />
      </div>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  good: "bg-chart-2",
  watch: "bg-chart-3",
  bad: "bg-destructive",
  unknown: "bg-muted-foreground",
};
