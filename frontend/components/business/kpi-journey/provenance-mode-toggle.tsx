"use client";

import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProvenance } from "@/lib/business/provenance-context";
import { cn } from "@/lib/utils";

export function ProvenanceModeToggle({ className }: { className?: string }) {
  const { enabled, setEnabled } = useProvenance();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "gap-1.5 text-muted-foreground",
        enabled && "bg-secondary text-foreground",
        className,
      )}
      aria-pressed={enabled}
      title={
        enabled
          ? "How numbers are made is on — click a KPI to see Raw→Gold"
          : "Turn on How numbers are made to inspect KPI lineage"
      }
      onClick={() => setEnabled(!enabled)}
      data-testid="provenance-mode-toggle"
    >
      <GitBranch className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">How numbers are made</span>
    </Button>
  );
}
