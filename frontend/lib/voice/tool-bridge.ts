// Browser → server tool execution for Gemini Live function calls.
//
// The model loop runs in Gemini; every tool still executes on our API with the user's
// cookie, so RBAC, data scope, surface limits and audit apply exactly as for text chat.

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolBridgeResult {
  id: string;
  name: string;
  /** Becomes the Live `functionResponse.response`. */
  response: Record<string, unknown>;
  scheduling: "WHEN_IDLE" | "INTERRUPT" | "SILENT";
}

interface ToolEnvelope {
  model_view?: Record<string, unknown>;
  scheduling?: string;
}

/** Same-origin proxy by default (httpOnly cookie); direct base when NEXT_PUBLIC_API_BASE is set. */
export function voiceApiRoot(): string {
  const direct = process.env.NEXT_PUBLIC_API_BASE;
  return direct ? `${direct.replace(/\/$/, "")}/api/v1` : "/qc-api/v1";
}

function credentials(): RequestCredentials {
  return process.env.NEXT_PUBLIC_API_BASE ? "include" : "same-origin";
}

const SCHEDULES = new Set(["WHEN_IDLE", "INTERRUPT", "SILENT"]);
const TIMEOUT_MS = 30_000;

export function toolUrl(name: string): string {
  return `${voiceApiRoot()}/assistant/tools/${encodeURIComponent(name)}`;
}

/** Run one tool. Failures become `{ error }` payloads the model can narrate — never a throw. */
export async function callTool(call: ToolCall, signal?: AbortSignal): Promise<ToolBridgeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const res = await fetch(toolUrl(call.name), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: credentials(),
      cache: "no-store",
      body: JSON.stringify({ args: call.args ?? {}, channel: "voice" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: unknown };
        if (typeof body.detail === "string") detail = body.detail;
      } catch {
        // Non-JSON body.
      }
      return { id: call.id, name: call.name, response: { error: detail }, scheduling: "WHEN_IDLE" };
    }
    const data = (await res.json()) as ToolEnvelope;
    const scheduling = SCHEDULES.has(data.scheduling ?? "")
      ? (data.scheduling as ToolBridgeResult["scheduling"])
      : "WHEN_IDLE";
    return { id: call.id, name: call.name, response: { output: data.model_view ?? {} }, scheduling };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "the tool timed out" : "the tool is unavailable";
    return { id: call.id, name: call.name, response: { error: detail }, scheduling: "WHEN_IDLE" };
  } finally {
    clearTimeout(timer);
  }
}
