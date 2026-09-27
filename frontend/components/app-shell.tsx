"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Command, Laptop, Moon, Settings2, Sun, TerminalSquare } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { signOut } from "@/app/login/actions";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { PrefsSheet } from "@/components/prefs-sheet";
import { ControlDock } from "@/components/sim/control-dock";
import { LEARN, OPS, type NavItem } from "@/lib/nav";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const THEME_CYCLE = ["light", "dark", "system"] as const;
const THEME_ICON = { light: Sun, dark: Moon, system: Laptop } as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const { prefs } = usePrefs();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setNavigating(true);
    const timer = window.setTimeout(() => setNavigating(false), 700);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const cycleTheme = () => {
    const current = (theme as (typeof THEME_CYCLE)[number]) ?? "system";
    const idx = THEME_CYCLE.indexOf(current);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    setTheme(next);
  };

  const ThemeIcon = mounted
    ? THEME_ICON[(theme as (typeof THEME_CYCLE)[number]) ?? "system"]
    : Moon;

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {navigating ? (
        <div className="route-bar fixed inset-x-0 top-0 z-50 h-0.5 bg-ring" aria-hidden />
      ) : null}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-3 px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <TerminalSquare className="size-4 text-foreground" strokeWidth={1.75} />
            <span className="text-sm font-medium tracking-tight">QuickCart</span>
          </Link>
          <Separator orientation="vertical" className="mx-1 hidden h-4 sm:block" />
          <nav
            className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex"
            aria-label="Primary"
          >
            <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
              {OPS.slice(0, 6).map((item) => (
                <TopLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
            <OperateMoreMenu items={OPS.slice(6)} pathname={pathname} />
          </nav>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto gap-2 text-muted-foreground"
            onClick={() => setOpen(true)}
          >
            <Command className="size-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline-flex">
              ⌘K
            </kbd>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={cycleTheme}
            aria-label="Cycle theme"
            title={`Theme: ${theme ?? "system"}`}
          >
            <ThemeIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => setPrefsOpen(true)}
            aria-label="Console preferences"
            title="Console preferences"
          >
            <Settings2 className="size-3.5" />
          </Button>
          {process.env.NEXT_PUBLIC_PUBLIC_DEMO === "1" ? (
            <Pill tone="neutral">Public demo</Pill>
          ) : (
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
                Sign out
              </Button>
            </form>
          )}
        </div>
        <div className="flex flex-col gap-1 border-t border-border/60 px-2 py-1.5 md:hidden">
          <MobileNavRow label="Operate" items={OPS} pathname={pathname} />
          <MobileNavRow label="Learn" items={LEARN} pathname={pathname} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-1">
        <aside
          className={cn(
            "sticky top-12 hidden h-[calc(100vh-3rem)] shrink-0 overflow-y-auto border-r border-border/80 px-3 py-4 md:block",
            prefs.compactNav ? "w-14" : "w-52",
          )}
        >
          {!prefs.compactNav && (
            <p className="mb-1.5 px-2 text-[11px] font-medium text-muted-foreground">Operate</p>
          )}
          <NavLinks items={OPS} pathname={pathname} compact={prefs.compactNav} />
          {!prefs.compactNav && (
            <p className="mb-1.5 mt-5 px-2 text-[11px] font-medium text-muted-foreground">Learn</p>
          )}
          <NavLinks items={LEARN} pathname={pathname} compact={prefs.compactNav} />
          {!prefs.compactNav && (
            <p className="mt-6 px-2 text-[10px] leading-relaxed text-muted-foreground">
              local-first · zero-cost
            </p>
          )}
        </aside>

        <main
          id="main"
          className={cn(
            "min-w-0 flex-1 pb-28",
            prefs.density === "compact"
              ? "px-3 pt-3 md:px-5 lg:px-6"
              : "px-4 pt-6 md:px-8 lg:px-10",
          )}
        >
          {children}
        </main>
      </div>

      <PrefsSheet open={prefsOpen} onOpenChange={setPrefsOpen} />

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Jump to a page…" />
        <CommandList>
          <CommandEmpty>No page found.</CommandEmpty>
          <CommandGroup heading="Operate">
            {OPS.map((item) => (
              <CommandItem
                key={item.href}
                onSelect={() => go(item.href)}
                value={`${item.label} ${item.hint ?? ""}`}
              >
                <item.icon className="size-4" />
                <span>{item.label}</span>
                {item.hint ? (
                  <span className="ml-auto text-xs text-muted-foreground">{item.hint}</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Learn">
            {LEARN.map((item) => (
              <CommandItem key={item.href} onSelect={() => go(item.href)} value={item.label}>
                <item.icon className="size-4" />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <ControlDock />
    </div>
  );
}

function isNavActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function OperateMoreMenu({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const routeActive = items.some((item) => isNavActive(item.href, pathname));

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] transition-colors",
          routeActive
            ? "bg-secondary text-foreground"
            : open
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
        )}
      >
        More
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="More operate pages"
          className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {items.map((item) => {
            const active = isNavActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <item.icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MobileNavRow({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className="w-16 shrink-0 text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <nav aria-label={label} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {items.map((item) => (
          <TopLink key={item.href} item={item} pathname={pathname} compact />
        ))}
      </nav>
    </div>
  );
}

function TopLink({
  item,
  pathname,
  compact,
}: {
  item: NavItem;
  pathname: string;
  compact?: boolean;
}) {
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "shrink-0 rounded-md px-2 py-1 text-[12px] transition-colors",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
        compact && "text-[11px]",
      )}
    >
      {item.label}
    </Link>
  );
}

function NavLinks({
  items,
  pathname,
  compact,
}: {
  items: NavItem[];
  pathname: string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            title={compact ? label : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              compact && "justify-center px-0",
            )}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
            {compact ? <span className="sr-only">{label}</span> : label}
          </Link>
        );
      })}
    </div>
  );
}
