import Link from "next/link";
import { TerminalSquare } from "lucide-react";

const FOOTER_LINKS = [
  { href: "/home#problem", label: "Problem" },
  { href: "/home#features", label: "Features" },
  { href: "/home#stack", label: "Stack" },
  { href: "/home#business", label: "Business" },
  { href: "/login", label: "Sign in" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-4 py-10 md:flex-row md:items-end md:justify-between md:px-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TerminalSquare className="size-3.5" strokeWidth={1.75} aria-hidden />
            <span className="text-sm font-medium tracking-tight">QuickCart</span>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Local-first quick-commerce intelligence. One laptop, the full pipeline.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between px-4 py-4 text-xs text-muted-foreground md:px-6">
          <span>Built for learning · Zero-cost by default</span>
          <span className="font-mono">PostgreSQL → Delta → Agent</span>
        </div>
      </div>
    </footer>
  );
}
