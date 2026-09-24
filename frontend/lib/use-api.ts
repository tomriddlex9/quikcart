"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGetJson, type ApiMode, type ApiState } from "./api";

/**
 * Poll a GET endpoint. On success the real payload is used (mode "live");
 * on any failure the provided demo fallback is used and the mode becomes
 * "demo" so the UI can label it honestly. Pass `refreshMs` for live polling.
 */
export function useApiData<T>(
  path: string | null,
  demo: T,
  refreshMs?: number,
): ApiState<T> & { reload: () => void; tick: number } {
  const [state, setState] = useState<ApiState<T>>({
    mode: "offline",
    data: null,
    error: null,
    lastUpdated: null,
  });
  const [tick, setTick] = useState(0);
  const demoRef = useRef(demo);
  demoRef.current = demo;

  const load = useCallback(async () => {
    if (path === null) return;
    try {
      const data = await apiGetJson<T>(path);
      setState({ mode: "live", data, error: null, lastUpdated: new Date() });
    } catch (err) {
      setState({
        mode: "demo",
        data: demoRef.current,
        error: err instanceof Error ? err.message : "API unreachable",
        lastUpdated: new Date(),
      });
    }
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled || path === null) return;
      try {
        const data = await apiGetJson<T>(path);
        if (!cancelled) {
          setState({ mode: "live", data, error: null, lastUpdated: new Date() });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            mode: "demo",
            data: demoRef.current,
            error: err instanceof Error ? err.message : "API unreachable",
            lastUpdated: new Date(),
          });
        }
      }
    };
    void run();
    if (!refreshMs || refreshMs <= 0) return;
    const id = setInterval(() => void run(), refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [path, refreshMs, tick]);

  return { ...state, reload: () => setTick((t) => t + 1), tick };
}
