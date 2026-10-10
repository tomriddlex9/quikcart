import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { JourneySummary } from "@/lib/business/types";

export function JourneyCard({
  journey,
  completed = false,
  resumeStep,
  recommended = false,
}: {
  journey: JourneySummary;
  completed?: boolean;
  /** Step to resume at (1-based) when the tour was started but not finished. */
  resumeStep?: number | null;
  recommended?: boolean;
}) {
  const label = completed ? "Do it again" : resumeStep && resumeStep > 1 ? `Resume at step ${resumeStep}` : "Start";
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Tour {journey.id} · {journey.step_count} steps</p>
          <h3 className="mt-0.5 text-base font-medium">{journey.title}</h3>
        </div>
        <div className="flex flex-col items-end gap-1">
          {recommended ? (
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Recommended for you
            </span>
          ) : null}
          {completed ? (
            <span className="inline-flex items-center gap-1 text-xs text-status-good">
              <Check className="size-3.5" aria-hidden /> Done
            </span>
          ) : null}
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">{journey.summary}</p>
      <p className="text-xs text-muted-foreground">For: {journey.audience}</p>
      <Link
        href={`/b/learn/${journey.id}${resumeStep && resumeStep > 1 && !completed ? `?step=${resumeStep}` : ""}`}
        className="mt-auto inline-flex w-fit items-center gap-1 text-sm font-medium hover:underline"
      >
        {label} <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </article>
  );
}
