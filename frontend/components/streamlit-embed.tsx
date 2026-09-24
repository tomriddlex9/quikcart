"use client";

import { useEffect, useState } from "react";
import { Expand, ExternalLink, MonitorCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STREAMLIT_URL = (
  process.env.NEXT_PUBLIC_STREAMLIT_URL ?? "http://localhost:8501"
).replace(/\/$/, "");

const DASHBOARD_PAGES = [
  {
    name: "Overview",
    description: "Platform-wide KPIs, order trends, and operating health.",
  },
  {
    name: "Stores",
    description: "Compare store GMV, hourly orders, and late-delivery rates.",
  },
  {
    name: "Inventory",
    description: "Surface products at risk of stocking out.",
  },
  {
    name: "Delivery",
    description: "Inspect fulfillment times and late-delivery performance.",
  },
  {
    name: "Customers",
    description: "Review top customers, spend, activity, and cancellations.",
  },
  {
    name: "Products",
    description: "Explore product revenue and category performance.",
  },
  {
    name: "Pipeline & Quality",
    description: "Monitor data-quality rules and recent pipeline outcomes.",
  },
  {
    name: "Approvals",
    description: "Review action proposals and their audit trails.",
  },
] as const;

type HealthState = "checking" | "up" | "down";
type EmbedHeight = 400 | 600 | 800;

function pageUrl(name: string) {
  return `${STREAMLIT_URL}/?page=${encodeURIComponent(name)}&embed=true`;
}

function StreamlitCard({
  name,
  description,
}: (typeof DASHBOARD_PAGES)[number]) {
  const [height, setHeight] = useState<EmbedHeight>(600);
  const [expanded, setExpanded] = useState(false);
  const url = pageUrl(name);

  return (
    <>
      <Card className="border-border/70 bg-card/70 py-0 shadow-none">
        <CardHeader className="border-b border-border/60 py-4">
          <CardTitle>{name}</CardTitle>
          <CardDescription>{description}</CardDescription>
          <CardAction className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Height
              <select
                aria-label={`${name} embed height`}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
                value={height}
                onChange={(event) =>
                  setHeight(Number(event.target.value) as EmbedHeight)
                }
              >
                <option value={400}>400</option>
                <option value={600}>600</option>
                <option value={800}>800</option>
              </select>
            </label>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <iframe
            className="w-full border-0 bg-background"
            src={url}
            title={`QuickCart ${name} dashboard`}
            loading="lazy"
            style={{ height }}
          />
        </CardContent>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink />
            Open in tab
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setExpanded(true)}>
            <Expand />
            Expand
          </Button>
        </div>
      </Card>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="h-[92vh] max-w-[96vw] grid-rows-[auto_1fr]">
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <iframe
            className="h-full min-h-0 w-full rounded-lg border border-border bg-background"
            src={url}
            title={`Expanded QuickCart ${name} dashboard`}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function HealthBadge({ state }: { state: HealthState }) {
  if (state === "checking") {
    return <Badge variant="secondary">Checking Streamlit…</Badge>;
  }
  if (state === "up") {
    return <Badge className="bg-emerald-500/15 text-emerald-400">Online</Badge>;
  }
  return <Badge variant="destructive">Offline</Badge>;
}

export function StreamlitEmbed() {
  const [state, setState] = useState<"checking" | "up" | "down">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch(STREAMLIT_URL, { mode: "no-cors", cache: "no-store" })
      .then(() => {
        if (!cancelled) setState("up");
      })
      .catch(() => {
        if (!cancelled) setState("down");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Embedded operations views</CardTitle>
          <CardDescription>
            Each module is routed directly to its Streamlit page. Resize a card
            or expand it for focused analysis.
          </CardDescription>
          <CardAction>
            <HealthBadge state={state} />
          </CardAction>
        </CardHeader>
        {state === "down" && (
          <CardContent>
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-muted-foreground">
              <MonitorCog className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p>
                Nothing is listening at{" "}
                <code className="text-foreground">{STREAMLIT_URL}</code>. Start
                it with <code className="text-foreground">make dashboard-up</code>.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {DASHBOARD_PAGES.map((page) => (
          <StreamlitCard key={page.name} {...page} />
        ))}
      </div>
    </div>
  );
}
