import Link from "next/link";
import { AskAboutButton } from "@/components/business/ask-about-button";
import { DeltaText } from "@/components/business/delta-text";
import { MetricExplainer } from "@/components/business/metric-explainer";
import { StatusBadge } from "@/components/business/status-badge";
import type { MetricValue } from "@/lib/business/types";
import { cn } from "@/lib/utils";

export function MetricTile({
  metric,
  href,
  compact = false,
  className,
}: {
  metric: MetricValue;
  href?: string;
  compact?: boolean;
  className?: string;
}) {
  const label = href ? (
    <Link href={href} className="hover:underline">
      {metric.label}
    </Link>
  ) : (
    metric.label
  );
  return (
    <article
      data-testid="metric-tile"
      data-status={metric.status}
      className={cn(
        "flex flex-col gap-2 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-medium text-muted-foreground">{label}</h3>
        <StatusBadge status={metric.status} />
      </div>
      <p className={cn("font-semibold tracking-tight tabular-nums", compact ? "text-2xl" : "text-3xl")}>
        {metric.display}
      </p>
      <DeltaText
        deltaPct={metric.delta_pct}
        direction={metric.direction}
        compareLabel={metric.compare_label}
      />
      {compact ? null : (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <MetricExplainer metric={metric} />
          <AskAboutButton
            question={`Why is ${metric.label.toLowerCase()} at ${metric.display}?`}
            context={{ metric: metric.key, status: metric.status }}
          />
        </div>
      )}
    </article>
  );
}
