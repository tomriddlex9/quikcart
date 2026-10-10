"use client";

import Link from "next/link";
import { BusinessPage } from "@/components/business/business-page";
import {
  AskBlock,
  AttentionBlock,
  ChartBlock,
  HomeChrome,
  KpiStrip,
} from "@/components/business/homes/shared";
import { useTodayHome } from "@/components/business/homes/use-today-home";
import type { ProductsResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

export function CategoryHome() {
  const { displayName, today, tiles, chartPoints, money, scopeHint } = useTodayHome();
  const bestsellers = useBusinessData<ProductsResponse>("/products?tab=bestsellers&limit=5");
  const slow = useBusinessData<ProductsResponse>("/products?tab=slow&limit=5");
  const categoryShare = money.data?.by_category.find(
    (c) => c.category.toLowerCase() === scopeHint.toLowerCase(),
  );

  return (
    <BusinessPage title="Today" query={today}>
      {(data) => (
        <div data-testid="category-home" data-persona-home="category_manager">
          <HomeChrome displayName={displayName} data={data}>
            <KpiStrip
              tiles={tiles}
              contextFor={() =>
                categoryShare
                  ? `${scopeHint} · ${Math.round((categoryShare.share_pct ?? 0) * 100)}% of company sales`
                  : `${scopeHint} · Category → SKU → Store`
              }
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">Bestsellers</h2>
                  <Link
                    href="/b/products?tab=bestsellers"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    See all
                  </Link>
                </div>
                <ul className="divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                  {(bestsellers.data?.items ?? []).slice(0, 4).map((item) => (
                    <li key={item.product_id} className="px-3 py-2 text-sm">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.revenue_display ?? "—"} · {item.units_sold ?? "—"} units
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">Slow movers</h2>
                  <Link
                    href="/b/products?tab=slow"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    See all
                  </Link>
                </div>
                <ul className="divide-y divide-border rounded-xl ring-1 ring-foreground/10">
                  {(slow.data?.items ?? []).slice(0, 4).map((item) => (
                    <li key={item.product_id} className="px-3 py-2 text-sm">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.note}</p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <Link
              href="/b/products?tab=running_low"
              className="block rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10 hover:ring-foreground/20"
            >
              <p className="font-medium">Wastage & stockout risk</p>
              <p className="mt-1 text-muted-foreground">
                SKUs at or below reorder in {scopeHint}
              </p>
            </Link>

            <ChartBlock points={chartPoints} title="Category sales, last 14 days" />
            <AttentionBlock data={data} />
            <AskBlock />
          </HomeChrome>
        </div>
      )}
    </BusinessPage>
  );
}
