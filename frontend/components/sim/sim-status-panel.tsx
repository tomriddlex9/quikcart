"use client";

import { Radio } from "lucide-react";
import { Pill, StatusDot } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { openSimDock } from "@/lib/sim-dock";
import type { SimStatus } from "@/lib/sim-types";
import { useApiData } from "@/lib/use-api";

const STATUS_REFRESH_MS = 5_000;

/**
 * Live readout of the demo simulator. Polls the same status document as
 * ControlDock and opens that dock via a window event — it does not start,
 * stop, or retune the simulator itself.
 */
export function SimStatusPanel() {
  const { data, error } = useApiData<SimStatus>("/api/v1/sim/status", STATUS_REFRESH_MS);
  const running = data?.state.running ?? false;
  const ordersPerMinute = data
    ? data.state.orders_per_minute * data.state.burst_factor
    : null;
  const tone = running ? "teal" : "neutral";

  return (
    <section
      aria-label="Simulator status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-secondary/25 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <Radio
          className={running ? "size-3.5 text-chart-2" : "size-3.5 text-muted-foreground"}
          strokeWidth={1.75}
        />
        {data ? (
          <>
            <Pill tone={tone}>
              <StatusDot tone={tone} />
              {running ? "Running" : "Stopped"}
            </Pill>
            <span className="text-sm tabular-nums text-foreground">
              {formatNumber(Math.round(ordersPerMinute ?? 0))} orders/min
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            {error ? "Simulator status unavailable" : "Checking simulator…"}
          </span>
        )}
      </div>
      <Button type="button" size="sm" onClick={() => openSimDock()}>
        Open simulator
      </Button>
    </section>
  );
}
