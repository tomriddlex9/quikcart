"use client";

import Link from "next/link";
import { ArrowUpRight, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiBanner } from "@/components/api-banner";
import { PageHeader } from "@/components/page-header";
import { RefreshIndicator } from "@/components/refresh-indicator";
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
  ActivityLogEntry,
  AnomalyRow,
  InventoryRiskRow,
  Kpis,
  OrderTrendRow,
  Proposal,
  StoreRow,
} from "@/lib/types";
import { ActivityLog } from "@/components/home/activity-log";
import { KpiWall, type HomeKpiItem } from "@/components/home/kpi-wall";
import {
  CancelLateDualLineChart,
  InventoryRiskChart,
  LiveOrdersAreaChart,
  OrdersGmvTrendChart,
  StoreGmvChart,
} from "@/components/home/home-charts";
import { TeamLensTabs, useTeamLens } from "@/components/home/team-lens";

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

function buildActivityLog(
  live: ReturnType<typeof useLiveStream>,
  anomalies: AnomalyRow[] | null,
  proposals: Proposal[] | null,
): ActivityLogEntry[] {
  const entries: ActivityLogEntry[] = [];

  if (live.snapshot && live.snapshot.generated_at !== new Date(0).toISOString()) {
    entries.push({
      id: `live-${live.snapshot.generated_at}`,
      ts: live.snapshot.generated_at,
      level: "info",
      source: "live",
      message:
        `orders_1m=${live.snapshot.orders_1m} ` +
        `gmv_15m=${formatCompactINR(live.snapshot.gmv_15m)} ` +
        `active_deliveries=${live.snapshot.active_deliveries}`,
    });
    for (const order of live.snapshot.recent_orders.slice(0, 6)) {
      entries.push({
        id: `order-${order.order_id}`,
        ts: order.placed_at,
        level: "info",
        source: "orders",
        message: `#${order.order_id} store=${order.store_id} status=${order.status} ${formatINR(order.total_amount)}`,
      });
    }
  }

  if (live.pipeline) {
    for (const hb of live.pipeline.heartbeats) {
      const ts = hb.updated_at ?? hb.last_run_at;
      if (!ts) continue;
      entries.push({
        id: `stage-${hb.stage}-${ts}`,
        ts,
        level: hb.error ? "error" : "info",
        source: "pipeline",
        message: hb.error
          ? `${hb.stage} error=${hb.error}`
          : `${hb.stage} rows_in=${hb.rows_in} rows_out=${hb.rows_out}` +
            (hb.lag_seconds != null ? ` lag=${Math.round(hb.lag_seconds)}s` : ""),
      });
    }
  }

  for (const anomaly of anomalies ?? []) {
    entries.push({
      id: `anomaly-${anomaly.anomaly_type}-${anomaly.store_id}-${anomaly.observed_on}`,
      ts: anomaly.observed_on,
      level: anomaly.severity?.toUpperCase() === "HIGH" ? "error" : "warn",
      source: "anomaly",
      message:
        `${anomaly.anomaly_type} store=${anomaly.store_id} ` +
        `observed=${formatPercent(anomaly.observed_value)} expected=${formatPercent(anomaly.expected_value)} ` +
        `severity=${anomaly.severity}`,
    });
  }

  for (const proposal of proposals ?? []) {
    const ts = proposal.updated_at ?? proposal.created_at;
    if (!ts) continue;
    entries.push({
      id: `proposal-${proposal.proposal_id}-${ts}`,
      ts,
      level: "info",
      source: "proposal",
      message:
        `#${proposal.proposal_id} ${proposal.proposal_type} status=${proposal.status}` +
        (proposal.approved_by ? ` by=${proposal.approved_by}` : ""),
    });
  }

  entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return entries.slice(0, 40);
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
          id: "open_tickets",
          label: "Open tickets",
          value: formatNumber(DEMO_OPEN_TICKETS),
          hint: "illustrative",
          teams: ["support", "exec"],
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
        {
          id: "forecast_mape",
          label: "Forecast MAPE",
          value: formatPercent(DEMO_FORECAST_MAPE),
          hint: "demand model, illustrative",
          teams: ["ml", "data"],
        },
      ]
    : [];

  const logLoading =
    live.snapshot === null && anomalies.data === null && proposals.data === null && live.pipeline === null;
  const liveLogEntries = buildActivityLog(live, anomalies.data, proposals.data);
  const logEntries = liveLogEntries.length > 0 ? liveLogEntries : DEMO_ACTIVITY_LOG;
  const logIsLive = live.mode === "live" && liveLogEntries.length > 0;

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
        <ActivityLog entries={logEntries} loading={logLoading} live={logIsLive} />
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
