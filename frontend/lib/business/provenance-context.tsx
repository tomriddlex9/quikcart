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
import type { MetricValue } from "@/lib/business/types";
import {
  readProvenanceMode,
  writeProvenanceMode,
} from "@/lib/business/provenance";

type ProvenanceContextValue = {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  inspectMetric: MetricValue | null;
  openInspector: (metric: MetricValue) => void;
  closeInspector: () => void;
};

const ProvenanceContext = createContext<ProvenanceContextValue | null>(null);

export function ProvenanceProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [inspectMetric, setInspectMetric] = useState<MetricValue | null>(null);

  useEffect(() => {
    setEnabledState(readProvenanceMode());
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    writeProvenanceMode(on);
    if (!on) setInspectMetric(null);
  }, []);

  const openInspector = useCallback((metric: MetricValue) => {
    setInspectMetric(metric);
  }, []);

  const closeInspector = useCallback(() => setInspectMetric(null), []);

  const value = useMemo(
    () => ({ enabled, setEnabled, inspectMetric, openInspector, closeInspector }),
    [enabled, setEnabled, inspectMetric, openInspector, closeInspector],
  );

  return <ProvenanceContext.Provider value={value}>{children}</ProvenanceContext.Provider>;
}

const FALLBACK: ProvenanceContextValue = {
  enabled: false,
  setEnabled: () => {},
  inspectMetric: null,
  openInspector: () => {},
  closeInspector: () => {},
};

export function useProvenance(): ProvenanceContextValue {
  return useContext(ProvenanceContext) ?? FALLBACK;
}
