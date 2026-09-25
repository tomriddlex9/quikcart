import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Skeleton as UiSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function Skeleton({ className = "" }: { className?: string }) {
  return <UiSkeleton className={className} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border px-4 py-8",
        className,
      )}
    >
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint ? <div className="max-w-[70ch] text-sm text-muted-foreground">{hint}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-6 text-sm text-destructive">
      <span className="font-medium">Something went wrong.</span> <span>{message}</span>
    </div>
  );
}
