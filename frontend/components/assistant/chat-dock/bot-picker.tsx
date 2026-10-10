"use client";

import { chatActions, useChatSession } from "@/lib/assistant/chat-session";
import { cn } from "@/lib/utils";
import { botsForSide, botStyleFor, type ExperienceSide } from "./bot-catalog";
import { PersonaBot } from "./persona-bot";

export function BotPicker({
  experience,
  className,
}: {
  experience: ExperienceSide;
  className?: string;
}) {
  const session = useChatSession();
  const bots = botsForSide(experience);
  const active = botStyleFor(session.botId);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Change bot
        </p>
        <p className="truncate text-[11px] text-muted-foreground" style={{ color: active.accent }}>
          {active.displayName} · {active.focus}
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Assistant bots">
        {bots.map((bot) => {
          const selected = bot.id === session.botId;
          return (
            <button
              key={bot.id}
              type="button"
              role="option"
              aria-selected={selected}
              title={`${bot.displayName}: ${bot.blurb}`}
              onClick={() => chatActions.setBotId(bot.id)}
              className={cn(
                "flex shrink-0 flex-col items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors",
                selected
                  ? "border-foreground/40 bg-muted"
                  : "border-transparent hover:border-border hover:bg-muted/50",
              )}
              style={selected ? { boxShadow: `inset 0 0 0 1px ${bot.accent}` } : undefined}
            >
              <PersonaBot persona={bot.id} emotion={selected ? "listen" : "idle"} size={40} compact />
              <span className="text-[11px] font-medium" style={{ color: bot.accent }}>
                {bot.displayName}
              </span>
            </button>
          );
        })}
      </div>
      <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">{active.personality}</p>
    </div>
  );
}
