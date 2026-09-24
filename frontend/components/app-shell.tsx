"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Brain,
  Database,
  Gauge,
  GitPullRequestArrow,
  LayoutList,
  MonitorCog,
  Package,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/ml", label: "ML platform", icon: Brain },
  { href: "/data", label: "Gold marts", icon: Database },
  { href: "/agent", label: "Agent console", icon: Bot },
  { href: "/system", label: "System map", icon: Workflow },
  { href: "/tech", label: "Tech stack", icon: Package },
  { href: "/proposals", label: "Proposals", icon: GitPullRequestArrow },
  { href: "/logs", label: "Pipeline & logs", icon: LayoutList },
  { href: "/streamlit", label: "Streamlit", icon: MonitorCog },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-ink text-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-amber focus:px-3 focus:py-2 focus:text-ink"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-52 flex-col border-r border-line-soft bg-ink-2 md:flex">
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-4">
          <TerminalSquare className="h-5 w-5 text-amber" strokeWidth={1.75} />
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight">
              QuickCart
            </div>
            <div className="text-[10px] text-faint">intelligence console</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Primary">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`mb-0.5 flex items-center gap-2.5 rounded-xs px-2.5 py-2 text-[12.5px] transition-colors ${
                  active
                    ? "bg-panel-2 text-paper"
                    : "text-muted hover:bg-panel hover:text-paper-dim"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${active ? "text-amber" : "text-faint"}`}
                  strokeWidth={1.75}
                />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line-soft px-4 py-3 text-[10px] leading-relaxed text-faint">
          local-first · zero-cost
          <br />
          15-phase learning platform
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-1 overflow-x-auto border-b border-line-soft bg-ink px-2 py-2 md:hidden">
        <TerminalSquare className="mx-1 h-4 w-4 shrink-0 text-amber" strokeWidth={1.75} />
        {NAV.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`shrink-0 rounded-xs px-2 py-1 text-[11px] ${
                active ? "bg-panel-2 text-paper" : "text-muted"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <main id="main" className="min-w-0 flex-1 px-4 pb-16 pt-16 md:ml-52 md:px-8 md:pt-8 lg:px-10">
        <div className="mx-auto max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
