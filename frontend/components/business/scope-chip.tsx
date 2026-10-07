"use client";

import { MapPin } from "lucide-react";
import { useBusiness } from "@/lib/business/business-context";
import type { BusinessScope } from "@/lib/business/types";

export function scopeLabel(scopes: BusinessScope[]): string {
  const first = scopes[0];
  if (!first || first.scope_type === "company") return "All stores";
  switch (first.scope_type) {
    case "city":
      return `${first.scope_value} stores`;
    case "store":
      return `Store ${first.scope_value}`;
    case "category":
      return `${first.scope_value} category`;
    default:
      return first.scope_value;
  }
}

export function ScopeChip() {
  const { scopes } = useBusiness();
  return (
    <span
      title="What you can see"
      className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-xs text-muted-foreground"
    >
      <MapPin className="size-3" aria-hidden />
      {scopeLabel(scopes)}
    </span>
  );
}
