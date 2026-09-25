"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createElement } from "react";

export type TeamLens = "ops" | "data" | "ml" | "support" | "exec";
export type Density = "comfortable" | "compact";
export type Accent = "steel" | "teal" | "amber";
export type Radius = "sharp" | "default" | "soft";

export type Prefs = {
  team: TeamLens;
  density: Density;
  accent: Accent;
  radius: Radius;
  reducedMotion: boolean;
  compactNav: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  team: "ops",
  density: "comfortable",
  accent: "steel",
  radius: "default",
  reducedMotion: false,
  compactNav: false,
};

const STORAGE_KEY = "qc_prefs_v1";

export const TEAM_LENS_OPTIONS: { value: TeamLens; label: string }[] = [
  { value: "ops", label: "Ops" },
  { value: "data", label: "Data" },
  { value: "ml", label: "ML" },
  { value: "support", label: "Support" },
  { value: "exec", label: "Exec" },
];

export const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

export const ACCENT_OPTIONS: { value: Accent; label: string }[] = [
  { value: "steel", label: "Steel" },
  { value: "teal", label: "Teal" },
  { value: "amber", label: "Amber" },
];

export const RADIUS_OPTIONS: { value: Radius; label: string }[] = [
  { value: "sharp", label: "Sharp" },
  { value: "default", label: "Default" },
  { value: "soft", label: "Soft" },
];

function isPrefs(value: unknown): value is Partial<Prefs> {
  return typeof value === "object" && value !== null;
}

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    if (!isPrefs(parsed)) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

function applyPrefsToDocument(prefs: Prefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-density", prefs.density);
  root.setAttribute("data-accent", prefs.accent);
  root.setAttribute("data-radius", prefs.radius);
  root.setAttribute("data-reduced-motion", String(prefs.reducedMotion));
  root.setAttribute("data-team", prefs.team);
}

type PrefsContextValue = {
  prefs: Prefs;
  setPrefs: (next: Partial<Prefs>) => void;
  resetPrefs: () => void;
};

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const loaded = loadPrefs();
    setPrefsState(loaded);
    applyPrefsToDocument(loaded);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    applyPrefsToDocument(prefs);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // localStorage unavailable (private mode, quota) — preferences stay in-memory only.
    }
  }, [prefs, hydrated]);

  const setPrefs = useCallback((next: Partial<Prefs>) => {
    setPrefsState((prev) => ({ ...prev, ...next }));
  }, []);

  const resetPrefs = useCallback(() => {
    setPrefsState(DEFAULT_PREFS);
  }, []);

  const value = useMemo(
    () => ({ prefs, setPrefs, resetPrefs }),
    [prefs, setPrefs, resetPrefs],
  );

  return createElement(PrefsContext.Provider, { value }, children);
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) {
    throw new Error("usePrefs must be used within a PrefsProvider");
  }
  return ctx;
}
