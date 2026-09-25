"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ARCHITECTURE_MERMAID_SOURCE } from "./data";

export function MermaidView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      setStatus("loading");
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
        });
        const { svg } = await mermaid.render("architecture-mermaid", ARCHITECTURE_MERMAID_SOURCE);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 print:hidden">
        <p className="text-xs text-muted-foreground">
          Same platform, drawn as a Mermaid flowchart — the printable/portable view.
        </p>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-3.5" strokeWidth={1.75} />
          Print
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        {status === "error" ? (
          <p className="text-sm text-destructive">
            Mermaid failed to render in this browser. The interactive diagram tab has the same
            flow.
          </p>
        ) : (
          <div
            ref={containerRef}
            className="mermaid-architecture-svg overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-none"
            aria-busy={status === "loading"}
          />
        )}
      </div>
    </div>
  );
}
