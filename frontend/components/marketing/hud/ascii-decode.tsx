"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/components/marketing/hud/use-prefers-reduced-motion";

const SCRAMBLE = "░▒▓█/#*+=:.·";

type AsciiDecodeProps = {
  text: string;
  className?: string;
  /** Re-trigger scramble when this becomes true (e.g. hover). */
  active?: boolean;
  as?: "span" | "p" | "h2" | "h3";
};

export function AsciiDecode({
  text,
  className,
  active = false,
  as: Tag = "span",
}: AsciiDecodeProps) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    if (reduced || !active) {
      setDisplay(text);
      return;
    }

    let frame = 0;
    let raf = 0;
    const chars = text.split("");
    const total = 14;

    const tick = () => {
      frame += 1;
      const progress = Math.min(1, frame / total);
      setDisplay(
        chars
          .map((ch, i) => {
            if (ch === " ") return " ";
            if (i / chars.length < progress) return ch;
            return SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]!;
          })
          .join(""),
      );
      if (progress < 1) raf = requestAnimationFrame(tick);
      else setDisplay(text);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced, text]);

  return <Tag className={cn("font-mono", className)}>{display}</Tag>;
}
