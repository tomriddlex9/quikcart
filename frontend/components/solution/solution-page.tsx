"use client";

import type { ComponentType } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Boxes,
  BriefcaseBusiness,
  ChartLine,
  DatabaseZap,
  Store,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { MarketingThemeToggle } from "@/components/marketing/theme-toggle";
import { LeadershipPage, RevenuePage, StorePage } from "@/components/solution/business-pages";
import { DataHealthPage, InventoryPage, OperationsPage } from "@/components/solution/ops-pages";
import { AS_OF, MENU, type SolutionView } from "@/lib/solution-data";
import { cn } from "@/lib/utils";

const PAGES: Record<string, { icon: LucideIcon; Page: ComponentType }> = {
  leadership: { icon: BriefcaseBusiness, Page: LeadershipPage },
  revenue: { icon: ChartLine, Page: RevenuePage },
  store: { icon: Store, Page: StorePage },
  operations: { icon: Truck, Page: OperationsPage },
  inventory: { icon: Warehouse, Page: InventoryPage },
  data: { icon: DatabaseZap, Page: DataHealthPage },
};

export function SolutionPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view: SolutionView = params.get("view") === "ops" ? "ops" : "business";
  const sub = MENU[view].find((s) => s.id === params.get("role")) ?? MENU[view][0];
  const { Page } = PAGES[sub.id];

  const go = (nextView: SolutionView, role: string) => {
    const q = new URLSearchParams();
    if (nextView === "ops") q.set("view", "ops");
    if (role !== MENU[nextView][0].id) q.set("role", role);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-[1100] border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 lg:w-56">
            <Boxes className="size-5" strokeWidth={1.75} />
            <span className="text-base font-semibold tracking-tight">QuickCart</span>
          </div>

          <nav aria-label="Persona" className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
            {(["business", "ops"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => v !== view && go(v, MENU[v][0].id)}
                aria-pressed={view === v}
                className={cn(
                  "rounded-md px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === v ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "business" ? "Business" : "Operations"}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium">{sub.person}</div>
              <div className="text-xs text-muted-foreground">{sub.label}</div>
            </div>
            <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold">
              {sub.person
                .split(" ")
                .map((p) => p[0])
                .join("")}
            </span>
            <MarketingThemeToggle />
          </div>
        </div>

        <nav aria-label="Dashboards" className="flex gap-1 overflow-x-auto px-4 pb-2 text-sm lg:hidden">
          {MENU[view].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => go(view, s.id)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 transition-colors",
                s.id === sub.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-border/60 lg:block">
          <nav aria-label="Dashboards" className="sticky top-[61px] space-y-1 px-3 py-6 text-sm">
            <div className="px-2 pb-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">
              {view === "business" ? "BUSINESS" : "OPERATIONS"}
            </div>
            {MENU[view].map((s) => {
              const Icon = PAGES[s.id].icon;
              const active = s.id === sub.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(view, s.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                  <span className="min-w-0">
                    <span className={cn("block truncate", active && "font-medium")}>{s.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.person}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{sub.label}</h1>
              <p className="text-sm text-muted-foreground">{sub.question}</p>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              Dummy data · as of {AS_OF[view]}
            </span>
          </div>
          <Page />
        </main>
      </div>
    </div>
  );
}
