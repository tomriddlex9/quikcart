/**
 * Chat memories: local (this session) and global (across chats).
 * Global facts live in localStorage; local notes follow the active sessionId.
 */

export interface MemoryItem {
  id: string;
  text: string;
  createdAt: number;
}

export interface ChatMemories {
  local: MemoryItem[];
  global: MemoryItem[];
}

const GLOBAL_KEY = "qc_chat_global_memory_v1";
const LOCAL_KEY_PREFIX = "qc_chat_local_memory_v1:";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeChatMemory(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readList(key: string): MemoryItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MemoryItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) => m && typeof m.id === "string" && typeof m.text === "string" && m.text.trim(),
    );
  } catch {
    return [];
  }
}

function writeList(key: string, items: MemoryItem[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(items.slice(0, 40)));
  } catch {
    /* quota / private mode */
  }
  emit();
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getGlobalMemories(): MemoryItem[] {
  return readList(GLOBAL_KEY);
}

export function getLocalMemories(sessionId: string): MemoryItem[] {
  if (!sessionId) return [];
  return readList(`${LOCAL_KEY_PREFIX}${sessionId}`);
}

export function getChatMemories(sessionId: string): ChatMemories {
  return {
    local: getLocalMemories(sessionId),
    global: getGlobalMemories(),
  };
}

export function addGlobalMemory(text: string): MemoryItem | null {
  const cleaned = text.trim().slice(0, 280);
  if (!cleaned) return null;
  const item: MemoryItem = { id: newId(), text: cleaned, createdAt: Date.now() };
  writeList(GLOBAL_KEY, [item, ...getGlobalMemories()]);
  return item;
}

export function removeGlobalMemory(id: string) {
  writeList(
    GLOBAL_KEY,
    getGlobalMemories().filter((m) => m.id !== id),
  );
}

export function addLocalMemory(sessionId: string, text: string): MemoryItem | null {
  const cleaned = text.trim().slice(0, 280);
  if (!cleaned || !sessionId) return null;
  const item: MemoryItem = { id: newId(), text: cleaned, createdAt: Date.now() };
  writeList(`${LOCAL_KEY_PREFIX}${sessionId}`, [item, ...getLocalMemories(sessionId)]);
  return item;
}

export function removeLocalMemory(sessionId: string, id: string) {
  if (!sessionId) return;
  writeList(
    `${LOCAL_KEY_PREFIX}${sessionId}`,
    getLocalMemories(sessionId).filter((m) => m.id !== id),
  );
}

export function clearLocalMemories(sessionId: string) {
  if (!sessionId || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(`${LOCAL_KEY_PREFIX}${sessionId}`);
  } catch {
    /* ignore */
  }
  emit();
}

/** Strings for the agent API (capped). */
export function memoryPayload(sessionId: string): {
  local: string[];
  global: string[];
} {
  const mem = getChatMemories(sessionId);
  return {
    local: mem.local.map((m) => m.text).slice(0, 12),
    global: mem.global.map((m) => m.text).slice(0, 12),
  };
}
