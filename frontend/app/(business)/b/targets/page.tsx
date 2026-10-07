"use client";

import { BusinessPage } from "@/components/business/business-page";
import { BusinessState } from "@/components/business/business-state";
import { StatusBadge } from "@/components/business/status-badge";
import { useBusinessData } from "@/lib/business/use-business-api";
import type { TargetsResponse } from "@/lib/business/types";

export default function TargetsPage() {
  const query = useBusinessData<TargetsResponse>("/targets");
  return (
    <BusinessPage
      title="Targets"
      description="Month-to-date pace against what you planned."
      query={query}
    >
      {(data) =>
        data.items.length === 0 ? (
          <BusinessState
            state="empty"
            title="No targets yet"
            hint={
              data.note ??
              "After you seed the database, run python -m quickcart.simulator.business to create monthly targets from recent sales."
            }
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {data.period_label}
              {data.period_start ? ` · starting ${data.period_start}` : ""}
            </p>
            <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
              {data.items.map((item) => (
                <li
                  key={`${item.scope_type}-${item.scope_value}-${item.metric_key}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {item.metric_label} · {item.scope_label}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      Target {item.target_display}
                      {item.actual_display ? ` · so far ${item.actual_display}` : ""}
                      {item.pace_pct != null ? ` · ${item.pace_pct}% of target` : ""}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </li>
              ))}
            </ul>
          </div>
        )
      }
    </BusinessPage>
  );
}
