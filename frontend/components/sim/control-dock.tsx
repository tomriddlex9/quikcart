"use client";

import { ChevronDown, ChevronUp, Gauge, Pause, Play, Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiPostJson } from "@/lib/api";
import { formatNumber, formatPercent } from "@/lib/format";
import { DEMO_SIM_STATUS, type SimConfigPatch, type SimStatus } from "@/lib/sim-types";
import { cn } from "@/lib/utils";
import { useApiData } from "@/lib/use-api";

const STATUS_REFRESH_MS = 5_000;
const CONFIG_DEBOUNCE_MS = 350;

type SliderKey = "orders_per_minute" | "cancel_rate" | "payment_fail_rate" | "inventory_churn" | "burst_factor";

interface SliderSpec {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

const SLIDERS: SliderSpec[] = [
  {
    key: "orders_per_minute",
    label: "Orders / min",
    min: 1,
    max: 600,
    step: 1,
    format: (value) => formatNumber(Math.round(value)),
  },
  {
    key: "cancel_rate",
    label: "Cancel rate",
    min: 0,
    max: 1,
    step: 0.01,
    format: formatPercent,
  },
  {
    key: "payment_fail_rate",
    label: "Payment fail rate",
    min: 0,
    max: 1,
    step: 0.01,
    format: formatPercent,
  },
  {
    key: "inventory_churn",
    label: "Inventory churn",
    min: 0,
    max: 1,
    step: 0.01,
    format: formatPercent,
  },
  {
    key: "burst_factor",
    label: "Burst factor",
    min: 0.1,
    max: 5,
    step: 0.1,
    format: (value) => `${value.toFixed(1)}×`,
  },
];

/**
 * Floating, app-wide control dock for the demo order simulator (kit/AGENTS.md:
 * a bounded demo tool — start/stop and a handful of clamped dials, nothing
 * that reaches arbitrary SQL or shell). Optimistic locally: a slider or the
 * start/stop toggle updates the on-screen state immediately, then reconciles
 * with the next poll of `/api/v1/sim/status`.
 */
export function ControlDock() {
  const { data, mode, reload } = useApiData<SimStatus>(
    "/api/v1/sim/status",
    DEMO_SIM_STATUS,
    STATUS_REFRESH_MS,
  );
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<SimStatus>(DEMO_SIM_STATUS);
  const [pending, setPending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingRef = useRef(false);

  useEffect(() => {
    if (data && !editingRef.current) {
      setLocal(data);
    }
  }, [data]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const applyPatch = (patch: SimConfigPatch) => {
    editingRef.current = true;
    setLocal((previous) => ({
      state: { ...previous.state, ...patch },
      impact: previous.impact,
    }));
    setPending(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const result = await apiPostJson<SimStatus>("/api/v1/sim/config", patch);
      setPending(false);
      editingRef.current = false;
      if (result.ok) {
        setLocal(result.data);
      }
      reload();
    }, CONFIG_DEBOUNCE_MS);
  };

  const toggleRunning = async () => {
    const next = !local.state.running;
    editingRef.current = true;
    setLocal((previous) => ({
      ...previous,
      state: { ...previous.state, running: next },
    }));
    setPending(true);
    const result = await apiPostJson<SimStatus>(next ? "/api/v1/sim/start" : "/api/v1/sim/stop", {});
    setPending(false);
    editingRef.current = false;
    if (result.ok) {
      setLocal(result.data);
    }
    reload();
  };

  const running = local.state.running;
  const effectiveOrdersPerMinute = local.state.orders_per_minute * local.state.burst_factor;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))]">
      <div className="overflow-hidden rounded-xl border border-border bg-card/95 shadow-lg ring-1 ring-foreground/10 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
        >
          <Radio
            className={cn("size-3.5 shrink-0", running ? "text-chart-2" : "text-muted-foreground")}
            strokeWidth={1.75}
          />
          <span className="text-sm font-medium">Simulator</span>
          <span className="ml-auto flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
            {mode === "demo" ? <span className="text-chart-3">demo</span> : null}
            {formatNumber(Math.round(effectiveOrdersPerMinute))}/min
          </span>
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          ) : (
            <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          )}
        </button>

        {open ? (
          <div className="border-t border-border px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                ~{formatNumber(Math.round(effectiveOrdersPerMinute))} orders/min → Postgres →
                Debezium → Bronze
                {local.impact.expected_cdc_lag_seconds_hint
                  ? ` (~${local.impact.expected_cdc_lag_seconds_hint.toFixed(0)}s CDC hop)`
                  : ""}
              </p>
              <Button
                type="button"
                size="sm"
                variant={running ? "secondary" : "default"}
                onClick={() => void toggleRunning()}
                className="shrink-0 gap-1.5"
              >
                {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {running ? "Stop" : "Start"}
              </Button>
            </div>

            <div className="mt-3 space-y-3">
              {SLIDERS.map((slider) => (
                <SliderRow
                  key={slider.key}
                  spec={slider}
                  value={local.state[slider.key]}
                  onChange={(value) => applyPatch({ [slider.key]: value })}
                />
              ))}
            </div>

            <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Gauge className="size-3 shrink-0" strokeWidth={1.75} />
              {pending ? "Saving…" : "Bounded demo control · no arbitrary SQL or shell"}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SliderRow({
  spec,
  value,
  onChange,
}: {
  spec: SliderSpec;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{spec.label}</span>
        <span className="tabular-nums font-medium">{spec.format(value)}</span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
        aria-label={spec.label}
      />
    </div>
  );
}
