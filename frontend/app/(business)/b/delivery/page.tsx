"use client";

import Link from "next/link";
import { BusinessPage } from "@/components/business/business-page";
import { DeltaText } from "@/components/business/delta-text";
import { MetricTile } from "@/components/business/metric-tile";
import { StatusBadge } from "@/components/business/status-badge";
import type { DeliveryHealthResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

function Counts({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        {entries.map(([label, count]) => (
          <div key={label}>
            <dd className="text-xl font-semibold tabular-nums">{count}</dd>
            <dt className="text-xs text-muted-foreground">{label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function DeliveryPage() {
  const query = useBusinessData<DeliveryHealthResponse>("/delivery/health");
  return (
    <BusinessPage
      title="Delivery"
      description="Are orders arriving on time? Stores with the slowest deliveries are listed first."
      query={query}
    >
      {(data) => (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-3">
            {data.metrics.map((m) => (
              <MetricTile key={m.key} metric={m} />
            ))}
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <Counts title="Orders in progress" values={data.in_progress} />
            <Counts title="Riders" values={data.riders} />
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-medium">By store</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              {data.by_store.map((row) => (
                <li key={row.store_id}>
                  <Link
                    href={`/b/stores/${row.store_id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 hover:bg-secondary/50 sm:grid-cols-[1fr_auto_auto_auto]"
                  >
                    <span className="truncate text-sm font-medium">{row.store_name}</span>
                    <StatusBadge status={row.status} />
                    <span className="hidden text-right sm:block">
                      <span className="block text-sm tabular-nums">{row.on_time_rate.display} on time</span>
                      <DeltaText
                        deltaPct={row.on_time_rate.delta_pct}
                        direction={row.on_time_rate.direction}
                        compareLabel="last week"
                      />
                    </span>
                    <span className="hidden text-sm tabular-nums text-muted-foreground sm:block">
                      {row.avg_delivery_minutes.display}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </BusinessPage>
  );
}
