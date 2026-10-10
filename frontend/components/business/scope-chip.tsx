"use client";

import { MapPin } from "lucide-react";
import { useBusiness } from "@/lib/business/business-context";
import { scopeLabel } from "@/lib/personas";

export { scopeLabel };

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
