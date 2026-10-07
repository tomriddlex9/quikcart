"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type DataSource = "api" | "demo";

const STORAGE_KEY = "qc_data_source_v1";

type DataModeContextValue = {
  source: DataSource;
  setSource: (next: DataSource) => void;
};

const DataModeContext = createContext<DataModeContextValue | null>(null);

function readStoredSource(): DataSource {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "demo" || raw === "api") return raw;
  } catch {
    // Private mode or a blocked storage API — stay on the API default.
  }
  return "api";
}

export function DataModeProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<DataSource>("api");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSourceState(readStoredSource());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, source);
    } catch {
      // Preferences stay in memory for this tab.
    }
  }, [source, hydrated]);

  const setSource = useCallback((next: DataSource) => {
    setSourceState(next);
  }, []);

  const value = useMemo(() => ({ source, setSource }), [source, setSource]);

  return <DataModeContext.Provider value={value}>{children}</DataModeContext.Provider>;
}

export function useDataMode(): DataModeContextValue {
  const value = useContext(DataModeContext);
  if (!value) {
    return { source: "api", setSource: () => {} };
  }
  return value;
}
