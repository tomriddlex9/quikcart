import { CheckCircle2, CircleAlert, CircleHelp, TriangleAlert } from "lucide-react";
import { statusLabel } from "@/lib/business/format";
import type { Status } from "@/lib/business/types";
import { cn } from "@/lib/utils";

const TONE: Record<Status, string> = {
  good: "bg-status-good/12 text-status-good",
  watch: "bg-status-watch/15 text-status-watch",
  bad: "bg-status-bad/12 text-status-bad",
  unknown: "bg-secondary text-muted-foreground",
};

const ICON = {
  good: CheckCircle2,
  watch: TriangleAlert,
  bad: CircleAlert,
  unknown: CircleHelp,
} as const;

/** Status is always icon + words, never colour alone. */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  label?: string;
  className?: string;
}) {
  const Icon = ICON[status];
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        TONE[status],
        className,
      )}
    >
      <Icon className="size-3" aria-hidden strokeWidth={2} />
      {label ?? statusLabel(status)}
    </span>
  );
}
