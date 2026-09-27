"use client";

import { Radio } from "lucide-react";
import { Pill, StatusDot } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { openSimDock } from "@/lib/sim-dock";
import { DEMO_SIM_STATUS, type SimStatus } from "@/lib/sim-types";
import { useApiData } from "@/lib/use-api";

const STATUS_REFRESH_MS = 5_000;

/**
 * Live readout of the demo simulator. Polls the same status document as
 * ControlDock and opens that dock via a window event — it does not start,
 * stop, or retune the simulator itself.
 */
export function SimStatusPanel() {
  const { data, mode } = useApiData<SimStatus>(
    "/api/v1/sim/status",
    DEMO_SIM_STATUS,
    STATUS_REFRESH_MS,
  );
  if (!data) {
    return (
      <section
        aria-label="Simulator status"
        className="mb-4 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
      >
        Checking simulator…
      </section>
    );
  }

  const running = data.state.running;
  const ordersPerMinute = data.state.orders_per_minute * data.state.burst_factor;
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
        <Pill tone={tone}>
          <StatusDot tone={tone} />
          {running ? "Running" : "Stopped"}
        </Pill>
        <span className="text-sm tabular-nums text-foreground">
          {formatNumber(Math.round(ordersPerMinute))} orders/min
        </span>
        {mode === "demo" ? <span className="text-xs text-chart-3">demo</span> : null}
      </div>
      <Button type="button" size="sm" onClick={() => openSimDock()}>
        Open simulator
      </Button>
    </section>
  );
}
