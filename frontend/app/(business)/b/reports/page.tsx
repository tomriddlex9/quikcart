"use client";

import { BusinessPage } from "@/components/business/business-page";
import { BusinessState } from "@/components/business/business-state";
import { useBusinessData } from "@/lib/business/use-business-api";
import type { ReportsResponse } from "@/lib/business/types";

export default function ReportsPage() {
  const query = useBusinessData<ReportsResponse>("/reports");
  return (
    <BusinessPage
      title="Reports"
      description="Saved, shareable reports."
      query={query}
    >
      {(data) =>
        data.items.length === 0 ? (
          <BusinessState
            state="empty"
            title="No saved reports yet"
            hint={
              data.note ??
              "Save an answer from Ask, or finish the weekly review journey, to build your first report."
            }
          />
        ) : (
          <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-foreground/10">
            {data.items.map((r) => (
              <li key={r.report_id} className="px-4 py-3">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-[13px] text-muted-foreground">
                  {r.created_at ? new Date(r.created_at).toLocaleString("en-IN") : "Saved"}
                  {r.schedule ? ` · ${r.schedule}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )
      }
    </BusinessPage>
  );
}
