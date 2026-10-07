import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { deltaDirection, deltaIsGood, deltaSentence } from "@/lib/business/format";
import type { MetricValue } from "@/lib/business/types";
import { cn } from "@/lib/utils";

export function DeltaText({
  deltaPct,
  direction = "higher_better",
  compareLabel,
  className,
}: {
  deltaPct: number | null | undefined;
  direction?: MetricValue["direction"];
  compareLabel?: string;
  className?: string;
}) {
  const dir = deltaDirection(deltaPct);
  const good = deltaIsGood(deltaPct, direction);
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        good === null
          ? "text-muted-foreground"
          : good
            ? "text-status-good"
            : "text-status-bad",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{deltaSentence(deltaPct, compareLabel)}</span>
    </span>
  );
}
