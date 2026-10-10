"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { businessRouteFor, opsRouteFor } from "@/lib/business-nav";
import { cn } from "@/lib/utils";

/** Business ⇄ Operations. Lands on the closest matching page in the other experience. */
export function ExperienceSwitcher({
  current,
  className,
}: {
  current: "business" | "ops";
  className?: string;
}) {
  const pathname = usePathname() ?? (current === "business" ? "/b/today" : "/");
  const otherHref = current === "business" ? opsRouteFor(pathname) : businessRouteFor(pathname);

  return (
    <nav
      aria-label="Experience"
      className={cn("inline-flex rounded-lg bg-muted p-0.5 text-xs", className)}
    >
      {current === "business" ? (
        <>
          <span
            aria-current="page"
            className="rounded-md bg-background px-2.5 py-1 font-medium text-foreground shadow-sm"
          >
            Business
          </span>
          <Link
            href={otherHref}
            className="rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Operations
          </Link>
        </>
      ) : (
        <>
          <Link
            href={otherHref}
            className="rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Business
          </Link>
          <span
            aria-current="page"
            className="rounded-md bg-background px-2.5 py-1 font-medium text-foreground shadow-sm"
          >
            Operations
          </span>
        </>
      )}
    </nav>
  );
}
