"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { ChevronDown, Menu, TerminalSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingThemeToggle } from "@/components/marketing/theme-toggle";
import { isDarkLike } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV = [
  {
    href: "#problem",
    label: "Problem",
  },
  {
    href: "#features",
    label: "Features",
    children: [
      { href: "#features", label: "What you get" },
      { href: "#stack", label: "Technical stack" },
      { href: "#business", label: "Business view" },
    ],
  },
  { href: "#stack", label: "Stack" },
  { href: "#business", label: "Business" },
] as const;

type SiteHeaderProps = {
  /** When true, section anchors and auth CTAs are shown (landing). */
  showNav?: boolean;
  /** Transparent glass bar for photo heroes / login meadow. */
  overMedia?: boolean;
  className?: string;
};

export function SiteHeader({ showNav = false, overMedia = false, className }: SiteHeaderProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!overMedia) return;
    const onScroll = () => setScrolled(window.scrollY > 48);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overMedia]);

  useEffect(() => {
    if (!featuresOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setFeaturesOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFeaturesOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [featuresOpen]);

  // White-on-photo only in dark themes while still over the media. Light mode
  // always uses theme foreground so the bar stays readable.
  const darkMedia =
    overMedia && !scrolled && mounted && isDarkLike(resolvedTheme);
  const solid = !overMedia || scrolled || (mounted && !isDarkLike(resolvedTheme));

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-colors",
        darkMedia
          ? "border-b border-white/15 bg-black/25 backdrop-blur-xl"
          : solid
            ? "border-b border-border/80 bg-background/90 text-foreground backdrop-blur-md"
            : "border-b border-border/60 bg-background/80 text-foreground backdrop-blur-xl",
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-4 px-4 md:px-6">
        <Link
          href="/home"
          className={cn(
            "flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            darkMedia ? "text-white" : "text-foreground",
          )}
        >
          <TerminalSquare className="size-4" strokeWidth={1.75} aria-hidden />
          <span className="text-sm font-medium tracking-tight">QuickCart</span>
        </Link>

        {showNav ? (
          <nav
            className={cn(
              "ml-2 hidden items-center gap-0.5 md:flex",
              darkMedia ? "text-white/85" : "text-muted-foreground",
            )}
            aria-label="Page sections"
          >
            {NAV.map((item) =>
              "children" in item && item.children ? (
                <div key={item.label} className="relative" ref={menuRef}>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      darkMedia ? "hover:text-white" : "hover:text-foreground",
                    )}
                    aria-expanded={featuresOpen}
                    onClick={() => setFeaturesOpen((v) => !v)}
                  >
                    {item.label}
                    <ChevronDown className="size-3.5 opacity-70" aria-hidden />
                  </button>
                  {featuresOpen ? (
                    <div
                      className={cn(
                        "absolute left-0 top-full z-50 mt-2 min-w-[11rem] rounded-2xl border p-1.5 shadow-lg",
                        darkMedia
                          ? "border-white/20 bg-white/15 text-white backdrop-blur-xl"
                          : "border-border bg-popover text-popover-foreground",
                      )}
                    >
                      {item.children.map((child) => (
                        <a
                          key={child.href + child.label}
                          href={child.href}
                          onClick={() => setFeaturesOpen(false)}
                          className={cn(
                            "block rounded-xl px-3 py-2 text-sm transition-colors",
                            darkMedia ? "hover:bg-white/15" : "hover:bg-muted",
                          )}
                        >
                          {child.label}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <a
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    darkMedia ? "hover:text-white" : "hover:text-foreground",
                  )}
                >
                  {item.label}
                </a>
              ),
            )}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <MarketingThemeToggle
            className={
              darkMedia
                ? "text-white hover:bg-white/10 hover:text-white"
                : "text-muted-foreground"
            }
          />
          {showNav ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "md:hidden",
                  darkMedia && "text-white hover:bg-white/10 hover:text-white",
                )}
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="marketing-mobile-nav"
                aria-label={open ? "Close menu" : "Open menu"}
              >
                {open ? <X className="size-4" /> : <Menu className="size-4" />}
              </Button>
              <Button
                nativeButton={false}
                render={<Link href="/login" />}
                variant="ghost"
                size="sm"
                className={cn(
                  "hidden sm:inline-flex",
                  darkMedia && "text-white hover:bg-white/10 hover:text-white",
                )}
              >
                Sign in
              </Button>
              <Button
                nativeButton={false}
                render={<Link href="/login" />}
                size="sm"
                className={cn(
                  "hidden sm:inline-flex",
                  darkMedia && "bg-white text-neutral-900 hover:bg-white/90",
                )}
              >
                Get started
              </Button>
            </>
          ) : (
            <Button
              nativeButton={false}
              render={<Link href="/home" />}
              variant="ghost"
              size="sm"
              className={cn(
                "hidden sm:inline-flex",
                darkMedia && "text-white hover:bg-white/10 hover:text-white",
              )}
            >
              Home
            </Button>
          )}
        </div>
      </div>

      {showNav && open ? (
        <div
          id="marketing-mobile-nav"
          className={cn(
            "border-t px-4 py-3 md:hidden",
            darkMedia
              ? "border-white/15 bg-black/40 text-white backdrop-blur-xl"
              : "border-border bg-background/95 text-foreground",
          )}
        >
          <nav className="flex flex-col gap-1" aria-label="Mobile sections">
            {NAV.map((item) => (
              <a
                key={item.href + item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-md px-2 py-2 text-sm",
                  darkMedia
                    ? "hover:bg-white/10"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {item.label}
              </a>
            ))}
            <div className="mt-2 flex gap-2">
              <Button
                nativeButton={false}
                render={<Link href="/login" />}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                Sign in
              </Button>
              <Button
                nativeButton={false}
                render={<Link href="/login" />}
                size="sm"
                className="flex-1"
              >
                Get started
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
