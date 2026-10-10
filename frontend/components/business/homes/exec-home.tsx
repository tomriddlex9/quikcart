"use client";

import { BusinessPage } from "@/components/business/business-page";
import {
  AskBlock,
  AttentionBlock,
  GettingStartedChecklist,
  HomeChrome,
  KpiStrip,
  StoresBlock,
} from "@/components/business/homes/shared";
import { useTodayHome } from "@/components/business/homes/use-today-home";

export function ExecHome() {
  const { displayName, today, stores, tiles, cityRollup, scopeHint } = useTodayHome();

  return (
    <BusinessPage title="Today" query={today}>
      {(data) => (
        <div data-testid="exec-home" data-persona-home="business_exec">
          <HomeChrome displayName={displayName} data={data}>
            <KpiStrip
              tiles={tiles}
              contextFor={() => `${scopeHint} · Company → City → Store`}
            />
            {cityRollup.length > 0 ? (
              <section className="space-y-2" aria-label="Cities by sales">
                <h2 className="text-sm font-medium">Cities, strongest first</h2>
                <ul className="divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                  {cityRollup.slice(0, 4).map((c) => (
                    <li
                      key={c.city}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <span className="font-medium">{c.city}</span>
                      <span className="text-muted-foreground">
                        {c.stores} stores ·{" "}
                        <span className="tabular-nums text-foreground">
                          {c.sales.toLocaleString("en-IN", {
                            style: "currency",
                            currency: "INR",
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {stores.data ? (
              <StoresBlock stores={stores.data.stores} title="Stores needing help first" />
            ) : null}
            <AttentionBlock data={data} />
            <AskBlock />
            <GettingStartedChecklist />
          </HomeChrome>
        </div>
      )}
    </BusinessPage>
  );
}
