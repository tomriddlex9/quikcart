"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Highlights a page section during a guided tour. The section carries `data-journey-id`;
 * it lights up when the tour links here with `?spot=<journeyId>` (or when `active` is forced).
 */
export function Spotlight({
  journeyId,
  active,
  children,
  className,
}: {
  journeyId?: string;
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [fromUrl, setFromUrl] = useState(false);
  useEffect(() => {
    if (!journeyId) return;
    const spot = new URLSearchParams(window.location.search).get("spot");
    setFromUrl(spot === journeyId);
    if (spot !== journeyId) return;
    document.querySelector(`[data-journey-id="${journeyId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [journeyId]);

  const on = active ?? fromUrl;
  return (
    <div
      data-journey-id={journeyId}
      data-spotlight={on ? "on" : "off"}
      className={cn(
        "rounded-xl transition-shadow",
        on && "ring-2 ring-ring ring-offset-2 ring-offset-background motion-safe:animate-pulse",
        className,
      )}
    >
      {children}
    </div>
  );
}
