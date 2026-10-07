"use client";

import type { ReactNode } from "react";
import { BusinessState } from "@/components/business/business-state";
import type { BusinessData } from "@/lib/business/use-business-api";

/** Page chrome shared by every /b page: title, sample-data notice, loading/error handling. */
export function BusinessPage<T>({
  title,
  description,
  actions,
  query,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Pass the page's primary data query; omit for static pages. */
  query?: BusinessData<T>;
  children: ReactNode | ((data: T) => ReactNode);
}) {
  let body: ReactNode;
  if (typeof children !== "function") {
    body = children;
  } else if (!query || query.loading) {
    body = <BusinessState state="loading" />;
  } else if (query.error || !query.data) {
    body = (
      <BusinessState
        state="error"
        title="We couldn't load this page."
        hint={query.error ?? "No data came back."}
        onRetry={query.reload}
      />
    );
  } else {
    body = children(query.data);
  }
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions}
      </header>
      {query && query.mode === "demo" ? (
        <p
          role="note"
          className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground"
        >
          Showing sample data
          {query.fallbackReason ? ` — the live service isn't answering (${query.fallbackReason}).` : "."}
        </p>
      ) : null}
      {body}
    </div>
  );
}
