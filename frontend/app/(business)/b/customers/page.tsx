"use client";

import { BusinessPage } from "@/components/business/business-page";
import { MetricTile } from "@/components/business/metric-tile";
import { formatCount } from "@/lib/business/format";
import type { CustomersHealthResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

export default function CustomersPage() {
  const query = useBusinessData<CustomersHealthResponse>("/customers/health");
  return (
    <BusinessPage title="Customers" description="Who is ordering, and whether they come back." query={query}>
      {(data) => (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-3">
            {data.metrics.map((m) => (
              <MetricTile key={m.key} metric={m} />
            ))}
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <p className="text-[13px] text-muted-foreground">New customers today</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCount(data.new_customers)}</p>
            </div>
            <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <p className="text-[13px] text-muted-foreground">Customers overall</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCount(data.total_customers)}</p>
            </div>
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Top customers</h2>
            {data.top_customers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                No customer orders yet today.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                {data.top_customers.map((c) => (
                  <li key={c.customer_code} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span>
                      <span className="block text-sm font-medium">{c.customer_code}</span>
                      <span className="text-xs text-muted-foreground">{c.orders} orders</span>
                    </span>
                    <span className="text-sm font-medium tabular-nums">{c.spend_display}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </BusinessPage>
  );
}
