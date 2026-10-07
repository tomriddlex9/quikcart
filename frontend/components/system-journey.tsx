"use client";

import { useMemo, useState } from "react";
import { Route } from "lucide-react";
import { SystemMap } from "@/components/system-map";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/lib/use-api";
import type { SystemStatus } from "@/lib/types";
import type { JourneyState, LaneState } from "@/lib/system-map";

function serviceState(services: Record<string, string>, name: string): "up" | "down" | null {
  const v = services[name];
  if (typeof v !== "string") return null;
  return v.toLowerCase() === "up" ? "up" : "down";
}

function anyGoldPresent(tables: Record<string, unknown>): boolean {
  return Object.values(tables).some((v) => v === true || (typeof v === "number" && v > 0));
}

/** Derive today's path state from the honest /api/v1/system/status probe. */
function deriveJourney(status: SystemStatus | null): JourneyState {
  const services = status?.services ?? {};
  const tables = (status?.data_root_tables ?? {}) as Record<string, unknown>;
  const up = (name: string): LaneState =>
    serviceState(services, name) === "up" ? "flowing" : "idle";
  const debezium = serviceState(services, "debezium");
  return {
    batch: anyGoldPresent(tables) ? "flowing" : "idle",
    streaming: up("redpanda"),
    cdc: debezium === "up" ? "flowing" : "idle",
    ai: up("qdrant"),
  };
}

const LANE_SUMMARY: Array<{ key: keyof JourneyState; probe: string }> = [
  { key: "batch", probe: "gold table presence on disk" },
  { key: "streaming", probe: "redpanda TCP probe" },
  { key: "cdc", probe: "debezium in the services probe" },
  { key: "ai", probe: "qdrant TCP probe" },
];

export function SystemJourney() {
  const [enabled, setEnabled] = useState(false);
  const status = useApiData<SystemStatus>("/api/v1/system/status", 30_000);
  const journey = useMemo(() => deriveJourney(status.data), [status.data]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button
          variant={enabled ? "secondary" : "outline"}
          size="sm"
          aria-pressed={enabled}
          onClick={() => setEnabled((v) => !v)}
        >
          <Route strokeWidth={1.75} />
          data journey {enabled ? "on" : "off"}
        </Button>
        <span className="text-xs text-muted-foreground">
          overlays path state from <code>/api/v1/system/status</code>
          {status.error && status.data === null
            ? " — status unavailable"
            : status.mode === "stale"
              ? " — last live status"
              : ""}
        </span>
      </div>

      <SystemMap journey={enabled ? journey : null} />

      {enabled ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {LANE_SUMMARY.map(({ key, probe }) => {
            const state = journey[key];
            return (
              <div key={key} className="rounded-lg border border-border px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span
                    className={`size-1.5 rounded-full ${
                      state === "flowing"
                        ? "bg-chart-2"
                        : state === "demo"
                          ? "bg-chart-3"
                          : "bg-muted-foreground"
                    }`}
                  />
                  {key === "ai" ? "AI / RAG" : key}
                  <span className="ml-auto text-muted-foreground">{state}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">probe: {probe}</div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
