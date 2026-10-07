"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AttentionList } from "@/components/business/attention-list";
import { BusinessPage } from "@/components/business/business-page";
import { GettingStartedChecklist } from "@/components/business/getting-started-checklist";
import { MetricTile } from "@/components/business/metric-tile";
import { MorningBriefing } from "@/components/business/morning-briefing";
import { QuickQuestionChips } from "@/components/business/quick-question-chips";
import { ResumeJourneyBanner } from "@/components/business/resume-journey-banner";
import { Spotlight } from "@/components/business/spotlight";
import { StoreLeaderboard } from "@/components/business/store-leaderboard";
import {
  TodayVsUsualChart,
  dailyPointsWithUsual,
} from "@/components/business/today-vs-usual-chart";
import { useBusiness } from "@/lib/business/business-context";
import { firstName } from "@/lib/business/format";
import type { MoneyResponse, StoreScorecardsResponse, TodayResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

const METRIC_LINKS: Record<string, string> = {
  sales_gmv: "/b/money",
  orders: "/b/stores",
  average_basket: "/b/money",
  on_time_rate: "/b/delivery",
  cancel_rate: "/b/stores",
  avg_delivery_minutes: "/b/delivery",
  stockout_risk_count: "/b/products?tab=running_low",
  active_customers: "/b/customers",
  repeat_rate: "/b/customers",
};

export default function TodayPage() {
  const { displayName, pinned } = useBusiness();
  const today = useBusinessData<TodayResponse>("/today");
  const stores = useBusinessData<StoreScorecardsResponse>("/stores/scorecards");
  const money = useBusinessData<MoneyResponse>("/money");

  const tiles = useMemo(() => {
    if (!today.data) return [];
    const all = [...today.data.headline, ...today.data.more];
    const picked = pinned
      .slice(0, 4)
      .map((key) => all.find((m) => m.key === key))
      .filter((m): m is NonNullable<typeof m> => m !== undefined);
    return picked.length > 0 ? picked : today.data.headline.slice(0, 4);
  }, [today.data, pinned]);

  const chartPoints = useMemo(
    () => (money.data ? dailyPointsWithUsual(money.data.daily_trend) : []),
    [money.data],
  );

  return (
    <BusinessPage title="Today" query={today}>
      {(data) => (
        <div className="space-y-6">
          <ResumeJourneyBanner />
          <MorningBriefing name={firstName(displayName)} summary={data.summary} meta={data.meta} />

          <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((metric) => (
              <MetricTile key={metric.key} metric={metric} href={METRIC_LINKS[metric.key]} />
            ))}
          </section>

          <Spotlight journeyId="attention">
            <section className="space-y-2">
              <h2 className="text-sm font-medium">Needs your attention</h2>
              <AttentionList items={data.attention.slice(0, 5)} />
            </section>
          </Spotlight>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Stores, ones needing help first</h2>
              <Link href="/b/stores" className="text-xs text-muted-foreground hover:text-foreground">
                See all stores
              </Link>
            </div>
            {stores.data ? <StoreLeaderboard stores={stores.data.stores} limit={5} /> : null}
          </section>

          {chartPoints.length > 0 ? (
            <TodayVsUsualChart points={chartPoints} title="Sales over the last 14 days, against your usual" />
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Ask something</h2>
            <QuickQuestionChips />
          </section>

          <GettingStartedChecklist />
        </div>
      )}
    </BusinessPage>
  );
}
