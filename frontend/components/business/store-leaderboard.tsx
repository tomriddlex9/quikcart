import Link from "next/link";
import { StatusBadge } from "@/components/business/status-badge";
import { DeltaText } from "@/components/business/delta-text";
import type { StoreScorecard } from "@/lib/business/types";

/** Stores arrive worst-first from the API; this just lays them out. */
export function StoreLeaderboard({
  stores,
  limit,
}: {
  stores: StoreScorecard[];
  limit?: number;
}) {
  const rows = limit ? stores.slice(0, limit) : stores;
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
        No stores to show.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {rows.map((store, index) => {
        const sales = store.metrics.sales_gmv;
        const onTime = store.metrics.on_time_rate;
        return (
          <li key={store.store_id}>
            <Link
              href={`/b/stores/${store.store_id}`}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/50 sm:grid-cols-[auto_1fr_auto_auto_auto]"
            >
              <span className="w-5 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{store.store_name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {store.attention[0] ?? store.city ?? "Doing fine"}
                </span>
              </span>
              <StatusBadge status={store.status} />
              {sales ? (
                <span className="hidden text-right sm:block">
                  <span className="block text-sm font-medium tabular-nums">{sales.display}</span>
                  <DeltaText deltaPct={sales.delta_pct} direction={sales.direction} compareLabel="last week" />
                </span>
              ) : null}
              {onTime ? (
                <span className="hidden text-right sm:block">
                  <span className="block text-sm font-medium tabular-nums">{onTime.display}</span>
                  <span className="text-xs text-muted-foreground">on time</span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
