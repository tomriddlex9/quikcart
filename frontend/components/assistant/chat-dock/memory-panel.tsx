"use client";

import { useSyncExternalStore, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addGlobalMemory,
  addLocalMemory,
  getChatMemories,
  removeGlobalMemory,
  removeLocalMemory,
  subscribeChatMemory,
  type MemoryItem,
} from "@/lib/assistant/chat-memory";

export function MemoryPanel({ sessionId }: { sessionId: string }) {
  const memories = useSyncExternalStore(
    subscribeChatMemory,
    () => getChatMemories(sessionId),
    () => ({ local: [] as MemoryItem[], global: [] as MemoryItem[] }),
  );
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"local" | "global">("global");

  const add = () => {
    if (scope === "global") addGlobalMemory(draft);
    else addLocalMemory(sessionId, draft);
    setDraft("");
  };

  return (
    <div className="space-y-3 text-[12px]">
      <p className="text-muted-foreground">
        Local memories stay in this chat. Global memories follow you across chats. They shape tone
        and continuity — numbers still come from live tools.
      </p>
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant={scope === "global" ? "default" : "ghost"}
          className="h-7 px-2 text-[11px]"
          onClick={() => setScope("global")}
        >
          Global
        </Button>
        <Button
          type="button"
          size="sm"
          variant={scope === "local" ? "default" : "ghost"}
          className="h-7 px-2 text-[11px]"
          onClick={() => setScope("local")}
        >
          This chat
        </Button>
      </div>
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            scope === "global"
              ? "e.g. I manage Store 3 in Bengaluru"
              : "e.g. Focus on dairy this shift"
          }
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[12px] outline-none focus-visible:border-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" size="sm" className="h-8" disabled={!draft.trim()} onClick={add}>
          Add
        </Button>
      </div>
      <MemoryList
        title="Global"
        items={memories.global}
        onRemove={(id) => removeGlobalMemory(id)}
      />
      <MemoryList
        title="This chat"
        items={memories.local}
        onRemove={(id) => removeLocalMemory(sessionId, id)}
      />
    </div>
  );
}

function MemoryList({
  title,
  items,
  onRemove,
}: {
  title: string;
  items: MemoryItem[];
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 font-medium text-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-muted-foreground">None yet.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((m) => (
            <li
              key={m.id}
              className="flex items-start gap-1 rounded-md border border-border bg-background px-2 py-1.5"
            >
              <span className="min-w-0 flex-1 leading-snug">{m.text}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${title.toLowerCase()} memory`}
                onClick={() => onRemove(m.id)}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
