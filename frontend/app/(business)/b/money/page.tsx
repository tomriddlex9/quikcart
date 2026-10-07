"use client";

import { useMemo } from "react";
import { BusinessPage } from "@/components/business/business-page";
import { MetricTile } from "@/components/business/metric-tile";
import {
  TodayVsUsualChart,
  dailyPointsWithUsual,
} from "@/components/business/today-vs-usual-chart";
import { formatShare } from "@/lib/business/format";
import type { MoneyResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

export default function MoneyPage() {
  const query = useBusinessData<MoneyResponse>("/money");
  const points = useMemo(() => dailyPointsWithUsual(query.data?.daily_trend ?? []), [query.data]);
  return (
    <BusinessPage
      title="Money"
      description="What came in, what was given away, and which categories carry the day."
      query={query}
    >
      {(data) => (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2">
            <MetricTile metric={data.sales} />
            <MetricTile metric={data.average_basket} />
          </section>

          <section aria-label="Sales breakdown" className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <h2 className="text-sm font-medium">From sales to net sales</h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Sales</dt>
                <dd className="text-lg font-semibold tabular-nums">{data.sales.display}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Discounts given</dt>
                <dd className="text-lg font-semibold tabular-nums">{data.discounts_display}</dd>
                <dd className="text-xs text-muted-foreground">
                  {formatShare(data.discount_share_pct)} of sales
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Refunds</dt>
                <dd className="text-lg font-semibold tabular-nums">{data.refunds_display}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Net sales</dt>
                <dd className="text-lg font-semibold tabular-nums">{data.net_sales_display}</dd>
              </div>
              {data.contribution_margin_display ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Contribution margin</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {data.contribution_margin_display}
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    {data.margin_pct != null
                      ? `${data.margin_pct}% of net sales`
                      : "After product cost"}
                    {data.cogs_display ? ` · cost ${data.cogs_display}` : ""}
                  </dd>
                </div>
              ) : null}
              {data.cogs_display && !data.contribution_margin_display ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Product cost</dt>
                  <dd className="text-lg font-semibold tabular-nums">{data.cogs_display}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Sales by category</h2>
            {data.by_category.length === 0 ? (
              <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
                No category sales for this day yet.
              </p>
            ) : (
              <ul className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                {data.by_category.map((c) => {
                  const widthPct = Math.max(0, Math.min(100, Math.round((c.share_pct ?? 0) * 100)));
                  return (
                    <li
                      key={c.category}
                      className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-[13px]"
                    >
                      <span className="truncate">{c.category}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
                        <span
                          className="block h-2 max-w-full rounded-full bg-chart-1"
                          style={{ width: `${widthPct}%` }}
                        />
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {c.sales_display} · {formatShare(c.share_pct)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <TodayVsUsualChart
            points={points}
            title={`Sales over the last ${points.length || 7} days, against your usual`}
          />
        </div>
      )}
    </BusinessPage>
  );
}
