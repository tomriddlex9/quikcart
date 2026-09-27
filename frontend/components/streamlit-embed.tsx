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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

type DashboardPage = (typeof DASHBOARD_PAGES)[number];
type HealthState = "checking" | "up" | "down" | "unknown";
type EmbedHeight = 400 | 600 | 800;

function pageUrl(name: string) {
  return `${STREAMLIT_URL}/?page=${encodeURIComponent(name)}&embed=true`;
}

function isDashboardPage(value: string): value is DashboardPage["name"] {
  return DASHBOARD_PAGES.some((page) => page.name === value);
}

/**
 * Same-origin or CORS-readable responses only.
 * An opaque no-cors result is not evidence the server is up.
 */
async function probeStreamlit(url: string, signal: AbortSignal): Promise<HealthState> {
  if (!url) return "unknown";
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      mode: "cors",
      signal,
    });
    if (response.type === "opaque" || response.type === "opaqueredirect") {
      return "unknown";
    }
    return response.ok ? "up" : "down";
  } catch {
    return "unknown";
  }
}

function OpenInTab({ url }: { url: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={<a href={url} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLink />
      Open in tab
    </Button>
  );
}

function StreamlitFrame({
  name,
  url,
  className,
  style,
}: {
  name: string;
  url: string;
  className?: string;
  style?: { height: EmbedHeight };
}) {
  return (
    <iframe
      className={className}
      src={url}
      title={`QuickCart ${name} dashboard`}
      style={style}
    />
  );
}

function StreamlitCard({
  name,
  description,
}: {
  name: DashboardPage["name"];
  description: string;
}) {
  const [height, setHeight] = useState<EmbedHeight>(600);
  const [expanded, setExpanded] = useState(false);
  const url = pageUrl(name);

  return (
    <>
      <Card className="border-border/70 bg-card/70 py-0 shadow-none">
        <CardHeader className="border-b border-border/60 py-4">
          <CardTitle>{name}</CardTitle>
          <CardDescription>
            {description} If the frame stays blank, Streamlit is refusing the embed.
            Open in tab still loads this page.
          </CardDescription>
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
          {expanded ? (
            <div
              className="flex items-center justify-center bg-background text-sm text-muted-foreground"
              style={{ height }}
            >
              Expanded view is open.
            </div>
          ) : (
            <StreamlitFrame
              name={name}
              url={url}
              className="w-full border-0 bg-background"
              style={{ height }}
            />
          )}
        </CardContent>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
          <OpenInTab url={url} />
          <Button variant="secondary" size="sm" onClick={() => setExpanded(true)}>
            <Expand />
            Expand
          </Button>
        </div>
      </Card>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="h-[92vh] max-w-[96vw] grid-rows-[auto_1fr] sm:max-w-[96vw]">
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>
              {description} If this frame is blank, use Open in tab.
            </DialogDescription>
          </DialogHeader>
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div>
              <OpenInTab url={url} />
            </div>
            {expanded ? (
              <StreamlitFrame
                name={name}
                url={url}
                className="h-full min-h-0 w-full flex-1 rounded-lg border border-border bg-background"
              />
            ) : null}
          </div>
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
  if (state === "unknown") {
    return <Badge variant="outline">Unknown</Badge>;
  }
  return <Badge variant="destructive">Offline</Badge>;
}

export function StreamlitEmbed() {
  const [state, setState] = useState<HealthState>("checking");
  const [selected, setSelected] = useState<DashboardPage["name"]>(DASHBOARD_PAGES[0].name);
  const page = DASHBOARD_PAGES.find((item) => item.name === selected) ?? DASHBOARD_PAGES[0];

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    probeStreamlit(STREAMLIT_URL, controller.signal).then((next) => {
      if (!cancelled) setState(next);
    });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Embedded operations views</CardTitle>
          <CardDescription>
            One Streamlit module at a time. Switching modules unmounts the previous frame.
          </CardDescription>
          <CardAction>
            <HealthBadge state={state} />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === "down" ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-muted-foreground">
              <MonitorCog className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p>
                Streamlit at <code className="text-foreground">{STREAMLIT_URL}</code> responded
                with an error. Start it with{" "}
                <code className="text-foreground">uv run streamlit run dashboard/app.py</code>.
              </p>
            </div>
          ) : null}
          {state === "unknown" ? (
            <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 p-3 text-sm text-muted-foreground">
              <MonitorCog className="mt-0.5 size-4 shrink-0" />
              <p>
                Health is unknown for <code className="text-foreground">{STREAMLIT_URL}</code>.
                The browser could not read a status (cross-origin block or no response). Open a
                module in a new tab to use it. Locally, start Streamlit with{" "}
                <code className="text-foreground">uv run streamlit run dashboard/app.py</code>.
              </p>
            </div>
          ) : null}
          <Tabs
            value={selected}
            onValueChange={(value) => {
              if (typeof value === "string" && isDashboardPage(value)) setSelected(value);
            }}
          >
            <TabsList
              aria-label="Streamlit modules"
              className="flex h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto"
            >
              {DASHBOARD_PAGES.map((item) => (
                <TabsTrigger key={item.name} value={item.name} className="h-7 flex-none px-2.5">
                  {item.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <StreamlitCard key={page.name} name={page.name} description={page.description} />
    </div>
  );
}
