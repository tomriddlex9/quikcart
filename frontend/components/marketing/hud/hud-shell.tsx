"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { MarketingThemeToggle } from "@/components/marketing/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HudShellProps = {
  children: ReactNode;
  /** Extra status text in the top bar. */
  status?: string;
  nodeId?: string;
  showAuthLinks?: boolean;
  className?: string;
};

function formatToday(): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
      .format(new Date())
      .toUpperCase();
  } catch {
    return "TODAY";
  }
}

export function HudShell({
  children,
  status = "CONNECTED",
  nodeId = "QC-NODE-042",
  showAuthLinks = true,
  className,
}: HudShellProps) {
  const [today, setToday] = useState("TODAY");

  useEffect(() => {
    setToday(formatToday());
  }, []);

  return (
    <div className={cn("qc-hud min-h-screen bg-background text-foreground", className)}>
      <div className="qc-hud-frame mx-auto flex min-h-screen max-w-[1280px] flex-col border border-foreground/35 md:my-3 md:min-h-[calc(100vh-1.5rem)]">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-foreground/35 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] md:px-4">
          <Link href="/home" className="font-medium tracking-[0.18em] text-foreground">
            QuickCart
          </Link>
          <span className="text-status-good" aria-live="polite">
            + {status}
          </span>
          <span className="hidden text-muted-foreground sm:inline">{nodeId}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">{today}</span>
            <MarketingThemeToggle className="text-muted-foreground" />
            {showAuthLinks ? (
              <>
                <Button
                  nativeButton={false}
                  render={<Link href="/login" />}
                  variant="ghost"
                  size="xs"
                  className="font-mono text-[10px] uppercase tracking-[0.14em]"
                >
                  Sign in
                </Button>
                <Button
                  nativeButton={false}
                  render={<Link href="/login" />}
                  size="xs"
                  className="font-mono text-[10px] uppercase tracking-[0.14em]"
                >
                  Enter
                </Button>
              </>
            ) : (
              <Button
                nativeButton={false}
                render={<Link href="/home" />}
                variant="ghost"
                size="xs"
                className="font-mono text-[10px] uppercase tracking-[0.14em]"
              >
                Home
              </Button>
            )}
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/35 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:px-4">
          <span>Local-first · Zero-cost by default</span>
          <span>PostgreSQL → Delta → Agent</span>
        </footer>
      </div>
    </div>
  );
}
