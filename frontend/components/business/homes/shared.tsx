"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AttentionList } from "@/components/business/attention-list";
import { GettingStartedChecklist } from "@/components/business/getting-started-checklist";
import { MetricTile } from "@/components/business/metric-tile";
import { MorningBriefing } from "@/components/business/morning-briefing";
import { QuickQuestionChips } from "@/components/business/quick-question-chips";
import { ResumeJourneyBanner } from "@/components/business/resume-journey-banner";
import { Spotlight } from "@/components/business/spotlight";
import { METRIC_LINKS } from "@/components/business/homes/use-today-home";
import { StoreLeaderboard } from "@/components/business/store-leaderboard";
import { TodayVsUsualChart } from "@/components/business/today-vs-usual-chart";
import { KpiCard } from "@/components/kpi-card";
import { firstName } from "@/lib/business/format";
import { useProvenance } from "@/lib/business/provenance-context";
import type { LiveWindow, MetricValue, StoreScorecard, TodayResponse } from "@/lib/business/types";
import { formatCompactINR, formatINR, formatNumber, formatPercent } from "@/lib/format";

export function ProvenanceBanner() {
  const { enabled } = useProvenance();
  if (!enabled) return null;
  return (
    <div
      className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
      data-testid="provenance-banner"
      role="status"
    >
      How numbers are made is on — click any KPI to see Raw → Bronze → Silver → Gold with the transform code.
    </div>
  );
}

export function HomeChrome({
  displayName,
  data,
  children,
}: {
  displayName: string;
  data: TodayResponse;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <ResumeJourneyBanner />
      <ProvenanceBanner />
      <MorningBriefing name={firstName(displayName)} summary={data.summary} meta={data.meta} />
      <LiveOpsStrip live={data.live} />
      {children}
    </div>
  );
}

export function LiveOpsStrip({ live }: { live: LiveWindow | null | undefined }) {
  if (!live) return null;
  return (
    <section aria-label="Live operations" className="space-y-2" data-testid="live-ops-strip">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Live operations</h2>
        <Link href="/live" className="text-xs text-muted-foreground hover:text-foreground">
          Open live view
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Orders / min"
          value={formatNumber(live.orders_1m)}
          hint={`${formatNumber(live.orders_15m)} in the last 15m`}
        />
        <KpiCard
          label="GMV · 15 min"
          value={formatCompactINR(live.gmv_15m)}
          hint={`${formatINR(live.gmv_1m)} in the last minute`}
        />
        <KpiCard
          label="Active deliveries"
          value={formatNumber(live.active_deliveries)}
          hint="currently in motion"
        />
        <KpiCard
          label="Payment failures"
          value={formatPercent(live.payment_failure_rate_15m)}
          hint="last 15 minutes"
        />
      </div>
    </section>
  );
}

export function KpiStrip({
  tiles,
  contextFor,
  large = false,
}: {
  tiles: MetricValue[];
  contextFor?: (m: MetricValue) => string | undefined;
  large?: boolean;
}) {
  return (
    <Spotlight journeyId="headline">
      <section
        aria-label="Key numbers"
        className={
          large
            ? "grid gap-3 sm:grid-cols-2"
            : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        }
      >
        {tiles.map((metric) => (
          <MetricTile
            key={metric.key}
            metric={metric}
            href={METRIC_LINKS[metric.key]}
            contextLine={contextFor?.(metric)}
            compact={!large}
            className={large ? "min-h-[140px]" : undefined}
          />
        ))}
      </section>
    </Spotlight>
  );
}

export function AttentionBlock({ data }: { data: TodayResponse }) {
  return (
    <Spotlight journeyId="attention">
      <section className="space-y-2" id="attention">
        <h2 className="text-sm font-medium">Needs your attention</h2>
        <AttentionList items={data.attention.slice(0, 5)} />
      </section>
    </Spotlight>
  );
}

export function AskBlock() {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Ask something</h2>
      <QuickQuestionChips />
    </section>
  );
}

export function StoresBlock({
  stores,
  title = "Stores, ones needing help first",
}: {
  stores: StoreScorecard[];
  title?: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <Link href="/b/stores" className="text-xs text-muted-foreground hover:text-foreground">
          See all stores
        </Link>
      </div>
      <StoreLeaderboard stores={stores} limit={5} />
    </section>
  );
}

export function ChartBlock({
  points,
  title,
}: {
  points: Parameters<typeof TodayVsUsualChart>[0]["points"];
  title: string;
}) {
  if (points.length === 0) return null;
  return <TodayVsUsualChart points={points} title={title} />;
}

export { GettingStartedChecklist };
