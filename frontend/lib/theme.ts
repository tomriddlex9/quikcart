import { Laptop, Moon, Sun, Circle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Themes the console exposes in the cycle / prefs UI. */
export const THEME_VALUES = ["light", "dark", "black", "system"] as const;
export type ThemeValue = (typeof THEME_VALUES)[number];

/** Themes that next-themes may set as a class on <html> (system resolves to light/dark). */
export const THEME_CLASS_VALUES = ["light", "dark", "black"] as const;

export const THEME_OPTIONS: {
  value: ThemeValue;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "black", label: "Black", icon: Circle },
  { value: "system", label: "System", icon: Laptop },
];

export const THEME_ICON: Record<ThemeValue, LucideIcon> = {
  light: Sun,
  dark: Moon,
  black: Circle,
  system: Laptop,
};

/** Cycle order for the header theme button (includes system). */
export const THEME_CYCLE: readonly ThemeValue[] = THEME_VALUES;

export function nextTheme(current: string | undefined): ThemeValue {
  const idx = THEME_CYCLE.indexOf((current as ThemeValue) ?? "system");
  return THEME_CYCLE[(idx < 0 ? 0 : idx + 1) % THEME_CYCLE.length];
}

/** True when the resolved surface is dark-like (dark charcoal or true black). */
export function isDarkLike(resolved: string | undefined | null): boolean {
  return resolved === "dark" || resolved === "black";
}

/** Sonner only accepts light | dark | system. */
export function sonnerTheme(
  theme: string | undefined,
): "light" | "dark" | "system" {
  if (theme === "black") return "dark";
  if (theme === "light" || theme === "dark" || theme === "system") return theme;
  return "system";
}

export function themeLabel(theme: string | undefined): string {
  const opt = THEME_OPTIONS.find((o) => o.value === theme);
  return opt?.label ?? theme ?? "system";
}
