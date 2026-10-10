"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nextTheme, THEME_ICON, type ThemeValue } from "@/lib/theme";

export function MarketingThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const ThemeIcon = mounted ? THEME_ICON[(theme as ThemeValue) ?? "system"] : Moon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className ?? "text-muted-foreground"}
      onClick={() => setTheme(nextTheme(theme))}
      aria-label="Cycle theme"
      title={`Theme: ${theme ?? "system"} (${resolvedTheme ?? "…"})`}
    >
      <ThemeIcon className="size-3.5" />
    </Button>
  );
}
