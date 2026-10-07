import Link from "next/link";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withSpotlight } from "@/lib/business/journeys";
import type { JourneyStep } from "@/lib/business/types";
import { cn } from "@/lib/utils";

export function JourneyPanel({
  step,
  onBack,
  onNext,
  onFinish,
  glossary = {},
}: {
  step: JourneyStep;
  onBack: () => void;
  onNext: () => void;
  onFinish: () => void;
  /** metric key → label, to show friendly names for the numbers this step is about. */
  glossary?: Record<string, string>;
}) {
  const last = step.next_n === null;
  return (
    <section aria-label={`Step ${step.n} of ${step.total}`} className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <ol className="flex items-center gap-1.5" aria-label="Progress">
        {Array.from({ length: step.total }, (_, i) => i + 1).map((n) => (
          <li
            key={n}
            data-state={n < step.n ? "done" : n === step.n ? "current" : "todo"}
            aria-current={n === step.n ? "step" : undefined}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              n <= step.n ? "bg-foreground" : "bg-border",
            )}
          >
            <span className="sr-only">Step {n}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Step {step.n} of {step.total}
      </p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{step.title}</h2>
      <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed text-foreground/90">{step.body}</p>
      {step.metric_keys.length > 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Numbers in this step:{" "}
          {step.metric_keys.map((k) => glossary[k] ?? k).join(", ")}
        </p>
      ) : null}
      {step.link ? (
        <Link
          href={withSpotlight(step.link)}
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium hover:underline"
        >
          Open this page <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      ) : null}
      <div className="mt-6 flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={onBack} disabled={step.prev_n === null}>
          <ArrowLeft aria-hidden /> Back
        </Button>
        {last ? (
          <Button size="sm" onClick={onFinish}>
            <Check aria-hidden /> Finish
          </Button>
        ) : (
          <Button size="sm" onClick={onNext}>
            Next <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
    </section>
  );
}
