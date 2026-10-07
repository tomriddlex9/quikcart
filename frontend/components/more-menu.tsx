"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Pin,
  PinOff,
  Play,
  Search,
  Settings2,
  SunMoon,
} from "lucide-react";
import { LEARN, OPS, type NavItem } from "@/lib/nav";
import { openSimDock } from "@/lib/sim-dock";
import { useApiData } from "@/lib/use-api";
import type { SystemStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const PINS_KEY = "qc_nav_pins_v1";
const RECENTS_KEY = "qc_nav_recents_v1";
const MAX_RECENTS = 5;

type Filter = "all" | "operate" | "learn";

function readList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, values: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Private browsing and quota errors leave the in-memory list in place.
  }
}

function isNavActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function matches(item: NavItem, query: string) {
  if (!query) return true;
  const haystack = `${item.label} ${item.hint ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

export function MoreMenu({
  pathname,
  themeLabel,
  onCycleTheme,
  onOpenPrefs,
  onOpenSearch,
}: {
  pathname: string;
  themeLabel: string;
  onCycleTheme: () => void;
  onOpenPrefs: () => void;
  onOpenSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pins, setPins] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const health = useApiData<SystemStatus>(open ? "/api/v1/system/status" : null, 60_000);

  const overflow = OPS.slice(6);
  const routeActive = overflow.some((item) => isNavActive(item.href, pathname));

  useEffect(() => {
    setPins(readList(PINS_KEY));
    setRecents(readList(RECENTS_KEY));
  }, []);

  useEffect(() => {
    const known = [...OPS, ...LEARN].some((item) => item.href === pathname);
    if (!known) return;
    setRecents((current) => {
      const next = [pathname, ...current.filter((href) => href !== pathname)].slice(0, MAX_RECENTS);
      writeList(RECENTS_KEY, next);
      return next;
    });
  }, [pathname]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const pool = useMemo(() => {
    const operate = filter === "learn" ? [] : OPS;
    const learn = filter === "operate" ? [] : LEARN;
    return [...operate, ...learn].filter((item) => matches(item, needle));
  }, [filter, needle]);

  const byHref = useMemo(() => {
    const map = new Map<string, NavItem>();
    for (const item of [...OPS, ...LEARN]) map.set(item.href, item);
    return map;
  }, []);

  const pinnedItems = pins.flatMap((href) => {
    const item = byHref.get(href);
    return item ? [item] : [];
  });
  const recentItems = recents.flatMap((href) => {
    const item = byHref.get(href);
    if (!item || item.href === pathname) return [];
    return [item];
  });

  const quickActions = useMemo(
    () => [
      { id: "sim", label: "Open simulator", hint: "start, stop, rate", run: () => openSimDock() },
      { id: "theme", label: `Theme · ${themeLabel}`, hint: "cycle light, dark, system", run: onCycleTheme },
      { id: "prefs", label: "Preferences", hint: "team lens, density", run: onOpenPrefs },
      {
        id: "copy",
        label: copied ? "Link copied" : "Copy page link",
        hint: "this URL",
        run: () => {
          const url = window.location.href;
          void navigator.clipboard?.writeText(url).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            },
            () => setCopied(false),
          );
        },
      },
      { id: "search", label: "Command search", hint: "⌘K", run: onOpenSearch },
    ],
    [copied, onCycleTheme, onOpenPrefs, onOpenSearch, themeLabel],
  );

  const visibleActions = needle
    ? quickActions.filter((action) => `${action.label} ${action.hint}`.toLowerCase().includes(needle))
    : quickActions;

  type Row =
    | { kind: "action"; id: string; label: string; run: () => void }
    | { kind: "page"; item: NavItem };

  const rows: Row[] = [
    ...visibleActions.map((action) => ({ kind: "action" as const, id: action.id, label: action.label, run: action.run })),
    ...pool.map((item) => ({ kind: "page" as const, item })),
  ];

  const togglePin = (href: string) => {
    setPins((current) => {
      const next = current.includes(href) ? current.filter((value) => value !== href) : [href, ...current];
      writeList(PINS_KEY, next);
      return next;
    });
  };

  const activate = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "action") {
      row.run();
      if (row.id !== "theme" && row.id !== "copy") setOpen(false);
      return;
    }
    setOpen(false);
    router.push(row.item.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (rows.length === 0 ? 0 : (index + 1) % rows.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length));
      return;
    }
    if (event.key === "Enter" && document.activeElement === searchRef.current) {
      event.preventDefault();
      activate(activeIndex);
    }
  };

  const healthLabel =
    health.mode === "live"
      ? "API live"
      : health.mode === "demo"
        ? "Demo data"
        : health.mode === "stale"
          ? "API last live"
          : health.error
            ? "API unreachable"
            : "Checking API";

  return (
    <div ref={rootRef} className="relative shrink-0" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
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
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} strokeWidth={1.75} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="dialog"
          aria-label="More pages and actions"
          className="absolute left-0 top-full z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="border-b border-border p-2">
            <label className="flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5">
              <Search className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Search pages and actions"
                aria-label="Search pages and actions"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
            </label>
            <div className="mt-2 flex gap-1" role="tablist" aria-label="Page group">
              {(
                [
                  ["all", "All"],
                  ["operate", "Operate"],
                  ["learn", "Learn"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => {
                    setFilter(value);
                    setActiveIndex(0);
                  }}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px]",
                    filter === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[min(70vh,28rem)] overflow-y-auto p-1">
            <Link
              href="/logs"
              className="mb-1 flex items-center justify-between rounded-md px-2 py-1.5 text-[12px] hover:bg-secondary/60"
              onClick={() => setOpen(false)}
            >
              <span className="text-muted-foreground">System status</span>
              <span className={cn("font-medium", health.error ? "text-destructive" : "text-foreground")}>
                {healthLabel}
              </span>
            </Link>

            {visibleActions.length > 0 ? (
              <section className="mb-1" aria-label="Quick actions">
                <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Actions
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {visibleActions.map((action) => {
                    const index = rows.findIndex((row) => row.kind === "action" && row.id === action.id);
                    const Icon =
                      action.id === "sim"
                        ? Play
                        : action.id === "theme"
                          ? SunMoon
                          : action.id === "prefs"
                            ? Settings2
                            : action.id === "copy"
                              ? copied
                                ? Check
                                : Copy
                              : Search;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => activate(index)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px]",
                          activeIndex === index ? "bg-secondary text-foreground" : "hover:bg-secondary/60",
                        )}
                      >
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                        <span className="truncate">{action.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {!needle && filter === "all" && pinnedItems.length > 0 ? (
              <PageGroup
                title="Pinned"
                items={pinnedItems}
                pathname={pathname}
                pins={pins}
                rows={rows}
                activeIndex={activeIndex}
                onHover={setActiveIndex}
                onPin={togglePin}
                onNavigate={() => setOpen(false)}
              />
            ) : null}

            {!needle && filter === "all" && recentItems.length > 0 ? (
              <PageGroup
                title="Recent"
                items={recentItems}
                pathname={pathname}
                pins={pins}
                rows={rows}
                activeIndex={activeIndex}
                onHover={setActiveIndex}
                onPin={togglePin}
                onNavigate={() => setOpen(false)}
                extra={
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      writeList(RECENTS_KEY, []);
                      setRecents([]);
                    }}
                  >
                    Clear
                  </button>
                }
              />
            ) : null}

            <PageGroup
              title={needle ? "Matches" : filter === "learn" ? "Learn" : filter === "operate" ? "Operate" : "Pages"}
              items={
                !needle && filter === "all"
                  ? pool.filter(
                      (item) =>
                        !pins.includes(item.href) && !recentItems.some((recent) => recent.href === item.href),
                    )
                  : pool
              }
              pathname={pathname}
              pins={pins}
              rows={rows}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onPin={togglePin}
              onNavigate={() => setOpen(false)}
            />

            {rows.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No pages or actions match.</p>
            ) : null}
          </div>
          <p className="border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
            ↑↓ move · enter open · esc close · pin keeps a page at the top
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PageGroup({
  title,
  items,
  pathname,
  pins,
  rows,
  activeIndex,
  onHover,
  onPin,
  onNavigate,
  extra,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  pins: string[];
  rows: Array<{ kind: "action"; id: string } | { kind: "page"; item: NavItem }>;
  activeIndex: number;
  onHover: (index: number) => void;
  onPin: (href: string) => void;
  onNavigate: () => void;
  extra?: ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-1" aria-label={title}>
      <div className="flex items-center justify-between px-2 py-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        {extra}
      </div>
      {items.map((item) => {
        const index = rows.findIndex((row) => row.kind === "page" && row.item.href === item.href);
        const active = isNavActive(item.href, pathname);
        const pinned = pins.includes(item.href);
        return (
          <div
            key={`${title}-${item.href}`}
            className={cn(
              "flex items-center rounded-md pr-1",
              activeIndex === index ? "bg-secondary text-foreground" : "hover:bg-secondary/60",
            )}
            onMouseEnter={() => onHover(index)}
          >
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px]"
            >
              <item.icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{item.label}</span>
              {item.hint ? <span className="ml-auto truncate text-[11px] text-muted-foreground">{item.hint}</span> : null}
            </Link>
            <button
              type="button"
              aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
              aria-pressed={pinned}
              onClick={() => onPin(item.href)}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              {pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
            </button>
          </div>
        );
      })}
    </section>
  );
}
