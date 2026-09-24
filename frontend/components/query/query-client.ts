// Local POST helper for the /query workbench.
//
// `apiPostJson` in `@/lib/api` is fixed at a 5s timeout, which suits fast writes like
// approving a proposal but not SQL generation via a local Ollama model (which can take
// well over a minute on CPU) or long-running analytical queries. Rather than edit the
// shared helper — other agents are also touching `lib/api.ts` — this module reimplements
// the same `PostResult<T>` contract with a caller-supplied timeout, kept local to the
// query feature.

import { API_BASE, type PostResult } from "@/lib/api";

export async function postJsonWithTimeout<T>(
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<PostResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = controller.signal.aborted;
    return {
      ok: false,
      status: 0,
      detail: timedOut
        ? `request timed out after ${Math.round(timeoutMs / 1000)}s`
        : err instanceof Error
          ? err.message
          : "API unreachable",
    };
  } finally {
    clearTimeout(timer);
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
