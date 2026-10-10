import { GitBranch, Info } from "lucide-react";
import { useProvenance } from "@/lib/business/provenance-context";
import type { MetricValue } from "@/lib/business/types";

/** Inline "What does this mean?" — plain description plus the current sentence. */
export function MetricExplainer({
  metric,
}: {
  metric: MetricValue;
}) {
  const { openInspector, setEnabled } = useProvenance();
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
        <button
          type="button"
          className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          data-testid="metric-how-calculated"
          onClick={(e) => {
            e.preventDefault();
            setEnabled(true);
            openInspector(metric);
          }}
        >
          <GitBranch className="size-3" aria-hidden />
          How is this calculated?
        </button>
      </div>
    </details>
  );
}
