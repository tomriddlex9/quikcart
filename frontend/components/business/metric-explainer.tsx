import { Info } from "lucide-react";
import type { MetricValue } from "@/lib/business/types";

/** Inline "What does this mean?" — plain description plus the current sentence. */
export function MetricExplainer({
  metric,
}: {
  metric: Pick<MetricValue, "label" | "plain_description" | "explanation" | "is_partial">;
}) {
  return (
    <details className="group text-xs">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <Info className="size-3.5" aria-hidden />
        What does this mean?
      </summary>
      <div className="mt-1.5 space-y-1 rounded-md bg-secondary/60 p-2 text-foreground/90">
        <p>{metric.plain_description}</p>
        <p className="text-muted-foreground">{metric.explanation}</p>
        {metric.is_partial ? (
          <p className="text-status-watch">Some of the data behind this is still being connected.</p>
        ) : null}
      </div>
    </details>
  );
}
