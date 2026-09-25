"use client";

import { GitBranch } from "lucide-react";
import {
  LineageDiagram,
  useCatalogLineage,
} from "@/components/database/lineage-diagram";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Drop-in architecture section. The architecture page is integrated by its
 * owner; keeping this component standalone avoids cross-agent page conflicts.
 */
export function ArchitectureLineage() {
  const lineage = useCatalogLineage();

  return (
    <section aria-labelledby="architecture-lineage-title">
      <Card>
        <CardHeader className="border-b">
          <CardTitle id="architecture-lineage-title" className="flex items-center gap-2">
            <GitBranch className="size-4 text-muted-foreground" />
            Table lineage
          </CardTitle>
          <CardDescription>
            Operational tables through Bronze, Silver, filtered rows, and Gold products
          </CardDescription>
          <CardAction>
            <Badge variant={lineage.mode === "live" ? "secondary" : "outline"}>
              {lineage.mode === "live" ? "Live catalog" : "Demo topology"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {lineage.error ? (
            <p className="mb-3 text-xs text-muted-foreground">
              Live lineage is unavailable ({lineage.error}); showing the demo topology.
            </p>
          ) : null}
          <LineageDiagram lineage={lineage.data} loading={lineage.loading} />
        </CardContent>
      </Card>
    </section>
  );
}
