"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { AttentionList } from "@/components/business/attention-list";
import { BusinessPage } from "@/components/business/business-page";
import { useMarkChecklist } from "@/components/business/getting-started-checklist";
import { MetricTile } from "@/components/business/metric-tile";
import { ProductList } from "@/components/business/product-list";
import { StatusBadge } from "@/components/business/status-badge";
import {
  TodayVsUsualChart,
  dailyPointsWithUsual,
} from "@/components/business/today-vs-usual-chart";
import type { StoreDetail } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

const TILE_ORDER = ["sales_gmv", "orders", "average_basket", "on_time_rate", "avg_delivery_minutes", "cancel_rate"];

export default function StoreDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const query = useBusinessData<StoreDetail>(Number.isFinite(id) ? `/stores/${id}` : null);
  const mark = useMarkChecklist();
  const loaded = query.data !== null;
  useEffect(() => {
    if (loaded) mark("open_store");
  }, [loaded, mark]);

  const hourly = useMemo(
    () =>
      (query.data?.hourly_trend ?? []).map((p) => ({
        label: `${new Date(p.at).getUTCHours()}:00`,
        today: p.sales,
      })),
    [query.data],
  );
  const daily = useMemo(() => dailyPointsWithUsual(query.data?.daily_trend ?? []), [query.data]);

  return (
    <BusinessPage
      title={query.data?.scorecard.store_name ?? "Store"}
      description={query.data?.scorecard.city ?? undefined}
      query={query}
      actions={
        <div className="flex items-center gap-3">
          {query.data ? <StatusBadge status={query.data.scorecard.status} /> : null}
          <Link href="/b/stores" className="text-xs text-muted-foreground hover:text-foreground">
            All stores
          </Link>
        </div>
      }
    >
      {(data) => (
        <div className="space-y-6">
          {data.scorecard.attention.length > 0 ? (
            <AttentionList
              items={data.scorecard.attention.map((text, i) => ({
                id: `${data.scorecard.store_id}-${i}`,
                severity: data.scorecard.status === "bad" ? "bad" : "watch",
                title: text,
                detail: "Compared with the same day last week.",
                metric_key: null,
                store_id: null,
                store_name: data.scorecard.store_name,
              }))}
            />
          ) : null}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TILE_ORDER.map((key) => data.scorecard.metrics[key])
              .filter((m) => m !== undefined)
              .map((metric) => (
                <MetricTile key={metric.key} metric={metric} />
              ))}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <TodayVsUsualChart points={hourly} title="Sales so far today, hour by hour" />
            <TodayVsUsualChart points={daily} title="Sales over 14 days, against the usual" />
          </div>
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Running low here</h2>
            <ProductList items={data.running_low} showStore={false} emptyText="Nothing is running low at this store." />
          </section>
        </div>
      )}
    </BusinessPage>
  );
}
