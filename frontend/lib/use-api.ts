"use client";

import { useEffect, useRef, useState } from "react";
import { apiGetJson, type ApiState } from "./api";
import { useDataMode } from "./data-mode";
import { demoPayload } from "./demo-payload";

/**
 * Poll a GET endpoint. Success is mode "live". A later failure keeps the last
 * payload as "stale". The first failure is "offline" with data null.
 * Mode "demo" is only the header toggle: it returns a bundled fixture and
 * does not call the network.
 */
export function useApiData<T>(
  path: string | null,
  refreshMs?: number,
): ApiState<T> & { reload: () => void; tick: number } {
  const { source } = useDataMode();
  const [state, setState] = useState<ApiState<T>>({
    mode: "offline",
    data: null,
    error: null,
    lastUpdated: null,
  });
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (source === "demo") return;
    let cancelled = false;
    const run = async () => {
      if (cancelled || path === null || inFlight.current) return;
      inFlight.current = true;
      try {
        const data = await apiGetJson<T>(path);
        if (!cancelled) {
          setState({ mode: "live", data, error: null, lastUpdated: new Date() });
        }
      } catch (err) {
        if (!cancelled) {
          const error = err instanceof Error ? err.message : "API unreachable";
          setState((previous) =>
            previous.mode === "live" || previous.mode === "stale"
              ? { ...previous, mode: "stale", error }
              : { mode: "offline", data: null, error, lastUpdated: null },
          );
        }
      } finally {
        inFlight.current = false;
      }
    };
    void run();
    if (!refreshMs || refreshMs <= 0) return;
    const id = setInterval(() => void run(), refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [path, refreshMs, tick, source]);

  if (source === "demo") {
    if (path === null) {
      return { mode: "demo", data: null, error: null, lastUpdated: null, reload: () => {}, tick: 0 };
    }
    const fixture = demoPayload(path);
    return {
      mode: "demo",
      data: fixture === undefined ? null : (fixture as T),
      error: fixture === undefined ? "No demo fixture for this endpoint." : null,
      lastUpdated: null,
      reload: () => {},
      tick: 0,
    };
  }

  return { ...state, reload: () => setTick((t) => t + 1), tick };
}
