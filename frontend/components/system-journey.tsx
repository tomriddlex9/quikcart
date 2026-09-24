"use client";

import { useMemo, useState } from "react";
import { Route } from "lucide-react";
import { SystemMap } from "@/components/system-map";
import { DEMO_SYSTEM_STATUS } from "@/lib/demo";
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
  const up = (name: string): LaneState => (serviceState(services, name) === "up" ? "flowing" : "idle");
  const debezium = serviceState(services, "debezium");
  return {
    batch: anyGoldPresent(tables) ? "flowing" : "idle",
    streaming: up("redpanda"),
    cdc: debezium === null ? "demo" : debezium === "up" ? "flowing" : "idle",
    ai: up("qdrant"),
  };
}

const LANE_SUMMARY: Array<{ key: keyof JourneyState; probe: string }> = [
  { key: "batch", probe: "gold table presence on disk" },
  { key: "streaming", probe: "redpanda TCP probe" },
  { key: "cdc", probe: "debezium in services list, else manual demo" },
  { key: "ai", probe: "qdrant TCP probe" },
];

export function SystemJourney() {
  const [enabled, setEnabled] = useState(false);
  const status = useApiData<SystemStatus>("/api/v1/system/status", DEMO_SYSTEM_STATUS, 30_000);
  const journey = useMemo(() => deriveJourney(status.data), [status.data]);
  const demo = status.mode !== "live";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`flex items-center gap-1.5 rounded-xs border px-3 py-1.5 text-[11.5px] transition-colors ${
            enabled
              ? "border-amber-dim/60 bg-amber/10 text-amber"
              : "border-line text-muted hover:text-paper"
          }`}
        >
          <Route className="h-3.5 w-3.5" strokeWidth={1.75} />
          data journey {enabled ? "on" : "off"}
        </button>
        <span className="text-[10.5px] text-faint">
          overlays today&apos;s path state from <code>/api/v1/system/status</code>
          {demo ? " (API offline — states below are demo estimates)" : ""}
        </span>
      </div>

      <SystemMap journey={enabled ? journey : null} />

      {enabled ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {LANE_SUMMARY.map(({ key, probe }) => {
            const state = journey[key];
            return (
              <div key={key} className="border border-line-soft bg-ink-2/60 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10.5px] text-paper-dim">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      state === "flowing" ? "bg-green" : state === "demo" ? "bg-amber" : "bg-faint"
                    }`}
                  />
                  {key === "ai" ? "AI / RAG" : key}
                  <span className="ml-auto text-faint">{state}</span>
                </div>
                <div className="mt-0.5 text-[9.5px] text-faint">probe: {probe}</div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
