"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Database, FlaskConical, Moon, MoreHorizontal, TerminalSquare } from "lucide-react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { BusinessCommand } from "@/components/business/business-command";
import { OpsPreviewBanner } from "@/components/business/ops-preview-banner";
import { ProvenanceModeToggle } from "@/components/business/kpi-journey/provenance-mode-toggle";
import { ScopeChip } from "@/components/business/scope-chip";
import { ExperienceSwitcher } from "@/components/experience-switcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useBusiness } from "@/lib/business/business-context";
import type { AlertsResponse } from "@/lib/business/types";
import {
  hierarchyCrumb,
  personaMobileTabs,
  personaMoreNav,
  personaPrimaryNav,
} from "@/lib/business/persona-views";
import { useBusinessData } from "@/lib/business/use-business-api";
import { useDataMode } from "@/lib/data-mode";
import { isBusinessActive, type BusinessNavItem } from "@/lib/business-nav";
import { nextTheme, THEME_ICON, type ThemeValue } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Voice pulls in Web Audio + canvas code; load it only in the browser, after first paint.
const CharacterDock = dynamic(() => import("@/components/assistant/character-dock"), { ssr: false });

function DataSourceButton() {
  const { source, setSource } = useDataMode();
  const demo = source === "demo";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground"
      onClick={() => setSource(demo ? "api" : "demo")}
      aria-pressed={demo}
      title={demo ? "Showing sample data. Switch to live data." : "Showing live data. Switch to sample data."}
    >
      {demo ? <FlaskConical className="size-3.5" aria-hidden /> : <Database className="size-3.5" aria-hidden />}
      <span className="hidden sm:inline">{demo ? "Sample data" : "Live data"}</span>
    </Button>
  );
}

function AlertsBell() {
  const { data } = useBusinessData<AlertsResponse>("/alerts");
  const count = data?.items.length ?? 0;
  return (
    <Link
      href="/b/today#attention"
      title={count ? `${count} things need you` : "No alerts"}
      className="relative inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="size-3.5" aria-hidden />
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-bad px-1 text-[10px] font-medium text-primary-foreground">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
      <span className="sr-only">{count ? `${count} alerts` : "Alerts"}</span>
    </Link>
  );
}

function ThemeButton() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted ? theme : "black") as ThemeValue;
  const Icon = THEME_ICON[current] ?? Moon;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
      aria-label="Change theme"
      title={`Theme: ${current}`}
      onClick={() => setTheme(nextTheme(theme))}
    >
      <Icon className="size-3.5" aria-hidden />
    </Button>
  );
}

function RailLink({ item, pathname }: { item: BusinessNavItem; pathname: string }) {
  const active = isBusinessActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <item.icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {item.label}
    </Link>
  );
}

export function BusinessShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);
  const { persona } = useBusiness();
  const primaryNav = useMemo(() => personaPrimaryNav(persona), [persona]);
  const mobileTabs = useMemo(() => {
    const tabs = personaMobileTabs(persona);
    return [
      ...tabs.slice(0, 4),
      { href: "#more", label: "More", icon: MoreHorizontal } satisfies BusinessNavItem,
    ];
  }, [persona]);
  const moreNav = useMemo(() => personaMoreNav(persona), [persona]);
  const crumb = hierarchyCrumb(persona);

  // Onboarding gets a calm, chrome-free page.
  if (pathname === "/b/welcome") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10 md:py-16">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="mx-auto flex min-h-screen max-w-[1400px]">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border/80 px-3 py-4 md:flex">
          <Link href="/b/today" className="mb-5 flex items-center gap-2 px-2">
            <TerminalSquare className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="text-sm font-medium tracking-tight">QuickCart</span>
          </Link>
          <nav aria-label="Business" className="flex-1 space-y-0.5 overflow-y-auto">
            {primaryNav.map((item) => (
              <RailLink key={item.href} item={item} pathname={pathname} />
            ))}
          </nav>
          <p className="mt-3 px-2 text-[11px] text-muted-foreground" title="How this role drills into the same data">
            {crumb}
          </p>
          <ExperienceSwitcher current="business" className="mt-2 self-start" />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border/80 bg-background/80 px-4 backdrop-blur-md">
            <Link href="/b/today" className="flex items-center gap-2 md:hidden">
              <TerminalSquare className="size-4" strokeWidth={1.75} aria-hidden />
              <span className="text-sm font-medium">QuickCart</span>
            </Link>
            <ScopeChip />
            <span className="hidden text-[11px] text-muted-foreground lg:inline" aria-hidden>
              {crumb}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <ProvenanceModeToggle />
              <BusinessCommand />
              <AlertsBell />
              <div className="hidden items-center gap-1 sm:flex">
                <DataSourceButton />
                <ThemeButton />
              </div>
              <form action={signOut} className="hidden sm:block">
                <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
                  Sign out
                </Button>
              </form>
            </div>
          </header>
          <OpsPreviewBanner />
          <main id="main" className="min-w-0 flex-1 px-4 pb-32 pt-6 md:px-8 md:pb-12 lg:px-10">
            <div className="mx-auto w-full max-w-5xl">{children}</div>
          </main>
        </div>
      </div>

      <nav
        aria-label="Business tabs"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {mobileTabs.map((tab) => {
          const isMore = tab.href === "#more";
          const active = isMore
            ? moreNav.some((m) => isBusinessActive(pathname, m.href))
            : isBusinessActive(pathname, tab.href);
          const content = (
            <>
              <tab.icon className="size-5" strokeWidth={1.75} aria-hidden />
              <span className="text-[11px]">{tab.label}</span>
            </>
          );
          const cls = cn(
            "flex flex-col items-center gap-0.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "text-foreground" : "text-muted-foreground",
          );
          return isMore ? (
            <button
              key={tab.href}
              type="button"
              className={cls}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-controls="business-more-sheet"
              onClick={() => setMoreOpen(true)}
            >
              {content}
            </button>
          ) : (
            <Link key={tab.href} href={tab.href} className={cls} aria-current={active ? "page" : undefined}>
              {content}
            </Link>
          );
        })}
      </nav>

      <CharacterDock />

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" id="business-more-sheet">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="grid gap-3 px-4 pb-6">
            <ExperienceSwitcher current="business" className="self-start" />
            <div className="flex flex-wrap gap-2">
              <DataSourceButton />
              <ThemeButton />
            </div>
            <div className="grid gap-1" onClick={() => setMoreOpen(false)}>
              <ProvenanceModeToggle />
              {moreNav.map((item) => (
                <RailLink key={item.href} item={item} pathname={pathname} />
              ))}
              <form action={signOut}>
                <Button type="submit" variant="ghost" className="w-full justify-start text-muted-foreground">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
