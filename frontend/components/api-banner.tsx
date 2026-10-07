"use client";

import { FlaskConical, TriangleAlert, WifiOff } from "lucide-react";
import { API_BASE, type ApiMode } from "@/lib/api";

/**
 * Shown when a live read failed. A first failure has no payload. A later
 * failure keeps the last live payload and says so.
 */
export function ApiBanner({ mode, error }: { mode: ApiMode; error?: string | null }) {
  if (mode === "live") return null;
  if (mode === "offline" && !error) return null;
  if (mode === "demo") {
    return (
      <div
        role="status"
        className="mb-4 flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-sm"
      >
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground">Demo data.</span> These figures are bundled
          fixtures. Switch the header to API for the live service.
        </div>
      </div>
    );
  }
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
      role="alert"
      className="mb-4 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" strokeWidth={1.75} />
      <div className="text-muted-foreground">
        <span className="font-medium text-foreground">API unreachable.</span>{" "}
        <code className="text-xs">{API_BASE}</code> did not answer
        {error ? ` (${error})` : ""}. Nothing is substituted for the missing payload.
      </div>
    </div>
  );
}
