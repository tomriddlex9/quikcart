import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** One component for the three non-happy states of a data section. */
export function BusinessState({
  state,
  title,
  hint,
  onRetry,
  className,
  children,
}: {
  state: "loading" | "empty" | "error";
  title?: string;
  hint?: string;
  onRetry?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  if (state === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn("space-y-3", className)}
        data-testid="business-loading"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {title ?? "Loading…"}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  const isError = state === "error";
  return (
    <div
      role={isError ? "alert" : undefined}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-xl border border-dashed px-4 py-8",
        isError ? "border-status-bad/40 bg-status-bad/5" : "border-border",
        className,
      )}
    >
      <p className="text-sm font-medium">
        {title ?? (isError ? "We couldn't load this." : "Nothing to show yet.")}
      </p>
      {hint ? <p className="max-w-[70ch] text-sm text-muted-foreground">{hint}</p> : null}
      {children}
      {isError && onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
