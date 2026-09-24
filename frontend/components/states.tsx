import type { ReactNode } from "react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="panel flex items-center gap-3 px-4 py-6 text-[12px] text-muted">
      <span className="live-dot inline-block h-2 w-2 rounded-full bg-teal" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-start gap-2 px-4 py-8">
      <div className="font-display text-[15px] text-paper-dim">{title}</div>
      {hint ? <div className="max-w-[60ch] text-[12px] text-faint">{hint}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="panel border-red-dim/50 px-4 py-6 text-[12px] text-red">
      <span className="font-semibold">Something went wrong.</span>{" "}
      <span className="text-red/80">{message}</span>
    </div>
  );
}
