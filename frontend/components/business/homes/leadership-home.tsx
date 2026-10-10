"use client";

import Link from "next/link";
import { BusinessPage } from "@/components/business/business-page";
import { StatusBadge } from "@/components/business/status-badge";
import {
  AskBlock,
  HomeChrome,
  KpiStrip,
} from "@/components/business/homes/shared";
import { useTodayHome } from "@/components/business/homes/use-today-home";

export function LeadershipHome() {
  const { displayName, today, tiles, cityRollup, targets } = useTodayHome();
  const topTargets = targets.data?.items.slice(0, 3) ?? [];
  const risks = (today.data?.attention ?? []).slice(0, 3);

  return (
    <BusinessPage title="Today" query={today}>
      {(data) => (
        <div data-testid="leadership-home" data-persona-home="leadership">
          <HomeChrome displayName={displayName} data={data}>
            <section
              className="rounded-xl border border-border bg-card p-5"
              aria-label="Sixty-second digest"
            >
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Sixty-second digest
              </p>
              <p className="mt-2 text-base leading-relaxed">{data.summary}</p>
            </section>

            <KpiStrip
              tiles={tiles.slice(0, 3)}
              contextFor={(m) => m.explanation}
            />

            {cityRollup.length > 0 ? (
              <section className="space-y-2" aria-label="City comparison">
                <h2 className="text-sm font-medium">Cities today</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {cityRollup.slice(0, 6).map((c) => (
                    <div
                      key={c.city}
                      className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
                    >
                      <p className="font-medium">{c.city}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">
                        {c.sales.toLocaleString("en-IN", {
                          style: "currency",
                          currency: "INR",
                          maximumFractionDigits: 0,
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">{c.stores} stores</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {topTargets.length > 0 ? (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">Month-to-date vs target</h2>
                  <Link
                    href="/b/targets"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    All targets
                  </Link>
                </div>
                <ul className="divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                  {topTargets.map((t) => (
                    <li
                      key={`${t.scope_type}-${t.scope_value}-${t.metric_key}`}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <div>
                        <p className="font-medium">{t.scope_label}</p>
                        <p className="text-xs text-muted-foreground">{t.metric_label}</p>
                      </div>
                      <div className="text-right">
                        <p className="tabular-nums">
                          {t.actual_display ?? "—"} / {t.target_display}
                        </p>
                        <StatusBadge status={t.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="space-y-2">
              <h2 className="text-sm font-medium">Three biggest risks</h2>
              {risks.length > 0 ? (
                <ol className="space-y-2">
                  {risks.map((r, i) => (
                    <li
                      key={r.id}
                      className="rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-foreground/10"
                    >
                      <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                      <span className="font-medium">{r.title}</span>
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No open risks right now.</p>
              )}
            </section>

            <AskBlock />
          </HomeChrome>
        </div>
      )}
    </BusinessPage>
  );
}
