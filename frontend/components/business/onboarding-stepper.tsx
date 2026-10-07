import { cn } from "@/lib/utils";

/** Segmented progress bar for the welcome tour. */
export function OnboardingStepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <div>
      <ol className="flex gap-1.5" aria-label="Setup progress">
        {steps.map((label, i) => (
          <li
            key={label}
            aria-current={i === current ? "step" : undefined}
            data-state={i < current ? "done" : i === current ? "current" : "todo"}
            className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= current ? "bg-foreground" : "bg-border")}
          >
            <span className="sr-only">{label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        Step {current + 1} of {steps.length}: {steps[current]}
      </p>
    </div>
  );
}
