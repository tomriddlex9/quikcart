// Fetch helpers for the QuickCart API.
//
// Mode semantics (surfaced in the UI, never hidden):
//   "live" — the API answered and the payload is real
//   "demo" — the API could not be reached; clearly-labeled local demo data is shown instead
//   "offline" — unreachable and no demo fallback was provided for this call

export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export type ApiMode = "live" | "demo" | "offline";

export interface ApiState<T> {
  mode: ApiMode;
  data: T | null;
  error: string | null;
  lastUpdated: Date | null;
}

const DEFAULT_TIMEOUT_MS = 5000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiGetJson<T>(path: string): Promise<T> {
  const res = await fetchWithTimeout(
    `${API_BASE}${path}`,
    { headers: { Accept: "application/json" }, cache: "no-store" },
    DEFAULT_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`GET ${path} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export type PostResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; detail: string };

export async function apiPostJson<T>(
  path: string,
  body: unknown,
): Promise<PostResult<T>> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_BASE}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      },
      DEFAULT_TIMEOUT_MS,
    );
  } catch {
    return { ok: false, status: 0, detail: "API unreachable" };
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const bodyJson = (await res.json()) as { detail?: string };
      if (bodyJson.detail) detail = bodyJson.detail;
    } catch {
      // non-JSON error body; keep the status-based detail
    }
    return { ok: false, status: res.status, detail };
  }
  return { ok: true, status: res.status, data: (await res.json()) as T };
}
