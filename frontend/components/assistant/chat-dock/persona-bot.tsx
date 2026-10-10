"use client";

import { Avatar } from "@bible-strong/avatar-react";
import type { AvatarDefinition } from "@bible-strong/avatar-core";
import { validateAvatarDefinition } from "@bible-strong/avatar-core";
import { useMemo } from "react";
import type { ChatEmotion } from "@/lib/assistant/chat-session";
import strobiJson from "@/lib/assistant/avatars/strobi.avatar.json";
import { cn } from "@/lib/utils";
import { botStyleFor } from "./bot-catalog";

export interface PersonaBotProps {
  persona?: string | null;
  emotion?: ChatEmotion;
  size?: number;
  /** Kept for API compatibility with the previous mouth-driven SVG bot. */
  mouthSource?: () => number;
  className?: string;
  compact?: boolean;
}

const EMOTION_TO_ANIMATION: Record<ChatEmotion, string> = {
  idle: "idle",
  listen: "listening",
  think: "thinking",
  speak: "happy",
  error: "confused",
};

function toHex6(color: string): `#${string}` {
  const cleaned = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(cleaned)) return cleaned as `#${string}`;
  return "#5b7fe5";
}

function definitionForPersona(persona: string | null | undefined): AvatarDefinition {
  const style = botStyleFor(persona);
  const candidate = {
    ...strobiJson,
    name: style.label,
    colors: {
      body: toHex6(style.fill),
      eyes: toHex6(style.eye.length === 7 ? "#111316" : style.eye),
    },
  };
  // Keep eye color dark for contrast on tinted bodies.
  candidate.colors.eyes = "#111316";
  const result = validateAvatarDefinition(candidate);
  if (!result.ok) {
    const fallback = validateAvatarDefinition(strobiJson);
    if (!fallback.ok) {
      throw new Error(fallback.errors.map((e) => e.message).join("; "));
    }
    return fallback.value;
  }
  return result.value;
}

export function PersonaBot({
  persona,
  emotion = "idle",
  size = 96,
  className,
}: PersonaBotProps) {
  const definition = useMemo(() => definitionForPersona(persona), [persona]);
  const animation = EMOTION_TO_ANIMATION[emotion] ?? "idle";

  return (
    <div
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
      data-emotion={emotion}
      data-bot={botStyleFor(persona).id}
    >
      <Avatar
        definition={definition}
        animation={animation}
        size={size}
        ariaLabel={`${botStyleFor(persona).label} assistant`}
        className="bs-avatar--qc"
        onError={(error) => {
          if (process.env.NODE_ENV !== "production") {
            console.warn("avatar", error);
          }
        }}
      />
    </div>
  );
}
