"use client";

import Link from "next/link";
import { ArrowUpRight, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiBanner } from "@/components/api-banner";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/pill";
import { RefreshIndicator } from "@/components/refresh-indicator";
import { buildActivityLog } from "@/lib/activity-log";
import { formatCompactINR, formatINR, formatNumber, formatPercent } from "@/lib/format";
import type { ApiMode } from "@/lib/api";
import { useApiData } from "@/lib/use-api";
import { useLiveStream } from "@/lib/use-live-stream";
import {
  DEMO_ACTIVE_DELIVERIES,
  DEMO_ACTIVITY_LOG,
  DEMO_ANOMALIES,
  DEMO_FORECAST_MAPE,
  DEMO_INVENTORY_RISKS,
  DEMO_KPIS,
  DEMO_OPEN_TICKETS,
  DEMO_PAYMENT_FAILURE_RATE,
  DEMO_PROPOSALS,
  DEMO_STORES,
  DEMO_TREND,
} from "@/lib/demo";
import type {
  AnomalyRow,
  InventoryRiskRow,
  Kpis,
  OrderTrendRow,
  Proposal,
  StoreRow,
} from "@/lib/types";
import { ActivityLog, presentActivityLog } from "@/components/home/activity-log";
import { KpiWall, type HomeKpiItem } from "@/components/home/kpi-wall";
import {
  CancelLateDualLineChart,
  InventoryRiskChart,
  LiveOrdersAreaChart,
  OrdersGmvTrendChart,
  StoreGmvChart,
} from "@/components/home/home-charts";
import { TeamLensTabs, useTeamLens, visibleFor, type TeamLens } from "@/components/home/team-lens";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ILLUSTRATIVE_KPIS: Array<{
  id: string;
  label: string;
  value: string;
  hint: string;
  teams: TeamLens[];
}> = [
  {
    id: "open_tickets",
    label: "Open tickets",
    value: formatNumber(DEMO_OPEN_TICKETS),
    hint: "support queue",
    teams: ["support", "exec"],
  },
  {
    id: "forecast_mape",
    label: "Forecast MAPE",
    value: formatPercent(DEMO_FORECAST_MAPE),
    hint: "demand model",
    teams: ["ml", "data"],
  },
];

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
  const [team, setTeam] = useTeamLens();

  const kpis = useApiData<Kpis>("/api/v1/overview/kpis", DEMO_KPIS, REFRESH_MS);
  const trend = useApiData<OrderTrendRow[]>("/api/v1/trends/orders", DEMO_TREND, REFRESH_MS);
  const stores = useApiData<StoreRow[]>("/api/v1/stores", DEMO_STORES, REFRESH_MS);
  const risks = useApiData<InventoryRiskRow[]>(
    "/api/v1/inventory/risks",
    DEMO_INVENTORY_RISKS,
    REFRESH_MS,
  );
  const anomalies = useApiData<AnomalyRow[]>("/api/v1/anomalies", DEMO_ANOMALIES, REFRESH_MS);
  const proposals = useApiData<Proposal[]>("/api/v1/proposals", DEMO_PROPOSALS, REFRESH_MS);
  const live = useLiveStream();

  const countdown = useCountdown(kpis.lastUpdated);
  const modes: ApiMode[] = [kpis.mode, trend.mode, stores.mode, risks.mode, anomalies.mode, proposals.mode];
  const pageMode: ApiMode = modes.includes("demo")
    ? "demo"
    : modes.includes("stale")
      ? "stale"
      : modes.includes("offline")
        ? "offline"
        : "live";

  const kpiLoading = kpis.data === null;

  const activeDeliveries =
    live.mode === "live" || live.mode === "stale"
      ? live.snapshot?.active_deliveries ?? DEMO_ACTIVE_DELIVERIES
      : DEMO_ACTIVE_DELIVERIES;
  const paymentFailureRate =
    live.mode === "live" || live.mode === "stale"
      ? live.snapshot?.payment_failure_rate_15m ?? DEMO_PAYMENT_FAILURE_RATE
      : DEMO_PAYMENT_FAILURE_RATE;

  const pendingProposals = (proposals.data ?? []).filter((p) => p.status === "PENDING").length;
  const stockoutStores = new Set(
    (risks.data ?? []).filter((r) => r.is_below_reorder_point).map((r) => r.store_id),
  ).size;

  const kpiItems: HomeKpiItem[] = kpis.data
    ? [
        {
          id: "gmv",
          label: "GMV",
          value: formatCompactINR(kpis.data.gmv),
          hint: formatINR(kpis.data.gmv),
          teams: ["data", "exec"],
        },
        {
          id: "orders_placed",
          label: "Orders",
          value: formatNumber(kpis.data.orders_placed),
          teams: ["ops", "data", "exec"],
        },
        {
          id: "aov",
          label: "AOV",
          value: kpis.data.orders_placed > 0
            ? formatINR(kpis.data.gmv / kpis.data.orders_placed)
            : "—",
          hint: "GMV ÷ orders placed",
          teams: ["data", "exec"],
        },
        {
          id: "cancellation_rate",
          label: "Cancellations",
          value: formatPercent(kpis.data.cancellation_rate),
          hint: "of placed orders",
          tone: kpis.data.cancellation_rate > 0.06 ? "warn" : "default",
          teams: ["ops", "support", "exec"],
        },
        {
          id: "late_delivery_rate",
          label: "Late deliveries",
          value: formatPercent(kpis.data.late_delivery_rate),
          hint: "past promise",
          tone: kpis.data.late_delivery_rate > 0.08 ? "warn" : "default",
          teams: ["ops", "support", "exec"],
        },
        {
          id: "active_deliveries",
          label: "Active deliveries",
          value: formatNumber(activeDeliveries),
          hint: "in flight now",
          teams: ["ops", "support", "exec"],
        },
        {
          id: "payment_failure_rate",
          label: "Payment failures",
          value: formatPercent(paymentFailureRate),
          hint: "last 15m",
          tone: paymentFailureRate > 0.06 ? "critical" : "default",
          teams: ["ops", "support", "exec"],
        },
        {
          id: "products_below_reorder",
          label: "Below reorder",
          value: formatNumber(kpis.data.products_below_reorder),
          hint: "SKUs, all stores",
          teams: ["ops", "data", "exec"],
        },
        {
          id: "stockout_stores",
          label: "Stores at risk",
          value: formatNumber(stockoutStores),
          hint: "≥1 SKU below reorder",
          tone: stockoutStores > 3 ? "warn" : "default",
          teams: ["ops", "data", "exec"],
        },
        {
          id: "active_customers",
          label: "Active customers",
          value: formatNumber(kpis.data.active_customers),
          hint: "ordered in period",
          teams: ["data", "exec"],
        },
        {
          id: "anomaly_count",
          label: "Anomalies",
          value: formatNumber((anomalies.data ?? []).length),
          hint: "open, unreviewed",
          tone: (anomalies.data ?? []).some((a) => a.severity?.toUpperCase() === "HIGH")
            ? "critical"
            : "default",
          teams: ["ml", "ops", "exec"],
        },
        {
          id: "pending_proposals",
          label: "Pending proposals",
          value: formatNumber(pendingProposals),
          hint: "awaiting human approval",
          teams: ["ml", "ops", "exec"],
        },
      ]
    : [];

  const logLoading =
    live.snapshot === null && anomalies.data === null && proposals.data === null && live.pipeline === null;
  const liveLogEntries = buildActivityLog(
    live.mode === "demo" ? null : live.snapshot,
    live.mode === "demo" ? null : live.pipeline,
    anomalies.mode === "live" || anomalies.mode === "stale" ? anomalies.data : null,
    proposals.mode === "live" || proposals.mode === "stale" ? proposals.data : null,
  );
  const activity = presentActivityLog(pageMode, live.mode, liveLogEntries, DEMO_ACTIVITY_LOG);
  const visibleIllustrative = ILLUSTRATIVE_KPIS.filter((item) => visibleFor(team, item.teams));

  return (
    <>
      <PageHeader
        title="Overview"
        description="Ops command center — Gold marts, the live stream and the agent's proposal queue, through the FastAPI boundary."
      >
        <RefreshIndicator mode={kpis.mode} lastUpdated={kpis.lastUpdated} countdown={countdown} />
      </PageHeader>

      <div className="mb-4">
        <TeamLensTabs team={team} onChange={setTeam} />
      </div>

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
        <ApiBanner
          mode={pageMode}
          error={kpis.error ?? trend.error ?? stores.error ?? risks.error ?? anomalies.error ?? proposals.error}
        />
      ) : null}

      <KpiWall items={kpiItems} team={team} loading={kpiLoading} />

      {visibleIllustrative.length > 0 ? (
        <section className="mt-3" aria-labelledby="illustrative-kpis">
          <h2 id="illustrative-kpis" className="mb-2 text-sm font-medium">
            Illustrative
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {visibleIllustrative.map((item) => (
              <Card key={item.id} size="sm" className="gap-1">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2 text-xs font-normal text-muted-foreground">
                    <span>{item.label}</span>
                    <Pill tone="amber">illustrative</Pill>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold leading-none tracking-tight tabular-nums">
                    {item.value}
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">{item.hint}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <OrdersGmvTrendChart data={trend.data} loading={trend.data === null} />
        <StoreGmvChart data={stores.data} loading={stores.data === null} />
        <CancelLateDualLineChart data={stores.data} loading={stores.data === null} />
        <LiveOrdersAreaChart
          data={live.snapshot?.orders_per_minute ?? null}
          loading={live.snapshot === null}
        />
        <InventoryRiskChart data={risks.data} loading={risks.data === null} />
      </div>

      <div className="mt-3">
        <ActivityLog entries={activity.entries} loading={logLoading} source={activity.source} />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Sources: <code>gold_store_hourly_metrics</code>, <code>gold_revenue_daily</code>,{" "}
        <code>gold_inventory_health</code>, <code>gold_anomalies</code> via{" "}
        <code>/api/v1/overview/kpis</code>, <code>/api/v1/trends/orders</code>,{" "}
        <code>/api/v1/stores</code>, <code>/api/v1/inventory/risks</code>,{" "}
        <code>/api/v1/anomalies</code>, <code>/api/v1/proposals</code> and the live stream.
      </p>
    </>
  );
}
