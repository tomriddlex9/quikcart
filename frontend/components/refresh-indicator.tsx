"use client";

import { RefreshCw } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { ApiMode } from "@/lib/api";
import { Pill, StatusDot } from "./pill";

/**
 * Top-right status chip: LIVE (teal, pulsing), DEMO (amber), or CONNECTING.
 * Shows when the data was last refreshed.
 */
export function RefreshIndicator({
  mode,
  lastUpdated,
  countdown,
}: {
  mode: ApiMode;
  lastUpdated: Date | null;
  countdown?: number | null;
}) {
  const tone = mode === "live" ? "teal" : mode === "demo" ? "amber" : "neutral";
  const label =
    mode === "live" ? "live API" : mode === "demo" ? "demo data" : "connecting";
  return (
    <div className="flex items-center gap-2">
      <Pill tone={tone}>
        <StatusDot tone={tone} />
        <span className={mode === "live" ? "live-dot" : undefined}>{label}</span>
        {typeof countdown === "number" && mode === "live" ? (
          <span className="text-[10px] opacity-70">next in {countdown}s</span>
        ) : null}
      </Pill>
      {lastUpdated ? (
        <span className="hidden items-center gap-1 text-[10.5px] text-faint sm:inline-flex">
          <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
          {timeAgo(lastUpdated)}
        </span>
      ) : null}
    </div>
  );
}
