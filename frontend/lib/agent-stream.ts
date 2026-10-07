import { API_BASE } from "@/lib/api";
import {
  parseCard,
  parseProvenance,
  type AssistantCard,
  type Provenance,
  type ToolStartEvent,
} from "@/lib/assistant/types";
import type { AgentEvidence, AgentToolTrace, ChatResponse } from "@/lib/types";

export type AgentStreamStage =
  | "classifying"
  | "planning"
  | "tools"
  | "action"
  | "answer";

/** `done` payload: the classic chat response plus the hydrated answer envelope. */
export interface AgentDonePayload extends ChatResponse {
  cards: AssistantCard[];
  followups: string[];
  provenance: Provenance | null;
}

export interface AgentStreamHandlers {
  onStatus?: (stage: AgentStreamStage, model?: string | null) => void;
  onTool?: (tool: {
    name: string;
    ok: boolean;
    cache_hit: boolean;
    summary: string;
  }) => void;
  onToolStart?: (tool: ToolStartEvent) => void;
  onToken?: (text: string) => void;
  onCard?: (card: AssistantCard) => void;
  onFollowups?: (items: string[]) => void;
  onDone?: (payload: AgentDonePayload) => void;
  onError?: (detail: string) => void;
}

const STREAM_TIMEOUT_MS = 90_000;

function parseBlock(block: string): { event: string; data: Record<string, unknown> } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function streamAgentChat(
  message: string,
  sessionId: string,
  handlers: AgentStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(`${API_BASE}/api/v1/agent/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ message, session_id: sessionId }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (body.detail) detail = body.detail;
      } catch {
        /* keep status */
      }
      handlers.onError?.(detail);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const parsed = parseBlock(part);
        if (!parsed) continue;
        const { event, data } = parsed;
        if (event === "status") {
          const stage = data.stage as AgentStreamStage;
          handlers.onStatus?.(stage, typeof data.model === "string" ? data.model : null);
        } else if (event === "tool") {
          handlers.onTool?.({
            name: String(data.name ?? "tool"),
            ok: data.ok !== false,
            cache_hit: Boolean(data.cache_hit),
            summary: String(data.summary ?? ""),
          });
        } else if (event === "tool_start") {
          handlers.onToolStart?.({
            name: String(data.name ?? "tool"),
            step: typeof data.step === "number" ? data.step : undefined,
          });
        } else if (event === "token") {
          handlers.onToken?.(String(data.text ?? ""));
        } else if (event === "card") {
          const card = parseCard(data);
          if (card) handlers.onCard?.(card);
        } else if (event === "followups") {
          const items = Array.isArray(data.items)
            ? data.items.filter((i): i is string => typeof i === "string")
            : [];
          handlers.onFollowups?.(items);
        } else if (event === "error") {
          handlers.onError?.(String(data.detail ?? data.answer ?? "agent stream failed"));
        } else if (event === "done") {
          handlers.onDone?.({
            answer: String(data.answer ?? ""),
            evidence: Array.isArray(data.evidence) ? (data.evidence as AgentEvidence[]) : [],
            tool_trace: Array.isArray(data.tool_trace)
              ? (data.tool_trace as AgentToolTrace[])
              : [],
            request_id: typeof data.request_id === "string" ? data.request_id : null,
            degraded: Boolean(data.degraded),
            model: typeof data.model === "string" ? data.model : null,
            cards: Array.isArray(data.cards)
              ? data.cards.flatMap((c) => {
                  const card = parseCard(c);
                  return card ? [card] : [];
                })
              : [],
            followups: Array.isArray(data.followups)
              ? data.followups.filter((i): i is string => typeof i === "string")
              : [],
            provenance: parseProvenance(data.provenance),
          });
        }
      }
    }
  } catch (err) {
    const aborted = controller.signal.aborted;
    handlers.onError?.(
      aborted
        ? "request timed out or was cancelled"
        : err instanceof Error
          ? err.message
          : "API unreachable",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
