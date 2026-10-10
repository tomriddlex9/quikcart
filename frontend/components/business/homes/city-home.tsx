"use client";

import Link from "next/link";
import { BusinessPage } from "@/components/business/business-page";
import { StatusBadge } from "@/components/business/status-badge";
import {
  AskBlock,
  ChartBlock,
  HomeChrome,
  KpiStrip,
  StoresBlock,
} from "@/components/business/homes/shared";
import { useTodayHome } from "@/components/business/homes/use-today-home";

export function CityHome() {
  const { displayName, today, stores, tiles, chartPoints, targets, scopeHint } = useTodayHome();
  const pace = targets.data?.items[0] ?? null;

  return (
    <BusinessPage title="Today" query={today}>
      {(data) => (
        <div data-testid="city-home" data-persona-home="city_manager">
          <HomeChrome displayName={displayName} data={data}>
            {pace ? (
              <section
                className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
                aria-label="City vs target"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] text-muted-foreground">Month-to-date vs plan</p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {pace.actual_display ?? "—"}{" "}
                      <span className="text-base font-normal text-muted-foreground">
                        / {pace.target_display}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {scopeHint} · {pace.metric_label}
                    </p>
                  </div>
                  <StatusBadge status={pace.status} />
                </div>
                {pace.pace_pct != null ? (
                  <p className="mt-2 text-sm">
                    Pace{" "}
                    <span className="font-medium tabular-nums">
                      {Math.round(pace.pace_pct)}%
                    </span>{" "}
                    of plan
                  </p>
                ) : null}
                <Link
                  href="/b/targets"
                  className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground"
                >
                  Open targets
                </Link>
              </section>
            ) : null}

            <KpiStrip
              tiles={tiles}
              contextFor={() => `${scopeHint} vs company / last week`}
            />

            {stores.data ? (
              <StoresBlock
                stores={stores.data.stores}
                title={`${scopeHint} stores — visit the weakest first`}
              />
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2">
              <Link
                href="/b/delivery"
                className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10 hover:ring-foreground/20"
              >
                <p className="font-medium">Delivery watch</p>
                <p className="mt-1 text-muted-foreground">
                  On-time and late risk across the city
                </p>
              </Link>
              <Link
                href="/b/money"
                className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10 hover:ring-foreground/20"
              >
                <p className="font-medium">Promo & money</p>
                <p className="mt-1 text-muted-foreground">
                  Sales trend and discount depth
                </p>
              </Link>
            </section>

            <ChartBlock points={chartPoints} title="City sales, last 14 days vs usual" />
            <AskBlock />
          </HomeChrome>
        </div>
      )}
    </BusinessPage>
  );
}
