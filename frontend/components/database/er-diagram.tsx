"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { ErDiagramResponse } from "@/lib/types";
import type { LineageLayer, LineageNode } from "@/lib/live-types";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

function identifier(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function label(value: string): string {
  return value.replace(/["\n\r]/g, " ").trim();
}

function toMermaidDefinition(diagram: ErDiagramResponse): string {
  const entities = diagram.tables.flatMap((table) => {
    const columns = table.columns.length > 0 ? table.columns : ["no_columns_reported"];
    return [
      `  ${identifier(table.name)} {`,
      ...columns.map((column) => `    string ${identifier(column)}`),
      "  }",
    ];
  });
  const relationships = diagram.edges.map(
    (edge) =>
      `  ${identifier(edge.from_table)} }o--|| ${identifier(edge.to_table)} : "${label(
        `${edge.from_column} → ${edge.to_column}`,
      )}"`,
  );
  return ["erDiagram", ...entities, ...relationships].join("\n");
}

export function ErDiagram({
  diagram,
  nodes = [],
  layer = "raw",
  loading,
}: {
  diagram: ErDiagramResponse | null;
  nodes?: LineageNode[];
  layer?: LineageLayer;
  loading: boolean;
}) {
  const reactId = useId();
  const renderId = useMemo(() => `quickcart-er-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`, [reactId]);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!diagram) {
      setSvg("");
      setError(null);
      return;
    }

    const currentDiagram = diagram;
    let active = true;
    setError(null);
    setSvg("");

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          fontFamily: "var(--font-sans)",
          er: { useMaxWidth: true },
        });
        const result = await mermaid.render(renderId, toMermaidDefinition(currentDiagram));
        if (active) setSvg(result.svg);
      } catch (renderError) {
        if (active) {
          setError(renderError instanceof Error ? renderError.message : "Diagram could not be rendered");
        }
      }
    }

    void renderDiagram();
    return () => {
      active = false;
    };
  }, [diagram, renderId]);

  if (loading || (layer === "raw" && diagram && !svg && !error)) {
    return <Skeleton className="h-72 w-full" />;
  }

  if (layer !== "raw") {
    if (nodes.length === 0) {
      return (
        <div className="grid h-48 place-items-center text-sm text-muted-foreground">
          No tables are reported in this layer.
        </div>
      );
    }
    return (
      <div
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        role="img"
        aria-label={`${layer} layer table diagram`}
      >
        {nodes.map((node) => (
          <article key={node.id} className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
              <span className="min-w-0 truncate font-mono text-xs font-medium">{node.name}</span>
              {node.row_count !== undefined && node.row_count !== null ? (
                <Badge variant="secondary">{node.row_count.toLocaleString()} rows</Badge>
              ) : (
                <Badge variant="outline">count unavailable</Badge>
              )}
            </header>
            <ul className="divide-y divide-border/70">
              {node.columns.length > 0 ? (
                node.columns.map((column) => (
                  <li key={column} className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {column}
                  </li>
                ))
              ) : (
                <li className="px-3 py-3 text-xs text-muted-foreground">No columns reported.</li>
              )}
            </ul>
          </article>
        ))}
      </div>
    );
  }

  if (!diagram) {
    return (
      <div className="grid h-48 place-items-center text-sm text-muted-foreground">
        No relationship metadata is available.
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">The visual diagram could not be rendered.</p>
        <ul className="space-y-1 font-mono text-xs text-foreground">
          {diagram.edges.map((edge) => (
            <li key={`${edge.from_table}.${edge.from_column}-${edge.to_table}.${edge.to_column}`}>
              {edge.from_table}.{edge.from_column} → {edge.to_table}.{edge.to_column}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      className="max-h-[34rem] overflow-auto [&_svg]:mx-auto [&_svg]:max-w-full"
      role="img"
      aria-label="Raw database entity relationship diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
