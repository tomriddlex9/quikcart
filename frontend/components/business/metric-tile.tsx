"use client";

import Link from "next/link";
import { AskAboutButton } from "@/components/business/ask-about-button";
import { DeltaText } from "@/components/business/delta-text";
import { MetricExplainer } from "@/components/business/metric-explainer";
import { StatusBadge } from "@/components/business/status-badge";
import { useProvenance } from "@/lib/business/provenance-context";
import type { MetricValue } from "@/lib/business/types";
import { cn } from "@/lib/utils";

export function MetricTile({
  metric,
  href,
  compact = false,
  className,
  contextLine,
}: {
  metric: MetricValue;
  href?: string;
  compact?: boolean;
  className?: string;
  /** Persona-specific supporting line under the value. */
  contextLine?: string;
}) {
  const { enabled, openInspector } = useProvenance();

  const labelNode =
    enabled || !href ? (
      metric.label
    ) : (
      <Link href={href} className="hover:underline">
        {metric.label}
      </Link>
    );

  return (
    <article
      data-testid="metric-tile"
      data-metric-key={metric.key}
      data-status={metric.status}
      data-provenance={enabled ? "on" : "off"}
      className={cn(
        "flex flex-col gap-2 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10",
        enabled && "cursor-pointer transition-shadow hover:ring-foreground/25",
        className,
      )}
      onClick={enabled ? () => openInspector(metric) : undefined}
      onKeyDown={
        enabled
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openInspector(metric);
              }
            }
          : undefined
      }
      role={enabled ? "button" : undefined}
      tabIndex={enabled ? 0 : undefined}
      aria-label={
        enabled ? `Inspect how ${metric.label} is made from Raw to Gold` : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-medium text-muted-foreground">{labelNode}</h3>
        <StatusBadge status={metric.status} />
      </div>
      <p className={cn("font-semibold tracking-tight tabular-nums", compact ? "text-2xl" : "text-3xl")}>
        {metric.display}
      </p>
      {contextLine ? (
        <p className="text-xs text-muted-foreground">{contextLine}</p>
      ) : null}
      <DeltaText
        deltaPct={metric.delta_pct}
        direction={metric.direction}
        compareLabel={metric.compare_label}
      />
      {compact ? null : (
        <div
          className="mt-1 flex flex-wrap items-center justify-between gap-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
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
