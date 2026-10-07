"use client";

// Data hook for /api/v1/b/*. Live first; falls back to per-persona demo fixtures when
// the Demo toggle is on or the API cannot answer (mirrors lib/use-api.ts semantics).

import { useCallback, useEffect, useState } from "react";
import { useBusiness } from "@/lib/business/business-context";
import { demoBusinessPayload } from "@/lib/business/demo-business";
import { useDataMode } from "@/lib/data-mode";

/** Same-origin proxy by default; a direct base when NEXT_PUBLIC_API_BASE is set. */
export function apiRoot(): string {
  const direct = process.env.NEXT_PUBLIC_API_BASE;
  return direct ? `${direct.replace(/\/$/, "")}/api/v1` : "/qc-api/v1";
}

export function businessApiBase(): string {
  return `${apiRoot()}/b`;
}

const TIMEOUT_MS = 8_000;

export type BusinessMode = "live" | "demo";

export interface BusinessData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  mode: BusinessMode;
  /** Why we are showing sample data when the API was expected. */
  fallbackReason: string | null;
  reload: () => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function fetchBusiness<T>(path: string, root: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${root}${path}`, {
      headers: { Accept: "application/json" },
      credentials: process.env.NEXT_PUBLIC_API_BASE ? "include" : "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (typeof body.detail === "string") detail = body.detail;
      } catch {
        // Non-JSON error body; keep the status text.
      }
      throw new HttpError(res.status, detail);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Client errors (not found / no permission) are real answers; everything else falls back. */
function shouldFallBack(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 500 || error.status === 401;
  return true;
}

export interface BusinessDataOptions<T> {
  /** Read from the general API (`/api/v1/...`) instead of the business API (`/api/v1/b/...`). */
  general?: boolean;
  /** Sample payload used in demo mode or when the API is down (general endpoints only). */
  fixture?: () => T;
}

export function useBusinessData<T>(
  path: string | null,
  options: BusinessDataOptions<T> = {},
): BusinessData<T> {
  const { general = false, fixture: customFixture } = options;
  const { source } = useDataMode();
  const { persona } = useBusiness();
  const [state, setState] = useState<Omit<BusinessData<T>, "reload">>({
    data: null,
    loading: path !== null,
    error: null,
    mode: "live",
    fallbackReason: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (path === null) {
      setState({ data: null, loading: false, error: null, mode: "live", fallbackReason: null });
      return;
    }
    let cancelled = false;
    const fixture = (reason: string | null) => {
      const payload = customFixture ? customFixture() : demoBusinessPayload(persona, path);
      setState(
        payload === undefined
          ? { data: null, loading: false, error: "That page isn't available.", mode: "demo", fallbackReason: reason }
          : { data: payload as T, loading: false, error: null, mode: "demo", fallbackReason: reason },
      );
    };

    setState((prev) => ({ ...prev, loading: true, error: null }));
    if (source === "demo") {
      fixture(null);
      return;
    }
    fetchBusiness<T>(path, general ? apiRoot() : businessApiBase())
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null, mode: "live", fallbackReason: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (shouldFallBack(error)) {
          fixture(error instanceof Error ? error.message : "The data service is not reachable.");
        } else {
          setState({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : "Something went wrong.",
            mode: "live",
            fallbackReason: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, source, persona, tick, general, customFixture]);

  return { ...state, reload };
}
