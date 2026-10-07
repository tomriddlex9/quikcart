"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { opsRouteFor } from "@/lib/business-nav";
import { cn } from "@/lib/utils";

/** Business ⇄ Operations. Lands on the closest matching page in the other experience. */
export function ExperienceSwitcher({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/b/today";
  const opsHref = opsRouteFor(pathname);
  return (
    <nav
      aria-label="Experience"
      className={cn("inline-flex rounded-lg bg-muted p-0.5 text-xs", className)}
    >
      <span
        aria-current="page"
        className="rounded-md bg-background px-2.5 py-1 font-medium text-foreground shadow-sm"
      >
        Business
      </span>
      <Link
        href={opsHref}
        className="rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        Operations
      </Link>
    </nav>
  );
}
