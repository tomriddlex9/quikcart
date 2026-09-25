"use client";

import { TriangleAlert, WifiOff } from "lucide-react";
import { API_BASE, type ApiMode } from "@/lib/api";

/**
 * Honest-mode banner. Rendered by every data page whenever the API is not
 * answering: demo data is always labeled as such, never passed off as live.
 */
export function ApiBanner({ mode, error }: { mode: ApiMode; error?: string | null }) {
  if (mode === "live") return null;
  if (mode === "stale") {
    return (
      <div
        role="status"
        className="mb-4 flex items-start gap-2.5 rounded-xl border border-chart-3/30 bg-chart-3/5 px-3.5 py-2.5 text-sm"
      >
        <WifiOff className="mt-0.5 size-4 shrink-0 text-chart-3" strokeWidth={1.75} />
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground">
            Live connection interrupted — showing last live data.
          </span>{" "}
          Reconnecting to <code className="text-xs">{API_BASE}</code>
          {error ? ` (${error})` : ""}.
        </div>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2.5 rounded-xl border border-chart-3/30 bg-chart-3/5 px-3.5 py-2.5 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-chart-3" strokeWidth={1.75} />
      <div className="text-muted-foreground">
        <span className="font-medium text-foreground">API offline — showing demo data.</span>{" "}
        <code className="text-xs">{API_BASE}</code> did not answer
        {error ? ` (${error})` : ""}. Start it with{" "}
        <code className="text-xs">uv run python -m quickcart.api</code>.
      </div>
    </div>
  );
}
