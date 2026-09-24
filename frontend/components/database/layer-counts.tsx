"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiGetJson } from "@/lib/api";
import type { LineageLayer, LivePipeline } from "@/lib/live-types";

const POLL_INTERVAL_MS = 10_000;
const DISPLAY_LAYERS: Array<{ layer: LineageLayer; label: string }> = [
  { layer: "raw", label: "Raw" },
  { layer: "bronze", label: "Bronze" },
  { layer: "silver", label: "Silver" },
  { layer: "quarantine", label: "Filtered" },
  { layer: "gold", label: "Gold" },
];

function layerTotal(pipeline: LivePipeline, layer: LineageLayer): number {
  const counts = layer === "raw" ? pipeline.counts.postgres : pipeline.counts[layer];
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

export function LayerCounts() {
  const [pipeline, setPipeline] = useState<LivePipeline | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const next = await apiGetJson<LivePipeline>("/api/v1/live/pipeline");
        if (!active) return;
        setPipeline(next);
        setError(null);
      } catch (requestError) {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "pipeline counts unavailable");
      } finally {
        if (active) setRefreshing(false);
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const totals = useMemo(
    () =>
      pipeline
        ? DISPLAY_LAYERS.map(({ layer, label }) => ({
            layer,
            label,
            count: layerTotal(pipeline, layer),
          }))
        : [],
    [pipeline],
  );

  return (
    <div
      className="flex min-h-7 flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      aria-label="Live row counts by data layer"
      title={error ?? "Updated every 10 seconds"}
    >
      {pipeline ? (
        totals.map(({ layer, label, count }) => (
          <Badge key={layer} variant={layer === "quarantine" ? "destructive" : "secondary"}>
            {label} · {count.toLocaleString()}
          </Badge>
        ))
      ) : (
        <Badge variant="outline">
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          {error ? "Live counts unavailable" : "Loading live counts"}
        </Badge>
      )}
      {pipeline ? <span className="ml-1">updates every 10s</span> : null}
    </div>
  );
}
