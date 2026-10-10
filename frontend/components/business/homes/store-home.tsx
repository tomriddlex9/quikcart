"use client";

import Link from "next/link";
import { BusinessPage } from "@/components/business/business-page";
import {
  AskBlock,
  HomeChrome,
  KpiStrip,
} from "@/components/business/homes/shared";
import { useTodayHome } from "@/components/business/homes/use-today-home";

export function StoreHome() {
  const { displayName, today, tiles, products, scopeHint } = useTodayHome();

  return (
    <BusinessPage title="Today" query={today}>
      {(data) => (
        <div data-testid="store-home" data-persona-home="store_manager">
          <HomeChrome displayName={displayName} data={data}>
            <KpiStrip
              tiles={tiles}
              large
              contextFor={() => `${scopeHint} · vs usual for this store`}
            />

            <section className="space-y-2" aria-label="Running low">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Running low in the next few hours</h2>
                <Link
                  href="/b/products?tab=running_low"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  All products
                </Link>
              </div>
              {products.data?.items.length ? (
                <ul className="divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                  {products.data.items.slice(0, 6).map((item) => (
                    <li
                      key={`${item.store_id}-${item.product_id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.note}</p>
                      </div>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {item.on_hand_qty ?? "—"} left
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No low-stock lines right now.</p>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <Link
                href="/b/delivery"
                className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 hover:ring-foreground/20"
              >
                <p className="text-sm font-medium">Late-risk orders</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Who will miss the promise window
                </p>
              </Link>
              <Link
                href="/b/actions"
                className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 hover:ring-foreground/20"
                data-testid="store-restock-cta"
              >
                <p className="text-sm font-medium">Request a restock</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Raise an action without leaving this view
                </p>
              </Link>
            </section>

            <AskBlock />
          </HomeChrome>
        </div>
      )}
    </BusinessPage>
  );
}
